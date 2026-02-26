/**
 * CloudProxyProvider — routes LLM requests through ABF Cloud.
 *
 * When cloud config is present in abf.config.yaml, this provider proxies
 * all LLM requests through ABF Cloud's gateway. The user pays ABF; ABF
 * manages the underlying provider API keys. No per-provider keys needed.
 *
 * Config:
 *   cloud:
 *     token: abf_...
 *     endpoint: https://api.abf.cloud/v1  # optional, has default
 */

import type { ICredentialVault } from '../../credentials/vault.js';
import type { ProviderId, USDCents } from '../../types/common.js';
import type {
	ChatChunk,
	ChatRequest,
	IProvider,
	ModelInfo,
} from '../../types/provider.js';
import type { CloudConfig } from '../../types/config.js';

const DEFAULT_ENDPOINT = 'https://api.abf.cloud/v1';
const MAX_BUFFER_SIZE = 1024 * 1024; // 1 MB

/**
 * Validate that a cloud endpoint URL is safe to use.
 * - Must be HTTPS (HTTP allowed only for localhost/127.0.0.1)
 * - Must not target RFC 1918, link-local, or loopback addresses (unless localhost dev)
 */
function validateEndpoint(raw: string): string {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error(`Invalid cloud endpoint URL: ${raw}`);
	}

	const hostname = parsed.hostname.toLowerCase();
	const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

	// Require HTTPS for non-localhost endpoints
	if (parsed.protocol !== 'https:' && !isLocalhost) {
		throw new Error(
			`Cloud endpoint must use HTTPS (got ${parsed.protocol}). ` +
			'HTTP is only allowed for localhost/127.0.0.1.',
		);
	}

	// Block RFC 1918 private addresses
	if (/^10\./.test(hostname) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
		/^192\.168\./.test(hostname)) {
		throw new Error(
			`Cloud endpoint must not target private RFC 1918 addresses: ${hostname}`,
		);
	}

	// Block link-local (169.254.x.x — includes AWS metadata 169.254.169.254)
	if (/^169\.254\./.test(hostname)) {
		throw new Error(
			`Cloud endpoint must not target link-local addresses: ${hostname}`,
		);
	}

	// Block IPv6 link-local (fe80::)
	if (hostname.startsWith('fe80')) {
		throw new Error(
			`Cloud endpoint must not target IPv6 link-local addresses: ${hostname}`,
		);
	}

	return parsed.toString().replace(/\/$/, ''); // normalize, strip trailing slash
}

export class CloudProxyProvider implements IProvider {
	readonly id = 'abf-cloud' as ProviderId;
	readonly name = 'ABF Cloud';
	readonly slug = 'abf-cloud';
	readonly authType = 'api_key' as const;

	private readonly endpoint: string;
	private readonly token: string;

	constructor(
		config: CloudConfig,
		_vault?: ICredentialVault,
	) {
		void _vault;
		this.token = config.token;
		this.endpoint = validateEndpoint(config.endpoint ?? DEFAULT_ENDPOINT);
	}

	async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
		let response: Response;
		try {
			response = await fetch(`${this.endpoint}/chat`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(request),
				signal: AbortSignal.timeout(120_000),
			});
		} catch (e) {
			yield { type: 'error', error: `ABF Cloud unreachable: ${(e as Error).message}` };
			return;
		}

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			yield { type: 'error', error: `ABF Cloud error ${response.status}: ${text}` };
			return;
		}

		// Parse NDJSON stream (same format as Ollama/OpenAI streaming)
		const reader = response.body?.getReader();
		if (!reader) {
			yield { type: 'error', error: 'No response body from ABF Cloud' };
			return;
		}

		const decoder = new TextDecoder();
		let buffer = '';
		let hasContent = false;
		let doneEmitted = false;

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Guard against unbounded buffer accumulation
				if (buffer.length > MAX_BUFFER_SIZE) {
					yield { type: 'error', error: 'ABF Cloud response buffer exceeded 1 MB limit' };
					break;
				}

				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed.startsWith(':')) continue; // SSE comment

					// Handle SSE format (data: ...) or plain NDJSON
					const jsonStr = trimmed.startsWith('data: ')
						? trimmed.slice(6)
						: trimmed;

					if (jsonStr === '[DONE]') continue;

					try {
						const chunk = JSON.parse(jsonStr) as {
							content?: string;
							done?: boolean;
							usage?: { prompt_tokens?: number; completion_tokens?: number };
						};

						if (chunk.content) {
							hasContent = true;
							yield { type: 'text', text: chunk.content };
						}

						if (chunk.done || chunk.usage) {
							doneEmitted = true;
							yield {
								type: 'done',
								...(chunk.usage != null && {
									usage: {
										inputTokens: chunk.usage.prompt_tokens ?? 0,
										outputTokens: chunk.usage.completion_tokens ?? 0,
										totalTokens: (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0),
									},
								}),
							};
						}
					} catch {
						// Skip malformed JSON lines
					}
				}
			}
		} finally {
			reader.releaseLock();
		}

		// Ensure we always emit done (but only if we haven't already)
		if (hasContent && !doneEmitted) {
			yield { type: 'done' };
		}
	}

	async models(): Promise<readonly ModelInfo[]> {
		try {
			const resp = await fetch(`${this.endpoint}/models`, {
				headers: { 'Authorization': `Bearer ${this.token}` },
				signal: AbortSignal.timeout(5_000),
			});
			if (!resp.ok) return [];
			const data = (await resp.json()) as { models?: ModelInfo[] };
			return data.models ?? [];
		} catch {
			return [];
		}
	}

	estimateCost(_model: string, _tokens: number): USDCents {
		// ABF Cloud handles billing server-side
		return 0 as USDCents;
	}
}
