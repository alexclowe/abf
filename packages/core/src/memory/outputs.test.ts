import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OutputsManager } from './outputs.js';

describe('OutputsManager', () => {
	let tempDir: string;
	let manager: OutputsManager;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'abf-outputs-test-'));
		manager = new OutputsManager(tempDir);
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe('write', () => {
		it('creates agent directory and timestamped .md file', async () => {
			await manager.write('scout', 'Session output content');

			const agentDir = join(tempDir, 'scout');
			const files = await readdir(agentDir);

			expect(files).toHaveLength(1);
			expect(files[0]).toMatch(/\.md$/);

			const content = await readFile(join(agentDir, files[0]), 'utf-8');
			expect(content).toBe('Session output content');
		});
	});

	describe('readRecent', () => {
		it('returns entries sorted newest first', async () => {
			// Write multiple outputs with small delays to ensure different timestamps
			await manager.write('scout', 'First output');
			// Manually create files with known timestamps for deterministic ordering
			const { writeFile, mkdir } = await import('node:fs/promises');
			const agentDir = join(tempDir, 'scout');
			await mkdir(agentDir, { recursive: true });
			await writeFile(join(agentDir, '2025-01-01T10-00-00-000Z.md'), 'Older output', 'utf-8');
			await writeFile(join(agentDir, '2025-06-15T12-30-00-000Z.md'), 'Newer output', 'utf-8');

			const entries = await manager.readRecent('scout');

			// The files are sorted alphabetically in reverse, so 2025-06 comes before 2025-01
			const timestamps = entries.map((e) => e.timestamp);
			for (let i = 1; i < timestamps.length; i++) {
				expect(timestamps[i - 1].localeCompare(timestamps[i])).toBeGreaterThanOrEqual(0);
			}
		});

		it('respects the limit parameter', async () => {
			const { writeFile, mkdir } = await import('node:fs/promises');
			const agentDir = join(tempDir, 'lens');
			await mkdir(agentDir, { recursive: true });

			for (let i = 1; i <= 10; i++) {
				const ts = `2025-01-${String(i).padStart(2, '0')}T00-00-00-000Z`;
				await writeFile(join(agentDir, `${ts}.md`), `Output ${i}`, 'utf-8');
			}

			const entries = await manager.readRecent('lens', 3);
			expect(entries).toHaveLength(3);
			// Should be the 3 newest (highest dates)
			expect(entries[0].content).toBe('Output 10');
			expect(entries[1].content).toBe('Output 9');
			expect(entries[2].content).toBe('Output 8');
		});

		it('returns empty array for non-existent agent directory', async () => {
			const entries = await manager.readRecent('nonexistent-agent');
			expect(entries).toEqual([]);
		});
	});

	describe('readTeamRecent', () => {
		it('excludes the requesting agent', async () => {
			const { writeFile, mkdir } = await import('node:fs/promises');

			// Create outputs for 3 agents
			for (const agent of ['scout', 'lens', 'sage']) {
				const agentDir = join(tempDir, agent);
				await mkdir(agentDir, { recursive: true });
				await writeFile(
					join(agentDir, '2025-03-01T10-00-00-000Z.md'),
					`Output from ${agent}`,
					'utf-8',
				);
			}

			const entries = await manager.readTeamRecent('scout', 5);
			const agents = entries.map((e) => e.agent);

			expect(agents).not.toContain('scout');
			expect(agents).toContain('lens');
			expect(agents).toContain('sage');
		});

		it('merges all agents and sorts by timestamp descending', async () => {
			const { writeFile, mkdir } = await import('node:fs/promises');

			// Create interleaved timestamps across agents
			const agentADir = join(tempDir, 'alpha');
			const agentBDir = join(tempDir, 'beta');
			await mkdir(agentADir, { recursive: true });
			await mkdir(agentBDir, { recursive: true });

			await writeFile(join(agentADir, '2025-01-01T08-00-00-000Z.md'), 'Alpha early', 'utf-8');
			await writeFile(join(agentADir, '2025-01-03T08-00-00-000Z.md'), 'Alpha late', 'utf-8');
			await writeFile(join(agentBDir, '2025-01-02T08-00-00-000Z.md'), 'Beta mid', 'utf-8');
			await writeFile(join(agentBDir, '2025-01-04T08-00-00-000Z.md'), 'Beta latest', 'utf-8');

			const entries = await manager.readTeamRecent('nonexistent', 3);

			// All four agents' entries merged and sorted by timestamp descending
			const timestamps = entries.map((e) => e.timestamp);
			for (let i = 1; i < timestamps.length; i++) {
				expect(timestamps[i - 1].localeCompare(timestamps[i])).toBeGreaterThanOrEqual(0);
			}
		});

		it('returns empty array for non-existent outputs directory', async () => {
			const isolated = new OutputsManager(join(tempDir, 'does-not-exist'));
			const entries = await isolated.readTeamRecent('any-agent');
			expect(entries).toEqual([]);
		});
	});
});
