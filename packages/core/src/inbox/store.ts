/**
 * InMemoryInbox — priority-sorted inbox per agent.
 */

import { nanoid } from 'nanoid';
import type { AgentId, ISOTimestamp } from '../types/common.js';
import { toISOTimestamp } from '../util/id.js';
import type { IInbox, InboxItem, InboxItemPriority } from '../types/inbox.js';

const PRIORITY_ORDER: Record<InboxItemPriority, number> = {
	urgent: 0,
	high: 1,
	normal: 2,
	low: 3,
};

const MAX_ITEMS_PER_AGENT = 500;

export class InMemoryInbox implements IInbox {
	private readonly items = new Map<string, InboxItem[]>(); // agentId → items

	push(item: Omit<InboxItem, 'id' | 'createdAt' | 'consumed'>): string {
		const id = nanoid(12);
		const full: InboxItem = {
			...item,
			id,
			createdAt: toISOTimestamp() as ISOTimestamp,
			consumed: false,
		};

		const agentItems = this.items.get(item.agentId) ?? [];
		agentItems.push(full);

		// Cap per-agent items
		if (agentItems.length > MAX_ITEMS_PER_AGENT) {
			agentItems.splice(0, agentItems.length - MAX_ITEMS_PER_AGENT);
		}

		this.items.set(item.agentId, agentItems);
		return id;
	}

	peek(agentId: AgentId, limit = 20): readonly InboxItem[] {
		const agentItems = this.items.get(agentId) ?? [];
		return this.sortByPriority(agentItems.filter((i) => !i.consumed)).slice(0, limit);
	}

	drain(agentId: AgentId): readonly InboxItem[] {
		const agentItems = this.items.get(agentId) ?? [];
		const pending = agentItems.filter((i) => !i.consumed);
		const sorted = this.sortByPriority(pending);

		// Mark as consumed
		for (const item of sorted) {
			item.consumed = true;
		}

		return sorted;
	}

	count(agentId: AgentId): number {
		const agentItems = this.items.get(agentId) ?? [];
		return agentItems.filter((i) => !i.consumed).length;
	}

	private sortByPriority(items: InboxItem[]): InboxItem[] {
		return [...items].sort(
			(a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
		);
	}
}
