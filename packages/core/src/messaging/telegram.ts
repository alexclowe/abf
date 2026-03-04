/**
 * Telegram Gateway — bidirectional Telegram bot using the Bot API.
 * Uses long-polling (getUpdates) so no public URL is needed.
 */

import { toISOTimestamp } from '../util/id.js';
import type { ChannelSendResult, IChannelGateway, InboundMessage } from './interfaces.js';

const TELEGRAM_API = 'https://api.telegram.org';

export class TelegramGateway implements IChannelGateway {
	readonly type = 'telegram' as const;
	private handlers: Array<(msg: InboundMessage) => void> = [];
	private connected = false;
	private polling = false;
	private lastUpdateId = 0;
	private abortController: AbortController | null = null;

	constructor(private readonly botToken: string) {}

	onMessage(handler: (msg: InboundMessage) => void): void {
		this.handlers.push(handler);
	}

	async send(chatId: string, text: string, _metadata?: Record<string, unknown>): Promise<ChannelSendResult> {
		const result = await this.apiCall('sendMessage', {
			chat_id: chatId,
			text,
			parse_mode: 'Markdown',
		});
		const msgId = (result as { message_id?: number })?.message_id;
		return { messageId: msgId ? String(msgId) : undefined };
	}

	async start(): Promise<void> {
		// Verify token is valid
		try {
			await this.apiCall('getMe');
			this.connected = true;
		} catch {
			this.connected = false;
			return;
		}

		// Start long-polling loop
		this.polling = true;
		this.abortController = new AbortController();
		void this.pollLoop();
	}

	async stop(): Promise<void> {
		this.polling = false;
		this.abortController?.abort();
		this.connected = false;
	}

	isConnected(): boolean {
		return this.connected;
	}

	private async pollLoop(): Promise<void> {
		while (this.polling) {
			try {
				const result = await this.apiCall('getUpdates', {
					offset: this.lastUpdateId + 1,
					timeout: 30,
					allowed_updates: ['message'],
				});

				if (!Array.isArray(result)) continue;

				for (const update of result as TelegramUpdate[]) {
					this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);

					if (update.message?.text) {
						const msg: InboundMessage = {
							channel: 'telegram',
							senderId: String(update.message.chat.id),
							senderName: update.message.from?.first_name ?? update.message.from?.username,
							conversationId: String(update.message.chat.id),
							text: update.message.text,
							timestamp: toISOTimestamp(),
							metadata: {
								messageId: update.message.message_id,
								chatType: update.message.chat.type,
								replyToMessageId: update.message.reply_to_message?.message_id,
							},
						};

						for (const handler of this.handlers) {
							try {
								await handler(msg);
							} catch {
								// Don't let handler errors break the poll loop
							}
						}
					}
				}
			} catch {
				if (this.polling) {
					// Wait before retrying on error
					await new Promise((r) => setTimeout(r, 5000));
				}
			}
		}
	}

	private async apiCall(method: string, params?: Record<string, unknown>): Promise<unknown> {
		const url = `${TELEGRAM_API}/bot${this.botToken}/${method}`;
		const init: RequestInit = {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
		};
		if (params) init.body = JSON.stringify(params);
		if (this.abortController) init.signal = this.abortController.signal;
		const res = await fetch(url, init);

		if (!res.ok) {
			throw new Error(`Telegram API ${method} failed: ${res.status} ${res.statusText}`);
		}

		const data = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
		if (!data.ok) {
			throw new Error(`Telegram API ${method} error: ${data.description ?? 'Unknown'}`);
		}

		return data.result;
	}
}

// Minimal Telegram API types (only what we use)
interface TelegramUpdate {
	update_id: number;
	message?: {
		message_id: number;
		from?: { first_name?: string; username?: string };
		chat: { id: number; type: string };
		text?: string;
		reply_to_message?: { message_id?: number };
	};
}
