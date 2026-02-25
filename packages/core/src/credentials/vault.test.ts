import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemCredentialVault } from './vault.js';

describe('FilesystemCredentialVault', () => {
	let tempDir: string;
	let vault: FilesystemCredentialVault;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'abf-vault-test-'));
		vault = new FilesystemCredentialVault(join(tempDir, 'credentials.enc'));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it('stores and retrieves a key', async () => {
		await vault.set('anthropic', 'api_key', 'sk-ant-test123');
		const result = await vault.get('anthropic', 'api_key');
		expect(result).toBe('sk-ant-test123');
	});

	it('returns undefined for missing key', async () => {
		const result = await vault.get('nonexistent', 'api_key');
		expect(result).toBeUndefined();
	});

	it('lists providers with stored keys', async () => {
		await vault.set('anthropic', 'api_key', 'sk-ant-test');
		await vault.set('openai', 'api_key', 'sk-test');

		const providers = await vault.list();
		expect(providers).toContain('anthropic');
		expect(providers).toContain('openai');
	});

	it('deletes a stored key', async () => {
		await vault.set('anthropic', 'api_key', 'sk-ant-test');
		await vault.delete('anthropic', 'api_key');

		const result = await vault.get('anthropic', 'api_key');
		expect(result).toBeUndefined();

		const providers = await vault.list();
		expect(providers).not.toContain('anthropic');
	});

	it('persists across vault instances (reads from disk)', async () => {
		await vault.set('anthropic', 'api_key', 'sk-ant-persistent');

		// Create a second vault pointing to same file
		const vault2 = new FilesystemCredentialVault(join(tempDir, 'credentials.enc'));
		const result = await vault2.get('anthropic', 'api_key');
		expect(result).toBe('sk-ant-persistent');
	});

	it('stores multiple keys per provider', async () => {
		// Clear env overrides so vault values are returned
		const savedKey = process.env['OPENAI_API_KEY'];
		delete process.env['OPENAI_API_KEY'];

		await vault.set('openai', 'api_key', 'sk-test');
		await vault.set('openai', 'org_id', 'org-123');

		expect(await vault.get('openai', 'api_key')).toBe('sk-test');
		expect(await vault.get('openai', 'org_id')).toBe('org-123');

		// Restore env
		if (savedKey) process.env['OPENAI_API_KEY'] = savedKey;
	});

	it('env var overrides vault value', async () => {
		await vault.set('anthropic', 'api_key', 'vault-value');

		// Simulate env var override
		process.env['ANTHROPIC_API_KEY'] = 'env-value';
		const result = await vault.get('anthropic', 'api_key');
		expect(result).toBe('env-value');

		// Clean up
		delete process.env['ANTHROPIC_API_KEY'];
	});
});
