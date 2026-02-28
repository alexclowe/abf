/**
 * OpenRouter provider — OpenAI-compatible API with OAuth PKCE support.
 * Users sign up at OpenRouter and get an API key via OAuth flow.
 * Supports all major models (Claude, GPT, Gemini, Llama, etc.) through one API.
 */

import type { ICredentialVault } from '../../credentials/vault.js';
import type { ProviderId, USDCents } from '../../types/common.js';
import { ProviderError } from '../../types/errors.js';
import type { ChatChunk, ChatRequest, ChatToolDefinition, IProvider, ModelInfo } from '../../types/provider.js';

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

export class OpenRouterProvider implements IProvider {
	readonly id = 'openrouter' as ProviderId;
	readonly name = 'OpenRouter';
	readonly slug = 'openrouter';
	readonly authType = 'oauth' as const;

	constructor(private readonly vault: ICredentialVault) {}

	private async getApiKey(): Promise<string> {
		const fromVault = await this.vault.get('openrouter', 'api_key');
		const key = fromVault ?? process.env['OPENROUTER_API_KEY'];
		if (!key) {
			throw new ProviderError(
				'PROVIDER_AUTH_FAILED',
				'OpenRouter API key not found. Connect via the dashboard or set OPENROUTER_API_KEY.',
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

		// Build OpenAI-compatible tool definitions — parameters is already a valid JSON Schema
		const tools: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> | undefined =
			request.tools && request.tools.length > 0
				? request.tools.map((t: ChatToolDefinition) => ({
						type: 'function' as const,
						function: {
							name: t.name,
							description: t.description,
							parameters: t.parameters,
						},
					}))
				: undefined;

		// Map messages to OpenAI format
		const messages = request.messages.map((m) => {
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
			const body: Record<string, unknown> = {
				model: request.model,
				messages,
				stream: true,
				...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
				...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
				...(tools ? { tools } : {}),
			};

			const resp = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`,
					'HTTP-Referer': 'https://github.com/alexclowe/abf',
					'X-Title': 'ABF - Agentic Business Framework',
				},
				body: JSON.stringify(body),
			});

			if (!resp.ok) {
				const errText = await resp.text().catch(() => resp.statusText);
				if (resp.status === 401) {
					yield { type: 'error', error: `Authentication failed: ${errText}` };
				} else if (resp.status === 429) {
					yield { type: 'error', error: `Rate limited: ${errText}` };
				} else {
					yield { type: 'error', error: `OpenRouter error (${resp.status}): ${errText}` };
				}
				return;
			}

			const reader = resp.body?.getReader();
			if (!reader) {
				yield { type: 'error', error: 'No response body' };
				return;
			}

			// Accumulate tool call arguments per index
			const toolCallBuffers = new Map<number, { id: string; name: string; arguments: string }>();
			let inputTokens = 0;
			let outputTokens = 0;

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith('data:')) continue;
					const data = trimmed.slice(5).trim();
					if (data === '[DONE]') continue;

					try {
						const chunk = JSON.parse(data) as {
							choices?: Array<{
								delta?: {
									content?: string;
									tool_calls?: Array<{
										index: number;
										id?: string;
										function?: { name?: string; arguments?: string };
									}>;
								};
							}>;
							usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
						};

						const choice = chunk.choices?.[0];
						if (choice?.delta?.content) {
							yield { type: 'text', text: choice.delta.content };
						}

						if (choice?.delta?.tool_calls) {
							for (const tc of choice.delta.tool_calls) {
								if (!toolCallBuffers.has(tc.index)) {
									toolCallBuffers.set(tc.index, { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' });
								}
								const buf = toolCallBuffers.get(tc.index)!;
								if (tc.id) buf.id = tc.id;
								if (tc.function?.name) buf.name = tc.function.name;
								if (tc.function?.arguments) buf.arguments += tc.function.arguments;
							}
						}

						if (chunk.usage) {
							inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
							outputTokens = chunk.usage.completion_tokens ?? outputTokens;
						}
					} catch {
						// Skip malformed JSON chunks
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

			// Emit usage
			if (inputTokens > 0 || outputTokens > 0) {
				yield {
					type: 'usage',
					usage: {
						inputTokens,
						outputTokens,
						totalTokens: inputTokens + outputTokens,
					},
				};
			}

			yield { type: 'done' };
		} catch (e) {
			yield { type: 'error', error: `OpenRouter error: ${e instanceof Error ? e.message : String(e)}` };
		}
	}

	async models(): Promise<readonly ModelInfo[]> {
		try {
			const apiKey = await this.getApiKey();
			const resp = await fetch(`${OPENROUTER_API_BASE}/models`, {
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'HTTP-Referer': 'https://github.com/alexclowe/abf',
				},
				signal: AbortSignal.timeout(10_000),
			});

			if (!resp.ok) {
				await resp.text().catch(() => '');
				return this.defaultModels();
			}

			const data = (await resp.json()) as {
				data?: Array<{
					id: string;
					name: string;
					context_length?: number;
					top_provider?: { max_completion_tokens?: number };
					pricing?: { prompt?: string; completion?: string };
				}>;
			};

			if (!Array.isArray(data.data)) return this.defaultModels();

			return data.data.slice(0, 50).map((m) => ({
				id: m.id,
				name: m.name,
				contextWindow: m.context_length ?? 128_000,
				maxOutputTokens: m.top_provider?.max_completion_tokens ?? 4096,
				supportsTools: true,
				supportsStreaming: true,
				costPerInputToken: m.pricing?.prompt ? Number(m.pricing.prompt) : 0.000001,
				costPerOutputToken: m.pricing?.completion ? Number(m.pricing.completion) : 0.000002,
			}));
		} catch {
			return this.defaultModels();
		}
	}

	private defaultModels(): readonly ModelInfo[] {
		return [
			{ id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextWindow: 200_000, supportsTools: true, supportsStreaming: true, costPerInputToken: 0.000003, costPerOutputToken: 0.000015 },
			{ id: 'openai/gpt-4o', name: 'GPT-4o', contextWindow: 128_000, supportsTools: true, supportsStreaming: true, costPerInputToken: 0.0000025, costPerOutputToken: 0.00001 },
			{ id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', contextWindow: 1_000_000, supportsTools: true, supportsStreaming: true, costPerInputToken: 0.0000001, costPerOutputToken: 0.0000004 },
			{ id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', contextWindow: 131_072, supportsTools: true, supportsStreaming: true, costPerInputToken: 0.0000003, costPerOutputToken: 0.0000004 },
		];
	}

	estimateCost(model: string, tokens: number): USDCents {
		// Default conservative estimate — OpenRouter has pass-through pricing
		const rate = model.includes('claude') ? 0.000015 : model.includes('gpt-4o') ? 0.00001 : 0.000002;
		return Math.round(tokens * rate * 100) as USDCents;
	}
}
