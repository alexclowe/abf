import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock external document parsers ────────────────────────────────────

vi.mock('mammoth', () => ({
	extractRawText: vi.fn().mockResolvedValue({ value: '  Extracted DOCX text\n\n\n\nwith gaps  ' }),
}));

vi.mock('pdf-parse', () => ({
	PDFParse: vi.fn().mockImplementation(() => ({
		getText: vi.fn().mockResolvedValue({ text: '  Extracted PDF text\n\n\n\nwith gaps  ' }),
		destroy: vi.fn().mockResolvedValue(undefined),
	})),
}));

import { detectFormat, extractText } from './parser.js';

// ─── detectFormat ───────────────────────────────────────────────────────

describe('detectFormat', () => {
	it('detects .docx extension', () => {
		expect(detectFormat('plan.docx')).toBe('docx');
	});

	it('detects .pdf extension', () => {
		expect(detectFormat('business.pdf')).toBe('pdf');
	});

	it('detects .txt extension', () => {
		expect(detectFormat('notes.txt')).toBe('txt');
	});

	it('detects .md extension', () => {
		expect(detectFormat('readme.md')).toBe('md');
	});

	it('maps .markdown to md', () => {
		expect(detectFormat('plan.markdown')).toBe('md');
	});

	it('handles uppercase extensions', () => {
		expect(detectFormat('plan.DOCX')).toBe('docx');
		expect(detectFormat('plan.PDF')).toBe('pdf');
	});

	it('returns null for unsupported extensions', () => {
		expect(detectFormat('image.jpg')).toBeNull();
		expect(detectFormat('data.csv')).toBeNull();
		expect(detectFormat('code.ts')).toBeNull();
	});

	it('returns null for files without extension', () => {
		expect(detectFormat('Makefile')).toBeNull();
	});

	it('handles paths with directories', () => {
		expect(detectFormat('/path/to/plan.docx')).toBe('docx');
		expect(detectFormat('docs/seed.md')).toBe('md');
	});
});

// ─── extractText ────────────────────────────────────────────────────────

describe('extractText', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'abf-parser-test-'));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	// ── Raw text input ────────────────────────────────────────────────

	it('returns raw text directly when input contains newlines', async () => {
		const input = 'Line one\nLine two\nLine three';
		const result = await extractText(input);
		expect(result).toBe('Line one\nLine two\nLine three');
	});

	it('returns raw text for long strings', async () => {
		const input = 'A'.repeat(2000);
		const result = await extractText(input);
		expect(result).toBe(input);
	});

	it('normalizes whitespace in raw text (collapses 3+ newlines to 2)', async () => {
		const input = 'Section 1\n\n\n\n\nSection 2\n\n\n\nSection 3';
		const result = await extractText(input);
		expect(result).toBe('Section 1\n\nSection 2\n\nSection 3');
	});

	it('trims leading and trailing whitespace in raw text', async () => {
		const input = '  \n\n  Hello World  \n\n  ';
		const result = await extractText(input);
		expect(result).toBe('Hello World');
	});

	// ── File path detection heuristic ─────────────────────────────────

	it('detects short strings with extensions as file paths', async () => {
		const filePath = join(tempDir, 'test.txt');
		await writeFile(filePath, 'File content here');

		const result = await extractText(filePath);
		expect(result).toBe('File content here');
	});

	it('reads .txt files from filesystem', async () => {
		const filePath = join(tempDir, 'notes.txt');
		await writeFile(filePath, 'Plain text content');

		const result = await extractText(filePath);
		expect(result).toBe('Plain text content');
	});

	it('reads .md files from filesystem', async () => {
		const filePath = join(tempDir, 'plan.md');
		await writeFile(filePath, '# My Plan\n\nContent here.');

		const result = await extractText(filePath);
		expect(result).toBe('# My Plan\n\nContent here.');
	});

	it('normalizes whitespace when reading text files', async () => {
		const filePath = join(tempDir, 'messy.txt');
		await writeFile(filePath, '  Start\n\n\n\n\nMiddle\n\n\nEnd  ');

		const result = await extractText(filePath);
		expect(result).toBe('Start\n\nMiddle\n\nEnd');
	});

	// ── Buffer input ──────────────────────────────────────────────────

	it('reads txt format from Buffer with explicit format', async () => {
		const buffer = Buffer.from('Buffer text content');
		const result = await extractText(buffer, 'txt');
		expect(result).toBe('Buffer text content');
	});

	it('reads md format from Buffer with explicit format', async () => {
		const buffer = Buffer.from('# Heading\n\nBody text');
		const result = await extractText(buffer, 'md');
		expect(result).toBe('# Heading\n\nBody text');
	});

	it('throws when Buffer has no format specified', async () => {
		const buffer = Buffer.from('some content');
		await expect(extractText(buffer)).rejects.toThrow(
			'Cannot determine document format',
		);
	});

	// ── DOCX extraction (mocked) ──────────────────────────────────────

	it('extracts text from .docx file via mammoth', async () => {
		const filePath = join(tempDir, 'doc.docx');
		await writeFile(filePath, 'fake docx bytes');

		const result = await extractText(filePath);
		// mammoth mock returns '  Extracted DOCX text\n\n\n\nwith gaps  '
		// After normalization: 'Extracted DOCX text\n\nwith gaps'
		expect(result).toBe('Extracted DOCX text\n\nwith gaps');
	});

	it('extracts text from Buffer with docx format via mammoth', async () => {
		const buffer = Buffer.from('fake docx bytes');
		const result = await extractText(buffer, 'docx');
		expect(result).toBe('Extracted DOCX text\n\nwith gaps');
	});

	// ── PDF extraction (mocked) ───────────────────────────────────────

	it('extracts text from .pdf file via pdf-parse', async () => {
		const filePath = join(tempDir, 'doc.pdf');
		await writeFile(filePath, 'fake pdf bytes');

		const result = await extractText(filePath);
		// pdf-parse mock returns '  Extracted PDF text\n\n\n\nwith gaps  '
		// After normalization: 'Extracted PDF text\n\nwith gaps'
		expect(result).toBe('Extracted PDF text\n\nwith gaps');
	});

	it('extracts text from Buffer with pdf format via pdf-parse', async () => {
		const buffer = Buffer.from('fake pdf bytes');
		const result = await extractText(buffer, 'pdf');
		expect(result).toBe('Extracted PDF text\n\nwith gaps');
	});

	// ── Format override ───────────────────────────────────────────────

	it('uses explicit format over auto-detection', async () => {
		const filePath = join(tempDir, 'misnamed.txt');
		await writeFile(filePath, '# Actually Markdown');

		const result = await extractText(filePath, 'md');
		expect(result).toBe('# Actually Markdown');
	});

	// ── Error cases ───────────────────────────────────────────────────

	it('throws for non-existent file path', async () => {
		const filePath = join(tempDir, 'does-not-exist.txt');
		await expect(extractText(filePath)).rejects.toThrow();
	});
});
