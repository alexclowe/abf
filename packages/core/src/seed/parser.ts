/**
 * Document parser for the seed-to-company pipeline.
 *
 * Extracts plain text from various document formats:
 * .docx (mammoth), .pdf (pdf-parse), .txt, .md
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

type SupportedFormat = 'docx' | 'pdf' | 'txt' | 'md';

/**
 * Detect format from a filename extension.
 * Returns null for unsupported extensions.
 */
export function detectFormat(filename: string): SupportedFormat | null {
	const ext = extname(filename).toLowerCase().replace('.', '');
	if (ext === 'docx' || ext === 'pdf' || ext === 'txt' || ext === 'md') {
		return ext as SupportedFormat;
	}
	// Handle .markdown as .md
	if (ext === 'markdown') return 'md';
	return null;
}

/**
 * Normalize whitespace: collapse 3+ consecutive newlines into 2,
 * and trim leading/trailing whitespace.
 */
function normalizeWhitespace(text: string): string {
	return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Extract plain text from a seed document.
 * Supports: .docx (mammoth), .pdf (pdf-parse), .txt, .md
 *
 * @param input - File path (string) or file content (Buffer)
 * @param format - Explicit format override; auto-detected from file path if omitted
 */
export async function extractText(
	input: string | Buffer,
	format?: SupportedFormat,
): Promise<string> {
	let buffer: Buffer;
	let resolvedFormat: SupportedFormat | null = format ?? null;

	if (typeof input === 'string') {
		// Check if it looks like a file path (has an extension and doesn't look like plain content)
		const looksLikePath =
			input.length < 1024 &&
			!input.includes('\n') &&
			/\.\w{1,10}$/.test(input);

		if (looksLikePath) {
			if (!resolvedFormat) {
				resolvedFormat = detectFormat(input);
			}
			buffer = await readFile(input);
		} else {
			// Treat as raw text content
			return normalizeWhitespace(input);
		}
	} else {
		buffer = input;
	}

	if (!resolvedFormat) {
		throw new Error(
			'Cannot determine document format. Provide a format parameter ("docx", "pdf", "txt", or "md").',
		);
	}

	switch (resolvedFormat) {
		case 'txt':
		case 'md': {
			const text = buffer.toString('utf-8');
			return normalizeWhitespace(text);
		}

		case 'docx': {
			const mammoth = await import('mammoth');
			const result = await mammoth.extractRawText({ buffer });
			return normalizeWhitespace(result.value);
		}

		case 'pdf': {
			const { PDFParse } = await import('pdf-parse');
			const parser = new PDFParse({ data: buffer });
			const result = await parser.getText();
			await parser.destroy();
			return normalizeWhitespace(result.text);
		}

		default:
			throw new Error(
				`Unsupported document format: "${resolvedFormat}". Supported formats: docx, pdf, txt, md.`,
			);
	}
}
