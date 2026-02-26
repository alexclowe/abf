import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IKeychain } from './keychain.js';

// ─── Mock scrypt with low-cost params for fast tests ────────────────
// The production scrypt N=32768 can exceed the test env memory limit.
// We intercept scrypt calls and force N=1024 to keep tests fast.
// vi.hoisted() ensures the holder is available when vi.mock is hoisted.

const { holder } = vi.hoisted(() => {
	const holder: { realScrypt: Function | null } = { realScrypt: null };
	return { holder };
});

vi.mock('node:crypto', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:crypto')>();
	holder.realScrypt = actual.scrypt;
	return {
		...actual,
		scrypt: (
			password: unknown,
			salt: unknown,
			keylen: number,
			optionsOrCb: unknown,
			maybeCb?: unknown,
		) => {
			const real = holder.realScrypt!;
			// scrypt has two overloads: (pw, salt, keylen, cb) and (pw, salt, keylen, opts, cb)
			if (typeof optionsOrCb === 'function') {
				// No options — pass through directly
				return real(password, salt, keylen, optionsOrCb);
			}
			// Has options object — override N to a low value for test speed
			const opts = { ...(optionsOrCb as Record<string, unknown>), N: 1024 };
			return real(password, salt, keylen, opts, maybeCb);
		},
	};
});

const { VaultV2 } = await import('./vault-v2.js');

// ─── In-memory keychain for tests ───────────────────────────────────

class InMemoryKeychain implements IKeychain {
	private key: Buffer | null = null;
	private available: boolean;

	constructor(available = true) {
		this.available = available;
	}

	async isAvailable(): Promise<boolean> {
		return this.available;
	}

	async setMasterKey(key: Buffer): Promise<void> {
		this.key = Buffer.from(key);
	}

	async getMasterKey(): Promise<Buffer | null> {
		return this.key;
	}

	async deleteMasterKey(): Promise<void> {
		this.key = null;
	}
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('VaultV2', () => {
	let tempDir: string;
	let vaultPath: string;
	let keychain: InMemoryKeychain;
	let savedAnthropicKey: string | undefined;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'abf-vault-v2-test-'));
		vaultPath = join(tempDir, 'credentials.enc');
		keychain = new InMemoryKeychain(true);
		// Isolate tests from real env vars that override vault.get()
		savedAnthropicKey = process.env['ANTHROPIC_API_KEY'];
		delete process.env['ANTHROPIC_API_KEY'];
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
		// Restore env var
		if (savedAnthropicKey !== undefined) {
			process.env['ANTHROPIC_API_KEY'] = savedAnthropicKey;
		}
	});

	// ─── Keychain backend tests ─────────────────────────────────────

	describe('with keychain backend', () => {
		it('set and get a credential (roundtrip through encrypt/decrypt)', async () => {
			const vault = new VaultV2(vaultPath, keychain);
			await vault.initialize();

			await vault.set('anthropic', 'api_key', 'sk-ant-secret123');
			const result = await vault.get('anthropic', 'api_key');
			expect(result).toBe('sk-ant-secret123');

			vault.destroy();
		});

		it('deletes a credential', async () => {
			const vault = new VaultV2(vaultPath, keychain);
			await vault.initialize();

			await vault.set('anthropic', 'api_key', 'sk-ant-deleteme');
			await vault.delete('anthropic', 'api_key');

			const result = await vault.get('anthropic', 'api_key');
			expect(result).toBeUndefined();

			// Provider should also be removed when its last key is deleted
			const providers = await vault.list();
			expect(providers).not.toContain('anthropic');

			vault.destroy();
		});

		it('lists providers', async () => {
			const vault = new VaultV2(vaultPath, keychain);
			await vault.initialize();

			await vault.set('anthropic', 'api_key', 'sk-ant');
			await vault.set('openai', 'api_key', 'sk-oai');
			await vault.set('ollama', 'base_url', 'http://localhost:11434');

			const providers = await vault.list();
			expect(providers).toContain('anthropic');
			expect(providers).toContain('openai');
			expect(providers).toContain('ollama');
			expect(providers).toHaveLength(3);

			vault.destroy();
		});

		it('returns undefined for non-existent key', async () => {
			const vault = new VaultV2(vaultPath, keychain);
			await vault.initialize();

			const result = await vault.get('nonexistent', 'api_key');
			expect(result).toBeUndefined();

			vault.destroy();
		});

		it('persists across vault instances (file persistence)', async () => {
			// Write with first instance
			const vault1 = new VaultV2(vaultPath, keychain);
			await vault1.initialize();
			await vault1.set('anthropic', 'api_key', 'sk-ant-persistent');
			vault1.destroy();

			// Read with a new instance sharing the same keychain
			const vault2 = new VaultV2(vaultPath, keychain);
			await vault2.initialize();
			const result = await vault2.get('anthropic', 'api_key');
			expect(result).toBe('sk-ant-persistent');

			vault2.destroy();
		});

		it('concurrent init calls do not race (init promise deduplication)', async () => {
			const vault = new VaultV2(vaultPath, keychain);

			// Call initialize multiple times concurrently
			const [r1, r2, r3] = await Promise.all([
				vault.initialize(),
				vault.initialize(),
				vault.initialize(),
			]);

			// All should resolve without error (void)
			expect(r1).toBeUndefined();
			expect(r2).toBeUndefined();
			expect(r3).toBeUndefined();

			// Vault should still be functional
			await vault.set('anthropic', 'api_key', 'concurrent-test');
			const result = await vault.get('anthropic', 'api_key');
			expect(result).toBe('concurrent-test');

			vault.destroy();
		});

		it('writes v2 file format with JSON header on first line', async () => {
			const vault = new VaultV2(vaultPath, keychain);
			await vault.initialize();
			await vault.set('test', 'key', 'value');

			const content = await readFile(vaultPath, 'utf8');
			const lines = content.trim().split('\n');
			expect(lines.length).toBe(2);

			const header = JSON.parse(lines[0]!);
			expect(header.version).toBe(2);
			expect(header.backend).toBe('keychain');
			expect(header.storedAt).toBeDefined();

			vault.destroy();
		});

		it('getBackendInfo returns keychain', async () => {
			const vault = new VaultV2(vaultPath, keychain);
			await vault.initialize();

			expect(vault.getBackendInfo()).toEqual({ backend: 'keychain' });

			vault.destroy();
		});

		it('destroy zeroes the master key and clears data', async () => {
			const vault = new VaultV2(vaultPath, keychain);
			await vault.initialize();
			await vault.set('anthropic', 'api_key', 'sk-ant-destroy');

			vault.destroy();

			// After destroy, list returns empty (data is cleared)
			const providers = await vault.list();
			expect(providers).toHaveLength(0);
		});
	});

	// ─── Scrypt / password backend tests ────────────────────────────

	describe('with scrypt (password) backend', () => {
		let noKeychain: InMemoryKeychain;

		beforeEach(() => {
			noKeychain = new InMemoryKeychain(false); // keychain unavailable
		});

		it('set and get a credential with password', async () => {
			const vault = new VaultV2(vaultPath, noKeychain, 'test-password-123');
			await vault.initialize();

			await vault.set('myprovider', 'api_key', 'sk-secret-value');
			const result = await vault.get('myprovider', 'api_key');
			expect(result).toBe('sk-secret-value');

			vault.destroy();
		});

		it('persists across instances with same password', async () => {
			const vault1 = new VaultV2(vaultPath, noKeychain, 'my-secure-password');
			await vault1.initialize();
			await vault1.set('anthropic', 'api_key', 'sk-ant-scrypt');
			vault1.destroy();

			const vault2 = new VaultV2(vaultPath, noKeychain, 'my-secure-password');
			await vault2.initialize();
			const result = await vault2.get('anthropic', 'api_key');
			expect(result).toBe('sk-ant-scrypt');

			vault2.destroy();
		});

		it('wrong password yields empty data (no crash)', async () => {
			const vault1 = new VaultV2(vaultPath, noKeychain, 'correct-password');
			await vault1.initialize();
			await vault1.set('anthropic', 'api_key', 'sk-ant-secret');
			vault1.destroy();

			// Open with wrong password — should not throw, just empty data
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const vault2 = new VaultV2(vaultPath, noKeychain, 'wrong-password');
			await vault2.initialize();

			const result = await vault2.get('anthropic', 'api_key');
			expect(result).toBeUndefined();

			const providers = await vault2.list();
			expect(providers).toHaveLength(0);

			warnSpy.mockRestore();
			vault2.destroy();
		});

		it('writes v2 file format with scrypt header', async () => {
			const vault = new VaultV2(vaultPath, noKeychain, 'test-pw');
			await vault.initialize();
			await vault.set('test', 'key', 'value');

			const content = await readFile(vaultPath, 'utf8');
			const lines = content.trim().split('\n');
			expect(lines.length).toBe(2);

			const header = JSON.parse(lines[0]!);
			expect(header.version).toBe(2);
			expect(header.backend).toBe('scrypt');
			expect(header.salt).toBeDefined();
			expect(typeof header.salt).toBe('string');
			expect(header.N).toBe(32768);
			expect(header.r).toBe(8);
			expect(header.p).toBe(1);

			vault.destroy();
		});

		it('getBackendInfo returns scrypt', async () => {
			const vault = new VaultV2(vaultPath, noKeychain, 'pw');
			await vault.initialize();

			expect(vault.getBackendInfo()).toEqual({ backend: 'scrypt' });

			vault.destroy();
		});

		it('throws if no keychain and no password (ABF_VAULT_INSECURE not set)', async () => {
			// Ensure env vars are not set
			const savedPw = process.env['ABF_VAULT_PASSWORD'];
			const savedInsecure = process.env['ABF_VAULT_INSECURE'];
			delete process.env['ABF_VAULT_PASSWORD'];
			delete process.env['ABF_VAULT_INSECURE'];

			const vault = new VaultV2(vaultPath, noKeychain);
			await expect(vault.initialize()).rejects.toThrow('No keychain available');

			// Restore env
			if (savedPw) process.env['ABF_VAULT_PASSWORD'] = savedPw;
			if (savedInsecure) process.env['ABF_VAULT_INSECURE'] = savedInsecure;
		});

		it('uses ABF_VAULT_PASSWORD env var as fallback', async () => {
			const savedPw = process.env['ABF_VAULT_PASSWORD'];
			process.env['ABF_VAULT_PASSWORD'] = 'env-password-fallback';

			const vault = new VaultV2(vaultPath, noKeychain);
			await vault.initialize();
			await vault.set('anthropic', 'api_key', 'sk-from-env-pw');

			const result = await vault.get('anthropic', 'api_key');
			expect(result).toBe('sk-from-env-pw');

			vault.destroy();

			// Restore
			if (savedPw) {
				process.env['ABF_VAULT_PASSWORD'] = savedPw;
			} else {
				delete process.env['ABF_VAULT_PASSWORD'];
			}
		});
	});

	// ─── Environment variable tests ─────────────────────────────────

	describe('environment variable handling', () => {
		afterEach(() => {
			// Clean up any env vars we set
			delete process.env['ANTHROPIC_API_KEY'];
			delete process.env['OPENAI_API_KEY'];
		});

		it('env var fallback when key not in vault', async () => {
			process.env['ANTHROPIC_API_KEY'] = 'env-only-value';

			const vault = new VaultV2(vaultPath, keychain);
			await vault.initialize();

			const result = await vault.get('anthropic', 'api_key');
			expect(result).toBe('env-only-value');

			vault.destroy();
		});

		it('env var takes precedence over vault value', async () => {
			const vault = new VaultV2(vaultPath, keychain);
			await vault.initialize();
			await vault.set('anthropic', 'api_key', 'vault-value');

			process.env['ANTHROPIC_API_KEY'] = 'env-wins';
			const result = await vault.get('anthropic', 'api_key');
			expect(result).toBe('env-wins');

			vault.destroy();
		});

		it('env key uses uppercase provider and key with underscores', async () => {
			// VaultV2 env key format: PROVIDER_KEY (hyphens -> underscores)
			process.env['OPENAI_API_KEY'] = 'from-env-openai';

			const vault = new VaultV2(vaultPath, keychain);
			await vault.initialize();

			const result = await vault.get('openai', 'api_key');
			expect(result).toBe('from-env-openai');

			vault.destroy();
		});
	});

	// ─── Keychain loss recovery ─────────────────────────────────────

	describe('keychain loss recovery', () => {
		it('resets vault when keychain loses the master key', async () => {
			const vault1 = new VaultV2(vaultPath, keychain);
			await vault1.initialize();
			await vault1.set('anthropic', 'api_key', 'will-be-lost');
			vault1.destroy();

			// Simulate keychain key loss
			await keychain.deleteMasterKey();

			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const vault2 = new VaultV2(vaultPath, keychain);
			await vault2.initialize();

			// Old credential should be gone (vault was reset)
			const result = await vault2.get('anthropic', 'api_key');
			expect(result).toBeUndefined();

			// But vault should still be functional with a new key
			await vault2.set('openai', 'api_key', 'new-after-reset');
			const newResult = await vault2.get('openai', 'api_key');
			expect(newResult).toBe('new-after-reset');

			warnSpy.mockRestore();
			vault2.destroy();
		});
	});

	// ─── Multiple keys per provider ─────────────────────────────────

	describe('multiple keys per provider', () => {
		it('stores and retrieves multiple keys for one provider', async () => {
			// Clear any env overrides
			const savedKey = process.env['OPENAI_API_KEY'];
			delete process.env['OPENAI_API_KEY'];

			const vault = new VaultV2(vaultPath, keychain);
			await vault.initialize();

			await vault.set('openai', 'api_key', 'sk-oai');
			await vault.set('openai', 'org_id', 'org-123');

			expect(await vault.get('openai', 'api_key')).toBe('sk-oai');
			expect(await vault.get('openai', 'org_id')).toBe('org-123');

			vault.destroy();

			// Restore
			if (savedKey) process.env['OPENAI_API_KEY'] = savedKey;
		});

		it('delete removes only the specified key', async () => {
			const savedKey = process.env['OPENAI_API_KEY'];
			delete process.env['OPENAI_API_KEY'];

			const vault = new VaultV2(vaultPath, keychain);
			await vault.initialize();

			await vault.set('openai', 'api_key', 'sk-oai');
			await vault.set('openai', 'org_id', 'org-123');
			await vault.delete('openai', 'api_key');

			expect(await vault.get('openai', 'api_key')).toBeUndefined();
			expect(await vault.get('openai', 'org_id')).toBe('org-123');

			// Provider should still be listed (still has org_id)
			const providers = await vault.list();
			expect(providers).toContain('openai');

			vault.destroy();

			if (savedKey) process.env['OPENAI_API_KEY'] = savedKey;
		});
	});
});
