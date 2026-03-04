/**
 * Slack Gateway — bidirectional Slack bot using Web API.
 * Sends messages via chat.postMessage. Receives via webhook at POST /webhook/slack/events.
 * Falls back to existing SlackPlugin (webhook-only) for backward compat.
 */

import { toISOTimestamp } from '../util/id.js';
import type { ChannelSendResult, IChannelGateway, InboundMessage } from './interfaces.js';

export class SlackGateway implements IChannelGateway {
	readonly type = 'slack' as const;
	private handlers: Array<(msg: InboundMessage) => void> = [];
	private connected = false;

	constructor(private readonly botToken: string) {}

	onMessage(handler: (msg: InboundMessage) => void): void {
		this.handlers.push(handler);
	}

	async send(channel: string, text: string, _metadata?: Record<string, unknown>): Promise<ChannelSendResult> {
		const res = await fetch('https://slack.com/api/chat.postMessage', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.botToken}`,
			},
			body: JSON.stringify({ channel, text }),
		});

		if (!res.ok) {
			throw new Error(`Slack API failed: ${res.status}`);
		}

		const data = (await res.json()) as { ok: boolean; error?: string; ts?: string };
		if (!data.ok) {
			throw new Error(`Slack API error: ${data.error ?? 'Unknown'}`);
		}

		return { messageId: data.ts };
	}

	async start(): Promise<void> {
		// Verify token is valid
		try {
			const res = await fetch('https://slack.com/api/auth.test', {
				headers: { Authorization: `Bearer ${this.botToken}` },
			});
			const data = (await res.json()) as { ok: boolean };
			this.connected = data.ok;
		} catch {
			this.connected = false;
		}
	}

	async stop(): Promise<void> {
		this.connected = false;
	}

	isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Handle an inbound event from Slack Events API webhook.
	 * Called by the gateway's webhook route handler.
	 */
	async handleWebhookEvent(event: SlackEvent): Promise<void> {
		if (event.type !== 'message' || event.subtype || !event.text) return;

		const msg: InboundMessage = {
			channel: 'slack',
			senderId: event.user ?? 'unknown',
			conversationId: event.channel,
			text: event.text,
			timestamp: toISOTimestamp(),
			metadata: {
				threadTs: event.thread_ts,
				ts: event.ts,
			},
		};

		for (const handler of this.handlers) {
			try {
				await handler(msg);
			} catch {
				// Don't let handler errors propagate
			}
		}
	}
}

interface SlackEvent {
	type: string;
	subtype?: string;
	user?: string;
	channel?: string;
	text?: string;
	ts?: string;
	thread_ts?: string;
}
