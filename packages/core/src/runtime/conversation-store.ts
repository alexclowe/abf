/**
 * InMemoryConversationStore — stores multi-turn chat history per conversation.
 * Used by the chat endpoint to maintain context across messages.
 *
 * Limits: 100 conversations max, 50 messages each. LRU eviction.
 */

import type { ChatMessage } from '../types/provider.js';

export interface ConversationEntry {
	readonly agentId: string;
	readonly messages: ChatMessage[];
	lastAccessed: number;
}

const MAX_CONVERSATIONS = 100;
const MAX_MESSAGES_PER_CONVERSATION = 50;

export class InMemoryConversationStore {
	private readonly store = new Map<string, ConversationEntry>();

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
	}

	delete(conversationId: string): boolean {
		return this.store.delete(conversationId);
	}

	size(): number {
		return this.store.size;
	}
}
