/**
 * Agent Inbox types — unified inbox for tasks, webhooks, and bus messages.
 */

import type { AgentId, ISOTimestamp } from './common.js';

export type InboxItemPriority = 'low' | 'normal' | 'high' | 'urgent';
export type InboxItemSource = 'human' | 'webhook' | 'bus' | 'agent';

export interface InboxItem {
	readonly id: string;
	readonly agentId: AgentId;
	readonly source: InboxItemSource;
	readonly priority: InboxItemPriority;
	readonly subject: string;
	readonly body: string;
	readonly from?: string | undefined;
	readonly createdAt: ISOTimestamp;
	consumed: boolean;
}

export interface IInbox {
	/** Push an item into an agent's inbox. */
	push(item: Omit<InboxItem, 'id' | 'createdAt' | 'consumed'>): string;

	/** Peek at items without consuming them. */
	peek(agentId: AgentId, limit?: number): readonly InboxItem[];

	/** Drain (consume) all pending items for an agent, sorted by priority. */
	drain(agentId: AgentId): readonly InboxItem[];

	/** Count pending items for an agent. */
	count(agentId: AgentId): number;
}
