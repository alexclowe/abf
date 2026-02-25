/**
 * Ollama provider — fetch-based streaming via Ollama's OpenAI-compatible API.
 * Local models: free, fully offline, no SDK needed.
 */

import type { ICredentialVault } from '../../credentials/vault.js';
import type { ProviderId, USDCents } from '../../types/common.js';
import type { ChatChunk, ChatRequest, IProvider, ModelInfo } from '../../types/provider.js';

interface OllamaChatChunk {
	model: string;
	message?: { role: string; content: string };
	done: boolean;
	prompt_eval_count?: number;
	eval_count?: number;
	done_reason?: string;
}

interface OllamaTag {
	name: string;
	modified_at: string;
	size: number;
}

interface OllamaTagsResponse {
	models: OllamaTag[];
}

export class OllamaProvider implements IProvider {
	readonly id = 'ollama' as ProviderId;
	readonly name = 'Ollama';
	readonly slug = 'ollama';
	readonly authType = 'local' as const;

	private readonly baseUrl: string;

	constructor(vault?: ICredentialVault) {
		// vault is accepted for API consistency but Ollama uses URL not key
		void vault;
		this.baseUrl =
			process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		// Map our ChatMessage format to Ollama format
		const messages = request.messages.map((m) => ({
			role: m.role === 'tool' ? 'user' : m.role,
			content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
		}));

		// Build tools in OpenAI-compatible format
		const tools =
			request.tools && request.tools.length > 0
				? request.tools.map((t) => ({
						type: 'function',
						function: {
							name: t.name,
							description: t.description,
							parameters: {
								type: 'object',
								properties: t.parameters,
								required: Object.keys(t.parameters).filter(
									(k) =>
										(t.parameters as Record<string, { required?: boolean }>)[k]?.required !== false,
								),
							},
						},
					}))
				: undefined;

		let response: Response;
		try {
			response = await fetch(`${this.baseUrl}/api/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: request.model,
					messages,
					stream: true,
					options: {
						temperature: request.temperature ?? 0.7,
					},
					...(tools ? { tools } : {}),
				}),
			});
		} catch (e) {
			yield {
				type: 'error',
				error: `Ollama connection failed: ${String(e)}. Is Ollama running at ${this.baseUrl}?`,
			};
			return;
		}

		if (!response.ok) {
			yield { type: 'error', error: `Ollama error ${response.status}: ${await response.text()}` };
			return;
		}

		const reader = response.body?.getReader();
		if (!reader) {
			yield { type: 'error', error: 'No response body from Ollama' };
			return;
		}

		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;

					let parsed: OllamaChatChunk;
					try {
						parsed = JSON.parse(trimmed) as OllamaChatChunk;
					} catch {
						continue;
					}

					if (parsed.message?.content) {
						yield { type: 'text', text: parsed.message.content };
					}

					if (parsed.done) {
						const inputTokens = parsed.prompt_eval_count ?? 0;
						const outputTokens = parsed.eval_count ?? 0;
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
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	async models(): Promise<readonly ModelInfo[]> {
		try {
			const response = await fetch(`${this.baseUrl}/api/tags`);
			if (!response.ok) return this.defaultModels();

			const data = (await response.json()) as OllamaTagsResponse;
			return data.models.map((m) => ({
				id: m.name,
				name: m.name,
				contextWindow: 128_000,
				supportsTools: true,
				supportsStreaming: true,
			}));
		} catch {
			return this.defaultModels();
		}
	}

	private defaultModels(): readonly ModelInfo[] {
		return [
			{
				id: 'llama3.1',
				name: 'Llama 3.1',
				contextWindow: 128_000,
				supportsTools: true,
				supportsStreaming: true,
			},
			{
				id: 'mistral',
				name: 'Mistral',
				contextWindow: 32_000,
				supportsTools: true,
				supportsStreaming: true,
			},
		];
	}

	estimateCost(_model: string, _tokens: number): USDCents {
		return 0 as USDCents; // Local = free
	}
}
