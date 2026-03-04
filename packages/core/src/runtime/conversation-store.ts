/**
 * Conversation Store — stores multi-turn chat history per conversation.
 * Used by the chat endpoint to maintain context across messages.
 *
 * IConversationStore defines the contract; InMemoryConversationStore is the
 * in-memory implementation. SQLiteConversationStore provides persistent storage.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ChatMessage } from '../types/provider.js';

export interface ConversationEntry {
	readonly agentId: string;
	readonly messages: ChatMessage[];
	lastAccessed: number;
}

export interface ConversationMeta {
	id: string;
	agentId: string;
	title: string;
	lastAccessed: number;
	messageCount: number;
}

export interface IConversationStore {
	get(conversationId: string): ConversationEntry | undefined;
	getOrCreate(conversationId: string, agentId: string): ConversationEntry;
	append(conversationId: string, ...messages: ChatMessage[]): void;
	delete(conversationId: string): boolean;
	size(): number;
	load(): Promise<void>;
	save(): Promise<void>;
	listByAgent(agentId: string): ConversationMeta[];
	getMeta(conversationId: string): ConversationMeta | undefined;
	upsertMeta(conversationId: string, agentId: string, title: string, messageCount: number): void;
	deleteMeta(conversationId: string): void;
}

const MAX_CONVERSATIONS = 100;
const MAX_MESSAGES_PER_CONVERSATION = 50;
const MAX_CONVERSATION_META = 200;
const SAVE_DEBOUNCE_MS = 2000;

export class InMemoryConversationStore implements IConversationStore {
	private readonly store = new Map<string, ConversationEntry>();
	private readonly metaStore = new Map<string, ConversationMeta>();
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

	// ─── Conversation Metadata ───────────────────────────────────────────

	listByAgent(agentId: string): ConversationMeta[] {
		const result: ConversationMeta[] = [];
		for (const meta of this.metaStore.values()) {
			if (meta.agentId === agentId) result.push(meta);
		}
		result.sort((a, b) => b.lastAccessed - a.lastAccessed);
		return result;
	}

	getMeta(conversationId: string): ConversationMeta | undefined {
		return this.metaStore.get(conversationId);
	}

	upsertMeta(conversationId: string, agentId: string, title: string, messageCount: number): void {
		const existing = this.metaStore.get(conversationId);
		if (existing) {
			existing.lastAccessed = Date.now();
			existing.messageCount = messageCount;
		} else {
			// Evict oldest if at capacity
			if (this.metaStore.size >= MAX_CONVERSATION_META) {
				const oldestKey = this.metaStore.keys().next().value;
				if (oldestKey) this.metaStore.delete(oldestKey);
			}
			this.metaStore.set(conversationId, {
				id: conversationId,
				agentId,
				title: title.slice(0, 50),
				lastAccessed: Date.now(),
				messageCount,
			});
		}
	}

	deleteMeta(conversationId: string): void {
		this.metaStore.delete(conversationId);
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
