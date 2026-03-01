/**
 * ScopedVault — wraps an ICredentialVault to restrict access to allowed providers only.
 * Used by custom tools to enforce least-privilege credential access.
 *
 * Each agent's tool list maps to a set of providers (e.g., web-search → brave-search).
 * Custom tools receive a ScopedVault that only exposes those providers' credentials.
 */

import type { ICredentialVault } from '../credentials/vault.js';

/**
 * Maps tool IDs to the credential providers they need.
 * Tools not listed here don't require any credentials.
 */
export const TOOL_PROVIDER_MAP: Readonly<Record<string, readonly string[]>> = {
	'web-search': ['brave-search'],
	'web-fetch': [],
	'browse': [],
	'email-send': ['google', 'resend'],
	'social-publish': ['twitter', 'linkedin', 'buffer'],
	'stripe-billing': ['stripe'],
	'github-ci': ['github'],
	'image-render': ['replicate', 'stability'],
	'app-generate': ['v0'],
	'app-deploy': ['vercel'],
	'backend-provision': ['supabase'],
	'code-generate': ['anthropic', 'openai'],
};

/** Derive the set of allowed providers from an agent's tool list. */
export function deriveAllowedProviders(agentTools: readonly string[]): string[] {
	const providers = new Set<string>();
	for (const tool of agentTools) {
		const mapped = TOOL_PROVIDER_MAP[tool];
		if (mapped) {
			for (const p of mapped) providers.add(p);
		}
	}
	return [...providers];
}

/**
 * A credential vault wrapper that restricts access to a set of allowed providers.
 * Denied accesses return undefined (for reads) or are silently dropped (for writes/deletes),
 * with a log callback for audit visibility.
 */
export class ScopedVault implements ICredentialVault {
	private readonly allowed: ReadonlySet<string>;

	constructor(
		private readonly inner: ICredentialVault,
		allowedProviders: readonly string[],
		private readonly onDenied?: (provider: string, operation: string) => void,
	) {
		this.allowed = new Set(allowedProviders);
	}

	async get(provider: string, key: string): Promise<string | undefined> {
		if (!this.allowed.has(provider)) {
			this.onDenied?.(provider, 'get');
			return undefined;
		}
		return this.inner.get(provider, key);
	}

	async set(provider: string, key: string, value: string): Promise<void> {
		// Allow tools to store their own credentials (e.g., OAuth tokens)
		return this.inner.set(provider, key, value);
	}

	async delete(provider: string, key: string): Promise<void> {
		if (!this.allowed.has(provider)) {
			this.onDenied?.(provider, 'delete');
			return;
		}
		return this.inner.delete(provider, key);
	}

	async list(): Promise<readonly string[]> {
		const all = await this.inner.list();
		return all.filter((p) => this.allowed.has(p));
	}
}
