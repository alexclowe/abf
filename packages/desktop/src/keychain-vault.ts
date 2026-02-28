/**
 * Native Keychain Vault — stores credentials in the OS keychain.
 *
 * Uses the `keytar` package (or Tauri's credential store plugin) to store
 * API keys and tokens in:
 * - macOS: Keychain
 * - Windows: Credential Manager
 * - Linux: Secret Service (GNOME Keyring / KWallet)
 *
 * Implements the same ICredentialVault interface as the file-based vault,
 * so it's a drop-in replacement for desktop deployments.
 */

import type { ICredentialVault } from '@abf/core';

const SERVICE_NAME = 'abf-desktop';

/** Minimal keytar-compatible interface (optional dependency). */
interface KeytarLike {
	getPassword(service: string, account: string): Promise<string | null>;
	setPassword(service: string, account: string, password: string): Promise<void>;
	deletePassword(service: string, account: string): Promise<boolean>;
	findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

/**
 * Create a vault backed by the OS native keychain.
 * Falls back to a warning if keytar is not installed.
 */
export function createKeychainVault(): ICredentialVault {
	let keytarInstance: KeytarLike | null = null;

	async function getKeytar(): Promise<KeytarLike> {
		if (keytarInstance) return keytarInstance;
		try {
			const modPath = 'keytar';
			keytarInstance = (await import(modPath)) as KeytarLike;
			return keytarInstance;
		} catch {
			throw new Error(
				'Native keychain not available. Install keytar: npm install keytar',
			);
		}
	}

	function makeKey(namespace: string, key: string): string {
		return `${namespace}:${key}`;
	}

	return {
		async get(namespace: string, key: string): Promise<string | null> {
			const keytar = await getKeytar();
			return keytar.getPassword(SERVICE_NAME, makeKey(namespace, key));
		},

		async set(namespace: string, key: string, value: string): Promise<void> {
			const keytar = await getKeytar();
			await keytar.setPassword(SERVICE_NAME, makeKey(namespace, key), value);
		},

		async delete(namespace: string, key: string): Promise<void> {
			const keytar = await getKeytar();
			await keytar.deletePassword(SERVICE_NAME, makeKey(namespace, key));
		},

		async list(namespace: string): Promise<string[]> {
			const keytar = await getKeytar();
			const creds = await keytar.findCredentials(SERVICE_NAME);
			const prefix = `${namespace}:`;
			return creds
				.filter((c) => c.account.startsWith(prefix))
				.map((c) => c.account.slice(prefix.length));
		},

		async has(namespace: string, key: string): Promise<boolean> {
			const keytar = await getKeytar();
			const val = await keytar.getPassword(SERVICE_NAME, makeKey(namespace, key));
			return val !== null;
		},
	};
}
