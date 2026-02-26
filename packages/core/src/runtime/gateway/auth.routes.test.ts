/**
 * Tests for auth routes — uses Hono's built-in app.request() for zero-server testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { registerAuthRoutes } from './auth.routes.js';
import type { ICredentialVault } from '../../credentials/vault.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function makeMockVault() {
	return {
		get: vi.fn().mockResolvedValue(undefined),
		set: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
		list: vi.fn().mockResolvedValue([]),
		initialize: vi.fn().mockResolvedValue(undefined),
		destroy: vi.fn(),
	};
}

/** Mock global fetch to simulate provider validation endpoints. */
function mockProviderFetch(status = 200) {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		text: vi.fn().mockResolvedValue(''),
		json: vi.fn().mockResolvedValue({}),
	});
}

function createApp(vault: ReturnType<typeof makeMockVault>) {
	const app = new Hono();
	registerAuthRoutes(app, { vault: vault as unknown as ICredentialVault });
	return app;
}

function jsonPost(app: Hono, path: string, body: unknown, headers?: Record<string, string>) {
	return app.request(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('Auth Routes — POST /auth/key/:provider', () => {
	let vault: ReturnType<typeof makeMockVault>;
	let app: Hono;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		vault = makeMockVault();
		app = createApp(vault);
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('stores valid Anthropic key in vault', async () => {
		// Mock fetch so network validation passes
		globalThis.fetch = mockProviderFetch(200) as unknown as typeof globalThis.fetch;

		const res = await jsonPost(app, '/auth/key/anthropic', {
			key: 'sk-ant-test-key-1234',
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.connected).toBe(true);
		expect(vault.set).toHaveBeenCalledWith('anthropic', 'api_key', 'sk-ant-test-key-1234');
	});

	it('stores valid OpenAI key in vault', async () => {
		globalThis.fetch = mockProviderFetch(200) as unknown as typeof globalThis.fetch;

		const res = await jsonPost(app, '/auth/key/openai', {
			key: 'sk-proj-test-key-5678',
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.connected).toBe(true);
		expect(vault.set).toHaveBeenCalledWith('openai', 'api_key', 'sk-proj-test-key-5678');
	});

	it('validates Anthropic key prefix (sk-ant-)', async () => {
		const res = await jsonPost(app, '/auth/key/anthropic', {
			key: 'invalid-prefix-key',
		});
		const body = await res.json();
		expect(body.connected).toBe(false);
		expect(body.error).toContain('sk-ant-');
		expect(vault.set).not.toHaveBeenCalled();
	});

	it('validates OpenAI key prefix (sk-)', async () => {
		const res = await jsonPost(app, '/auth/key/openai', {
			key: 'not-a-valid-openai-key',
		});
		const body = await res.json();
		expect(body.connected).toBe(false);
		expect(body.error).toContain('sk-');
		expect(vault.set).not.toHaveBeenCalled();
	});

	it('rejects invalid key format from provider API (401)', async () => {
		globalThis.fetch = mockProviderFetch(401) as unknown as typeof globalThis.fetch;

		const res = await jsonPost(app, '/auth/key/anthropic', {
			key: 'sk-ant-expired-key',
		});
		const body = await res.json();
		expect(body.connected).toBe(false);
		expect(body.error).toContain('Invalid API key');
		expect(vault.set).not.toHaveBeenCalled();
	});

	it('rejects unknown provider with 400', async () => {
		const res = await jsonPost(app, '/auth/key/unknown-provider', {
			key: 'any-key',
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.connected).toBe(false);
		expect(body.error).toContain('Unknown provider');
	});

	it('rejects missing key field', async () => {
		const res = await jsonPost(app, '/auth/key/anthropic', {});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.connected).toBe(false);
		expect(body.error).toContain('key is required');
	});

	it('rejects empty key field', async () => {
		const res = await jsonPost(app, '/auth/key/anthropic', { key: '  ' });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.connected).toBe(false);
		expect(body.error).toContain('key is required');
	});
});

describe('Auth Routes — GET /auth/status', () => {
	let vault: ReturnType<typeof makeMockVault>;
	let app: Hono;
	let originalFetch: typeof globalThis.fetch;
	const savedEnvKeys: Record<string, string | undefined> = {};

	beforeEach(() => {
		vault = makeMockVault();
		app = createApp(vault);
		originalFetch = globalThis.fetch;

		// Save and clear provider env vars so they don't affect connected status
		for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'BRAVE_SEARCH_API_KEY']) {
			savedEnvKeys[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		// Restore env vars
		for (const [key, val] of Object.entries(savedEnvKeys)) {
			if (val === undefined) delete process.env[key];
			else process.env[key] = val;
		}
	});

	it('returns connection status per provider', async () => {
		// No vault keys, no env vars — all disconnected.
		// Mock fetch to reject Ollama probe.
		globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused')) as unknown as typeof globalThis.fetch;

		const res = await app.request('/auth/status');
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, { connected: boolean }>;

		// Should have anthropic, openai, brave-search, and ollama entries
		expect(body['anthropic']).toBeDefined();
		expect(body['openai']).toBeDefined();
		expect(body['ollama']).toBeDefined();

		// All disconnected when no keys set
		expect(body['anthropic']!.connected).toBe(false);
		expect(body['openai']!.connected).toBe(false);
		expect(body['ollama']!.connected).toBe(false);
	});

	it('shows connected when vault has a key', async () => {
		vault.get.mockImplementation(async (slug: string) => {
			if (slug === 'anthropic') return 'sk-ant-stored-key';
			return undefined;
		});
		globalThis.fetch = vi.fn().mockRejectedValue(new Error('refused')) as unknown as typeof globalThis.fetch;

		const res = await app.request('/auth/status');
		const body = (await res.json()) as Record<string, { connected: boolean }>;
		expect(body['anthropic']!.connected).toBe(true);
		expect(body['openai']!.connected).toBe(false);
	});
});

describe('Auth Routes — DELETE /auth/:provider', () => {
	let vault: ReturnType<typeof makeMockVault>;
	let app: Hono;

	beforeEach(() => {
		vault = makeMockVault();
		app = createApp(vault);
	});

	it('removes credential from vault', async () => {
		const res = await app.request('/auth/anthropic', { method: 'DELETE' });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.disconnected).toBe(true);
		expect(vault.delete).toHaveBeenCalledWith('anthropic', 'api_key');
	});

	it('rejects unknown provider with 400', async () => {
		const res = await app.request('/auth/unknown-provider', { method: 'DELETE' });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.disconnected).toBe(false);
		expect(body.error).toContain('Unknown provider');
	});
});

describe('Auth Routes — GET /auth/providers', () => {
	let vault: ReturnType<typeof makeMockVault>;
	let app: Hono;

	beforeEach(() => {
		vault = makeMockVault();
		app = createApp(vault);
	});

	it('returns available providers with metadata', async () => {
		const res = await app.request('/auth/providers');
		expect(res.status).toBe(200);
		const body = (await res.json()) as Array<{
			id: string;
			displayName: string;
			keyPrefix: string;
			deepLink: string;
			optional: boolean;
		}>;

		expect(body.length).toBeGreaterThanOrEqual(2);

		const anthropic = body.find((p) => p.id === 'anthropic');
		expect(anthropic).toBeDefined();
		expect(anthropic!.displayName).toBe('Anthropic (Claude)');
		expect(anthropic!.keyPrefix).toBe('sk-ant-');
		expect(anthropic!.deepLink).toContain('anthropic.com');
		expect(anthropic!.optional).toBe(false);

		const openai = body.find((p) => p.id === 'openai');
		expect(openai).toBeDefined();
		expect(openai!.keyPrefix).toBe('sk-');

		const brave = body.find((p) => p.id === 'brave-search');
		expect(brave).toBeDefined();
		expect(brave!.optional).toBe(true);
	});
});

describe('Auth Routes — Rate Limiting', () => {
	let vault: ReturnType<typeof makeMockVault>;
	let app: Hono;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		vault = makeMockVault();
		app = createApp(vault);
		originalFetch = globalThis.fetch;
		// Mock fetch to pass provider validation for all requests
		globalThis.fetch = mockProviderFetch(200) as unknown as typeof globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('returns 429 after 5 requests within the rate limit window', async () => {
		// The rate limiter is keyed by IP:provider. With Hono's app.request(),
		// x-forwarded-for defaults to 'unknown'. Send 6 requests.
		const results: number[] = [];
		for (let i = 0; i < 6; i++) {
			const res = await jsonPost(
				app,
				'/auth/key/anthropic',
				{ key: 'sk-ant-test-rate-limit-key' },
				// Use a unique IP to avoid interference from other tests
				{ 'X-Forwarded-For': '10.99.99.99' },
			);
			results.push(res.status);
		}

		// First 5 should succeed (200), 6th should be rate-limited (429)
		const successCount = results.filter((s) => s === 200).length;
		const rateLimitedCount = results.filter((s) => s === 429).length;
		expect(successCount).toBe(5);
		expect(rateLimitedCount).toBe(1);
	});
});
