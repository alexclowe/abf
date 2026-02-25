/**
 * In-process message bus using EventEmitter.
 * Default for local development. Replaced by Redis/BullMQ in production.
 */

import { EventEmitter } from 'node:events';
import type { AgentId } from '../../types/common.js';
import type { BusMessage, IBus, MessageFilter, MessageHandler } from '../../types/message.js';

export class InProcessBus implements IBus {
	private readonly emitter = new EventEmitter();
	private readonly pending = new Map<string, BusMessage[]>();
	private readonly history = new Map<string, BusMessage[]>();

	async publish(message: BusMessage): Promise<void> {
		// Store in history for sender
		this.addToHistory(message.from, message);

		if (message.to === '*') {
			// Broadcast to all subscribers
			this.emitter.emit('broadcast', message);
		} else {
			// Direct message
			this.emitter.emit(`agent:${message.to}`, message);

			// Store as pending for the recipient
			const pending = this.pending.get(message.to) ?? [];
			pending.push(message);
			this.pending.set(message.to, pending);

			// Store in history for receiver
			this.addToHistory(message.to, message);
		}
	}

	subscribe(agentId: AgentId, handler: MessageHandler): () => void {
		const directHandler = (msg: BusMessage) => void handler(msg);
		const broadcastHandler = (msg: BusMessage) => {
			if (msg.from !== agentId) void handler(msg);
		};

		this.emitter.on(`agent:${agentId}`, directHandler);
		this.emitter.on('broadcast', broadcastHandler);

		return () => {
			this.emitter.off(`agent:${agentId}`, directHandler);
			this.emitter.off('broadcast', broadcastHandler);
		};
	}

	subscribeWithFilter(filter: MessageFilter, handler: MessageHandler): () => void {
		const wrappedHandler = (msg: BusMessage) => {
			if (filter.type && msg.type !== filter.type) return;
			if (filter.from && msg.from !== filter.from) return;
			if (filter.priority && msg.priority !== filter.priority) return;
			void handler(msg);
		};

		if (filter.to) {
			this.emitter.on(`agent:${filter.to}`, wrappedHandler);
			return () => this.emitter.off(`agent:${filter.to}`, wrappedHandler);
		}

		// No specific target — listen to everything
		this.emitter.on('broadcast', wrappedHandler);
		return () => this.emitter.off('broadcast', wrappedHandler);
	}

	async getPending(agentId: AgentId): Promise<readonly BusMessage[]> {
		const pending = this.pending.get(agentId) ?? [];
		this.pending.set(agentId, []);
		return pending;
	}

	async getHistory(agentId: AgentId, limit?: number): Promise<readonly BusMessage[]> {
		const history = this.history.get(agentId) ?? [];
		if (limit) return history.slice(-limit);
		return history;
	}

	private addToHistory(agentId: AgentId, message: BusMessage): void {
		const history = this.history.get(agentId) ?? [];
		history.push(message);
		// Keep last 1000 messages per agent
		if (history.length > 1000) history.splice(0, history.length - 1000);
		this.history.set(agentId, history);
	}
}
