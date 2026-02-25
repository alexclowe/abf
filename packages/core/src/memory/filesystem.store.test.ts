import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentId } from '../types/common.js';
import { FilesystemMemoryStore } from './filesystem.store.js';

describe('FilesystemMemoryStore', () => {
	let tempDir: string;
	let store: FilesystemMemoryStore;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'abf-test-'));
		store = new FilesystemMemoryStore(tempDir);
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it('writes and reads charter', async () => {
		const agentId = 'test-agent' as AgentId;
		const charter = '# Test Agent\n\nYou are a test agent.';

		const writeResult = await store.write(agentId, 'charter', charter);
		expect(writeResult.ok).toBe(true);

		const readResult = await store.read(agentId, 'charter');
		expect(readResult.ok).toBe(true);
		if (readResult.ok) {
			expect(readResult.value).toBe(charter);
		}
	});

	it('appends to history', async () => {
		const agentId = 'test-agent' as AgentId;

		await store.append(agentId, 'history', 'First entry');
		await store.append(agentId, 'history', 'Second entry');

		const readResult = await store.read(agentId, 'history');
		expect(readResult.ok).toBe(true);
		if (readResult.ok) {
			expect(readResult.value).toContain('First entry');
			expect(readResult.value).toContain('Second entry');
		}
	});

	it('verifies checksum integrity', async () => {
		const agentId = 'test-agent' as AgentId;
		await store.write(agentId, 'charter', 'Verified content');

		const verifyResult = await store.verify(agentId, 'charter');
		expect(verifyResult.ok).toBe(true);
		if (verifyResult.ok) {
			expect(verifyResult.value).toBe(true);
		}
	});

	it('loads agent context', async () => {
		const agentId = 'test-agent' as AgentId;
		await store.write(agentId, 'charter', '# Test Agent');
		await store.append(agentId, 'history', 'Did something');

		const contextResult = await store.loadContext(agentId);
		expect(contextResult.ok).toBe(true);
		if (contextResult.ok) {
			expect(contextResult.value.charter).toBe('# Test Agent');
			expect(contextResult.value.history.length).toBeGreaterThan(0);
		}
	});

	it('returns error for missing memory', async () => {
		const result = await store.read('nonexistent' as AgentId, 'charter');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('MEMORY_READ_FAILED');
		}
	});
});
