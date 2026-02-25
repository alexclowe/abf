/**
 * Postgres-backed memory store with pgvector support.
 * Use when storage.backend = 'postgres' in abf.config.yaml.
 *
 * Tables:
 *   abf_agent_history  — append-only per-agent history entries
 *   abf_agent_charter  — one charter per agent (upsert)
 *   abf_decisions       — team/company-wide decisions
 *   abf_knowledge       — key-value structured knowledge
 */

import pg from 'pg';
import type { AgentId, Checksum, ISOTimestamp, TeamId } from '../types/common.js';
import type { ABFError, Result } from '../types/errors.js';
import { Err, MemoryError, Ok } from '../types/errors.js';
import type {
	AgentMemoryContext,
	IMemoryStore,
	MemoryEntry,
	MemoryLayer,
} from '../types/memory.js';
import { computeChecksum } from '../util/checksum.js';

const { Pool } = pg;

export class PostgresMemoryStore implements IMemoryStore {
	private readonly pool: InstanceType<typeof Pool>;

	constructor(connectionString: string, poolSize?: number | undefined) {
		this.pool = new Pool({
			connectionString,
			max: poolSize ?? 10,
		});
	}

	/** Run once at startup to create tables and indexes. */
	async initialize(): Promise<void> {
		await this.pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
		await this.pool.query(`
			CREATE TABLE IF NOT EXISTS abf_agent_history (
				id          BIGSERIAL PRIMARY KEY,
				agent_id    TEXT NOT NULL,
				content     TEXT NOT NULL,
				timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				checksum    TEXT NOT NULL,
				embedding   vector(1536)
			)
		`);
		await this.pool.query(`
			CREATE INDEX IF NOT EXISTS idx_abf_history_agent
				ON abf_agent_history(agent_id, timestamp DESC)
		`);
		await this.pool.query(`
			CREATE TABLE IF NOT EXISTS abf_agent_charter (
				agent_id    TEXT PRIMARY KEY,
				content     TEXT NOT NULL,
				updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				checksum    TEXT NOT NULL
			)
		`);
		await this.pool.query(`
			CREATE TABLE IF NOT EXISTS abf_decisions (
				id          BIGSERIAL PRIMARY KEY,
				team_id     TEXT,
				content     TEXT NOT NULL,
				timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				checksum    TEXT NOT NULL
			)
		`);
		await this.pool.query(`
			CREATE TABLE IF NOT EXISTS abf_knowledge (
				key         TEXT PRIMARY KEY,
				content     TEXT NOT NULL,
				updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				checksum    TEXT NOT NULL
			)
		`);
	}

	async read(agentId: AgentId, layer: MemoryLayer): Promise<Result<string, ABFError>> {
		try {
			if (layer === 'charter') {
				const r = await this.pool.query<{ content: string }>(
					`SELECT content FROM abf_agent_charter WHERE agent_id = $1`,
					[agentId],
				);
				if (r.rows.length === 0) {
					return Err(
						new MemoryError('MEMORY_READ_FAILED', `No charter for ${agentId}`, {}),
					);
				}
				return Ok(r.rows[0]!.content);
			}
			if (layer === 'history') {
				const r = await this.pool.query<{ content: string }>(
					`SELECT content FROM abf_agent_history WHERE agent_id = $1 ORDER BY timestamp DESC LIMIT 20`,
					[agentId],
				);
				return Ok(r.rows.map((row) => row.content).join('\n\n---\n\n'));
			}
			if (layer === 'decisions') {
				const r = await this.pool.query<{ content: string }>(
					`SELECT content FROM abf_decisions ORDER BY timestamp DESC LIMIT 10`,
				);
				return Ok(r.rows.map((row) => row.content).join('\n\n---\n\n'));
			}
			if (layer === 'knowledge') {
				const r = await this.pool.query<{ key: string; content: string }>(
					`SELECT key, content FROM abf_knowledge`,
				);
				return Ok(
					JSON.stringify(
						Object.fromEntries(r.rows.map((row) => [row.key, row.content])),
					),
				);
			}
			return Err(
				new MemoryError('MEMORY_READ_FAILED', `Unsupported layer: ${String(layer)}`, {}),
			);
		} catch (e) {
			return Err(
				new MemoryError(
					'MEMORY_READ_FAILED',
					`Failed to read ${layer} for ${agentId}: ${String(e)}`,
					{},
				),
			);
		}
	}

	async append(
		agentId: AgentId,
		_layer: 'history',
		content: string,
	): Promise<Result<void, ABFError>> {
		try {
			const checksum = computeChecksum(content);
			await this.pool.query(
				`INSERT INTO abf_agent_history(agent_id, content, checksum) VALUES($1, $2, $3)`,
				[agentId, content, checksum],
			);
			return Ok(undefined);
		} catch (e) {
			return Err(
				new MemoryError(
					'MEMORY_WRITE_FAILED',
					`Failed to append history for ${agentId}: ${String(e)}`,
					{},
				),
			);
		}
	}

	async write(
		agentId: AgentId,
		layer: Exclude<MemoryLayer, 'history'>,
		content: string,
	): Promise<Result<void, ABFError>> {
		try {
			const checksum = computeChecksum(content);
			if (layer === 'charter') {
				await this.pool.query(
					`INSERT INTO abf_agent_charter(agent_id, content, checksum)
					 VALUES($1, $2, $3)
					 ON CONFLICT(agent_id) DO UPDATE SET content=$2, checksum=$3, updated_at=NOW()`,
					[agentId, content, checksum],
				);
			} else if (layer === 'decisions') {
				await this.pool.query(
					`INSERT INTO abf_decisions(content, checksum) VALUES($1, $2)`,
					[content, checksum],
				);
			} else if (layer === 'knowledge') {
				await this.pool.query(
					`INSERT INTO abf_knowledge(key, content, checksum)
					 VALUES($1, $2, $3)
					 ON CONFLICT(key) DO UPDATE SET content=$2, checksum=$3, updated_at=NOW()`,
					[agentId, content, checksum],
				);
			}
			return Ok(undefined);
		} catch (e) {
			return Err(
				new MemoryError(
					'MEMORY_WRITE_FAILED',
					`Failed to write ${layer} for ${agentId}: ${String(e)}`,
					{},
				),
			);
		}
	}

	async loadContext(agentId: AgentId): Promise<Result<AgentMemoryContext, ABFError>> {
		try {
			const [charterResult, historyResult, decisionResult, knowledgeResult] =
				await Promise.all([
					this.pool.query<{ content: string }>(
						`SELECT content FROM abf_agent_charter WHERE agent_id = $1`,
						[agentId],
					),
					this.pool.query<{ content: string; timestamp: Date; checksum: string }>(
						`SELECT content, timestamp, checksum FROM abf_agent_history WHERE agent_id = $1 ORDER BY timestamp DESC LIMIT 20`,
						[agentId],
					),
					this.pool.query<{
						content: string;
						team_id: string | null;
						timestamp: Date;
						checksum: string;
					}>(
						`SELECT content, team_id, timestamp, checksum FROM abf_decisions ORDER BY timestamp DESC LIMIT 10`,
					),
					this.pool.query<{ key: string; content: string }>(
						`SELECT key, content FROM abf_knowledge`,
					),
				]);

			const charter = charterResult.rows[0]?.content ?? '';

			const history: MemoryEntry[] = historyResult.rows.map((row) => ({
				layer: 'history' as MemoryLayer,
				agentId,
				content: row.content,
				timestamp: row.timestamp.toISOString() as ISOTimestamp,
				checksum: row.checksum as Checksum,
			}));

			const decisions: MemoryEntry[] = decisionResult.rows.map((row) => {
				const entry: MemoryEntry = {
					layer: 'decisions' as MemoryLayer,
					content: row.content,
					timestamp: row.timestamp.toISOString() as ISOTimestamp,
					checksum: row.checksum as Checksum,
				};
				if (row.team_id !== null) {
					return { ...entry, teamId: row.team_id as TeamId };
				}
				return entry;
			});

			const knowledge: Record<string, string> = Object.fromEntries(
				knowledgeResult.rows.map((row) => [row.key, row.content]),
			);

			return Ok({ charter, history, decisions, knowledge, pendingMessages: 0 });
		} catch (e) {
			return Err(
				new MemoryError(
					'MEMORY_READ_FAILED',
					`Failed to load context for ${agentId}: ${String(e)}`,
					{},
				),
			);
		}
	}

	async verify(agentId: AgentId, layer: MemoryLayer): Promise<Result<boolean, ABFError>> {
		try {
			if (layer === 'charter') {
				const r = await this.pool.query<{ content: string; checksum: string }>(
					`SELECT content, checksum FROM abf_agent_charter WHERE agent_id = $1`,
					[agentId],
				);
				if (r.rows.length === 0) return Ok(false);
				const row = r.rows[0]!;
				return Ok(computeChecksum(row.content) === row.checksum);
			}
			if (layer === 'history') {
				const r = await this.pool.query<{ content: string; checksum: string }>(
					`SELECT content, checksum FROM abf_agent_history WHERE agent_id = $1 ORDER BY timestamp DESC LIMIT 1`,
					[agentId],
				);
				if (r.rows.length === 0) return Ok(true);
				const row = r.rows[0]!;
				return Ok(computeChecksum(row.content) === row.checksum);
			}
			return Ok(true);
		} catch (e) {
			return Err(
				new MemoryError(
					'MEMORY_INTEGRITY_FAILED',
					`Failed to verify ${layer} for ${agentId}: ${String(e)}`,
					{},
				),
			);
		}
	}

	async list(
		layer: MemoryLayer,
		filter?: { readonly teamId?: TeamId | undefined } | undefined,
	): Promise<Result<readonly MemoryEntry[], ABFError>> {
		try {
			if (layer === 'decisions') {
				const r = filter?.teamId
					? await this.pool.query<{
							content: string;
							team_id: string | null;
							timestamp: Date;
							checksum: string;
						}>(
							`SELECT content, team_id, timestamp, checksum FROM abf_decisions WHERE team_id = $1 ORDER BY timestamp DESC`,
							[filter.teamId],
						)
					: await this.pool.query<{
							content: string;
							team_id: string | null;
							timestamp: Date;
							checksum: string;
						}>(
							`SELECT content, team_id, timestamp, checksum FROM abf_decisions ORDER BY timestamp DESC`,
						);

				const entries: MemoryEntry[] = r.rows.map((row) => {
					const entry: MemoryEntry = {
						layer: 'decisions' as MemoryLayer,
						content: row.content,
						timestamp: row.timestamp.toISOString() as ISOTimestamp,
						checksum: row.checksum as Checksum,
					};
					if (row.team_id !== null) {
						return { ...entry, teamId: row.team_id as TeamId };
					}
					return entry;
				});
				return Ok(entries);
			}
			return Ok([]);
		} catch (e) {
			return Err(
				new MemoryError(
					'MEMORY_READ_FAILED',
					`Failed to list ${layer}: ${String(e)}`,
					{},
				),
			);
		}
	}

	/** Gracefully close the connection pool. */
	async disconnect(): Promise<void> {
		await this.pool.end();
	}
}
