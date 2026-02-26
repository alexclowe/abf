/**
 * browse -- headless browser tool for JS-heavy pages, authenticated browsing,
 * and basic page interactions. Uses Playwright (chromium) under the hood.
 *
 * Lazy singleton browser per process; fresh BrowserContext per execute() call
 * for cookie/state isolation.
 */
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import { toISOTimestamp } from '../../util/id.js';
import type { BuiltinToolContext } from './context.js';

// ─── Browser singleton ───────────────────────────────────────────────

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
	if (browser) return browser;

	let chromium: typeof import('playwright-core').chromium;
	try {
		const pw = await import('playwright-core');
		chromium = pw.chromium;
	} catch {
		throw new Error(
			'browse: playwright-core is not installed. Run: pnpm --filter @abf/core add playwright-core',
		);
	}

	try {
		browser = await chromium.launch({ headless: true });
	} catch (e) {
		throw new Error(
			`browse: Chromium not installed. Run: npx playwright install chromium\n(${String(e)})`,
		);
	}

	return browser;
}

/** Close the singleton browser. Call on runtime shutdown. */
export async function closeBrowser(): Promise<void> {
	if (browser) {
		await browser.close();
		browser = null;
	}
}

// ─── Action types ────────────────────────────────────────────────────

type BrowseAction =
	| { type: 'click'; selector: string }
	| { type: 'fill'; selector: string; value: string }
	| { type: 'wait'; selector?: string; text?: string; timeout?: number }
	| { type: 'scroll'; direction?: 'down' | 'up'; amount?: number }
	| { type: 'select'; selector: string; value: string }
	| { type: 'navigate'; url: string };

async function executeAction(page: Page, action: BrowseAction): Promise<void> {
	switch (action.type) {
		case 'click':
			await page.click(action.selector, { timeout: 10_000 });
			break;
		case 'fill':
			await page.fill(action.selector, action.value, { timeout: 10_000 });
			break;
		case 'wait':
			if (action.selector) {
				await page.waitForSelector(action.selector, { timeout: action.timeout ?? 10_000 });
			} else if (action.text) {
				// String expression runs in browser context (no DOM lib needed in Node)
				const escaped = action.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
				await page.waitForFunction(
					`document.body && document.body.innerText && document.body.innerText.includes('${escaped}')`,
					{ timeout: action.timeout ?? 10_000 },
				);
			} else {
				await page.waitForTimeout(action.timeout ?? 1_000);
			}
			break;
		case 'scroll': {
			const delta = (action.amount ?? 500) * (action.direction === 'up' ? -1 : 1);
			await page.evaluate(`window.scrollBy(0, ${String(delta)})`);
			break;
		}
		case 'select':
			await page.selectOption(action.selector, action.value, { timeout: 10_000 });
			break;
		case 'navigate':
			await page.goto(action.url, { waitUntil: 'networkidle', timeout: 30_000 });
			break;
	}
}

// ─── Tool factory ────────────────────────────────────────────────────

export function createBrowseTool(_ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'browse' as ToolId,
		name: 'browse',
		description:
			'Navigate to a URL with a headless browser, render JavaScript, and extract content. ' +
			'Use when web-fetch fails on JS-heavy pages or when you need to interact with a web application. ' +
			'Supports clicking, filling forms, and waiting for elements.',
		source: 'registry',
		parameters: [
			{ name: 'url', type: 'string', description: 'URL to navigate to', required: true },
			{
				name: 'actions',
				type: 'array',
				description:
					'Sequence of browser actions to perform before extraction. ' +
					'Each action: {type:"click"|"fill"|"wait"|"scroll"|"select"|"navigate", selector?, value?, text?, timeout?, direction?, amount?, url?}',
				required: false,
			},
			{
				name: 'extract',
				type: 'string',
				description: 'What to return: "text" (default), "html", or "screenshot"',
				required: false,
			},
			{
				name: 'wait_for',
				type: 'string',
				description: 'CSS selector or text to wait for before extracting',
				required: false,
			},
			{
				name: 'max_length',
				type: 'number',
				description: 'Max characters to return (default 10000, max 100000)',
				required: false,
			},
		],
		estimatedCost: 0 as USDCents,
		timeout: 60_000,
	};

	return {
		definition,
		async execute(args) {
			// ── Validate url ──────────────────────────────────────────
			const urlArg = args['url'];
			if (typeof urlArg !== 'string' || !urlArg.trim()) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'browse: url parameter is required', {}),
				);
			}

			let parsedUrl: URL;
			try {
				parsedUrl = new URL(urlArg);
			} catch {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', `browse: invalid URL: ${urlArg}`, {}),
				);
			}

			if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						'browse: only http/https URLs are supported',
						{},
					),
				);
			}

			// ── Parse options ─────────────────────────────────────────
			const actions = Array.isArray(args['actions']) ? (args['actions'] as BrowseAction[]) : [];
			const extract = typeof args['extract'] === 'string' ? args['extract'] : 'text';
			const waitFor = typeof args['wait_for'] === 'string' ? args['wait_for'] : undefined;
			const maxLength =
				typeof args['max_length'] === 'number'
					? Math.max(1, Math.min(args['max_length'], 100_000))
					: 10_000;

			if (!['text', 'html', 'screenshot'].includes(extract)) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`browse: extract must be "text", "html", or "screenshot" (got "${extract}")`,
						{},
					),
				);
			}

			// ── Launch browser & create isolated context ──────────────
			let b: Browser;
			try {
				b = await getBrowser();
			} catch (e) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', String(e instanceof Error ? e.message : e), {}),
				);
			}

			let context: BrowserContext | null = null;
			try {
				context = await b.newContext({
					userAgent: 'ABF/0.3 (https://github.com/alexclowe/abf)',
				});
				const page = await context.newPage();

				// ── Navigate ──────────────────────────────────────────
				await page.goto(urlArg, { waitUntil: 'networkidle', timeout: 30_000 });

				// ── Execute actions sequentially ──────────────────────
				for (let i = 0; i < actions.length; i++) {
					const action = actions[i]!;
					try {
						await executeAction(page, action);
					} catch (e) {
						return Err(
							new ToolError(
								'TOOL_EXECUTION_FAILED',
								`browse: action[${String(i)}] (${action.type}) failed: ${String(e instanceof Error ? e.message : e)}`,
								{ actionIndex: i, action },
							),
						);
					}
				}

				// ── Wait for selector/text if specified ───────────────
				if (waitFor) {
					try {
						// Try as CSS selector first; if it looks like plain text, wait for text
						if (waitFor.match(/^[a-zA-Z#.[]/)) {
							await page.waitForSelector(waitFor, { timeout: 10_000 });
						} else {
							const escaped = waitFor.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
							await page.waitForFunction(
								`document.body && document.body.innerText && document.body.innerText.includes('${escaped}')`,
								{ timeout: 10_000 },
							);
						}
					} catch {
						// Non-fatal: proceed with extraction anyway
					}
				}

				// ── Extract content ───────────────────────────────────
				const title = await page.title();

				if (extract === 'screenshot') {
					const buf = await page.screenshot({ type: 'png', fullPage: false });
					const base64 = buf.toString('base64');
					return Ok({
						url: page.url(),
						title,
						screenshot: base64,
						extractedAt: toISOTimestamp(),
					});
				}

				let content: string;
				if (extract === 'html') {
					content = await page.content();
				} else {
					// 'text' — clean innerText
					content = await page.innerText('body');
				}

				// Normalize whitespace for text mode
				if (extract === 'text') {
					content = content.replace(/\s+/g, ' ').trim();
				}

				const truncated = content.length > maxLength;
				content = content.slice(0, maxLength);

				return Ok({
					url: page.url(),
					title,
					content,
					extractedAt: toISOTimestamp(),
					truncated,
				});
			} catch (e) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`browse: ${String(e instanceof Error ? e.message : e)}`,
						{},
					),
				);
			} finally {
				if (context) {
					await context.close().catch(() => {});
				}
			}
		},
	};
}
