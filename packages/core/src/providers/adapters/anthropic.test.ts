/**
 * Tests for AnthropicProvider — mocks the SDK to verify chunk transformation.
 */

import { describe, expect, it, vi } from 'vitest';
import { FilesystemCredentialVault } from '../../credentials/vault.js';

// Mock the Anthropic SDK before importing the provider
vi.mock('@anthropic-ai/sdk', () => {
	const mockStream = async function* () {
		// message_start with input tokens
		yield {
			type: 'message_start',
			message: { usage: { input_tokens: 10, output_tokens: 0 } },
		};
		// text content block
		yield { type: 'content_block_start', content_block: { type: 'text' } };
		yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } };
		yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } };
		yield { type: 'content_block_stop' };
		// message_delta with output tokens
		yield { type: 'message_delta', usage: { output_tokens: 5 } };
		yield { type: 'message_stop' };
	};

	class MockMessages {
		stream(_params: unknown) {
			return mockStream();
		}
	}

	class MockClient {
		messages = new MockMessages();
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

describe('AnthropicProvider', () => {
	it('streams text chunks and usage from mocked SDK', async () => {
		// Use a vault that will fall back to env var
		const vault = {
			get: vi.fn().mockResolvedValue(undefined),
			set: vi.fn(),
			delete: vi.fn(),
			list: vi.fn().mockResolvedValue([]),
		};
		process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';

		const { AnthropicProvider } = await import('./anthropic.js');
		const provider = new AnthropicProvider(vault as unknown as FilesystemCredentialVault);

		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'claude-sonnet-4-5',
			messages: [{ role: 'user', content: 'Say hello' }],
		})) {
			chunks.push(chunk);
		}

		// Should have text chunks
		const textChunks = chunks.filter((c) => c.type === 'text');
		expect(textChunks.length).toBeGreaterThan(0);
		expect(textChunks.map((c) => c.text).join('')).toBe('Hello world');

		// Should have usage chunks
		const usageChunks = chunks.filter((c) => c.type === 'usage');
		expect(usageChunks.length).toBeGreaterThan(0);

		// Should end with done
		const lastChunk = chunks[chunks.length - 1];
		expect(lastChunk?.type).toBe('done');

		delete process.env['ANTHROPIC_API_KEY'];
	});

	it('yields error chunk when no API key configured', async () => {
		delete process.env['ANTHROPIC_API_KEY'];

		const vault = {
			get: vi.fn().mockResolvedValue(undefined),
			set: vi.fn(),
			delete: vi.fn(),
			list: vi.fn().mockResolvedValue([]),
		};

		const { AnthropicProvider } = await import('./anthropic.js');
		const provider = new AnthropicProvider(vault as unknown as FilesystemCredentialVault);

		const chunks = [];
		for await (const chunk of provider.chat({
			model: 'claude-sonnet-4-5',
			messages: [{ role: 'user', content: 'test' }],
		})) {
			chunks.push(chunk);
		}

		expect(chunks[0]?.type).toBe('error');
		expect(chunks[0]?.error).toContain('API key');
	});

	it('returns models list', async () => {
		const vault = { get: vi.fn(), set: vi.fn(), delete: vi.fn(), list: vi.fn() };
		const { AnthropicProvider } = await import('./anthropic.js');
		const provider = new AnthropicProvider(vault as unknown as FilesystemCredentialVault);

		const models = await provider.models();
		expect(models.length).toBeGreaterThan(0);
		expect(models.every((m) => m.supportsTools)).toBe(true);
	});

	it('estimates cost in USDCents', async () => {
		const vault = { get: vi.fn(), set: vi.fn(), delete: vi.fn(), list: vi.fn() };
		const { AnthropicProvider } = await import('./anthropic.js');
		const provider = new AnthropicProvider(vault as unknown as FilesystemCredentialVault);

		const cost = provider.estimateCost('claude-sonnet-4-5', 1000);
		expect(cost).toBeGreaterThan(0);
	});
});
