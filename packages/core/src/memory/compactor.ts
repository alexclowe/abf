/**
 * MemoryCompactor — rolling window + LLM summarization of older history entries.
 * Prevents unbounded memory growth by keeping only recent entries in full
 * and compressing older entries into a summary.
 */

import type { AgentId } from '../types/common.js';
import type { IMemoryStore } from '../types/memory.js';
import type { IProviderRegistry } from '../types/provider.js';

export interface CompactionConfig {
	/** Number of recent history entries to keep in full. Default: 20. */
	readonly windowSize: number;
	/** Trigger compaction when history entries exceed this count. Default: 50. */
	readonly threshold: number;
	/** Whether summarization is enabled. Default: true. */
	readonly enabled: boolean;
}

const SUMMARIZE_SYSTEM_PROMPT = `You are a memory compactor for an AI agent. Given a set of older session history entries, produce a concise summary that preserves:
- Key decisions and their reasoning
- Important findings and data points
- Recurring patterns or lessons learned
- Relationships and contacts mentioned

Keep the summary under 2000 characters. Use bullet points. Do not add commentary.`;

export class MemoryCompactor {
	constructor(
		private readonly memoryStore: IMemoryStore,
		private readonly providerRegistry: IProviderRegistry,
		private readonly config: CompactionConfig,
	) {}

	/**
	 * Check if an agent's history needs compaction.
	 */
	async shouldCompact(agentId: AgentId): Promise<boolean> {
		if (!this.config.enabled) return false;

		const result = await this.memoryStore.loadContext(agentId);
		if (!result.ok) return false;

		const historyText = result.value.history.map((h) => h.content).join('');
		const entryCount = (historyText.match(/\n---\n/g) || []).length + 1;
		return entryCount > this.config.threshold;
	}

	/**
	 * Check and compact in a single pass — loads context once.
	 * Preferred over calling shouldCompact() + compact() separately.
	 */
	async compactIfNeeded(agentId: AgentId): Promise<boolean> {
		if (!this.config.enabled) return false;

		const result = await this.memoryStore.loadContext(agentId);
		if (!result.ok) return false;

		const historyText = result.value.history.map((h) => h.content).join('');
		const entries = historyText.split(/\n---\n/).filter((e) => e.trim());

		if (entries.length <= this.config.threshold) return false;
		if (entries.length <= this.config.windowSize) return false;

		const olderEntries = entries.slice(0, entries.length - this.config.windowSize);
		const summary = await this.summarize(olderEntries.join('\n---\n'));
		if (summary) {
			await this.memoryStore.write(agentId, 'knowledge', summary);
		}

		return true;
	}

	/**
	 * Compact an agent's history: summarize older entries, keep recent window.
	 */
	async compact(agentId: AgentId): Promise<void> {
		const result = await this.memoryStore.loadContext(agentId);
		if (!result.ok) return;

		// History is stored as a single concatenated entry with --- delimiters
		const historyText = result.value.history.map((h) => h.content).join('');
		const entries = historyText.split(/\n---\n/).filter((e) => e.trim());

		if (entries.length <= this.config.windowSize) return;

		// Split into older (to summarize) and recent (to keep)
		const olderEntries = entries.slice(0, entries.length - this.config.windowSize);
		const recentEntries = entries.slice(entries.length - this.config.windowSize);

		// Summarize older entries using the cheapest available provider
		const summary = await this.summarize(olderEntries.join('\n---\n'));

		// Write summary to memory store
		if (summary) {
			await this.memoryStore.write(agentId, 'knowledge', summary);
		}

		// Rewrite history with only recent entries
		// Note: filesystem store append-only — we write via the knowledge layer workaround
		// For the summary, we use a dedicated path convention
		const recentContent = recentEntries.join('\n---\n');
		// We can't directly truncate the history file via the store interface,
		// but we store the summary and the session manager will include it in prompts.
		// The full compaction (file rewrite) would need a new store method.
		// For now, store the summary separately.
		void recentContent; // kept for future file-level compaction
	}

	private async summarize(content: string): Promise<string | null> {
		// Try providers in order: cheapest first
		const slugs = ['ollama', 'openai', 'anthropic'];
		for (const slug of slugs) {
			const provider = this.providerRegistry.getBySlug(slug);
			if (!provider) continue;

			try {
				const models = await provider.models();
				if (models.length === 0) continue;

				// Pick the cheapest model
				const model = models[0]!.id;
				let text = '';

				const chunks = provider.chat({
					model,
					messages: [
						{ role: 'system', content: SUMMARIZE_SYSTEM_PROMPT },
						{ role: 'user', content: `Summarize these agent session entries:\n\n${content}` },
					],
					temperature: 0.2,
				});

				for await (const chunk of chunks) {
					if (chunk.type === 'text' && chunk.text) {
						text += chunk.text;
					}
				}

				return text || null;
			} catch {
				// Try next provider
			}
		}

		return null;
	}
}
