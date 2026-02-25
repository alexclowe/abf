/**
 * web-fetch -- fetch a URL and extract readable text content.
 * Uses @mozilla/readability + linkedom for clean text extraction.
 */
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import { toISOTimestamp } from '../../util/id.js';
import type { BuiltinToolContext } from './context.js';

// Minimal DOM-like interfaces for linkedom output (no DOM lib in tsconfig)
interface DOMElement {
	getAttribute(name: string): string | null;
	textContent: string | null;
}

interface DOMDocument {
	title: string;
	body: { textContent: string | null } | null;
	querySelectorAll(selector: string): Iterable<DOMElement>;
}

export function createWebFetchTool(_ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'web-fetch' as ToolId,
		name: 'web-fetch',
		description:
			'Fetch a URL and extract its main text content. Returns cleaned, readable text ' +
			'(not raw HTML). Use for reading articles, documentation, or any web page.',
		source: 'registry',
		parameters: [
			{ name: 'url', type: 'string', description: 'URL to fetch', required: true },
			{
				name: 'max_length',
				type: 'number',
				description: 'Max characters to return (default 5000)',
				required: false,
			},
			{
				name: 'extract_links',
				type: 'boolean',
				description: 'Include links found on the page (default false)',
				required: false,
			},
		],
		estimatedCost: 0 as USDCents,
		timeout: 15_000,
	};

	return {
		definition,
		async execute(args) {
			const urlArg = args['url'];
			if (typeof urlArg !== 'string' || !urlArg.trim()) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'web-fetch: url parameter is required', {}),
				);
			}

			// Validate URL
			let parsedUrl: URL;
			try {
				parsedUrl = new URL(urlArg);
			} catch {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', `web-fetch: invalid URL: ${urlArg}`, {}),
				);
			}

			if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						'web-fetch: only http/https URLs are supported',
						{},
					),
				);
			}

			const maxLength =
				typeof args['max_length'] === 'number' ? Math.min(args['max_length'], 50_000) : 5_000;
			const extractLinks = args['extract_links'] === true;

			const response = await fetch(urlArg, {
				headers: {
					'User-Agent': 'ABF/0.3 (https://github.com/alexclowe/abf)',
					'Accept': 'text/html,application/xhtml+xml,*/*',
				},
				redirect: 'follow',
			});

			if (!response.ok) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`web-fetch: HTTP ${String(response.status)} for ${urlArg}`,
						{ status: response.status },
					),
				);
			}

			const html = await response.text();

			// Parse with linkedom + extract with Readability
			let title = '';
			let content = '';
			let byline: string | undefined;
			const links: Array<{ text: string; href: string }> = [];

			try {
				const { parseHTML } = await import('linkedom');
				const { Readability } = await import('@mozilla/readability');

				const parsed = parseHTML(html);
				const doc = parsed.document as unknown as DOMDocument;
				title = doc.title ?? '';

				if (extractLinks) {
					const anchors = doc.querySelectorAll('a[href]');
					for (const anchor of anchors) {
						const href = anchor.getAttribute('href');
						const text = (anchor.textContent ?? '').trim();
						if (href && text && href.startsWith('http')) {
							links.push({ text, href });
						}
					}
				}

				// Readability expects a DOM Document; linkedom provides a compatible one
				const reader = new Readability(parsed.document);
				const article = reader.parse();
				if (article) {
					title = article.title ?? title;
					content = article.textContent ?? '';
					byline = article.byline ?? undefined;
				} else {
					// Readability failed -- strip HTML tags as fallback
					content = (doc.body?.textContent ?? html).replace(/<[^>]+>/g, ' ');
				}
			} catch {
				// Total failure -- return raw text stripped of tags
				content = html
					.replace(/<[^>]+>/g, ' ')
					.replace(/\s+/g, ' ')
					.trim();
			}

			// Normalize whitespace
			content = content.replace(/\s+/g, ' ').trim();
			const truncated = content.length > maxLength;
			content = content.slice(0, maxLength);

			return Ok({
				url: response.url, // may differ from input if redirected
				title: title.trim(),
				content,
				...(byline ? { byline } : {}),
				fetchedAt: toISOTimestamp(),
				...(extractLinks ? { links: links.slice(0, 50) } : {}), // cap at 50 links
				truncated,
			});
		},
	};
}
