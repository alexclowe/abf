import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { IKeychain } from './keychain.js';

// ─── Mock child_process with proper custom promisify ────────────────
// Node's execFile has a util.promisify.custom symbol so that
// promisify(execFile) returns {stdout, stderr}. Our mock must replicate
// that behavior for the keychain module (which does promisify at load).

const { mockExecFileCb } = vi.hoisted(() => {
	const mockExecFileCb = vi.fn();
	return { mockExecFileCb };
});

vi.mock('node:child_process', () => {
	// Create the promisified version that returns {stdout, stderr}
	const customPromisified = (...args: unknown[]) => {
		return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
			mockExecFileCb(...args, (err: Error | null, stdout: string, stderr: string) => {
				if (err) reject(err);
				else resolve({ stdout, stderr });
			});
		});
	};
	mockExecFileCb[promisify.custom] = customPromisified;
	return { execFile: mockExecFileCb };
});

// ─── Mock node:os to control platform() per-test ────────────────────

const osPlatformMock = vi.fn<() => NodeJS.Platform>();

vi.mock('node:os', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:os')>();
	return {
		...actual,
		platform: () => osPlatformMock(),
	};
});

// Now import the module under test (after mocks are in place)
const { createKeychain } = await import('./keychain.js');

// ─── In-memory keychain for logic tests ─────────────────────────────

class InMemoryKeychain implements IKeychain {
	private store = new Map<string, Buffer>();

	async isAvailable(): Promise<boolean> {
		return true;
	}

	async setMasterKey(key: Buffer): Promise<void> {
		this.store.set('master', Buffer.from(key));
	}

	async getMasterKey(): Promise<Buffer | null> {
		return this.store.get('master') ?? null;
	}

	async deleteMasterKey(): Promise<void> {
		this.store.delete('master');
	}
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('keychain', () => {

	afterEach(() => {
		mockExecFileCb.mockReset();
	});

	// ─── NoopKeychain (unsupported platform) ────────────────────────

	describe('NoopKeychain (unsupported platform)', () => {
		let noop: IKeychain;

		beforeEach(() => {
			osPlatformMock.mockReturnValue('freebsd' as NodeJS.Platform);
			noop = createKeychain();
		});

		it('isAvailable returns false', async () => {
			expect(await noop.isAvailable()).toBe(false);
		});

		it('getMasterKey returns null', async () => {
			expect(await noop.getMasterKey()).toBeNull();
		});

		it('setMasterKey does not throw', async () => {
			const key = randomBytes(32);
			await expect(noop.setMasterKey(key)).resolves.toBeUndefined();
		});

		it('deleteMasterKey does not throw', async () => {
			await expect(noop.deleteMasterKey()).resolves.toBeUndefined();
		});

		it('getMasterKey still returns null after setMasterKey (noop)', async () => {
			await noop.setMasterKey(randomBytes(32));
			expect(await noop.getMasterKey()).toBeNull();
		});
	});

	// ─── createKeychain platform selection ──────────────────────────

	describe('createKeychain platform selection', () => {
		it('returns a keychain for darwin', () => {
			osPlatformMock.mockReturnValue('darwin');
			const kc = createKeychain();
			expect(kc).toBeDefined();
			expect(typeof kc.isAvailable).toBe('function');
			expect(typeof kc.setMasterKey).toBe('function');
			expect(typeof kc.getMasterKey).toBe('function');
			expect(typeof kc.deleteMasterKey).toBe('function');
		});

		it('returns a keychain for linux', () => {
			osPlatformMock.mockReturnValue('linux');
			const kc = createKeychain();
			expect(kc).toBeDefined();
			expect(typeof kc.isAvailable).toBe('function');
		});

		it('returns a keychain for win32', () => {
			osPlatformMock.mockReturnValue('win32');
			const kc = createKeychain();
			expect(kc).toBeDefined();
			expect(typeof kc.isAvailable).toBe('function');
		});

		it('returns NoopKeychain for unknown platform', () => {
			osPlatformMock.mockReturnValue('aix' as NodeJS.Platform);
			const kc = createKeychain();
			expect(kc).toBeDefined();
		});
	});

	// ─── InMemoryKeychain (key round-trip) ──────────────────────────

	describe('InMemoryKeychain (key buffer round-trip)', () => {
		let memKeychain: InMemoryKeychain;

		beforeEach(() => {
			memKeychain = new InMemoryKeychain();
		});

		it('isAvailable returns true', async () => {
			expect(await memKeychain.isAvailable()).toBe(true);
		});

		it('set 32-byte key and get same 32 bytes back', async () => {
			const key = randomBytes(32);
			await memKeychain.setMasterKey(key);

			const retrieved = await memKeychain.getMasterKey();
			expect(retrieved).not.toBeNull();
			expect(retrieved!.length).toBe(32);
			expect(Buffer.compare(key, retrieved!)).toBe(0);
		});

		it('key is a copy (not the same buffer reference)', async () => {
			const key = randomBytes(32);
			await memKeychain.setMasterKey(key);

			const retrieved = await memKeychain.getMasterKey();
			// Mutating original should not affect stored
			key.fill(0);
			expect(retrieved![0]).not.toBe(0); // at least one byte should differ
		});

		it('delete removes the key', async () => {
			const key = randomBytes(32);
			await memKeychain.setMasterKey(key);
			await memKeychain.deleteMasterKey();

			expect(await memKeychain.getMasterKey()).toBeNull();
		});

		it('getMasterKey returns null when no key stored', async () => {
			expect(await memKeychain.getMasterKey()).toBeNull();
		});
	});

	// ─── Hex validation ─────────────────────────────────────────────

	describe('hex validation (via MacOSKeychain.getMasterKey)', () => {
		// The validateHex function is module-private. We test it indirectly
		// through MacOSKeychain.getMasterKey which calls validateHex
		// on the stdout returned by execFile.

		let kc: IKeychain;

		beforeEach(() => {
			osPlatformMock.mockReturnValue('darwin');
			kc = createKeychain();
			mockExecFileCb.mockReset();
		});

		it('valid 64-char hex string returns a 32-byte buffer', async () => {
			const validHex = 'a'.repeat(64);
			mockExecFileCb.mockImplementation(
				(...args: unknown[]) => {
					const cb = args[args.length - 1];
					if (typeof cb === 'function') cb(null, validHex, '');
				},
			);

			const result = await kc.getMasterKey();
			expect(result).not.toBeNull();
			expect(result!.length).toBe(32);
		});

		it('non-hex characters cause getMasterKey to return null', async () => {
			const invalidHex = 'g'.repeat(64);
			mockExecFileCb.mockImplementation(
				(...args: unknown[]) => {
					const cb = args[args.length - 1];
					if (typeof cb === 'function') cb(null, invalidHex, '');
				},
			);

			const result = await kc.getMasterKey();
			expect(result).toBeNull();
		});

		it('hex string that is too short returns null', async () => {
			const shortHex = 'abcdef1234';
			mockExecFileCb.mockImplementation(
				(...args: unknown[]) => {
					const cb = args[args.length - 1];
					if (typeof cb === 'function') cb(null, shortHex, '');
				},
			);

			const result = await kc.getMasterKey();
			expect(result).toBeNull();
		});

		it('hex string that is too long returns null', async () => {
			const longHex = 'a'.repeat(128);
			mockExecFileCb.mockImplementation(
				(...args: unknown[]) => {
					const cb = args[args.length - 1];
					if (typeof cb === 'function') cb(null, longHex, '');
				},
			);

			const result = await kc.getMasterKey();
			expect(result).toBeNull();
		});

		it('hex with surrounding whitespace is trimmed and accepted', async () => {
			const paddedHex = '  ' + 'b'.repeat(64) + '\n';
			mockExecFileCb.mockImplementation(
				(...args: unknown[]) => {
					const cb = args[args.length - 1];
					if (typeof cb === 'function') cb(null, paddedHex, '');
				},
			);

			const result = await kc.getMasterKey();
			expect(result).not.toBeNull();
			expect(result!.length).toBe(32);
		});

		it('empty string returns null', async () => {
			mockExecFileCb.mockImplementation(
				(...args: unknown[]) => {
					const cb = args[args.length - 1];
					if (typeof cb === 'function') cb(null, '', '');
				},
			);

			const result = await kc.getMasterKey();
			expect(result).toBeNull();
		});

		it('execFile error causes getMasterKey to return null', async () => {
			mockExecFileCb.mockImplementation(
				(...args: unknown[]) => {
					const cb = args[args.length - 1];
					if (typeof cb === 'function') {
						cb(new Error('security: SecKeychainSearchCopyNext failed'), '', '');
					}
				},
			);

			const result = await kc.getMasterKey();
			expect(result).toBeNull();
		});
	});

	// ─── MacOS isAvailable ──────────────────────────────────────────

	describe('MacOS isAvailable', () => {
		let kc: IKeychain;

		beforeEach(() => {
			osPlatformMock.mockReturnValue('darwin');
			kc = createKeychain();
			mockExecFileCb.mockReset();
		});

		it('returns true when security binary is found', async () => {
			mockExecFileCb.mockImplementation(
				(...args: unknown[]) => {
					const cb = args[args.length - 1];
					if (typeof cb === 'function') cb(null, '/usr/bin/security', '');
				},
			);

			expect(await kc.isAvailable()).toBe(true);
		});

		it('returns false when security binary is not found', async () => {
			mockExecFileCb.mockImplementation(
				(...args: unknown[]) => {
					const cb = args[args.length - 1];
					if (typeof cb === 'function') cb(new Error('not found'), '', '');
				},
			);

			expect(await kc.isAvailable()).toBe(false);
		});
	});
});
