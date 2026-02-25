/**
 * Message Bus types.
 * Inter-agent communication with typed messages, priorities, and filtering.
 */

import type { AgentId, ISOTimestamp, MessageId } from './common.js';

// ─── Message Types ────────────────────────────────────────────────────

export type MessageType = 'REQUEST' | 'RESPONSE' | 'ALERT' | 'ESCALATION' | 'STATUS' | 'BROADCAST';

export type MessagePriority = 'low' | 'normal' | 'high' | 'critical';

export interface BusMessage {
	readonly id: MessageId;
	readonly from: AgentId;
	readonly to: AgentId | '*'; // '*' = broadcast
	readonly type: MessageType;
	readonly priority: MessagePriority;
	readonly context: string;
	readonly payload: Readonly<Record<string, unknown>>;
	readonly timestamp: ISOTimestamp;
	readonly deadline?: ISOTimestamp | undefined;
	readonly replyTo?: MessageId | undefined;
}

// ─── Bus Interface ────────────────────────────────────────────────────

export interface MessageFilter {
	readonly type?: MessageType | undefined;
	readonly from?: AgentId | undefined;
	readonly to?: AgentId | undefined;
	readonly priority?: MessagePriority | undefined;
}

export type MessageHandler = (message: BusMessage) => void | Promise<void>;

export interface IBus {
	publish(message: BusMessage): Promise<void>;
	subscribe(agentId: AgentId, handler: MessageHandler): () => void; // returns unsubscribe
	subscribeWithFilter(filter: MessageFilter, handler: MessageHandler): () => void;
	getPending(agentId: AgentId): Promise<readonly BusMessage[]>;
	getHistory(agentId: AgentId, limit?: number): Promise<readonly BusMessage[]>;
}
