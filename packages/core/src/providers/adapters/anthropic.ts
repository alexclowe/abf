/**
 * Anthropic provider — real streaming implementation using @anthropic-ai/sdk.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ICredentialVault } from '../../credentials/vault.js';
import type { ProviderId, USDCents } from '../../types/common.js';
import { ProviderError } from '../../types/errors.js';
import type { ChatChunk, ChatRequest, ContentPart, IProvider, ModelInfo } from '../../types/provider.js';

export class AnthropicProvider implements IProvider {
	readonly id = 'anthropic' as ProviderId;
	readonly name = 'Anthropic';
	readonly slug = 'anthropic';
	readonly authType = 'api_key' as const;

	private cachedClient: { key: string; client: Anthropic } | null = null;

	constructor(private readonly vault: ICredentialVault) {}

	private getClient(apiKey: string): Anthropic {
		if (this.cachedClient?.key === apiKey) {
			return this.cachedClient.client;
		}
		const client = new Anthropic({ apiKey });
		this.cachedClient = { key: apiKey, client };
		return client;
	}

	private async getApiKey(): Promise<string> {
		const fromVault = await this.vault.get('anthropic', 'api_key');
		const key = fromVault ?? process.env['ANTHROPIC_API_KEY'];
		if (!key) {
			throw new ProviderError(
				'PROVIDER_AUTH_FAILED',
				'Anthropic API key not found. Run `abf auth anthropic` or set ANTHROPIC_API_KEY.',
			);
		}
		return key;
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		let apiKey: string;
		try {
			apiKey = await this.getApiKey();
		} catch (e) {
			yield { type: 'error', error: (e as Error).message };
			return;
		}

		const client = this.getClient(apiKey);

		// Transform messages to Anthropic format
		const systemMessage = request.messages.find((m) => m.role === 'system');
		const userMessages = request.messages.filter((m) => m.role !== 'system');

		// Build tool definitions — parameters is already a valid JSON Schema object
		const tools: Anthropic.Tool[] | undefined =
			request.tools && request.tools.length > 0
				? request.tools.map((t) => ({
						type: 'custom' as const,
						name: t.name,
						description: t.description,
						input_schema: t.parameters as Anthropic.Tool.InputSchema,
					}))
				: undefined;

		// Map our ChatMessage format to Anthropic MessageParam
		const anthropicMessages: Anthropic.MessageParam[] = userMessages
			.filter((m) => m.role !== 'system')
			.map((m) => {
				if (m.role === 'tool') {
					return {
						role: 'user' as const,
						content: [
							{
								type: 'tool_result' as const,
								tool_use_id: m.toolCallId ?? '',
								content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
							},
						],
					};
				}

				// Assistant message with tool_calls (multi-turn tool use)
				if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
					const blocks: Anthropic.ContentBlockParam[] = [];
					if (typeof m.content === 'string' && m.content) {
						blocks.push({ type: 'text' as const, text: m.content });
					}
					for (const tc of m.toolCalls) {
						blocks.push({
							type: 'tool_use' as const,
							id: tc.id,
							name: tc.name,
							input: JSON.parse(tc.arguments) as Record<string, unknown>,
						});
					}
					return { role: 'assistant' as const, content: blocks };
				}

				// Handle multimodal ContentPart[] content (images + text)
				if (Array.isArray(m.content) && m.content.length > 0 && typeof m.content[0] === 'object' && 'type' in m.content[0]) {
					const parts = m.content as readonly ContentPart[];
					const hasImages = parts.some((p) => p.type === 'image');
					if (hasImages) {
						const blocks: Anthropic.ContentBlockParam[] = parts.map((p) => {
							if (p.type === 'image') {
								return {
									type: 'image' as const,
									source: {
										type: 'base64' as const,
										media_type: p.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
										data: p.data,
									},
								};
							}
							return { type: 'text' as const, text: p.text };
						});
						return {
							role: m.role as 'user' | 'assistant',
							content: blocks,
						};
					}
				}

				return {
					role: m.role as 'user' | 'assistant',
					content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
				};
			});

		try {
			const systemText =
				systemMessage && typeof systemMessage.content === 'string'
					? systemMessage.content
					: undefined;

			const streamParams = {
				model: request.model,
				max_tokens: request.maxTokens ?? 8192,
				messages: anthropicMessages,
				...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
				...(systemText ? { system: systemText } : {}),
				...(tools ? { tools } : {}),
			};

			const stream = client.messages.stream(streamParams, {
				signal: request.signal ?? undefined,
			});

			// Buffer for accumulating tool use input
			type ToolBuffer = { id: string; name: string; inputJson: string };
			let currentTool: ToolBuffer | null = null;

			for await (const event of stream) {
				if (event.type === 'content_block_start') {
					if (event.content_block.type === 'tool_use') {
						currentTool = {
							id: event.content_block.id,
							name: event.content_block.name,
							inputJson: '',
						};
					}
				} else if (event.type === 'content_block_delta') {
					if (event.delta.type === 'text_delta') {
						yield { type: 'text', text: event.delta.text };
					} else if (event.delta.type === 'input_json_delta' && currentTool) {
						currentTool.inputJson += event.delta.partial_json;
					}
				} else if (event.type === 'content_block_stop' && currentTool) {
					yield {
						type: 'tool_call',
						toolCall: {
							id: currentTool.id,
							name: currentTool.name,
							arguments: currentTool.inputJson || '{}',
						},
					};
					currentTool = null;
				} else if (event.type === 'message_delta' && event.usage) {
					yield {
						type: 'usage',
						usage: {
							inputTokens: 0, // input counted at message_start
							outputTokens: event.usage.output_tokens,
							totalTokens: event.usage.output_tokens,
						},
					};
				} else if (event.type === 'message_start' && event.message.usage) {
					yield {
						type: 'usage',
						usage: {
							inputTokens: event.message.usage.input_tokens,
							outputTokens: event.message.usage.output_tokens,
							totalTokens:
								event.message.usage.input_tokens + event.message.usage.output_tokens,
						},
					};
				} else if (event.type === 'message_stop') {
					yield { type: 'done' };
				}
			}
		} catch (e: unknown) {
			if (e instanceof Error && e.name === 'AbortError') {
				yield { type: 'error', error: 'Request aborted' };
			} else if (e instanceof Anthropic.APIError) {
				if (e.status === 401) {
					yield { type: 'error', error: `Authentication failed: ${e.message}` };
				} else if (e.status === 429) {
					yield { type: 'error', error: `Rate limited: ${e.message}` };
				} else {
					yield { type: 'error', error: `Provider error (${e.status}): ${e.message}` };
				}
			} else {
				yield { type: 'error', error: String(e) };
			}
		}
	}

	async models(): Promise<readonly ModelInfo[]> {
		return [
			{
				id: 'claude-sonnet-4-5',
				name: 'Claude Sonnet 4.5',
				contextWindow: 200_000,
				maxOutputTokens: 8_192,
				supportsTools: true,
				supportsStreaming: true,
				costPerInputToken: 0.000003,
				costPerOutputToken: 0.000015,
			},
			{
				id: 'claude-haiku-3-5',
				name: 'Claude Haiku 3.5',
				contextWindow: 200_000,
				maxOutputTokens: 8_192,
				supportsTools: true,
				supportsStreaming: true,
				costPerInputToken: 0.0000008,
				costPerOutputToken: 0.000004,
			},
			{
				id: 'claude-opus-4-6',
				name: 'Claude Opus 4.6',
				contextWindow: 200_000,
				maxOutputTokens: 32_000,
				supportsTools: true,
				supportsStreaming: true,
				costPerInputToken: 0.000015,
				costPerOutputToken: 0.000075,
			},
		];
	}

	estimateCost(model: string, tokens: number): USDCents {
		const rates: Record<string, number> = {
			'claude-sonnet-4-5': 0.000015,
			'claude-haiku-3-5': 0.000004,
			'claude-opus-4-6': 0.000075,
		};
		const rate = rates[model] ?? 0.000015;
		return Math.round(tokens * rate * 100) as USDCents;
	}
}
