/**
 * Tests for CloudProxyProvider — endpoint validation, SSRF protection, chat streaming.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudProxyProvider } from './cloud-proxy.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function makeProvider(endpoint?: string, token = 'abf_test_token') {
	return new CloudProxyProvider({
		token,
		endpoint,
	});
}

/**
 * Create a mock ReadableStream from an array of NDJSON lines.
 * Each line is a JSON string (or plain string) that will be followed by '\n'.
 */
function mockNDJSONStream(lines: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	const data = lines.map((l) => l + '\n').join('');
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(data));
			controller.close();
		},
	});
}

function mockFetchResponse(status: number, body?: ReadableStream<Uint8Array> | string) {
	let bodyStream: ReadableStream<Uint8Array> | null = null;
	if (typeof body === 'string') {
		const encoder = new TextEncoder();
		bodyStream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode(body));
				controller.close();
			},
		});
	} else {
		bodyStream = body ?? null;
	}

	return {
		ok: status >= 200 && status < 300,
		status,
		body: bodyStream,
		text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : ''),
		json: vi.fn().mockResolvedValue({}),
	};
}

// ─── Endpoint Validation ──────────────────────────────────────────────

describe('CloudProxyProvider — Endpoint Validation', () => {
	it('requires HTTPS for non-localhost endpoints', () => {
		expect(() => makeProvider('http://api.example.com/v1')).toThrow(
			/must use HTTPS/,
		);
	});

	it('allows HTTPS for remote endpoints', () => {
		const provider = makeProvider('https://api.abf.cloud/v1');
		expect(provider.id).toBe('abf-cloud');
	});

	it('allows HTTP for localhost', () => {
		const provider = makeProvider('http://localhost:8080/v1');
		expect(provider.id).toBe('abf-cloud');
	});

	it('allows HTTP for 127.0.0.1', () => {
		const provider = makeProvider('http://127.0.0.1:8080/v1');
		expect(provider.id).toBe('abf-cloud');
	});

	it('blocks RFC 1918 10.x.x.x addresses', () => {
		expect(() => makeProvider('https://10.0.0.1/v1')).toThrow(
			/private RFC 1918/,
		);
		expect(() => makeProvider('https://10.255.255.255/v1')).toThrow(
			/private RFC 1918/,
		);
	});

	it('blocks RFC 1918 172.16-31.x.x addresses', () => {
		expect(() => makeProvider('https://172.16.0.1/v1')).toThrow(
			/private RFC 1918/,
		);
		expect(() => makeProvider('https://172.31.255.255/v1')).toThrow(
			/private RFC 1918/,
		);
	});

	it('blocks RFC 1918 192.168.x.x addresses', () => {
		expect(() => makeProvider('https://192.168.1.1/v1')).toThrow(
			/private RFC 1918/,
		);
		expect(() => makeProvider('https://192.168.0.100/v1')).toThrow(
			/private RFC 1918/,
		);
	});

	it('blocks link-local 169.254.x.x addresses (AWS metadata)', () => {
		expect(() => makeProvider('https://169.254.169.254/v1')).toThrow(
			/link-local/,
		);
		expect(() => makeProvider('https://169.254.0.1/v1')).toThrow(
			/link-local/,
		);
	});

	it('rejects invalid URL', () => {
		expect(() => makeProvider('not-a-url')).toThrow(/Invalid cloud endpoint URL/);
	});

	it('uses default endpoint when none provided', () => {
		const provider = makeProvider();
		expect(provider.name).toBe('ABF Cloud');
		// Default endpoint is https://api.abf.cloud/v1, which should be valid
	});
});

// ─── Provider Properties ──────────────────────────────────────────────

describe('CloudProxyProvider — Properties', () => {
	it('has correct id, name, slug, and authType', () => {
		const provider = makeProvider('https://api.abf.cloud/v1');
		expect(provider.id).toBe('abf-cloud');
		expect(provider.name).toBe('ABF Cloud');
		expect(provider.slug).toBe('abf-cloud');
		expect(provider.authType).toBe('api_key');
	});

	it('estimateCost always returns 0', () => {
		const provider = makeProvider('https://api.abf.cloud/v1');
		expect(provider.estimateCost('claude-sonnet-4-5', 1000)).toBe(0);
		expect(provider.estimateCost('gpt-4', 50000)).toBe(0);
	});
});

// ─── models() ─────────────────────────────────────────────────────────

describe('CloudProxyProvider — models()', () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('returns models from cloud endpoint', async () => {
		const mockModels = [
			{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet', contextWindow: 200000, supportsTools: true, supportsStreaming: true },
			{ id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, supportsTools: true, supportsStreaming: true },
		];

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ models: mockModels }),
		}) as unknown as typeof globalThis.fetch;

		const provider = makeProvider('https://api.abf.cloud/v1');
		const models = await provider.models();
		expect(models).toHaveLength(2);
		expect(models[0].id).toBe('claude-sonnet-4-5');
		expect(models[1].id).toBe('gpt-4o');
	});

	it('returns empty array on network error', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof globalThis.fetch;

		const provider = makeProvider('https://api.abf.cloud/v1');
		const models = await provider.models();
		expect(models).toEqual([]);
	});

	it('returns empty array on non-OK response', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
		}) as unknown as typeof globalThis.fetch;

		const provider = makeProvider('https://api.abf.cloud/v1');
		const models = await provider.models();
		expect(models).toEqual([]);
	});
});

// ─── chat() ───────────────────────────────────────────────────────────

describe('CloudProxyProvider — chat()', () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('streams text chunks from NDJSON response', async () => {
		const ndjsonLines = [
			JSON.stringify({ content: 'Hello ' }),
			JSON.stringify({ content: 'world!' }),
			JSON.stringify({ done: true, usage: { prompt_tokens: 10, completion_tokens: 5 } }),
		];

		globalThis.fetch = vi.fn().mockResolvedValue(
			mockFetchResponse(200, mockNDJSONStream(ndjsonLines)),
		) as unknown as typeof globalThis.fetch;

		const provider = makeProvider('https://api.abf.cloud/v1');
		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'claude-sonnet-4-5',
			messages: [{ role: 'user', content: 'Say hello' }],
		})) {
			chunks.push(chunk);
		}

		const textChunks = chunks.filter((c) => c.type === 'text');
		expect(textChunks).toHaveLength(2);
		expect(textChunks[0].text).toBe('Hello ');
		expect(textChunks[1].text).toBe('world!');

		const doneChunks = chunks.filter((c) => c.type === 'done');
		expect(doneChunks).toHaveLength(1);
		expect(doneChunks[0].usage).toEqual({
			inputTokens: 10,
			outputTokens: 5,
			totalTokens: 15,
		});
	});

	it('handles SSE format (data: prefix)', async () => {
		const ndjsonLines = [
			'data: ' + JSON.stringify({ content: 'SSE content' }),
			'data: ' + JSON.stringify({ done: true }),
		];

		globalThis.fetch = vi.fn().mockResolvedValue(
			mockFetchResponse(200, mockNDJSONStream(ndjsonLines)),
		) as unknown as typeof globalThis.fetch;

		const provider = makeProvider('https://api.abf.cloud/v1');
		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'test',
			messages: [{ role: 'user', content: 'test' }],
		})) {
			chunks.push(chunk);
		}

		const textChunks = chunks.filter((c) => c.type === 'text');
		expect(textChunks).toHaveLength(1);
		expect(textChunks[0].text).toBe('SSE content');
	});

	it('skips [DONE] sentinel and SSE comments', async () => {
		const ndjsonLines = [
			': this is a comment',
			JSON.stringify({ content: 'real content' }),
			'data: [DONE]',
			JSON.stringify({ done: true }),
		];

		globalThis.fetch = vi.fn().mockResolvedValue(
			mockFetchResponse(200, mockNDJSONStream(ndjsonLines)),
		) as unknown as typeof globalThis.fetch;

		const provider = makeProvider('https://api.abf.cloud/v1');
		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'test',
			messages: [{ role: 'user', content: 'test' }],
		})) {
			chunks.push(chunk);
		}

		const textChunks = chunks.filter((c) => c.type === 'text');
		expect(textChunks).toHaveLength(1);
		expect(textChunks[0].text).toBe('real content');
	});

	it('yields error chunk on network failure', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(
			new Error('Connection refused'),
		) as unknown as typeof globalThis.fetch;

		const provider = makeProvider('https://api.abf.cloud/v1');
		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'test',
			messages: [{ role: 'user', content: 'test' }],
		})) {
			chunks.push(chunk);
		}

		expect(chunks).toHaveLength(1);
		expect(chunks[0].type).toBe('error');
		expect(chunks[0].error).toContain('ABF Cloud unreachable');
		expect(chunks[0].error).toContain('Connection refused');
	});

	it('yields error chunk on non-OK HTTP response', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			mockFetchResponse(500, 'Internal Server Error'),
		) as unknown as typeof globalThis.fetch;

		const provider = makeProvider('https://api.abf.cloud/v1');
		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'test',
			messages: [{ role: 'user', content: 'test' }],
		})) {
			chunks.push(chunk);
		}

		expect(chunks).toHaveLength(1);
		expect(chunks[0].type).toBe('error');
		expect(chunks[0].error).toContain('ABF Cloud error 500');
	});

	it('yields error when response has no body', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			body: null,
			text: vi.fn().mockResolvedValue(''),
		}) as unknown as typeof globalThis.fetch;

		const provider = makeProvider('https://api.abf.cloud/v1');
		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'test',
			messages: [{ role: 'user', content: 'test' }],
		})) {
			chunks.push(chunk);
		}

		expect(chunks).toHaveLength(1);
		expect(chunks[0].type).toBe('error');
		expect(chunks[0].error).toContain('No response body');
	});

	it('emits done automatically if content was yielded but no done chunk received', async () => {
		const ndjsonLines = [
			JSON.stringify({ content: 'Partial response' }),
			// No done or usage line — stream ends abruptly
		];

		globalThis.fetch = vi.fn().mockResolvedValue(
			mockFetchResponse(200, mockNDJSONStream(ndjsonLines)),
		) as unknown as typeof globalThis.fetch;

		const provider = makeProvider('https://api.abf.cloud/v1');
		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'test',
			messages: [{ role: 'user', content: 'test' }],
		})) {
			chunks.push(chunk);
		}

		expect(chunks).toHaveLength(2);
		expect(chunks[0].type).toBe('text');
		expect(chunks[0].text).toBe('Partial response');
		expect(chunks[1].type).toBe('done');
	});

	it('sends correct authorization header and body', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			mockFetchResponse(200, mockNDJSONStream([
				JSON.stringify({ content: 'ok' }),
				JSON.stringify({ done: true }),
			])),
		);
		globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

		const provider = makeProvider('https://api.abf.cloud/v1', 'abf_my_secret_token');
		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'claude-sonnet-4-5',
			messages: [{ role: 'user', content: 'hello' }],
			temperature: 0.5,
		})) {
			chunks.push(chunk);
		}

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, opts] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.abf.cloud/v1/chat');
		expect(opts.method).toBe('POST');
		expect(opts.headers['Authorization']).toBe('Bearer abf_my_secret_token');
		expect(opts.headers['Content-Type']).toBe('application/json');

		const sentBody = JSON.parse(opts.body);
		expect(sentBody.model).toBe('claude-sonnet-4-5');
		expect(sentBody.messages).toHaveLength(1);
		expect(sentBody.temperature).toBe(0.5);
	});
});
