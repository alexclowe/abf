/**
 * Filesystem-based memory store.
 * Stores agent memory as Markdown files with checksum integrity.
 *
 * Layout:
 *   {basePath}/agents/{agentId}/charter.md
 *   {basePath}/agents/{agentId}/history.md
 *   {basePath}/decisions.md
 *   {basePath}/knowledge/{key}.md
 */

import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId, TeamId } from '../types/common.js';
import type { ABFError, Result } from '../types/errors.js';
import { Err, MemoryError, Ok } from '../types/errors.js';
import type {
	AgentMemoryContext,
	IMemoryStore,
	MemoryEntry,
	MemoryLayer,
} from '../types/memory.js';
import { computeChecksum, verifyChecksum } from '../util/checksum.js';
import { toISOTimestamp } from '../util/id.js';

export class FilesystemMemoryStore implements IMemoryStore {
	constructor(private readonly basePath: string) {}

	async read(agentId: AgentId, layer: MemoryLayer): Promise<Result<string, ABFError>> {
		const filePath = this.getPath(agentId, layer);
		try {
			const content = await readFile(filePath, 'utf-8');
			return Ok(content);
		} catch {
			return Err(
				new MemoryError('MEMORY_READ_FAILED', `Failed to read ${layer} for agent ${agentId}`, {
					agentId,
					layer,
					path: filePath,
				}),
			);
		}
	}

	async append(
		agentId: AgentId,
		_layer: 'history',
		content: string,
	): Promise<Result<void, ABFError>> {
		const filePath = this.getPath(agentId, 'history');
		try {
			await this.ensureDir(filePath);
			const timestamp = toISOTimestamp();
			const entry = `\n---\n_${timestamp}_\n\n${content}\n`;
			await appendFile(filePath, entry, 'utf-8');

			// Write checksum sidecar
			const fullContent = await readFile(filePath, 'utf-8');
			const checksum = computeChecksum(fullContent);
			await writeFile(`${filePath}.checksum`, checksum, 'utf-8');

			return Ok(undefined);
		} catch (e) {
			return Err(
				new MemoryError('MEMORY_WRITE_FAILED', `Failed to append history for agent ${agentId}`, {
					agentId,
					error: String(e),
				}),
			);
		}
	}

	async write(
		agentId: AgentId,
		layer: Exclude<MemoryLayer, 'history'>,
		content: string,
	): Promise<Result<void, ABFError>> {
		const filePath = this.getPath(agentId, layer);
		try {
			await this.ensureDir(filePath);
			await writeFile(filePath, content, 'utf-8');

			// Write checksum sidecar
			const checksum = computeChecksum(content);
			await writeFile(`${filePath}.checksum`, checksum, 'utf-8');

			return Ok(undefined);
		} catch (e) {
			return Err(
				new MemoryError('MEMORY_WRITE_FAILED', `Failed to write ${layer} for agent ${agentId}`, {
					agentId,
					layer,
					error: String(e),
				}),
			);
		}
	}

	async loadContext(agentId: AgentId): Promise<Result<AgentMemoryContext, ABFError>> {
		// Read charter, history, and decisions in parallel
		const [charterResult, historyResult, decisionsResult] = await Promise.all([
			this.read(agentId, 'charter'),
			this.read(agentId, 'history'),
			this.read(agentId, 'decisions'),
		]);

		const charter = charterResult.ok ? charterResult.value : '';

		const historyContent = historyResult.ok ? historyResult.value : '';
		const history: MemoryEntry[] = historyContent
			? [
					{
						layer: 'history',
						agentId,
						content: historyContent,
						timestamp: toISOTimestamp(),
						checksum: computeChecksum(historyContent),
					},
				]
			: [];

		const decisionsContent = decisionsResult.ok ? decisionsResult.value : '';
		const decisions: MemoryEntry[] = decisionsContent
			? [
					{
						layer: 'decisions',
						content: decisionsContent,
						timestamp: toISOTimestamp(),
						checksum: computeChecksum(decisionsContent),
					},
				]
			: [];

		// Load knowledge files — parallel reads within the directory
		const knowledge: Record<string, string> = {};
		const knowledgeDir = join(this.basePath, 'knowledge');
		try {
			const files = await readdir(knowledgeDir);
			const mdFiles = files.filter((f) => f.endsWith('.md'));
			const entries = await Promise.all(
				mdFiles.map(async (file) => {
					const content = await readFile(join(knowledgeDir, file), 'utf-8');
					return [file.replace('.md', ''), content] as const;
				}),
			);
			for (const [key, content] of entries) {
				knowledge[key] = content;
			}
		} catch {
			// Knowledge dir may not exist
		}

		return Ok({
			charter,
			history,
			decisions,
			knowledge,
			pendingMessages: 0, // Filled by the runtime from the bus
		});
	}

	async verify(agentId: AgentId, layer: MemoryLayer): Promise<Result<boolean, ABFError>> {
		const filePath = this.getPath(agentId, layer);
		try {
			const content = await readFile(filePath, 'utf-8');
			const storedChecksum = await readFile(`${filePath}.checksum`, 'utf-8');
			return Ok(
				verifyChecksum(content, storedChecksum.trim() as import('../types/common.js').Checksum),
			);
		} catch {
			return Err(
				new MemoryError(
					'MEMORY_INTEGRITY_FAILED',
					`Failed to verify ${layer} for agent ${agentId}`,
					{ agentId, layer },
				),
			);
		}
	}

	async list(
		layer: MemoryLayer,
		filter?: { readonly teamId?: TeamId | undefined } | undefined,
	): Promise<Result<readonly MemoryEntry[], ABFError>> {
		// For v0.1, list decisions only
		if (layer === 'decisions') {
			const filePath = join(this.basePath, 'decisions.md');
			try {
				const content = await readFile(filePath, 'utf-8');
				return Ok([
					{
						layer: 'decisions',
						teamId: filter?.teamId,
						content,
						timestamp: toISOTimestamp(),
						checksum: computeChecksum(content),
					},
				]);
			} catch {
				return Ok([]);
			}
		}
		return Ok([]);
	}

	// ─── Private Helpers ──────────────────────────────────────────────

	private getPath(agentId: AgentId, layer: MemoryLayer): string {
		switch (layer) {
			case 'charter':
				return join(this.basePath, 'agents', agentId, 'charter.md');
			case 'history':
				return join(this.basePath, 'agents', agentId, 'history.md');
			case 'decisions':
				return join(this.basePath, 'decisions.md');
			case 'knowledge':
				return join(this.basePath, 'knowledge');
			case 'session':
				return join(this.basePath, 'agents', agentId, 'session.md');
		}
	}

	private async ensureDir(filePath: string): Promise<void> {
		const dir = filePath.substring(0, filePath.lastIndexOf('/'));
		await mkdir(dir, { recursive: true });
	}
}
