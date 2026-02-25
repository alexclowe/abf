/**
 * OpenAI provider — real streaming implementation using the openai npm package.
 */

import OpenAI from 'openai';
import type { ICredentialVault } from '../../credentials/vault.js';
import type { ProviderId, USDCents } from '../../types/common.js';
import { ProviderError } from '../../types/errors.js';
import type { ChatChunk, ChatRequest, IProvider, ModelInfo } from '../../types/provider.js';

export class OpenAIProvider implements IProvider {
	readonly id = 'openai' as ProviderId;
	readonly name = 'OpenAI';
	readonly slug = 'openai';
	readonly authType = 'api_key' as const;

	constructor(private readonly vault: ICredentialVault) {}

	private async getApiKey(): Promise<string> {
		const fromVault = await this.vault.get('openai', 'api_key');
		const key = fromVault ?? process.env['OPENAI_API_KEY'];
		if (!key) {
			throw new ProviderError(
				'PROVIDER_AUTH_FAILED',
				'OpenAI API key not found. Run `abf auth openai` or set OPENAI_API_KEY.',
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

		const client = new OpenAI({ apiKey });

		// Build tool definitions
		const tools: OpenAI.Chat.ChatCompletionTool[] | undefined =
			request.tools && request.tools.length > 0
				? request.tools.map((t) => ({
						type: 'function' as const,
						function: {
							name: t.name,
							description: t.description,
							parameters: {
								type: 'object' as const,
								properties: t.parameters as Record<string, unknown>,
								required: Object.keys(t.parameters).filter(
									(k) =>
										(t.parameters as Record<string, { required?: boolean }>)[k]?.required !== false,
								),
							},
						},
					}))
				: undefined;

		// Map our ChatMessage format to OpenAI format
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = request.messages.map((m) => {
			if (m.role === 'tool') {
				return {
					role: 'tool' as const,
					tool_call_id: m.toolCallId ?? '',
					content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
				};
			}
			return {
				role: m.role as 'system' | 'user' | 'assistant',
				content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
			};
		});

		try {
			// Accumulate tool call arguments per index
			const toolCallBuffers = new Map<number, { id: string; name: string; arguments: string }>();

			const streamParams = {
				model: request.model,
				messages: openAiMessages,
				// OpenAI requires null (not undefined) to mean "use default"
				...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
				...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
				...(tools ? { tools } : {}),
			};

			const stream = client.chat.completions.stream(streamParams);

			for await (const chunk of stream) {
				const choice = chunk.choices[0];
				if (!choice) continue;

				const delta = choice.delta;

				if (delta.content) {
					yield { type: 'text', text: delta.content };
				}

				if (delta.tool_calls) {
					for (const tc of delta.tool_calls) {
						if (!toolCallBuffers.has(tc.index)) {
							toolCallBuffers.set(tc.index, {
								id: tc.id ?? '',
								name: tc.function?.name ?? '',
								arguments: '',
							});
						}
						const buf = toolCallBuffers.get(tc.index)!;
						if (tc.id) buf.id = tc.id;
						if (tc.function?.name) buf.name = tc.function.name;
						if (tc.function?.arguments) buf.arguments += tc.function.arguments;
					}
				}
			}

			// Emit completed tool calls
			for (const [, tc] of toolCallBuffers) {
				yield {
					type: 'tool_call',
					toolCall: {
						id: tc.id,
						name: tc.name,
						arguments: tc.arguments || '{}',
					},
				};
			}

			// Emit usage from final completion (includes usage stats unlike finalMessage)
			const finalCompletion = await stream.finalChatCompletion();
			if (finalCompletion.usage) {
				yield {
					type: 'usage',
					usage: {
						inputTokens: finalCompletion.usage.prompt_tokens,
						outputTokens: finalCompletion.usage.completion_tokens,
						totalTokens: finalCompletion.usage.total_tokens,
					},
				};
			}

			yield { type: 'done' };
		} catch (e: unknown) {
			if (e instanceof OpenAI.APIError) {
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
				id: 'gpt-4o',
				name: 'GPT-4o',
				contextWindow: 128_000,
				maxOutputTokens: 16_384,
				supportsTools: true,
				supportsStreaming: true,
				costPerInputToken: 0.0000025,
				costPerOutputToken: 0.00001,
			},
			{
				id: 'gpt-4o-mini',
				name: 'GPT-4o Mini',
				contextWindow: 128_000,
				maxOutputTokens: 16_384,
				supportsTools: true,
				supportsStreaming: true,
				costPerInputToken: 0.00000015,
				costPerOutputToken: 0.0000006,
			},
		];
	}

	estimateCost(model: string, tokens: number): USDCents {
		const rates: Record<string, number> = {
			'gpt-4o': 0.00001,
			'gpt-4o-mini': 0.0000006,
		};
		const rate = rates[model] ?? 0.00001;
		return Math.round(tokens * rate * 100) as USDCents;
	}
}
