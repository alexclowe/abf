/**
 * Knowledge Base loader — reads all *.md files from a knowledge directory.
 * Returns a Record<filename, content> for injection into agent prompts.
 *
 * Optimizations:
 * - Parallel file reads via Promise.allSettled (not sequential)
 * - Optional caching with directory watching via KnowledgeCache
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { join } from 'node:path';

/**
 * Load all Markdown files from the knowledge directory.
 * Returns a map of filename (without extension) → content.
 * Reads all files in parallel for better I/O throughput.
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

	// Read all files in parallel
	const entries = await Promise.allSettled(
		files.map(async (file) => {
			const content = await readFile(join(dir, file), 'utf-8');
			const key = file.replace(/\.md$/, '');
			return [key, content] as const;
		}),
	);

	const result: Record<string, string> = {};
	for (const entry of entries) {
		if (entry.status === 'fulfilled') {
			result[entry.value[0]] = entry.value[1];
		}
	}
	return result;
}

/**
 * Cached knowledge loader — loads files once and watches for changes.
 * Use for long-running processes (e.g. the runtime) to avoid re-reading
 * unchanged knowledge files on every session.
 */
export class KnowledgeCache {
	private cache: Record<string, string> | null = null;
	private watcher: FSWatcher | null = null;

	constructor(private readonly dir: string) {}

	/** Get cached knowledge files, loading on first call. */
	async get(): Promise<Record<string, string>> {
		if (this.cache !== null) return this.cache;

		this.cache = await loadKnowledgeFiles(this.dir);

		// Watch for changes — invalidate cache on any file modification
		if (existsSync(this.dir) && !this.watcher) {
			try {
				this.watcher = watch(this.dir, () => {
					this.cache = null;
				});
				// Prevent watcher from keeping the process alive
				this.watcher.unref();
			} catch {
				// fs.watch not available on all platforms — fall back to uncached
			}
		}

		return this.cache;
	}

	/** Invalidate the cache, forcing a reload on next access. */
	invalidate(): void {
		this.cache = null;
	}

	/** Stop watching and release resources. */
	close(): void {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
		this.cache = null;
	}
}
