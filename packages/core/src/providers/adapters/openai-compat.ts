/**
 * OpenAI-Compatible provider — single parameterized class for any provider
 * that exposes /v1/chat/completions with SSE streaming (Moonshot, DeepSeek,
 * Groq, Together, OpenRouter, and any custom endpoint).
 *
 * Adapted from openrouter.ts — same SSE parsing, tool call accumulation,
 * and error handling, but config-driven instead of hard-coded.
 */

import type { ICredentialVault } from '../../credentials/vault.js';
import type { ProviderId, USDCents } from '../../types/common.js';
import { ProviderError } from '../../types/errors.js';
import type {
	ChatChunk,
	ChatRequest,
	ChatToolDefinition,
	IProvider,
	ModelInfo,
	ProviderAuthType,
} from '../../types/provider.js';

// ─── Config ──────────────────────────────────────────────────────────

export interface OpenAICompatConfig {
	/** Unique provider identifier (e.g. 'moonshot') */
	readonly id: string;
	/** Human-readable name (e.g. 'Moonshot AI') */
	readonly name: string;
	/** Slug for agent YAML `provider:` field and vault lookup */
	readonly slug: string;
	/** Base URL without trailing slash (e.g. 'https://api.moonshot.cn/v1') */
	readonly baseUrl: string;
	/** Authentication type */
	readonly authType: ProviderAuthType;
	/** Environment variable name for API key fallback */
	readonly envVar?: string | undefined;
	/** Default model when none specified */
	readonly defaultModel?: string | undefined;
	/** Static model list — returned from models() if provided, skips API call */
	readonly models?: readonly ModelInfo[] | undefined;
	/** Extra HTTP headers (e.g. HTTP-Referer for OpenRouter) */
	readonly headers?: Readonly<Record<string, string>> | undefined;
}

// ─── Provider ────────────────────────────────────────────────────────

export class OpenAICompatProvider implements IProvider {
	readonly id: ProviderId;
	readonly name: string;
	readonly slug: string;
	readonly authType: ProviderAuthType;

	constructor(
		private readonly config: OpenAICompatConfig,
		private readonly vault: ICredentialVault,
	) {
		this.id = config.id as ProviderId;
		this.name = config.name;
		this.slug = config.slug;
		this.authType = config.authType;
	}

	private async getApiKey(): Promise<string> {
		const fromVault = await this.vault.get(this.slug, 'api_key');
		const fromEnv = this.config.envVar ? process.env[this.config.envVar] : undefined;
		const key = fromVault ?? fromEnv;
		if (!key) {
			throw new ProviderError(
				'PROVIDER_AUTH_FAILED',
				`${this.name} API key not found. Run "abf auth ${this.slug}" or set ${this.config.envVar ?? `${this.slug.toUpperCase()}_API_KEY`}.`,
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

		// Build OpenAI-compatible tool definitions
		const tools:
			| Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>
			| undefined =
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
			// Assistant message with tool_calls (multi-turn tool use)
			if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
				return {
					role: 'assistant' as const,
					content: typeof m.content === 'string' && m.content ? m.content : null,
					tool_calls: m.toolCalls.map((tc) => ({
						id: tc.id,
						type: 'function' as const,
						function: { name: tc.name, arguments: tc.arguments },
					})),
				};
			}
			return {
				role: m.role as 'system' | 'user' | 'assistant',
				content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
			};
		});

		try {
			// Build response_format for structured output (JSON Schema mode)
			const responseFormat = request.responseFormat
				? {
						type: 'json_schema' as const,
						json_schema: {
							name: request.responseFormat.name,
							schema: request.responseFormat.schema,
							strict: request.responseFormat.strict ?? true,
						},
					}
				: undefined;

			const body: Record<string, unknown> = {
				model: request.model,
				messages,
				stream: true,
				...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
				...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
				...(tools ? { tools } : {}),
				...(responseFormat ? { response_format: responseFormat } : {}),
			};

			const resp = await fetch(`${this.config.baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`,
					'X-Title': 'ABF - Agentic Business Framework',
					...(this.config.headers ?? {}),
				},
				body: JSON.stringify(body),
				...(request.signal ? { signal: request.signal } : {}),
			});

			if (!resp.ok) {
				const errText = await resp.text().catch(() => resp.statusText);
				if (resp.status === 401) {
					yield { type: 'error', error: `${this.name} authentication failed: ${errText}` };
				} else if (resp.status === 429) {
					yield { type: 'error', error: `${this.name} rate limited: ${errText}` };
				} else {
					yield { type: 'error', error: `${this.name} error (${resp.status}): ${errText}` };
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
			if (e instanceof DOMException && e.name === 'AbortError') {
				yield { type: 'error', error: `${this.name} request aborted` };
			} else {
				yield { type: 'error', error: `${this.name} error: ${e instanceof Error ? e.message : String(e)}` };
			}
		}
	}

	async models(): Promise<readonly ModelInfo[]> {
		// Return static list if provided in config
		if (this.config.models && this.config.models.length > 0) {
			return this.config.models;
		}

		// Otherwise fetch from /v1/models endpoint
		try {
			const apiKey = await this.getApiKey();
			const resp = await fetch(`${this.config.baseUrl}/models`, {
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					...(this.config.headers ?? {}),
				},
				signal: AbortSignal.timeout(10_000),
			});

			if (!resp.ok) {
				await resp.text().catch(() => '');
				return this.fallbackModels();
			}

			const data = (await resp.json()) as {
				data?: Array<{
					id: string;
					name?: string;
					context_length?: number;
					top_provider?: { max_completion_tokens?: number };
					pricing?: { prompt?: string; completion?: string };
				}>;
			};

			if (!Array.isArray(data.data)) return this.fallbackModels();

			return data.data.slice(0, 50).map((m) => ({
				id: m.id,
				name: m.name ?? m.id,
				contextWindow: m.context_length ?? 128_000,
				maxOutputTokens: m.top_provider?.max_completion_tokens ?? 4096,
				supportsTools: true,
				supportsStreaming: true,
				costPerInputToken: m.pricing?.prompt ? Number(m.pricing.prompt) : undefined,
				costPerOutputToken: m.pricing?.completion ? Number(m.pricing.completion) : undefined,
			}));
		} catch {
			return this.fallbackModels();
		}
	}

	private fallbackModels(): readonly ModelInfo[] {
		if (this.config.defaultModel) {
			return [
				{
					id: this.config.defaultModel,
					name: this.config.defaultModel,
					contextWindow: 128_000,
					supportsTools: true,
					supportsStreaming: true,
				},
			];
		}
		return [];
	}

	estimateCost(model: string, tokens: number): USDCents {
		// Check static model list for pricing
		const modelInfo = this.config.models?.find((m) => m.id === model);
		if (modelInfo?.costPerInputToken) {
			return Math.round(tokens * modelInfo.costPerInputToken * 100) as USDCents;
		}
		// Default conservative estimate
		return Math.round(tokens * 0.000002 * 100) as USDCents;
	}
}
