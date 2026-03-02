/**
 * InMemoryConversationStore — stores multi-turn chat history per conversation.
 * Used by the chat endpoint to maintain context across messages.
 *
 * Limits: 100 conversations max, 50 messages each. LRU eviction.
 * Optionally persists to disk via `logs/conversations.json` with 2s debounced saves.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ChatMessage } from '../types/provider.js';

export interface ConversationEntry {
	readonly agentId: string;
	readonly messages: ChatMessage[];
	lastAccessed: number;
}

const MAX_CONVERSATIONS = 100;
const MAX_MESSAGES_PER_CONVERSATION = 50;
const SAVE_DEBOUNCE_MS = 2000;

export class InMemoryConversationStore {
	private readonly store = new Map<string, ConversationEntry>();
	private saveTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly filePath?: string) {}

	get(conversationId: string): ConversationEntry | undefined {
		const entry = this.store.get(conversationId);
		if (entry) {
			entry.lastAccessed = Date.now();
		}
		return entry;
	}

	getOrCreate(conversationId: string, agentId: string): ConversationEntry {
		let entry = this.store.get(conversationId);
		if (entry) {
			entry.lastAccessed = Date.now();
			return entry;
		}

		// Evict oldest if at capacity
		if (this.store.size >= MAX_CONVERSATIONS) {
			let oldestKey: string | undefined;
			let oldestTime = Number.POSITIVE_INFINITY;
			for (const [key, val] of this.store) {
				if (val.lastAccessed < oldestTime) {
					oldestTime = val.lastAccessed;
					oldestKey = key;
				}
			}
			if (oldestKey) this.store.delete(oldestKey);
		}

		entry = { agentId, messages: [], lastAccessed: Date.now() };
		this.store.set(conversationId, entry);
		this.scheduleSave();
		return entry;
	}

	append(conversationId: string, ...messages: ChatMessage[]): void {
		const entry = this.store.get(conversationId);
		if (!entry) return;

		entry.messages.push(...messages);
		entry.lastAccessed = Date.now();

		// Trim to max messages (keep system message if present, trim oldest user/assistant pairs)
		while (entry.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
			// Remove the oldest non-system message
			const idx = entry.messages.findIndex((m) => m.role !== 'system');
			if (idx >= 0) {
				entry.messages.splice(idx, 1);
			} else {
				break;
			}
		}

		this.scheduleSave();
	}

	delete(conversationId: string): boolean {
		const deleted = this.store.delete(conversationId);
		if (deleted) this.scheduleSave();
		return deleted;
	}

	size(): number {
		return this.store.size;
	}

	/** Load persisted conversations from disk. */
	async load(): Promise<void> {
		if (!this.filePath) return;
		try {
			const raw = await readFile(this.filePath, 'utf-8');
			const entries = JSON.parse(raw) as [string, ConversationEntry][];
			for (const [key, entry] of entries) {
				this.store.set(key, entry);
			}
		} catch {
			// File doesn't exist or is corrupt — start fresh
		}
	}

	/** Persist all conversations to disk. */
	async save(): Promise<void> {
		if (!this.filePath) return;
		try {
			await mkdir(dirname(this.filePath), { recursive: true });
			await writeFile(this.filePath, JSON.stringify([...this.store.entries()]), 'utf-8');
		} catch {
			// Non-fatal — log silently, data still in memory
		}
	}

	/** Schedule a debounced save — collapses rapid mutations into one disk write. */
	private scheduleSave(): void {
		if (!this.filePath) return;
		if (this.saveTimer !== undefined) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = undefined;
			void this.save();
		}, SAVE_DEBOUNCE_MS);
	}
}
