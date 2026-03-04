/**
 * OperatorChannel — unified bidirectional communication between agents and the operator.
 *
 * All agent→operator messages flow through here:
 * 1. Persisted in ConversationStore (dashboard always has the record)
 * 2. Added to SSE snapshot (real-time badge)
 * 3. Delivered to external channel if configured (Slack/Discord/Telegram/Email)
 *
 * Reply mapping enables inbound replies on external channels to link back
 * to the originating conversation.
 */

import type { AgentNotification, ChannelType, IChannelGateway } from './interfaces.js';
import type { IConversationStore } from '../runtime/conversation-store.js';
import type { AgentId, SessionId, ISOTimestamp } from '../types/common.js';

export interface OperatorMessage {
	readonly agentId: string;
	readonly agentName: string;
	readonly agentDisplayName: string;
	readonly sessionId: string;
	readonly task: string;
	readonly content: string;
	readonly timestamp: string;
	readonly source: 'session_output' | 'escalation' | 'agent_initiated';
}

interface ReplyMapping {
	readonly conversationId: string;
	readonly agentId: string;
	readonly timestamp: number;
}

export class OperatorChannel {
	/** Recent messages for SSE snapshot (ring buffer, max 50). */
	private readonly recentMessages: OperatorMessage[] = [];

	/** Maps external channel message IDs to conversation context for reply linking. */
	private readonly replyMap = new Map<string, ReplyMapping>();

	/** Per-agent rate limiting counters. */
	private readonly agentMessageCounts = new Map<string, { count: number; windowStart: number }>();

	private static readonly MAX_PER_HOUR = 10;
	private static readonly BURST_THRESHOLD = 3;
	private static readonly BURST_WINDOW_MS = 60_000;
	private static readonly REPLY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
	private static readonly MAX_REPLY_ENTRIES = 1000;

	constructor(
		private readonly conversationStore: IConversationStore,
		private readonly notifier: { notify(n: AgentNotification): Promise<void> } | null,
		private readonly channelRouter?: { getGateway(type: ChannelType): IChannelGateway | undefined } | undefined,
		private readonly preferredChannel?: ChannelType | undefined,
		private readonly notificationTarget?: string | undefined,
	) {}

	/**
	 * Send a message from an agent to the operator.
	 * Creates a conversation in the store, adds to recent messages for SSE,
	 * and notifies on the external channel if configured.
	 */
	send(message: OperatorMessage): void {
		// Rate limit: prevent noisy agents from flooding the operator
		if (this.isRateLimited(message.agentId)) return;

		const convId = `agent-${message.sessionId}`;

		// 1. Persist as conversation (dashboard always has the record)
		this.conversationStore.getOrCreate(convId, message.agentId);
		this.conversationStore.upsertMeta(
			convId,
			message.agentId,
			message.task.slice(0, 50) || 'Agent update',
			1,
		);
		this.conversationStore.append(convId, {
			role: 'assistant',
			content: message.content,
		});

		// 2. Add to recent messages (for SSE snapshot)
		this.recentMessages.push(message);
		if (this.recentMessages.length > 50) this.recentMessages.shift();

		// 3. Deliver to external channel
		void this.deliverExternal(message, convId);
	}

	/** Get recent messages for SSE snapshot. */
	getRecentMessages(): readonly OperatorMessage[] {
		return this.recentMessages;
	}

	/**
	 * Resolve an inbound reply on an external channel to a conversation.
	 * Returns the mapping if the reply references a known outbound message.
	 */
	resolveReply(channel: ChannelType, replyRef?: string): ReplyMapping | undefined {
		if (!replyRef) return undefined;
		const key = `${channel}:${replyRef}`;
		const mapping = this.replyMap.get(key);
		if (!mapping) return undefined;
		if (Date.now() - mapping.timestamp > OperatorChannel.REPLY_TTL_MS) {
			this.replyMap.delete(key);
			return undefined;
		}
		return mapping;
	}

	// ─── Private ──────────────────────────────────────────────────────────

	private async deliverExternal(message: OperatorMessage, convId: string): Promise<void> {
		// Try gateway first (bidirectional, reply-trackable)
		if (this.channelRouter && this.preferredChannel && this.notificationTarget) {
			const gw = this.channelRouter.getGateway(this.preferredChannel);
			if (gw?.isConnected()) {
				try {
					const formatted = this.formatForChannel(message);
					const result = await gw.send(this.notificationTarget, formatted);
					if (result.messageId) {
						this.storeReplyMapping(
							this.preferredChannel,
							result.messageId,
							convId,
							message.agentId,
						);
					}
					return; // sent via gateway, skip notifier
				} catch {
					// fall through to notifier
				}
			}
		}

		// Fallback: one-way notification via OperatorNotifier
		if (this.notifier) {
			void this.notifier.notify({
				type: 'agent_message',
				agentId: message.agentId as AgentId,
				sessionId: message.sessionId as SessionId,
				message: `${message.agentDisplayName}: ${message.content.slice(0, 300)}`,
				severity: 'info',
				timestamp: message.timestamp as ISOTimestamp,
				context: { conversationId: convId, task: message.task },
			});
		}
	}

	/** Format agent message for external channels with source tagging (S3). */
	private formatForChannel(message: OperatorMessage): string {
		// Wrap in code blocks to prevent injection (S2):
		// - Slack: prevents link unfurling
		// - Discord: prevents embed injection
		// - Telegram: prevents markdown injection
		const preview = message.content.slice(0, 500);
		return `[ABF Agent: ${message.agentDisplayName}] Task: ${message.task}\n───\n\`\`\`\n${preview}\n\`\`\``;
	}

	private storeReplyMapping(
		channel: ChannelType,
		messageId: string,
		conversationId: string,
		agentId: string,
	): void {
		const key = `${channel}:${messageId}`;
		this.replyMap.set(key, { conversationId, agentId, timestamp: Date.now() });
		this.pruneReplyMap();
	}

	private pruneReplyMap(): void {
		if (this.replyMap.size <= OperatorChannel.MAX_REPLY_ENTRIES) return;
		const now = Date.now();
		for (const [key, mapping] of this.replyMap) {
			if (now - mapping.timestamp > OperatorChannel.REPLY_TTL_MS) {
				this.replyMap.delete(key);
			}
		}
		// Hard cap: evict oldest if still over limit
		while (this.replyMap.size > OperatorChannel.MAX_REPLY_ENTRIES) {
			const firstKey = this.replyMap.keys().next().value;
			if (firstKey) this.replyMap.delete(firstKey);
			else break;
		}
	}

	/** Per-agent rate limiting: max 10 messages/hour, burst protection for 3+ in 60s. */
	private isRateLimited(agentId: string): boolean {
		const now = Date.now();
		const record = this.agentMessageCounts.get(agentId);

		if (!record || now - record.windowStart > 3_600_000) {
			this.agentMessageCounts.set(agentId, { count: 1, windowStart: now });
			return false;
		}

		record.count++;

		// Hard limit: 10 per hour per agent
		if (record.count > OperatorChannel.MAX_PER_HOUR) return true;

		// Burst protection: 3+ in 60 seconds → rate limited
		if (
			record.count >= OperatorChannel.BURST_THRESHOLD &&
			now - record.windowStart < OperatorChannel.BURST_WINDOW_MS
		) {
			return true;
		}

		return false;
	}
}
