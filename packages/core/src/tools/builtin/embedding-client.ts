/**
 * EmbeddingClient -- shared embedding model client.
 * OpenAI text-embedding-3-small if OPENAI_API_KEY set, else Ollama nomic-embed-text.
 * Lazy-initialized and cached as a module singleton.
 */
import type { ICredentialVault } from '../../credentials/index.js';
import { createLogger } from '../../util/logger.js';

const logger = createLogger({ level: 'info', format: 'json', name: 'embedding-client' });

export interface EmbeddingClient {
	embed(text: string): Promise<number[]>;
	readonly dims: number;
}

let cachedClient: EmbeddingClient | null = null;

export async function getEmbeddingClient(vault?: ICredentialVault): Promise<EmbeddingClient> {
	if (cachedClient) return cachedClient;

	// Try OpenAI first
	let openaiKey = process.env['OPENAI_API_KEY'];
	if (!openaiKey && vault) {
		openaiKey = await vault.get('openai', 'api_key');
	}

	if (openaiKey) {
		const key = openaiKey; // capture for closure
		cachedClient = {
			dims: 1536,
			async embed(text: string): Promise<number[]> {
				const response = await fetch('https://api.openai.com/v1/embeddings', {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${key}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ input: text, model: 'text-embedding-3-small' }),
				});
				if (!response.ok) throw new Error(`OpenAI embeddings error: ${String(response.status)}`);
				const data = (await response.json()) as { data: { embedding: number[] }[] };
				return data.data[0]?.embedding ?? [];
			},
		};
		logger.info({}, 'Using OpenAI text-embedding-3-small for knowledge search');
		return cachedClient;
	}

	// Fall back to Ollama
	const ollamaUrl = process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434';
	cachedClient = {
		dims: 768,
		async embed(text: string): Promise<number[]> {
			const response = await fetch(`${ollamaUrl}/api/embeddings`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
			});
			if (!response.ok) throw new Error(`Ollama embeddings error: ${String(response.status)}`);
			const data = (await response.json()) as { embedding: number[] };
			return data.embedding;
		},
	};
	logger.info({ url: ollamaUrl }, 'Using Ollama nomic-embed-text for knowledge search');
	return cachedClient;
}

/** Reset the cached client (for testing). */
export function resetEmbeddingClient(): void {
	cachedClient = null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += (a[i] ?? 0) * (b[i] ?? 0);
		normA += (a[i] ?? 0) ** 2;
		normB += (b[i] ?? 0) ** 2;
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}
