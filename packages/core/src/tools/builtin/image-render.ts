/**
 * image-render -- render HTML content to PNG or JPEG images.
 * Primary path: satori (JSX-to-SVG) + resvg (SVG-to-PNG).
 * Fallback: playwright-core (headless browser screenshot).
 * Saves output to the project outputs/renders/ directory.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';

const MAX_DIMENSION = 4096;

export function createImageRenderTool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'image-render' as ToolId,
		name: 'image-render',
		description:
			'Render HTML/JSX to PNG or JPEG images. Uses satori for SVG generation and resvg for rasterization. ' +
			'Saves output to the project outputs/ directory.',
		source: 'registry',
		parameters: [
			{
				name: 'html',
				type: 'string',
				description:
					'HTML content to render. Supports a subset (divs, spans, text, images, flex layout).',
				required: true,
			},
			{
				name: 'width',
				type: 'number',
				description: 'Image width in pixels (default 1200, max 4096)',
				required: false,
			},
			{
				name: 'height',
				type: 'number',
				description: 'Image height in pixels (default 630, max 4096)',
				required: false,
			},
			{
				name: 'format',
				type: 'string',
				description: "Output format: 'png' or 'jpeg' (default 'png')",
				required: false,
			},
			{
				name: 'quality',
				type: 'number',
				description: 'JPEG quality 1-100 (default 80, only used for jpeg)',
				required: false,
			},
			{
				name: 'filename',
				type: 'string',
				description: 'Output filename (auto-generated if omitted)',
				required: false,
			},
			{
				name: 'variables',
				type: 'object',
				description: 'Variables for {{placeholder}} substitution in html',
				required: false,
			},
			{
				name: 'return_base64',
				type: 'boolean',
				description: 'If true, return base64 string instead of just file path',
				required: false,
			},
		],
		estimatedCost: 0 as USDCents,
		timeout: 60_000,
	};

	return {
		definition,
		async execute(args) {
			const rawHtml = args['html'];
			if (typeof rawHtml !== 'string' || !rawHtml.trim()) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'image-render: html parameter is required', {}),
				);
			}

			// Parse options with defaults and clamping
			const width = Math.min(
				typeof args['width'] === 'number' ? Math.max(1, args['width']) : 1200,
				MAX_DIMENSION,
			);
			const height = Math.min(
				typeof args['height'] === 'number' ? Math.max(1, args['height']) : 630,
				MAX_DIMENSION,
			);
			const format = args['format'] === 'jpeg' ? 'jpeg' : 'png';
			const quality = typeof args['quality'] === 'number' ? Math.max(1, Math.min(100, args['quality'])) : 80;
			const outputFilename =
				typeof args['filename'] === 'string' && args['filename'].trim()
					? args['filename']
					: `render_${nanoid(8)}.${format}`;
			const returnBase64 = args['return_base64'] === true;

			// Strip <script> tags for security
			let html: string = rawHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

			// Variable substitution
			if (args['variables'] && typeof args['variables'] === 'object') {
				for (const [k, v] of Object.entries(args['variables'] as Record<string, unknown>)) {
					html = html.replaceAll(`{{${k}}}`, String(v));
				}
			}

			// Ensure output directory exists
			const outputDir = join(ctx.projectRoot, 'outputs', 'renders');
			mkdirSync(outputDir, { recursive: true });
			const outputPath = join(outputDir, outputFilename);

			let imageBuffer: Buffer;

			// Primary path: satori + resvg
			try {
				imageBuffer = await renderWithSatori(html, width, height, format, quality);
			} catch {
				// Fallback: playwright-core
				try {
					imageBuffer = await renderWithPlaywright(html, width, height, format, quality);
				} catch (pwError) {
					return Err(
						new ToolError(
							'TOOL_EXECUTION_FAILED',
							'image-render: both satori and playwright failed. ' +
								'Install one of: satori + @resvg/resvg-js, or playwright-core. ' +
								`Last error: ${pwError instanceof Error ? pwError.message : String(pwError)}`,
							{},
						),
					);
				}
			}

			// Write to disk
			writeFileSync(outputPath, imageBuffer);

			const result: Record<string, unknown> = {
				path: outputPath,
				width,
				height,
				format,
				sizeBytes: imageBuffer.length,
			};

			if (returnBase64) {
				result['base64'] = imageBuffer.toString('base64');
			}

			return Ok(result);
		},
	};
}

/**
 * Load a font for satori. Tries common system font paths first,
 * then fetches a fallback font from CDN.
 */
async function loadFont(): Promise<ArrayBuffer> {
	const systemFonts = [
		'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
		'/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
		'/usr/share/fonts/truetype/freefont/FreeSans.ttf',
		'/System/Library/Fonts/Helvetica.ttc',
		'C:\\Windows\\Fonts\\arial.ttf',
	];

	for (const fp of systemFonts) {
		try {
			if (existsSync(fp)) {
				return readFileSync(fp).buffer as ArrayBuffer;
			}
		} catch {
			continue;
		}
	}

	// Fetch fallback font from CDN
	const resp = await fetch(
		'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.0/files/inter-latin-400-normal.woff',
	);
	if (!resp.ok) {
		throw new Error(`Failed to fetch fallback font: ${String(resp.status)}`);
	}
	return resp.arrayBuffer();
}

/**
 * Render using satori (JSX-to-SVG) + resvg (SVG-to-PNG).
 * Optionally converts to JPEG via sharp.
 */
async function renderWithSatori(
	html: string,
	width: number,
	height: number,
	format: string,
	quality: number,
): Promise<Buffer> {
	const satori = (await import('satori')).default;
	const { Resvg } = await import('@resvg/resvg-js');

	const fontData = await loadFont();

	// satori expects React-like element trees; cast to satisfy ReactNode typing
	// without requiring @types/react as a dependency.
	const element = {
		type: 'div',
		props: {
			style: {
				display: 'flex',
				width: '100%',
				height: '100%',
				alignItems: 'center',
				justifyContent: 'center',
				padding: '40px',
				fontFamily: 'Inter',
			},
			children: html,
		},
	};
	const svg = await satori(
		element as unknown as Parameters<typeof satori>[0],
		{
			width,
			height,
			fonts: [{ name: 'Inter', data: fontData, weight: 400, style: 'normal' as const }],
		},
	);

	const resvg = new Resvg(svg, { fitTo: { mode: 'width' as const, value: width } });
	let buffer = Buffer.from(resvg.render().asPng());

	if (format === 'jpeg') {
		const sharpModule = await import('sharp');
		// sharp uses `export = sharp` — access via .default or the module itself
		const sharpFn = ('default' in sharpModule ? sharpModule.default : sharpModule) as unknown as
			(input: Buffer) => { jpeg(opts: { quality: number }): { toBuffer(): Promise<Buffer> } };
		const jpegBuf = await sharpFn(buffer).jpeg({ quality }).toBuffer();
		buffer = Buffer.from(jpegBuf);
	}

	return buffer;
}

/**
 * Fallback renderer using playwright-core headless browser.
 */
async function renderWithPlaywright(
	html: string,
	width: number,
	height: number,
	format: string,
	quality: number,
): Promise<Buffer> {
	const { chromium } = await import('playwright-core');
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport: { width, height } });
		await page.setContent(
			`<!DOCTYPE html><html><body style="margin:0;padding:40px;display:flex;align-items:center;justify-content:center;min-height:100vh">${html}</body></html>`,
		);
		const screenshotOpts: { type: 'png' | 'jpeg'; quality?: number } =
			format === 'jpeg'
				? { type: 'jpeg', quality }
				: { type: 'png' };
		const screenshotBuffer = await page.screenshot(screenshotOpts);
		return Buffer.from(screenshotBuffer);
	} finally {
		await browser.close();
	}
}
