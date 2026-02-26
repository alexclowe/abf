/**
 * knowledge-search -- semantic search over agent memory and knowledge base.
 * Returns the most relevant passages ranked by cosine similarity.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId, USDCents } from '../../types/common.js';
import type { Checksum } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import { computeChecksum } from '../../util/checksum.js';
import type { BuiltinToolContext } from './context.js';
import { getEmbeddingClient, cosineSimilarity } from './embedding-client.js';
import type { EmbeddingClient } from './embedding-client.js';

interface SearchResult {
	content: string;
	source: string;
	similarity: number;
	timestamp?: string | undefined;
}

/** Chunk a text into paragraphs (double newline split, min 50 chars). */
function chunkText(text: string): string[] {
	return text
		.split(/\n\n+/)
		.map(p => p.trim())
		.filter(p => p.length >= 50);
}

interface EmbeddingCache {
	checksum: Checksum;
	chunks: { text: string; embedding: number[] }[];
}

async function loadOrComputeEmbeddings(
	filePath: string,
	content: string,
	client: EmbeddingClient,
): Promise<{ text: string; embedding: number[] }[]> {
	const cachePath = `${filePath}.embeddings.json`;
	const currentChecksum = computeChecksum(content);

	// Check cache
	if (existsSync(cachePath)) {
		try {
			const cached = JSON.parse(await readFile(cachePath, 'utf-8')) as EmbeddingCache;
			if (cached.checksum === currentChecksum) {
				return cached.chunks;
			}
		} catch {
			/* cache invalid, recompute */
		}
	}

	// Compute embeddings for all chunks
	const chunks = chunkText(content);
	const embedded: { text: string; embedding: number[] }[] = [];
	for (const chunk of chunks) {
		const embedding = await client.embed(chunk);
		embedded.push({ text: chunk, embedding });
	}

	// Save cache
	try {
		const cache: EmbeddingCache = { checksum: currentChecksum, chunks: embedded };
		await writeFile(cachePath, JSON.stringify(cache), 'utf-8');
	} catch {
		/* cache write failure is non-fatal */
	}

	return embedded;
}

/** Search all *.md files in a directory and add results to candidates. */
async function searchDirectory(
	dir: string,
	sourcePrefix: string,
	queryEmbedding: number[],
	client: EmbeddingClient,
	candidates: SearchResult[],
): Promise<number> {
	if (!existsSync(dir)) return 0;
	let files: string[] = [];
	try {
		files = (await readdir(dir)).filter(f => f.endsWith('.md'));
	} catch {
		return 0;
	}

	let totalSearched = 0;
	for (const file of files) {
		const filePath = join(dir, file);
		const content = await readFile(filePath, 'utf-8');
		const chunks = await loadOrComputeEmbeddings(filePath, content, client);
		totalSearched += chunks.length;
		for (const { text, embedding } of chunks) {
			candidates.push({
				content: text,
				source: `${sourcePrefix}/${file}`,
				similarity: cosineSimilarity(queryEmbedding, embedding),
			});
		}
	}
	return totalSearched;
}

export function createKnowledgeSearchTool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'knowledge-search' as ToolId,
		name: 'knowledge-search',
		description:
			'Semantic search over agent memory (history, decisions) and the shared knowledge base. ' +
			'Returns the most relevant passages ranked by similarity.',
		source: 'registry',
		parameters: [
			{
				name: 'query',
				type: 'string',
				description: 'Natural language search query',
				required: true,
			},
			{
				name: 'scope',
				type: 'string',
				description: 'Where to search: "all", "decisions", "history:agentName", "knowledge", "outputs", "outputs:agentName"',
				required: false,
			},
			{
				name: 'limit',
				type: 'number',
				description: 'Max results to return (default 5)',
				required: false,
			},
		],
		estimatedCost: 1 as USDCents,
		timeout: 30_000,
	};

	return {
		definition,
		async execute(args) {
			const query = args['query'];
			if (typeof query !== 'string' || !query.trim()) {
				return Err(new ToolError('TOOL_EXECUTION_FAILED', 'knowledge-search: query is required', {}));
			}

			const scope = typeof args['scope'] === 'string' ? args['scope'] : 'all';
			const limit = typeof args['limit'] === 'number' ? Math.min(args['limit'], 20) : 5;

			// Get embedding client (lazy, cached)
			let client: EmbeddingClient;
			try {
				client = await getEmbeddingClient(ctx.vault);
			} catch (e) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`knowledge-search: failed to initialize embedding model. ` +
							`Set OPENAI_API_KEY or start Ollama with nomic-embed-text. Error: ${String(e)}`,
						{},
					),
				);
			}

			// Embed the query
			let queryEmbedding: number[];
			try {
				queryEmbedding = await client.embed(query);
			} catch (e) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`knowledge-search: embedding failed: ${String(e)}`,
						{},
					),
				);
			}

			const memoryDir = join(ctx.projectRoot, 'memory');
			const candidates: SearchResult[] = [];
			let totalSearched = 0;

			// Determine which files to search based on scope
			const searchHistory = scope === 'all' || scope.startsWith('history:');
			const searchDecisions = scope === 'all' || scope === 'decisions';
			const searchKnowledge = scope === 'all' || scope === 'knowledge';
			const searchOutputs = scope === 'all' || scope.startsWith('outputs');

			if (searchDecisions) {
				const decisionsPath = join(memoryDir, 'decisions.md');
				if (existsSync(decisionsPath)) {
					const content = await readFile(decisionsPath, 'utf-8');
					const chunks = await loadOrComputeEmbeddings(decisionsPath, content, client);
					totalSearched += chunks.length;
					for (const { text, embedding } of chunks) {
						candidates.push({
							content: text,
							source: 'decisions',
							similarity: cosineSimilarity(queryEmbedding, embedding),
						});
					}
				}
			}

			if (searchHistory) {
				const agentsDir = join(memoryDir, 'agents');
				if (existsSync(agentsDir)) {
					let agentNames: string[] = [];
					try {
						agentNames = await readdir(agentsDir);
					} catch {
						/* no agents dir */
					}

					// Filter by specific agent if scope is "history:agentName"
					if (scope.startsWith('history:')) {
						const targetAgent = scope.slice('history:'.length);
						agentNames = agentNames.filter(n => n === targetAgent);
					}

					for (const agentName of agentNames) {
						const historyPath = join(agentsDir, agentName, 'history.md');
						if (!existsSync(historyPath)) continue;
						const content = await readFile(historyPath, 'utf-8');
						const chunks = await loadOrComputeEmbeddings(historyPath, content, client);
						totalSearched += chunks.length;
						for (const { text, embedding } of chunks) {
							candidates.push({
								content: text,
								source: `history:${agentName}`,
								similarity: cosineSimilarity(queryEmbedding, embedding),
							});
						}
					}
				}
			}

			if (searchKnowledge) {
				// Search memory/knowledge/ (agent-level)
				totalSearched += await searchDirectory(
					join(memoryDir, 'knowledge'), 'knowledge', queryEmbedding, client, candidates,
				);

				// Search project-level knowledge/ dir
				const projectKnowledgeDir = join(ctx.projectRoot, 'knowledge');
				if (projectKnowledgeDir !== join(memoryDir, 'knowledge')) {
					totalSearched += await searchDirectory(
						projectKnowledgeDir, 'project-knowledge', queryEmbedding, client, candidates,
					);
				}
			}

			if (searchOutputs) {
				const outputsDir = join(ctx.projectRoot, 'outputs');
				if (existsSync(outputsDir)) {
					if (scope.startsWith('outputs:')) {
						// Search specific agent outputs
						const targetAgent = scope.slice('outputs:'.length);
						totalSearched += await searchDirectory(
							join(outputsDir, targetAgent), `outputs:${targetAgent}`, queryEmbedding, client, candidates,
						);
					} else {
						// Search all agent outputs
						let agentDirs: string[] = [];
						try { agentDirs = await readdir(outputsDir); } catch { /* */ }
						for (const agentName of agentDirs) {
							totalSearched += await searchDirectory(
								join(outputsDir, agentName), `outputs:${agentName}`, queryEmbedding, client, candidates,
							);
						}
					}
				}
			}

			// Sort by similarity descending and return top N
			const results = candidates
				.sort((a, b) => b.similarity - a.similarity)
				.slice(0, limit)
				.filter(r => r.similarity > 0.1); // filter noise

			return Ok({
				results,
				query,
				totalSearched,
			});
		},
	};
}
