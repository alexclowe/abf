/**
 * Secure Vault v2 — proper credential storage.
 *
 * Upgrades from v1's SHA-256(hostname:username) key derivation to:
 *   1. OS Keychain (preferred) — random master key stored in native keychain
 *   2. Scrypt master password — user-supplied password + memory-hard KDF
 *
 * File format (v2):
 *   Line 1: JSON VaultHeader (plaintext — backend + KDF params)
 *   Line 2: base64(IV[12] + AuthTag[16] + AES-256-GCM ciphertext)
 *
 * Environment variables always override vault (existing behavior preserved).
 *
 * Note: Uses Node built-in crypto.scrypt instead of Argon2id to avoid native
 * dependencies. Scrypt with N=32768,r=8,p=1 is OWASP-approved and provides
 * strong resistance to GPU brute-force attacks. Argon2id can be swapped in
 * later by changing the KDF call without altering the file format.
 */

import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	scrypt,
} from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { homedir, hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import type { ICredentialVault } from './vault.js';
import { createKeychain, type IKeychain } from './keychain.js';

// promisify(scrypt) only sees the 3-arg overload — cast to include the options overload
const scryptAsync = promisify(scrypt) as (
	password: string | Buffer,
	salt: string | Buffer,
	keylen: number,
	options?: { N?: number; r?: number; p?: number },
) => Promise<Buffer>;

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_VAULT_PATH = join(homedir(), '.abf', 'credentials.enc');
const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

// Scrypt parameters (OWASP recommendations for interactive login)
const SCRYPT_N = 32768;  // CPU/memory cost — 2^15
const SCRYPT_R = 8;      // block size
const SCRYPT_P = 1;      // parallelism
const SCRYPT_SALT_LEN = 32;

// Scrypt validation bounds
const SCRYPT_MAX_N = 2 ** 20;
const SCRYPT_MAX_R = 16;
const SCRYPT_MAX_P = 4;

// ─── Types ──────────────────────────────────────────────────────────

interface VaultHeader {
	readonly version: 2;
	readonly backend: 'keychain' | 'scrypt';
	readonly salt?: string;     // base64, scrypt only
	readonly N?: number;        // scrypt cost
	readonly r?: number;        // scrypt block size
	readonly p?: number;        // scrypt parallelism
	readonly storedAt?: string; // ISO timestamp of creation
}

type VaultData = Record<string, Record<string, string>>;

// ─── Encryption helpers ─────────────────────────────────────────────

function encryptData(plaintext: string, key: Buffer): string {
	const iv = randomBytes(IV_LEN);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptData(encoded: string, key: Buffer): string {
	const combined = Buffer.from(encoded, 'base64');
	const iv = combined.subarray(0, IV_LEN);
	const tag = combined.subarray(IV_LEN, IV_LEN + TAG_LEN);
	const ciphertext = combined.subarray(IV_LEN + TAG_LEN);
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ─── V1 Migration ───────────────────────────────────────────────────

function isV1Vault(content: string): boolean {
	const firstLine = content.trim().split('\n')[0] ?? '';
	return !firstLine.startsWith('{');
}

function decryptV1(content: string): VaultData {
	const seed = `${hostname()}:${userInfo().username}:abf-vault-v1`;
	const key = createHash('sha256').update(seed).digest().subarray(0, KEY_LEN);
	const decrypted = decryptData(content.trim(), key);
	return JSON.parse(decrypted) as VaultData;
}

// ─── Scrypt key derivation ──────────────────────────────────────────

async function deriveScryptKey(
	password: string,
	salt: Buffer,
	N = SCRYPT_N,
	r = SCRYPT_R,
	p = SCRYPT_P,
): Promise<Buffer> {
	return (await scryptAsync(password, salt, KEY_LEN, { N, r, p })) as Buffer;
}

// ─── Header validation ─────────────────────────────────────────────

function validateHeader(parsed: unknown): VaultHeader {
	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error('[vault] Invalid vault header: not an object');
	}
	const obj = parsed as Record<string, unknown>;

	if (obj['version'] !== 2) {
		throw new Error(`[vault] Unsupported vault version: ${String(obj['version'])} (expected 2)`);
	}

	if (obj['backend'] !== 'keychain' && obj['backend'] !== 'scrypt') {
		throw new Error(`[vault] Unknown vault backend: ${String(obj['backend'])} (expected 'keychain' or 'scrypt')`);
	}

	if (obj['backend'] === 'scrypt') {
		if (typeof obj['salt'] !== 'string' || obj['salt'].length === 0) {
			throw new Error('[vault] Scrypt backend requires a non-empty salt');
		}
		if (typeof obj['N'] !== 'number' || obj['N'] < 1 || obj['N'] > SCRYPT_MAX_N) {
			throw new Error(`[vault] Scrypt N out of bounds: ${String(obj['N'])} (max ${SCRYPT_MAX_N})`);
		}
		if (typeof obj['r'] !== 'number' || obj['r'] < 1 || obj['r'] > SCRYPT_MAX_R) {
			throw new Error(`[vault] Scrypt r out of bounds: ${String(obj['r'])} (max ${SCRYPT_MAX_R})`);
		}
		if (typeof obj['p'] !== 'number' || obj['p'] < 1 || obj['p'] > SCRYPT_MAX_P) {
			throw new Error(`[vault] Scrypt p out of bounds: ${String(obj['p'])} (max ${SCRYPT_MAX_P})`);
		}
	}

	return parsed as VaultHeader;
}

// ─── VaultV2 ────────────────────────────────────────────────────────

export class VaultV2 implements ICredentialVault {
	private data: VaultData = {};
	private masterKey: Buffer | null = null;
	private header: VaultHeader | null = null;
	private initPromise: Promise<void> | null = null;
	private dirEnsured = false;

	constructor(
		private readonly vaultPath: string,
		private readonly keychain: IKeychain,
		private readonly masterPassword?: string,
	) {}

	/** Must be called before any get/set/delete/list operations. */
	async initialize(): Promise<void> {
		if (this.initPromise) return this.initPromise;
		this.initPromise = this.doInitialize();
		return this.initPromise;
	}

	private async doInitialize(): Promise<void> {
		// Ensure vault directory exists once during initialization
		await this.ensureDir();

		if (!existsSync(this.vaultPath)) {
			// Fresh install — create empty vault
			await this.establishMasterKey();
			this.data = {};
			await this.save();
			return;
		}

		const content = (await readFile(this.vaultPath, 'utf8')).trim();

		if (isV1Vault(content)) {
			// Migrate from v1
			try {
				this.data = decryptV1(content);
				await this.establishMasterKey();
				await this.save();
				console.log('[vault] Upgraded to v2 — your credentials are now more secure');
			} catch {
				// V1 decryption failed — start fresh
				console.warn('[vault] Could not migrate v1 vault — starting fresh');
				this.data = {};
				await this.establishMasterKey();
				await this.save();
			}
			return;
		}

		// V2 format — split at first newline only (M1: don't break on embedded newlines)
		const newlineIdx = content.indexOf('\n');
		if (newlineIdx === -1) {
			this.data = {};
			await this.establishMasterKey();
			await this.save();
			return;
		}
		const headerLine = content.substring(0, newlineIdx);
		const ciphertextLine = content.substring(newlineIdx + 1);
		if (!headerLine || !ciphertextLine) {
			this.data = {};
			await this.establishMasterKey();
			await this.save();
			return;
		}

		this.header = validateHeader(JSON.parse(headerLine));

		if (this.header.backend === 'keychain') {
			this.masterKey = await this.keychain.getMasterKey();
			if (!this.masterKey) {
				// Keychain lost the key — can't decrypt. Start fresh.
				console.warn('[vault] Keychain master key not found — credentials reset');
				this.data = {};
				await this.establishMasterKey();
				await this.save();
				return;
			}
		} else {
			// Scrypt backend — derive key from password
			const password = this.masterPassword ?? process.env['ABF_VAULT_PASSWORD'];
			if (!password) {
				console.warn('[vault] No vault password provided (set ABF_VAULT_PASSWORD) — credentials unavailable');
				this.data = {};
				return;
			}
			// Salt is guaranteed present by validateHeader for scrypt backend
			const salt = Buffer.from(this.header.salt!, 'base64');
			this.masterKey = await deriveScryptKey(
				password,
				salt,
				this.header.N,
				this.header.r,
				this.header.p,
			);
		}

		try {
			const decrypted = decryptData(ciphertextLine, this.masterKey);
			this.data = JSON.parse(decrypted) as VaultData;
		} catch {
			console.warn('[vault] Decryption failed — wrong password or corrupted vault');
			this.data = {};
		}
	}

	private async establishMasterKey(): Promise<void> {
		const keychainAvailable = await this.keychain.isAvailable();

		if (keychainAvailable) {
			// Generate random master key, store in OS keychain
			this.masterKey = randomBytes(KEY_LEN);
			await this.keychain.setMasterKey(this.masterKey);
			this.header = {
				version: 2,
				backend: 'keychain',
				storedAt: new Date().toISOString(),
			};
			return;
		}

		// Fall back to scrypt with master password
		const password = this.masterPassword ?? process.env['ABF_VAULT_PASSWORD'] ?? '';
		if (!password) {
			if (process.env['ABF_VAULT_INSECURE'] === 'true') {
				console.warn('[vault] No keychain and no ABF_VAULT_PASSWORD — using empty password (ABF_VAULT_INSECURE=true)');
			} else {
				throw new Error(
					'[vault] No keychain available and no ABF_VAULT_PASSWORD set. ' +
					'Either set the ABF_VAULT_PASSWORD environment variable, or set ABF_VAULT_INSECURE=true ' +
					'to allow an empty password (NOT recommended for production).',
				);
			}
		}
		const salt = randomBytes(SCRYPT_SALT_LEN);
		this.masterKey = await deriveScryptKey(password, salt);
		this.header = {
			version: 2,
			backend: 'scrypt',
			salt: salt.toString('base64'),
			N: SCRYPT_N,
			r: SCRYPT_R,
			p: SCRYPT_P,
			storedAt: new Date().toISOString(),
		};
	}

	private async ensureDir(): Promise<void> {
		if (this.dirEnsured) return;
		await mkdir(dirname(this.vaultPath), { recursive: true });
		this.dirEnsured = true;
	}

	private async save(): Promise<void> {
		if (!this.masterKey || !this.header) return;
		const json = JSON.stringify(this.data);
		const ciphertext = encryptData(json, this.masterKey);
		const content = JSON.stringify(this.header) + '\n' + ciphertext;

		// Atomic write: write to temp file, then rename
		const tempPath = join(dirname(this.vaultPath), `.vault-${Date.now()}-${randomBytes(4).toString('hex')}.tmp`);
		await writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600 });
		await rename(tempPath, this.vaultPath);
	}

	async set(provider: string, key: string, value: string): Promise<void> {
		this.data[provider] ??= {};
		this.data[provider]![key] = value;
		await this.save();
	}

	async get(provider: string, key: string): Promise<string | undefined> {
		// Environment variables always win (for CI/Docker)
		const envKey = `${provider.toUpperCase().replace(/-/g, '_')}_${key.toUpperCase().replace(/-/g, '_')}`;
		const envVal = process.env[envKey];
		if (envVal) return envVal;

		return this.data[provider]?.[key];
	}

	async delete(provider: string, key: string): Promise<void> {
		if (this.data[provider]) {
			delete this.data[provider]![key];
			if (Object.keys(this.data[provider]!).length === 0) {
				delete this.data[provider];
			}
			await this.save();
		}
	}

	async list(): Promise<readonly string[]> {
		return Object.keys(this.data);
	}

	/** Returns vault backend info for Dashboard display. */
	getBackendInfo(): { backend: string } {
		if (this.header) return { backend: this.header.backend };
		return { backend: 'none' };
	}

	/** Zeroes the master key buffer and clears all data from memory. */
	destroy(): void {
		if (this.masterKey) {
			this.masterKey.fill(0);
			this.masterKey = null;
		}
		this.data = {};
		this.header = null;
		this.initPromise = null;
	}
}

// ─── Factory ────────────────────────────────────────────────────────

export async function createVault(options?: {
	readonly vaultPath?: string;
	readonly masterPassword?: string;
	readonly preferKeychain?: boolean;
}): Promise<ICredentialVault> {
	const vaultPath = options?.vaultPath ?? DEFAULT_VAULT_PATH;
	const keychain = createKeychain();
	const vault = new VaultV2(vaultPath, keychain, options?.masterPassword);
	await vault.initialize();
	return vault;
}
