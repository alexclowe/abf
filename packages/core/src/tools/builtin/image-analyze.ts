/**
 * image-analyze -- fetch an image and analyze it with a vision-capable LLM.
 * Supports Anthropic (Claude) and OpenAI (GPT-4o) vision APIs.
 */
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';

/** Map content-type to Anthropic media_type string. */
function toMediaType(ct: string): string {
	if (ct.includes('png')) return 'image/png';
	if (ct.includes('gif')) return 'image/gif';
	if (ct.includes('webp')) return 'image/webp';
	return 'image/jpeg';
}

export function createImageAnalyzeTool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'image-analyze' as ToolId,
		name: 'image-analyze',
		description:
			'Fetch an image from a URL and analyze it using a vision-capable LLM. ' +
			'Returns a textual description or analysis based on the provided prompt.',
		source: 'registry',
		parameters: [
			{ name: 'url', type: 'string', description: 'URL of the image to analyze', required: true },
			{
				name: 'prompt',
				type: 'string',
				description: 'What to analyze about the image',
				required: true,
			},
		],
		estimatedCost: 5 as USDCents,
		timeout: 60_000,
	};

	return {
		definition,
		async execute(args) {
			const url = args['url'];
			const prompt = args['prompt'];
			if (typeof url !== 'string' || !url.trim()) {
				return Err(new ToolError('TOOL_EXECUTION_FAILED', 'image-analyze: url is required', {}));
			}
			if (typeof prompt !== 'string' || !prompt.trim()) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'image-analyze: prompt is required', {}),
				);
			}

			// Fetch the image
			let imageB64: string;
			let mediaType: string;
			try {
				const resp = await fetch(url);
				if (!resp.ok) {
					return Err(
						new ToolError(
							'TOOL_EXECUTION_FAILED',
							`image-analyze: failed to fetch image: ${String(resp.status)} ${resp.statusText}`,
							{},
						),
					);
				}
				const contentType = resp.headers.get('content-type') ?? 'image/jpeg';
				mediaType = toMediaType(contentType);
				const buf = Buffer.from(await resp.arrayBuffer());
				imageB64 = buf.toString('base64');
			} catch (e) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`image-analyze: failed to fetch image: ${e instanceof Error ? e.message : String(e)}`,
						{},
					),
				);
			}

			// Try Anthropic first, then OpenAI
			let anthropicKey = process.env['ANTHROPIC_API_KEY'];
			if (!anthropicKey) {
				const vk = await ctx.vault.get('anthropic', 'api_key');
				if (vk) anthropicKey = vk;
			}

			if (anthropicKey) {
				return callAnthropic(anthropicKey, imageB64, mediaType, prompt);
			}

			let openaiKey = process.env['OPENAI_API_KEY'];
			if (!openaiKey) {
				const vk = await ctx.vault.get('openai', 'api_key');
				if (vk) openaiKey = vk;
			}

			if (openaiKey) {
				return callOpenAI(openaiKey, imageB64, mediaType, prompt);
			}

			return Err(
				new ToolError(
					'TOOL_EXECUTION_FAILED',
					'image-analyze: no vision API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.',
					{},
				),
			);
		},
	};
}

async function callAnthropic(apiKey: string, imageB64: string, mediaType: string, prompt: string) {
	try {
		const resp = await fetch('https://api.anthropic.com/v1/messages', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': apiKey,
				'anthropic-version': '2023-06-01',
			},
			body: JSON.stringify({
				model: 'claude-sonnet-4-5-20250514',
				max_tokens: 1024,
				messages: [
					{
						role: 'user',
						content: [
							{
								type: 'image',
								source: { type: 'base64', media_type: mediaType, data: imageB64 },
							},
							{ type: 'text', text: prompt },
						],
					},
				],
			}),
		});

		if (!resp.ok) {
			const body = await resp.text();
			return Err(
				new ToolError(
					'TOOL_EXECUTION_FAILED',
					`image-analyze: Anthropic API error ${String(resp.status)}: ${body}`,
					{},
				),
			);
		}

		const data = (await resp.json()) as { content?: Array<{ text?: string }> };
		const text = data.content?.[0]?.text ?? '';
		return Ok({ analysis: text, provider: 'anthropic' });
	} catch (e) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`image-analyze: Anthropic call failed: ${e instanceof Error ? e.message : String(e)}`,
				{},
			),
		);
	}
}

async function callOpenAI(apiKey: string, imageB64: string, mediaType: string, prompt: string) {
	try {
		const resp = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: 'gpt-4o',
				max_tokens: 1024,
				messages: [
					{
						role: 'user',
						content: [
							{
								type: 'image_url',
								image_url: { url: `data:${mediaType};base64,${imageB64}` },
							},
							{ type: 'text', text: prompt },
						],
					},
				],
			}),
		});

		if (!resp.ok) {
			const body = await resp.text();
			return Err(
				new ToolError(
					'TOOL_EXECUTION_FAILED',
					`image-analyze: OpenAI API error ${String(resp.status)}: ${body}`,
					{},
				),
			);
		}

		const data = (await resp.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const text = data.choices?.[0]?.message?.content ?? '';
		return Ok({ analysis: text, provider: 'openai' });
	} catch (e) {
		return Err(
			new ToolError(
				'TOOL_EXECUTION_FAILED',
				`image-analyze: OpenAI call failed: ${e instanceof Error ? e.message : String(e)}`,
				{},
			),
		);
	}
}
