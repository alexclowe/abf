/**
 * Telegram notification plugin — sends one-way notifications via Bot API.
 *
 * Unlike TelegramGateway (bidirectional long-polling for agent chat), this
 * plugin is fire-and-forget for operator alerts. It implements the same
 * IMessagingPlugin interface as SlackPlugin and DiscordPlugin.
 */

import type { AgentNotification, IMessagingPlugin, MessagingPluginType } from './interfaces.js';

const TELEGRAM_API = 'https://api.telegram.org';

const SEVERITY_EMOJI: Record<string, string> = {
	info: '\u2139\uFE0F',
	warn: '\u26A0\uFE0F',
	error: '\u274C',
	critical: '\uD83D\uDEA8',
};

export class TelegramNotificationPlugin implements IMessagingPlugin {
	readonly type = 'telegram' as MessagingPluginType;

	constructor(
		private readonly botToken: string,
		private readonly chatId: string,
	) {}

	async send(notification: AgentNotification): Promise<void> {
		const emoji = SEVERITY_EMOJI[notification.severity] ?? '\uD83D\uDD14';
		const title = notification.type.replace(/_/g, ' ').toUpperCase();
		const text = [
			`${emoji} *ABF ${title}*`,
			'',
			`*Agent:* ${notification.agentId}`,
			`*Severity:* ${notification.severity}`,
			'',
			notification.message,
			'',
			`_Session: ${notification.sessionId} | ${notification.timestamp}_`,
		].join('\n');

		const res = await fetch(`${TELEGRAM_API}/bot${this.botToken}/sendMessage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chat_id: this.chatId,
				text,
				parse_mode: 'Markdown',
			}),
		});

		if (!res.ok) {
			throw new Error(`Telegram sendMessage failed: ${res.status} ${res.statusText}`);
		}
	}
}
