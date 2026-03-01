/**
 * OutputsManager — manages cross-agent output sharing.
 *
 * Session outputs are written to `outputs/<agentName>/` as timestamped files.
 * Teammates can read each other's recent outputs to share context.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toISOTimestamp } from '../util/index.js';

export interface OutputEntry {
	readonly agent: string;
	readonly timestamp: string;
	readonly content: string;
}

export class OutputsManager {
	constructor(private readonly outputsDir: string) {}

	/**
	 * Write an output for an agent session.
	 */
	async write(agentName: string, content: string): Promise<void> {
		const agentDir = join(this.outputsDir, agentName);
		await mkdir(agentDir, { recursive: true });

		const ts = toISOTimestamp(new Date()).replace(/[:.]/g, '-');
		const filename = `${ts}.md`;
		await writeFile(join(agentDir, filename), content, 'utf-8');
	}

	/**
	 * Read recent outputs for a specific agent.
	 */
	async readRecent(agentName: string, limit = 5): Promise<readonly OutputEntry[]> {
		const agentDir = join(this.outputsDir, agentName);
		try {
			const files = await readdir(agentDir);
			const sorted = files.filter((f) => f.endsWith('.md')).sort().reverse().slice(0, limit);

			// Read all files in parallel
			const results = await Promise.allSettled(
				sorted.map(async (file) => {
					const content = await readFile(join(agentDir, file), 'utf-8');
					return {
						agent: agentName,
						timestamp: file.replace('.md', '').replace(/-/g, ':').replace(/:(\d{2})$/, '.$1'),
						content,
					} as OutputEntry;
				}),
			);
			return results
				.filter((r): r is PromiseFulfilledResult<OutputEntry> => r.status === 'fulfilled')
				.map((r) => r.value);
		} catch {
			return [];
		}
	}

	/**
	 * Read recent outputs from all team members (all agents in the outputs dir).
	 * Excludes the requesting agent's own outputs.
	 */
	async readTeamRecent(excludeAgent: string, limit = 3): Promise<readonly OutputEntry[]> {
		try {
			const agents = await readdir(this.outputsDir);
			const teammates = agents.filter((a) => a !== excludeAgent);

			// Read all teammates in parallel
			const results = await Promise.allSettled(
				teammates.map((agent) => this.readRecent(agent, limit)),
			);
			const allEntries: OutputEntry[] = [];
			for (const result of results) {
				if (result.status === 'fulfilled') {
					allEntries.push(...result.value);
				}
			}

			// Sort by timestamp descending, take the most recent
			return allEntries
				.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
				.slice(0, limit * 3);
		} catch {
			return [];
		}
	}
}
