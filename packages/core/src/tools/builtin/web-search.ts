/**
 * web-search -- real web search via Brave Search API.
 * Falls back to helpful error if BRAVE_SEARCH_API_KEY not configured.
 */
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';

// Simple token bucket rate limiter: max 1 request/second
let lastRequestTime = 0;

async function waitForRateLimit(): Promise<void> {
	const now = Date.now();
	const elapsed = now - lastRequestTime;
	if (elapsed < 1000) {
		await new Promise<void>(resolve => setTimeout(resolve, 1000 - elapsed));
	}
	lastRequestTime = Date.now();
}

interface BraveSearchResult {
	title: string;
	url: string;
	description?: string;
	page_age?: string;
}

interface BraveSearchResponse {
	web?: {
		results: BraveSearchResult[];
		total_count?: number;
	};
}

export function createWebSearchTool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'web-search' as ToolId,
		name: 'web-search',
		description:
			'Search the web and return structured results with titles, URLs, and snippets. ' +
			'Requires BRAVE_SEARCH_API_KEY environment variable.',
		source: 'registry',
		parameters: [
			{ name: 'query', type: 'string', description: 'Search query', required: true },
			{
				name: 'count',
				type: 'number',
				description: 'Number of results to return (default 10, max 20)',
				required: false,
			},
			{
				name: 'freshness',
				type: 'string',
				description: 'Recency filter: "day", "week", "month", or omit for all time',
				required: false,
			},
		],
		estimatedCost: 1 as USDCents, // ~$0.01 per call
		timeout: 10_000,
	};

	return {
		definition,
		async execute(args) {
			const query = args['query'];
			if (typeof query !== 'string' || !query.trim()) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'web-search: query parameter is required', {}),
				);
			}

			// Get API key: env var first, then vault
			let apiKey = process.env['BRAVE_SEARCH_API_KEY'];
			if (!apiKey) {
				const vaultKey = await ctx.vault.get('brave-search', 'api_key');
				if (vaultKey) apiKey = vaultKey;
			}

			if (!apiKey) {
				return Ok({
					results: [],
					totalEstimated: 0,
					query,
					error:
						'web-search requires BRAVE_SEARCH_API_KEY. ' +
						'Set it via: export BRAVE_SEARCH_API_KEY=your-key ' +
						'or run: abf auth brave-search',
				});
			}

			const count = Math.min(typeof args['count'] === 'number' ? args['count'] : 10, 20);
			const freshness = typeof args['freshness'] === 'string' ? args['freshness'] : undefined;

			// Map freshness to Brave API params
			const freshnessMap: Record<string, string> = { day: 'pd', week: 'pw', month: 'pm' };
			const freshnessParam = freshness ? freshnessMap[freshness] : undefined;

			await waitForRateLimit();

			const url = new URL('https://api.search.brave.com/res/v1/web/search');
			url.searchParams.set('q', query);
			url.searchParams.set('count', String(count));
			if (freshnessParam) url.searchParams.set('freshness', freshnessParam);

			const response = await fetch(url.toString(), {
				headers: {
					'Accept': 'application/json',
					'Accept-Encoding': 'gzip',
					'X-Subscription-Token': apiKey,
				},
			});

			if (!response.ok) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`Brave Search API error: ${String(response.status)} ${response.statusText}`,
						{ status: response.status },
					),
				);
			}

			const data = (await response.json()) as BraveSearchResponse;
			const webResults = data.web?.results ?? [];

			return Ok({
				results: webResults.map(r => ({
					title: r.title,
					url: r.url,
					snippet: r.description ?? '',
					...(r.page_age ? { published: r.page_age } : {}),
				})),
				totalEstimated: data.web?.total_count ?? webResults.length,
				query,
			});
		},
	};
}
