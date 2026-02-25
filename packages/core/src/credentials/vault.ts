/**
 * FilesystemCredentialVault — AES-256-GCM encrypted credential storage.
 *
 * Stores provider API keys at ~/.abf/credentials.enc
 * Machine-derived encryption key: SHA-256(hostname + username)
 * process.env always overrides vault (for CI/scripts).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';

export interface ICredentialVault {
	set(provider: string, key: string, value: string): Promise<void>;
	get(provider: string, key: string): Promise<string | undefined>;
	delete(provider: string, key: string): Promise<void>;
	list(): Promise<readonly string[]>; // provider slugs with stored keys
}

const VAULT_PATH = join(homedir(), '.abf', 'credentials.enc');
const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

/** Derive a 32-byte machine key from hostname + username. */
function deriveMachineKey(): Buffer {
	const seed = `${hostname()}:${userInfo().username}:abf-vault-v1`;
	return createHash('sha256').update(seed).digest();
}

type VaultData = Record<string, Record<string, string>>;

function encrypt(plaintext: string, key: Buffer): string {
	const iv = randomBytes(IV_LEN);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	// Format: iv(12) + tag(16) + ciphertext — all base64-encoded together
	const combined = Buffer.concat([iv, tag, encrypted]);
	return combined.toString('base64');
}

function decrypt(encoded: string, key: Buffer): string {
	const combined = Buffer.from(encoded, 'base64');
	const iv = combined.subarray(0, IV_LEN);
	const tag = combined.subarray(IV_LEN, IV_LEN + TAG_LEN);
	const ciphertext = combined.subarray(IV_LEN + TAG_LEN);
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(tag);
	return decipher.update(ciphertext) + decipher.final('utf8');
}

export class FilesystemCredentialVault implements ICredentialVault {
	private readonly key: Buffer;
	private data: VaultData = {};
	private loaded = false;

	constructor(private readonly vaultPath: string = VAULT_PATH) {
		this.key = deriveMachineKey().subarray(0, KEY_LEN);
	}

	private load(): void {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const raw = readFileSync(this.vaultPath, 'utf8');
			const decrypted = decrypt(raw.trim(), this.key);
			this.data = JSON.parse(decrypted) as VaultData;
		} catch {
			// File doesn't exist or is corrupt — start with empty vault
			this.data = {};
		}
	}

	private save(): void {
		const json = JSON.stringify(this.data);
		const encrypted = encrypt(json, this.key);
		mkdirSync(dirname(this.vaultPath), { recursive: true });
		writeFileSync(this.vaultPath, encrypted, { encoding: 'utf8', mode: 0o600 });
	}

	async set(provider: string, key: string, value: string): Promise<void> {
		this.load();
		this.data[provider] ??= {};
		this.data[provider]![key] = value;
		this.save();
	}

	async get(provider: string, key: string): Promise<string | undefined> {
		// Environment variable always wins (for CI/scripts)
		const envKey = `${provider.toUpperCase()}_${key.toUpperCase().replace(/-/g, '_')}`;
		const envVal = process.env[envKey];
		if (envVal) return envVal;

		this.load();
		return this.data[provider]?.[key];
	}

	async delete(provider: string, key: string): Promise<void> {
		this.load();
		if (this.data[provider]) {
			delete this.data[provider]![key];
			if (Object.keys(this.data[provider]!).length === 0) {
				delete this.data[provider];
			}
			this.save();
		}
	}

	async list(): Promise<readonly string[]> {
		this.load();
		return Object.keys(this.data);
	}
}
