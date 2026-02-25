/**
 * Redis-backed message bus using ioredis.
 * Production replacement for InProcessBus.
 *
 * Uses two Redis connections:
 * - `commands`: general commands (zadd, rpush, lrange, del, zrange, publish)
 * - `sub`: subscription-only (enters subscribe mode)
 *
 * Key naming:
 * - Direct channel:   abf:agent:{agentId}
 * - Broadcast channel: abf:broadcast
 * - Pending list:      abf:pend:{agentId}   (RPUSH / LRANGE+DEL)
 * - History sorted set: abf:hist:{agentId}  (ZADD with timestamp score)
 */

import { Redis } from 'ioredis';
import type { AgentId } from '../../types/common.js';
import type { BusMessage, IBus, MessageFilter, MessageHandler } from '../../types/message.js';

const BROADCAST_CHANNEL = 'abf:broadcast';
const HISTORY_MAX = 1000;

function agentChannel(agentId: string): string {
	return `abf:agent:${agentId}`;
}

function pendingKey(agentId: string): string {
	return `abf:pend:${agentId}`;
}

function historyKey(agentId: string): string {
	return `abf:hist:${agentId}`;
}

export class RedisBus implements IBus {
	private commands: Redis;
	private sub: Redis;
	private connected = false;

	/** Handlers for direct messages keyed by agentId */
	private readonly directHandlers = new Map<string, Set<MessageHandler>>();
	/** Handlers for broadcast messages keyed by subscribing agentId (to filter self-sends) */
	private readonly broadcastHandlers = new Map<string, MessageHandler>();
	/** Channels the sub connection is currently subscribed to */
	private readonly subscribedChannels = new Set<string>();

	constructor(private readonly url: string) {
		this.commands = new Redis(this.url, { lazyConnect: true });
		this.sub = new Redis(this.url, { lazyConnect: true });
	}

	async connect(): Promise<void> {
		if (this.connected) return;
		await this.commands.connect();
		await this.sub.connect();
		this.connected = true;

		// Set up the message listener on the sub connection
		this.sub.on('message', (channel: string, data: string) => {
			const msg = JSON.parse(data) as BusMessage;
			if (channel === BROADCAST_CHANNEL) {
				for (const [id, handler] of this.broadcastHandlers) {
					if (msg.from !== id) void handler(msg);
				}
			} else if (channel.startsWith('abf:agent:')) {
				const agentId = channel.slice('abf:agent:'.length);
				const handlers = this.directHandlers.get(agentId);
				if (handlers) {
					for (const h of handlers) void h(msg);
				}
			}
		});
	}

	async disconnect(): Promise<void> {
		if (!this.connected) return;
		this.sub.removeAllListeners('message');
		await this.sub.quit();
		await this.commands.quit();
		this.connected = false;
		this.directHandlers.clear();
		this.broadcastHandlers.clear();
		this.subscribedChannels.clear();
	}

	async publish(message: BusMessage): Promise<void> {
		const json = JSON.stringify(message);
		const score = Date.now();
		const fromHistKey = historyKey(message.from);

		if (message.to === '*') {
			// Broadcast: store in sender history + publish on broadcast channel
			const pipeline = this.commands.pipeline();
			pipeline.zadd(fromHistKey, score.toString(), json);
			pipeline.zremrangebyrank(fromHistKey, 0, -(HISTORY_MAX + 1));
			pipeline.publish(BROADCAST_CHANNEL, json);
			await pipeline.exec();
		} else {
			// Direct: store in sender + receiver history, add to pending, publish
			const toHistKey = historyKey(message.to);
			const toPendKey = pendingKey(message.to);
			const channel = agentChannel(message.to);

			const pipeline = this.commands.pipeline();
			pipeline.zadd(fromHistKey, score.toString(), json);
			pipeline.zremrangebyrank(fromHistKey, 0, -(HISTORY_MAX + 1));
			pipeline.rpush(toPendKey, json);
			pipeline.zadd(toHistKey, score.toString(), json);
			pipeline.zremrangebyrank(toHistKey, 0, -(HISTORY_MAX + 1));
			pipeline.publish(channel, json);
			await pipeline.exec();
		}
	}

	subscribe(agentId: AgentId, handler: MessageHandler): () => void {
		// Direct handlers
		let handlers = this.directHandlers.get(agentId);
		if (!handlers) {
			handlers = new Set();
			this.directHandlers.set(agentId, handlers);
		}
		handlers.add(handler);

		// Subscribe the sub connection to this agent's channel if not already
		const directCh = agentChannel(agentId);
		if (!this.subscribedChannels.has(directCh)) {
			this.subscribedChannels.add(directCh);
			void this.sub.subscribe(directCh);
		}

		// Broadcast handler (keyed by agentId to filter self-sends)
		this.broadcastHandlers.set(agentId, handler);
		if (!this.subscribedChannels.has(BROADCAST_CHANNEL)) {
			this.subscribedChannels.add(BROADCAST_CHANNEL);
			void this.sub.subscribe(BROADCAST_CHANNEL);
		}

		return () => {
			handlers.delete(handler);
			if (handlers.size === 0) {
				this.directHandlers.delete(agentId);
				this.subscribedChannels.delete(directCh);
				void this.sub.unsubscribe(directCh);
			}
			this.broadcastHandlers.delete(agentId);
		};
	}

	subscribeWithFilter(filter: MessageFilter, handler: MessageHandler): () => void {
		const wrappedHandler: MessageHandler = (msg: BusMessage) => {
			if (filter.type && msg.type !== filter.type) return;
			if (filter.from && msg.from !== filter.from) return;
			if (filter.priority && msg.priority !== filter.priority) return;
			void handler(msg);
		};

		if (filter.to) {
			return this.subscribe(filter.to as AgentId, wrappedHandler);
		}

		// No specific target — listen to broadcast only
		// Use a synthetic key that won't collide with real agent IDs
		const syntheticId = `__filter_${Date.now()}_${Math.random().toString(36).slice(2)}`;
		this.broadcastHandlers.set(syntheticId, wrappedHandler);
		if (!this.subscribedChannels.has(BROADCAST_CHANNEL)) {
			this.subscribedChannels.add(BROADCAST_CHANNEL);
			void this.sub.subscribe(BROADCAST_CHANNEL);
		}

		return () => {
			this.broadcastHandlers.delete(syntheticId);
		};
	}

	async getPending(agentId: AgentId): Promise<readonly BusMessage[]> {
		const key = pendingKey(agentId);
		const items: string[] = await this.commands.lrange(key, 0, -1);
		if (items.length > 0) await this.commands.del(key);
		return items.map((i: string) => JSON.parse(i) as BusMessage);
	}

	async getHistory(agentId: AgentId, limit = 50): Promise<readonly BusMessage[]> {
		const items: string[] = await this.commands.zrange(historyKey(agentId), -limit, -1);
		return items.map((i: string) => JSON.parse(i) as BusMessage);
	}
}
