/**
 * File-based audit store.
 * Appends JSON entries to log files for immutable audit trail.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId, SessionId } from '../types/common.js';
import type { ABFError, Result } from '../types/errors.js';
import { Err, Ok } from '../types/errors.js';
import { MemoryError } from '../types/errors.js';
import type { AuditEntry, AuditEventType, IAuditStore } from '../types/security.js';

export class FileAuditStore implements IAuditStore {
	private readonly dir: string;

	constructor(logsDir: string) {
		this.dir = join(logsDir, 'audit');
	}

	async log(entry: AuditEntry): Promise<void> {
		await mkdir(this.dir, { recursive: true });

		// Write to daily log file
		const date = entry.timestamp.slice(0, 10); // YYYY-MM-DD
		const filePath = join(this.dir, `${date}.jsonl`);
		await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf-8');

		// Security events get their own file for easier review
		if (entry.severity === 'security') {
			const securityPath = join(this.dir, 'security.jsonl');
			await appendFile(securityPath, `${JSON.stringify(entry)}\n`, 'utf-8');
		}
	}

	async query(filter: {
		readonly agentId?: AgentId | undefined;
		readonly sessionId?: SessionId | undefined;
		readonly eventType?: AuditEventType | undefined;
		readonly since?: import('../types/common.js').ISOTimestamp | undefined;
		readonly limit?: number | undefined;
	}): Promise<Result<readonly AuditEntry[], ABFError>> {
		try {
			const { readdir } = await import('node:fs/promises');
			const files = await readdir(this.dir);
			let jsonlFiles = files.filter((f) => f.endsWith('.jsonl') && f !== 'security.jsonl');

			// Optimization: skip files before the 'since' date using filenames (YYYY-MM-DD.jsonl)
			if (filter.since) {
				const sinceDate = filter.since.slice(0, 10); // YYYY-MM-DD
				jsonlFiles = jsonlFiles.filter((f) => f.slice(0, 10) >= sinceDate);
			}

			// Sort by date — most recent last (natural order for collecting results)
			jsonlFiles.sort();

			const entries: AuditEntry[] = [];

			for (const file of jsonlFiles) {
				const content = await readFile(join(this.dir, file), 'utf-8');
				const lines = content.trim().split('\n').filter(Boolean);

				for (const line of lines) {
					const entry = JSON.parse(line) as AuditEntry;

					if (filter.agentId && entry.agentId !== filter.agentId) continue;
					if (filter.sessionId && entry.sessionId !== filter.sessionId) continue;
					if (filter.eventType && entry.eventType !== filter.eventType) continue;
					if (filter.since && entry.timestamp < filter.since) continue;

					entries.push(entry);

					if (filter.limit && entries.length >= filter.limit) {
						return Ok(entries);
					}
				}
			}

			return Ok(entries);
		} catch {
			return Err(
				new MemoryError('MEMORY_READ_FAILED', 'Failed to query audit log', {
					filter,
				}),
			);
		}
	}
}
