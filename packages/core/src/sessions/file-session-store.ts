/**
 * File-based session store.
 * Persists SessionResult to JSONL files (one per day) under logs/sessions/.
 * Used to restore agent stats (cost, session count) across restarts.
 */

import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId, ISOTimestamp, USDCents } from '../types/common.js';
import type { SessionResult } from '../types/session.js';

export interface AgentStats {
	totalCost: USDCents;
	sessionsCompleted: number;
	errorCount: number;
	lastActive?: ISOTimestamp;
}

export interface ISessionStore {
	persist(result: SessionResult): Promise<void>;
	getAgentStats(agentId: AgentId): Promise<AgentStats>;
	query(filter?: { agentId?: AgentId; limit?: number }): Promise<SessionResult[]>;
}

export class FileSessionStore implements ISessionStore {
	private readonly dir: string;
	/** Cached per-agent stats. Invalidated on persist(). */
	private statsCache: Map<string, AgentStats> | null = null;

	constructor(logsDir: string) {
		this.dir = join(logsDir, 'sessions');
	}

	async persist(result: SessionResult): Promise<void> {
		await mkdir(this.dir, { recursive: true });

		const date = result.completedAt.slice(0, 10); // YYYY-MM-DD
		const filePath = join(this.dir, `${date}.jsonl`);
		await appendFile(filePath, `${JSON.stringify(result)}\n`, 'utf-8');

		// Invalidate stats cache so next getAgentStats() re-scans
		this.statsCache = null;
	}

	async getAgentStats(agentId: AgentId): Promise<AgentStats> {
		if (!this.statsCache) {
			await this.buildStatsCache();
		}
		return (
			this.statsCache!.get(agentId) ?? {
				totalCost: 0 as USDCents,
				sessionsCompleted: 0,
				errorCount: 0,
			}
		);
	}

	async query(filter?: { agentId?: AgentId; limit?: number }): Promise<SessionResult[]> {
		const limit = filter?.limit ?? Number.MAX_SAFE_INTEGER;

		let files: string[];
		try {
			files = await readdir(this.dir);
		} catch {
			return []; // directory doesn't exist yet
		}

		const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
		// Newest files first
		jsonlFiles.sort().reverse();

		const results: SessionResult[] = [];

		for (const file of jsonlFiles) {
			const content = await readFile(join(this.dir, file), 'utf-8');
			const lines = content.trim().split('\n').filter(Boolean);
			// Newest entries first (bottom of file = most recent)
			lines.reverse();

			for (const line of lines) {
				const entry = JSON.parse(line) as SessionResult;

				if (filter?.agentId && entry.agentId !== filter.agentId) continue;

				results.push(entry);
				if (results.length >= limit) return results;
			}
		}

		return results;
	}

	private async buildStatsCache(): Promise<void> {
		const cache = new Map<string, AgentStats>();

		let files: string[];
		try {
			files = await readdir(this.dir);
		} catch {
			this.statsCache = cache;
			return;
		}

		const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));

		for (const file of jsonlFiles) {
			const content = await readFile(join(this.dir, file), 'utf-8');
			const lines = content.trim().split('\n').filter(Boolean);

			for (const line of lines) {
				const entry = JSON.parse(line) as SessionResult;
				const existing = cache.get(entry.agentId) ?? {
					totalCost: 0 as USDCents,
					sessionsCompleted: 0,
					errorCount: 0,
				};

				existing.totalCost = ((existing.totalCost as number) +
					(entry.cost as number)) as USDCents;
				existing.sessionsCompleted += 1;
				if (entry.status === 'failed') existing.errorCount += 1;

				// Track latest activity
				if (!existing.lastActive || entry.completedAt > existing.lastActive) {
					existing.lastActive = entry.completedAt as ISOTimestamp;
				}

				cache.set(entry.agentId, existing);
			}
		}

		this.statsCache = cache;
	}
}
