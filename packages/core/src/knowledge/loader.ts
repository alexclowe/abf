/**
 * Knowledge Base loader — reads all *.md files from a knowledge directory.
 * Returns a Record<filename, content> for injection into agent prompts.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load all Markdown files from the knowledge directory.
 * Returns a map of filename (without extension) → content.
 */
export async function loadKnowledgeFiles(
	dir: string,
): Promise<Record<string, string>> {
	if (!existsSync(dir)) return {};

	let files: string[];
	try {
		files = (await readdir(dir)).filter((f) => f.endsWith('.md'));
	} catch {
		return {};
	}

	const result: Record<string, string> = {};
	for (const file of files) {
		try {
			const content = await readFile(join(dir, file), 'utf-8');
			const key = file.replace(/\.md$/, '');
			result[key] = content;
		} catch {
			// Skip unreadable files
		}
	}
	return result;
}
