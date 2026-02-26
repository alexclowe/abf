/**
 * Auth routes — provider key collection, status, and Ollama auto-detect.
 *
 * POST   /auth/key/:provider   — validate and store an API key
 * GET    /auth/status          — connection status for all providers + Ollama
 * DELETE /auth/:provider       — disconnect a provider
 * GET    /auth/ollama/detect   — dedicated Ollama probe with model details
 *
 * These routes are NOT behind the ABF_API_KEY middleware — they handle
 * their own security via rate limiting and input validation.
 */

import type { Hono } from 'hono';
import type { ICredentialVault } from '../../credentials/vault.js';

// ─── Provider configs ───────────────────────────────────────────────

interface ProviderAuthConfig {
	readonly displayName: string;
	readonly keyPrefix: string;
	readonly deepLink: string;
	readonly optional: boolean;
	readonly description?: string;
}

const PROVIDER_AUTH_CONFIGS: Record<string, ProviderAuthConfig> = {
	anthropic: {
		displayName: 'Anthropic (Claude)',
		keyPrefix: 'sk-ant-',
		deepLink: 'https://console.anthropic.com/settings/keys',
		optional: false,
	},
	openai: {
		displayName: 'OpenAI (GPT)',
		keyPrefix: 'sk-',
		deepLink: 'https://platform.openai.com/api-keys',
		optional: false,
	},
	'brave-search': {
		displayName: 'Brave Search',
		keyPrefix: 'BSA',
		deepLink: 'https://api.search.brave.com/app/keys',
		optional: true,
		description: 'Enables the web-search tool for agents',
	},
};

// ─── Helpers ────────────────────────────────────────────────────────

/** Strip control characters and limit length for safe logging. */
function sanitize(input: string, maxLen = 64): string {
	return input.replace(/[\x00-\x1f\x7f]/g, '').slice(0, maxLen);
}

/** Strip non-printable characters from a string value. */
function stripNonPrintable(s: string): string {
	return s.replace(/[^\x20-\x7e]/g, '');
}

// ─── Rate limiter ───────────────────────────────────────────────────

const rateLimitState = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
	const now = Date.now();

	// Prune expired entries when map grows beyond 100 to prevent unbounded growth
	if (rateLimitState.size > 100) {
		for (const [k, v] of rateLimitState) {
			if (now > v.resetAt) rateLimitState.delete(k);
		}
	}

	const state = rateLimitState.get(key);
	if (!state || now > state.resetAt) {
		rateLimitState.set(key, { count: 1, resetAt: now + 60_000 });
		return true;
	}
	if (state.count >= 5) return false;
	state.count++;
	return true;
}

// ─── Key validation ─────────────────────────────────────────────────

interface ValidationResult {
	readonly valid: boolean;
	readonly error?: string;
}

async function validateProviderKey(
	provider: string,
	key: string,
): Promise<ValidationResult> {
	const config = PROVIDER_AUTH_CONFIGS[provider];
	if (!config) return { valid: false, error: 'Unknown provider' };

	// Prefix check (fast, no network)
	if (!key.startsWith(config.keyPrefix)) {
		return { valid: false, error: `Key should start with "${config.keyPrefix}"` };
	}

	// Network validation — hit provider's lightweight endpoint
	try {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		let url: string;
		const method = 'GET';

		if (provider === 'anthropic') {
			url = 'https://api.anthropic.com/v1/models';
			headers['x-api-key'] = key;
			headers['anthropic-version'] = '2023-06-01';
		} else if (provider === 'openai') {
			url = 'https://api.openai.com/v1/models';
			headers['Authorization'] = `Bearer ${key}`;
		} else if (provider === 'brave-search') {
			url = 'https://api.search.brave.com/res/v1/web/search?q=test&count=1';
			headers['X-Subscription-Token'] = key;
		} else {
			return { valid: false, error: 'Unknown provider' };
		}

		const fetchOpts: RequestInit = {
			method,
			headers,
			signal: AbortSignal.timeout(10_000),
		};

		const resp = await fetch(url, fetchOpts);

		if (resp.status === 401 || resp.status === 403) {
			await resp.text().catch(() => '');
			return { valid: false, error: 'Invalid API key' };
		}

		// Consume the response body to free resources
		await resp.text().catch(() => '');

		// Any non-auth error means the key is valid but something else went wrong
		return { valid: true };
	} catch {
		return { valid: false, error: 'Could not reach provider. Check your connection.' };
	}
}

// ─── Route registration ─────────────────────────────────────────────

export interface AuthRoutesDeps {
	readonly vault: ICredentialVault;
}

export function registerAuthRoutes(app: Hono, deps: AuthRoutesDeps): void {
	// POST /auth/key/:provider — validate and store API key
	app.post('/auth/key/:provider', async (c) => {
		const provider = c.req.param('provider');
		if (!(provider in PROVIDER_AUTH_CONFIGS)) {
			return c.json({ connected: false, error: 'Unknown provider' }, 400);
		}

		// Rate limit: 5 attempts per IP per provider per minute
		const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
		const rateLimitKey = `${ip}:${provider}`;
		if (!checkRateLimit(rateLimitKey)) {
			return c.json({ connected: false, error: 'Too many attempts. Wait a minute.' }, 429);
		}

		const body = await c.req.json<{ key?: string }>().catch(() => ({} as { key?: string }));
		const key = body.key;
		if (typeof key !== 'string' || !key.trim()) {
			return c.json({ connected: false, error: 'key is required' }, 400);
		}

		const result = await validateProviderKey(provider, key.trim());
		if (!result.valid) {
			return c.json({ connected: false, error: result.error });
		}

		// Store in vault — key cleared from scope after this
		await deps.vault.set(provider, 'api_key', key.trim());
		console.log(`[auth] credential_stored provider=${sanitize(provider)} at=${new Date().toISOString()}`);

		return c.json({ connected: true });
	});

	// GET /auth/status — connection status for all providers
	app.get('/auth/status', async (c) => {
		const statuses: Record<string, unknown> = {};

		for (const [slug, config] of Object.entries(PROVIDER_AUTH_CONFIGS)) {
			const vaultKey = await deps.vault.get(slug, 'api_key');
			const envName = `${slug.toUpperCase().replace(/-/g, '_')}_API_KEY`;
			const fromEnv = Boolean(process.env[envName]);
			const connected = Boolean(vaultKey) || fromEnv;

			const entry: Record<string, unknown> = { connected };
			if (config.optional) entry['optional'] = true;
			if (config.description) entry['description'] = config.description;
			statuses[slug] = entry;
		}

		// Probe Ollama (Path 3 — auto-detect)
		try {
			const ollamaResp = await fetch('http://localhost:11434/api/tags', {
				signal: AbortSignal.timeout(2_000),
			});
			if (ollamaResp.ok) {
				const data = (await ollamaResp.json()) as { models?: unknown[] };
				const rawModels = Array.isArray(data.models) ? data.models.slice(0, 100) : [];
				const models = rawModels
					.filter((m): m is { name: string } => typeof (m as { name?: unknown })?.name === 'string')
					.map((m) => stripNonPrintable(m.name));
				statuses['ollama'] = { connected: true, models, local: true };
			} else {
				await ollamaResp.text().catch(() => '');
				statuses['ollama'] = { connected: false, local: true };
			}
		} catch {
			statuses['ollama'] = { connected: false, local: true };
		}

		return c.json(statuses);
	});

	// DELETE /auth/:provider — disconnect provider
	app.delete('/auth/:provider', async (c) => {
		const provider = c.req.param('provider');

		// Validate provider against known configs
		if (!(provider in PROVIDER_AUTH_CONFIGS)) {
			return c.json({ disconnected: false, error: 'Unknown provider' }, 400);
		}

		// Rate limit: 5 deletes per IP per provider per minute
		const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
		const rateLimitKey = `${ip}:delete:${provider}`;
		if (!checkRateLimit(rateLimitKey)) {
			return c.json({ disconnected: false, error: 'Too many attempts. Wait a minute.' }, 429);
		}

		await deps.vault.delete(provider, 'api_key');
		console.log(`[auth] credential_deleted provider=${sanitize(provider)} at=${new Date().toISOString()}`);
		return c.json({ disconnected: true });
	});

	// GET /auth/ollama/detect — dedicated Ollama probe with model details
	app.get('/auth/ollama/detect', async (c) => {
		try {
			const resp = await fetch('http://localhost:11434/api/tags', {
				signal: AbortSignal.timeout(3_000),
			});
			if (!resp.ok) {
				await resp.text().catch(() => '');
				return c.json({ detected: false });
			}

			const data = (await resp.json()) as {
				models?: unknown[];
			};
			const rawModels = Array.isArray(data.models) ? data.models.slice(0, 100) : [];
			const models = rawModels
				.filter((m): m is { name: string; size: unknown } =>
					typeof (m as { name?: unknown })?.name === 'string')
				.map((m) => ({
					name: stripNonPrintable((m as { name: string }).name),
					size: typeof (m as { size?: unknown }).size === 'number' ? (m as { size: number }).size : 0,
				}));
			return c.json({ detected: true, models, baseUrl: 'http://localhost:11434' });
		} catch {
			return c.json({ detected: false });
		}
	});

	// GET /auth/providers — list available provider configs (for Dashboard)
	app.get('/auth/providers', (c) => {
		const providers = Object.entries(PROVIDER_AUTH_CONFIGS).map(
			([id, config]) => ({
				id,
				displayName: config.displayName,
				keyPrefix: config.keyPrefix,
				deepLink: config.deepLink,
				optional: config.optional,
				...(config.description != null && { description: config.description }),
			}),
		);
		return c.json(providers);
	});
}
