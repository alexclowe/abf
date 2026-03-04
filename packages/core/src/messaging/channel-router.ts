/**
 * Channel Router — routes inbound messages from external channels to agents.
 *
 * When a message arrives on a channel (Telegram, Slack, Discord, Email),
 * the router finds the matching route, dispatches an activation to the target agent,
 * and optionally sends the agent's response back via the same channel.
 */

import type { AgentId } from '../types/common.js';
import type { IDispatcher } from '../runtime/interfaces.js';
import { createActivationId, toISOTimestamp } from '../util/id.js';
import type { ChannelRoute, ChannelType, IChannelGateway, InboundMessage } from './interfaces.js';
import type { OperatorChannel } from './operator-channel.js';

export class ChannelRouter {
	private readonly gateways = new Map<ChannelType, IChannelGateway>();
	private routes: ChannelRoute[] = [];
	private dispatcher: IDispatcher | undefined;
	private operatorChannel: OperatorChannel | undefined;

	setDispatcher(dispatcher: IDispatcher): void {
		this.dispatcher = dispatcher;
	}

	setOperatorChannel(oc: OperatorChannel): void {
		this.operatorChannel = oc;
	}

	setRoutes(routes: ChannelRoute[]): void {
		this.routes = routes;
	}

	addGateway(gateway: IChannelGateway): void {
		this.gateways.set(gateway.type, gateway);
		gateway.onMessage((msg) => this.handleInbound(msg));
	}

	getGateway(type: ChannelType): IChannelGateway | undefined {
		return this.gateways.get(type);
	}

	getStatus(): Array<{ type: ChannelType; connected: boolean }> {
		return [...this.gateways.entries()].map(([type, gw]) => ({
			type,
			connected: gw.isConnected(),
		}));
	}

	getRoutes(): readonly ChannelRoute[] {
		return this.routes;
	}

	async start(): Promise<void> {
		const startPromises: Promise<void>[] = [];
		for (const gw of this.gateways.values()) {
			startPromises.push(gw.start());
		}
		await Promise.allSettled(startPromises);
	}

	async stop(): Promise<void> {
		const stopPromises: Promise<void>[] = [];
		for (const gw of this.gateways.values()) {
			stopPromises.push(gw.stop());
		}
		await Promise.allSettled(stopPromises);
	}

	private async handleInbound(msg: InboundMessage): Promise<void> {
		if (!this.dispatcher) return;

		// Check if this is a reply to a known agent message
		const replyRef = this.extractReplyRef(msg);
		const replyMapping = this.operatorChannel?.resolveReply(msg.channel, replyRef);

		// Find matching route (reply mapping overrides route for agent targeting)
		const route = this.findRoute(msg);
		const targetAgent = replyMapping?.agentId ?? route?.agent;
		if (!targetAgent) return;

		const activation = {
			id: createActivationId(),
			agentId: targetAgent as AgentId,
			trigger: {
				type: 'event' as const,
				event: `channel:${msg.channel}`,
				task: msg.text,
			},
			timestamp: toISOTimestamp(),
			payload: {
				channel: msg.channel,
				senderId: msg.senderId,
				senderName: msg.senderName,
				conversationId: replyMapping?.conversationId ?? msg.conversationId,
				text: msg.text,
				metadata: msg.metadata,
			},
		};

		const result = await this.dispatcher.dispatch(activation);

		// If configured to respond in-channel, send the agent's output back
		const respondInChannel = route?.respondInChannel ?? !!replyMapping;
		if (respondInChannel && result.ok) {
			const sessionResult = this.dispatcher.getSessionResult(result.value);
			if (sessionResult?.outputText) {
				const gw = this.gateways.get(msg.channel);
				if (gw) {
					const target = msg.conversationId ?? msg.senderId;
					await gw.send(target, sessionResult.outputText);
				}
			}
		}
	}

	/** Extract reply reference from inbound message metadata (per-channel). */
	private extractReplyRef(msg: InboundMessage): string | undefined {
		const meta = msg.metadata;
		if (!meta) return undefined;
		switch (msg.channel) {
			case 'slack': return meta['threadTs'] as string | undefined;
			case 'discord': return meta['replyTo'] as string | undefined;
			case 'telegram': return meta['replyToMessageId'] ? String(meta['replyToMessageId']) : undefined;
			case 'email': return meta['inReplyTo'] as string | undefined;
			default: return undefined;
		}
	}

	private findRoute(msg: InboundMessage): ChannelRoute | undefined {
		for (const route of this.routes) {
			if (route.channel !== msg.channel) continue;

			// If route has a pattern, check if senderId or conversationId matches
			if (route.pattern) {
				const regex = new RegExp(route.pattern.replace(/\*/g, '.*'));
				const target = msg.conversationId ?? msg.senderId;
				if (!regex.test(target)) continue;
			}

			return route;
		}
		return undefined;
	}
}
