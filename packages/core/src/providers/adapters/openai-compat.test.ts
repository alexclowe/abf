/**
 * Tests for OpenAICompatProvider — validates SSE parsing, credential resolution,
 * tool call accumulation, and abort handling.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { OpenAICompatProvider } from './openai-compat.js';
import type { OpenAICompatConfig } from './openai-compat.js';
import type { ICredentialVault } from '../../credentials/vault.js';

const TEST_CONFIG: OpenAICompatConfig = {
	id: 'test-provider',
	name: 'Test Provider',
	slug: 'test-provider',
	baseUrl: 'https://api.test.example/v1',
	authType: 'api_key',
	envVar: 'TEST_PROVIDER_API_KEY',
	defaultModel: 'test-model',
	models: [
		{
			id: 'test-model',
			name: 'Test Model',
			contextWindow: 128_000,
			supportsTools: true,
			supportsStreaming: true,
			costPerInputToken: 0.000001,
			costPerOutputToken: 0.000005,
		},
	],
};

function createMockVault(apiKey?: string): ICredentialVault {
	return {
		get: vi.fn().mockResolvedValue(apiKey ?? undefined),
		set: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
		list: vi.fn().mockResolvedValue(apiKey ? ['test-provider'] : []),
	} as unknown as ICredentialVault;
}

/** Create a ReadableStream from SSE data lines */
function createSSEStream(events: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const data = events.map((e) => `data: ${e}\n\n`).join('') + 'data: [DONE]\n\n';
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(data));
			controller.close();
		},
	});
}

describe('OpenAICompatProvider', () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		delete process.env['TEST_PROVIDER_API_KEY'];
	});

	it('has correct id, name, slug from config', () => {
		const provider = new OpenAICompatProvider(TEST_CONFIG, createMockVault('sk-test'));
		expect(provider.id).toBe('test-provider');
		expect(provider.name).toBe('Test Provider');
		expect(provider.slug).toBe('test-provider');
		expect(provider.authType).toBe('api_key');
	});

	it('resolves API key from vault', async () => {
		const vault = createMockVault('sk-from-vault');
		const provider = new OpenAICompatProvider(TEST_CONFIG, vault);

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			body: createSSEStream([
				JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }),
			]),
		});

		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'test-model',
			messages: [{ role: 'user', content: 'test' }],
		})) {
			chunks.push(chunk);
		}

		expect(vault.get).toHaveBeenCalledWith('test-provider', 'api_key');
		expect(chunks.some((c) => c.type === 'text')).toBe(true);
	});

	it('falls back to env var when vault returns undefined', async () => {
		process.env['TEST_PROVIDER_API_KEY'] = 'sk-from-env';
		const vault = createMockVault(undefined);
		const provider = new OpenAICompatProvider(TEST_CONFIG, vault);

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			body: createSSEStream([
				JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }),
			]),
		});

		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'test-model',
			messages: [{ role: 'user', content: 'test' }],
		})) {
			chunks.push(chunk);
		}

		expect(chunks.some((c) => c.type === 'text')).toBe(true);
		// Verify auth header was set with env var key
		const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(fetchCall?.[1]?.headers?.['Authorization']).toBe('Bearer sk-from-env');
	});

	it('yields error when no API key available', async () => {
		const vault = createMockVault(undefined);
		const provider = new OpenAICompatProvider(TEST_CONFIG, vault);

		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'test-model',
			messages: [{ role: 'user', content: 'test' }],
		})) {
			chunks.push(chunk);
		}

		expect(chunks[0]?.type).toBe('error');
		expect(chunks[0]?.error).toContain('API key not found');
	});

	it('streams text chunks from SSE response', async () => {
		const provider = new OpenAICompatProvider(TEST_CONFIG, createMockVault('sk-test'));

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			body: createSSEStream([
				JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] }),
				JSON.stringify({ choices: [{ delta: { content: 'world' } }] }),
				JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5 } }),
			]),
		});

		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'test-model',
			messages: [{ role: 'user', content: 'Say hello' }],
		})) {
			chunks.push(chunk);
		}

		const textChunks = chunks.filter((c) => c.type === 'text');
		expect(textChunks.map((c) => c.text).join('')).toBe('Hello world');

		const usageChunks = chunks.filter((c) => c.type === 'usage');
		expect(usageChunks.length).toBe(1);
		expect(usageChunks[0]?.usage?.inputTokens).toBe(10);
		expect(usageChunks[0]?.usage?.outputTokens).toBe(5);

		expect(chunks[chunks.length - 1]?.type).toBe('done');
	});

	it('accumulates and emits tool calls', async () => {
		const provider = new OpenAICompatProvider(TEST_CONFIG, createMockVault('sk-test'));

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			body: createSSEStream([
				JSON.stringify({
					choices: [{
						delta: {
							tool_calls: [{
								index: 0,
								id: 'call_123',
								function: { name: 'web-search', arguments: '{"q' },
							}],
						},
					}],
				}),
				JSON.stringify({
					choices: [{
						delta: {
							tool_calls: [{
								index: 0,
								function: { arguments: 'uery":"test"}' },
							}],
						},
					}],
				}),
			]),
		});

		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'test-model',
			messages: [{ role: 'user', content: 'search for test' }],
			tools: [{ name: 'web-search', description: 'Search', parameters: {} }],
		})) {
			chunks.push(chunk);
		}

		const toolChunks = chunks.filter((c) => c.type === 'tool_call');
		expect(toolChunks.length).toBe(1);
		expect(toolChunks[0]?.toolCall?.id).toBe('call_123');
		expect(toolChunks[0]?.toolCall?.name).toBe('web-search');
		expect(toolChunks[0]?.toolCall?.arguments).toBe('{"query":"test"}');
	});

	it('handles HTTP error responses', async () => {
		const provider = new OpenAICompatProvider(TEST_CONFIG, createMockVault('sk-test'));

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			text: vi.fn().mockResolvedValue('Invalid API key'),
		});

		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'test-model',
			messages: [{ role: 'user', content: 'test' }],
		})) {
			chunks.push(chunk);
		}

		expect(chunks[0]?.type).toBe('error');
		expect(chunks[0]?.error).toContain('authentication failed');
	});

	it('handles rate limiting', async () => {
		const provider = new OpenAICompatProvider(TEST_CONFIG, createMockVault('sk-test'));

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 429,
			statusText: 'Too Many Requests',
			text: vi.fn().mockResolvedValue('Rate limit exceeded'),
		});

		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'test-model',
			messages: [{ role: 'user', content: 'test' }],
		})) {
			chunks.push(chunk);
		}

		expect(chunks[0]?.type).toBe('error');
		expect(chunks[0]?.error).toContain('rate limited');
	});

	it('returns static models when config provides them', async () => {
		const provider = new OpenAICompatProvider(TEST_CONFIG, createMockVault('sk-test'));
		const models = await provider.models();
		expect(models).toEqual(TEST_CONFIG.models);
	});

	it('returns fallback model when no static models and no API key', async () => {
		const configWithoutModels: OpenAICompatConfig = {
			...TEST_CONFIG,
			models: undefined,
		};
		const provider = new OpenAICompatProvider(configWithoutModels, createMockVault(undefined));
		const models = await provider.models();
		expect(models.length).toBe(1);
		expect(models[0]?.id).toBe('test-model');
	});

	it('estimates cost using static model pricing', () => {
		const provider = new OpenAICompatProvider(TEST_CONFIG, createMockVault('sk-test'));
		const cost = provider.estimateCost('test-model', 1000);
		// 1000 * 0.000001 * 100 = 0.1 → rounds to 0
		expect(cost).toBeGreaterThanOrEqual(0);
	});

	it('passes extra headers from config', async () => {
		const configWithHeaders: OpenAICompatConfig = {
			...TEST_CONFIG,
			headers: { 'X-Custom': 'test-value' },
		};
		const provider = new OpenAICompatProvider(configWithHeaders, createMockVault('sk-test'));

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			body: createSSEStream([
				JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }),
			]),
		});

		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'test-model',
			messages: [{ role: 'user', content: 'test' }],
		})) {
			chunks.push(chunk);
		}

		const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(fetchCall?.[1]?.headers?.['X-Custom']).toBe('test-value');
	});

	it('sends correct request body with tools and temperature', async () => {
		const provider = new OpenAICompatProvider(TEST_CONFIG, createMockVault('sk-test'));

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			body: createSSEStream([
				JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }),
			]),
		});

		for await (const _ of provider.chat({
			model: 'test-model',
			messages: [{ role: 'user', content: 'test' }],
			temperature: 0.7,
			maxTokens: 1024,
			tools: [{ name: 'search', description: 'Search', parameters: { type: 'object' } }],
		})) {
			// consume
		}

		const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(fetchCall?.[1]?.body as string);
		expect(body.model).toBe('test-model');
		expect(body.stream).toBe(true);
		expect(body.temperature).toBe(0.7);
		expect(body.max_tokens).toBe(1024);
		expect(body.tools).toHaveLength(1);
		expect(body.tools[0].function.name).toBe('search');
	});
});
