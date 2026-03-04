/**
 * Discord Gateway — bidirectional Discord bot using webhook for outbound.
 * For inbound, receives messages via webhook at POST /webhook/discord/events.
 * Full WebSocket (discord.js) support is optional — deferred to avoid heavy dependency.
 */

import { toISOTimestamp } from '../util/id.js';
import type { ChannelSendResult, IChannelGateway, InboundMessage } from './interfaces.js';

export class DiscordGateway implements IChannelGateway {
	readonly type = 'discord' as const;
	private handlers: Array<(msg: InboundMessage) => void> = [];
	private connected = false;

	constructor(
		private readonly botToken: string,
		private readonly webhookUrl?: string,
	) {}

	onMessage(handler: (msg: InboundMessage) => void): void {
		this.handlers.push(handler);
	}

	async send(channelId: string, text: string, _metadata?: Record<string, unknown>): Promise<ChannelSendResult> {
		// If webhook URL is configured, use that (simpler, no bot token needed for outbound)
		if (this.webhookUrl) {
			const res = await fetch(this.webhookUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: text }),
			});
			if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);
			const data = (await res.json()) as { id?: string };
			return { messageId: data.id };
		}

		// Otherwise use Bot API to send to specific channel
		const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bot ${this.botToken}`,
			},
			body: JSON.stringify({ content: text }),
		});

		if (!res.ok) {
			throw new Error(`Discord API failed: ${res.status}`);
		}

		const data = (await res.json()) as { id?: string };
		return { messageId: data.id };
	}

	async start(): Promise<void> {
		if (!this.botToken) {
			this.connected = false;
			return;
		}

		// Verify bot token
		try {
			const res = await fetch('https://discord.com/api/v10/users/@me', {
				headers: { Authorization: `Bot ${this.botToken}` },
			});
			this.connected = res.ok;
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
	 * Handle an inbound event from Discord Interactions webhook.
	 * Called by the gateway's webhook route handler.
	 */
	async handleWebhookEvent(event: DiscordEvent): Promise<void> {
		if (!event.content || event.author?.bot) return;

		const msg: InboundMessage = {
			channel: 'discord',
			senderId: event.author?.id ?? 'unknown',
			senderName: event.author?.username,
			conversationId: event.channel_id,
			text: event.content,
			timestamp: toISOTimestamp(),
			metadata: {
				messageId: event.id,
				guildId: event.guild_id,
				replyTo: event.message_reference?.message_id,
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

interface DiscordEvent {
	id?: string;
	content?: string;
	author?: { id: string; username?: string; bot?: boolean };
	channel_id?: string;
	guild_id?: string;
	message_reference?: { message_id?: string };
}
