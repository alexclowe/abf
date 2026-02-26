/**
 * Tests for OpenAIProvider — mocks the SDK to verify chunk transformation.
 */

import { describe, expect, it, vi } from 'vitest';
import type { FilesystemCredentialVault } from '../../credentials/vault.js';

// Build a fake streaming response that mimics the openai stream API
const buildFakeStream = () => {
	const chunks = [
		{ choices: [{ delta: { content: 'Hello ' }, finish_reason: null }] },
		{ choices: [{ delta: { content: 'world' }, finish_reason: null }] },
		{ choices: [{ delta: {}, finish_reason: 'stop' }] },
	];

	let index = 0;

	const fakeStream = {
		[Symbol.asyncIterator]() {
			return {
				next: async () => {
					if (index < chunks.length) {
						return { value: chunks[index++], done: false };
					}
					return { value: undefined, done: true };
				},
			};
		},
		async finalChatCompletion() {
			return {
				usage: {
					prompt_tokens: 10,
					completion_tokens: 3,
					total_tokens: 13,
				},
			};
		},
	};

	return fakeStream;
};

vi.mock('openai', () => {
	class MockChatCompletions {
		stream(_params: unknown) {
			return buildFakeStream();
		}
	}

	class MockChat {
		completions = new MockChatCompletions();
	}

	class MockClient {
		chat = new MockChat();
		static APIError = class extends Error {
			status: number;
			constructor(status: number, msg: string) {
				super(msg);
				this.status = status;
			}
		};
	}

	return {
		default: MockClient,
		APIError: MockClient.APIError,
	};
});

describe('OpenAIProvider', () => {
	it('streams text and emits usage from mocked SDK', async () => {
		process.env['OPENAI_API_KEY'] = 'sk-test';

		const vault = {
			get: vi.fn().mockResolvedValue(undefined),
			set: vi.fn(),
			delete: vi.fn(),
			list: vi.fn().mockResolvedValue([]),
		};

		const { OpenAIProvider } = await import('./openai.js');
		const provider = new OpenAIProvider(vault as unknown as FilesystemCredentialVault);

		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'gpt-4o',
			messages: [{ role: 'user', content: 'Say hello' }],
		})) {
			chunks.push(chunk);
		}

		const textChunks = chunks.filter((c) => c.type === 'text');
		expect(textChunks.map((c) => c.text).join('')).toBe('Hello world');

		const usageChunks = chunks.filter((c) => c.type === 'usage');
		expect(usageChunks.length).toBeGreaterThan(0);
		const usage = usageChunks[0]?.usage;
		expect(usage?.inputTokens).toBe(10);
		expect(usage?.outputTokens).toBe(3);
		expect(usage?.totalTokens).toBe(13);

		const lastChunk = chunks[chunks.length - 1];
		expect(lastChunk?.type).toBe('done');

		delete process.env['OPENAI_API_KEY'];
	});

	it('yields error chunk when no API key configured', async () => {
		delete process.env['OPENAI_API_KEY'];

		const vault = {
			get: vi.fn().mockResolvedValue(undefined),
			set: vi.fn(),
			delete: vi.fn(),
			list: vi.fn().mockResolvedValue([]),
		};

		const { OpenAIProvider } = await import('./openai.js');
		const provider = new OpenAIProvider(vault as unknown as FilesystemCredentialVault);

		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'gpt-4o',
			messages: [{ role: 'user', content: 'test' }],
		})) {
			chunks.push(chunk);
		}

		expect(chunks[0]?.type).toBe('error');
		expect(chunks[0]?.error).toContain('API key');
	});

	it('estimates cost in USDCents', async () => {
		const vault = { get: vi.fn(), set: vi.fn(), delete: vi.fn(), list: vi.fn() };
		const { OpenAIProvider } = await import('./openai.js');
		const provider = new OpenAIProvider(vault as unknown as FilesystemCredentialVault);

		const cost = provider.estimateCost('gpt-4o', 1000);
		expect(cost).toBeGreaterThan(0);
	});
});
