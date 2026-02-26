import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadKnowledgeFiles } from './loader.js';

describe('loadKnowledgeFiles', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'abf-knowledge-test-'));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it('loads all *.md files from the directory', async () => {
		await writeFile(join(tempDir, 'company.md'), '# Company Info\nWe do things.');
		await writeFile(join(tempDir, 'brand-voice.md'), 'Be professional.');
		await writeFile(join(tempDir, 'faq.md'), '## FAQ\nQ: What?\nA: That.');

		const result = await loadKnowledgeFiles(tempDir);

		expect(Object.keys(result)).toHaveLength(3);
		expect(result['company']).toBe('# Company Info\nWe do things.');
		expect(result['brand-voice']).toBe('Be professional.');
		expect(result['faq']).toBe('## FAQ\nQ: What?\nA: That.');
	});

	it('uses filename without .md extension as the key', async () => {
		await writeFile(join(tempDir, 'my-knowledge-file.md'), 'content');

		const result = await loadKnowledgeFiles(tempDir);

		expect(result).toHaveProperty('my-knowledge-file');
		expect(result).not.toHaveProperty('my-knowledge-file.md');
	});

	it('returns empty object for a non-existent directory', async () => {
		const result = await loadKnowledgeFiles(join(tempDir, 'does-not-exist'));
		expect(result).toEqual({});
	});

	it('returns empty object for an empty directory', async () => {
		const emptyDir = join(tempDir, 'empty');
		await mkdir(emptyDir);

		const result = await loadKnowledgeFiles(emptyDir);
		expect(result).toEqual({});
	});

	it('ignores non-.md files', async () => {
		await writeFile(join(tempDir, 'notes.md'), 'Markdown content');
		await writeFile(join(tempDir, 'data.json'), '{"key":"value"}');
		await writeFile(join(tempDir, 'readme.txt'), 'Plain text');
		await writeFile(join(tempDir, 'script.ts'), 'console.log("hi")');
		await writeFile(join(tempDir, '.hidden'), 'hidden file');

		const result = await loadKnowledgeFiles(tempDir);

		expect(Object.keys(result)).toHaveLength(1);
		expect(result['notes']).toBe('Markdown content');
		expect(result).not.toHaveProperty('data');
		expect(result).not.toHaveProperty('readme');
		expect(result).not.toHaveProperty('script');
		expect(result).not.toHaveProperty('.hidden');
	});

	it('handles files with empty content', async () => {
		await writeFile(join(tempDir, 'empty.md'), '');

		const result = await loadKnowledgeFiles(tempDir);

		expect(result).toHaveProperty('empty');
		expect(result['empty']).toBe('');
	});
});
