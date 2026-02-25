/**
 * Discord messaging plugin — sends notifications via Discord webhook.
 */

import type { IMessagingPlugin, AgentNotification, DiscordPluginConfig } from './interfaces.js';
import { createLogger } from '../util/logger.js';

const logger = createLogger({ level: 'info', format: 'json', name: 'messaging:discord' });

const SEVERITY_COLOR: Record<string, number> = {
	info: 0x3498db,
	warn: 0xf39c12,
	error: 0xe74c3c,
	critical: 0x8e44ad,
};

export class DiscordPlugin implements IMessagingPlugin {
	readonly type = 'discord' as const;

	constructor(private readonly config: DiscordPluginConfig) {}

	async send(notification: AgentNotification): Promise<void> {
		const color = SEVERITY_COLOR[notification.severity] ?? 0x95a5a6;
		const payload = {
			username: this.config.username ?? 'ABF Runtime',
			embeds: [
				{
					title: `${notification.type.replace('_', ' ').toUpperCase()} -- ${notification.agentId}`,
					description: notification.message,
					color,
					fields: [
						{ name: 'Severity', value: notification.severity, inline: true },
						{ name: 'Session', value: notification.sessionId as string, inline: true },
					],
					timestamp: notification.timestamp as string,
				},
			],
		};

		const res = await fetch(this.config.webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});

		if (!res.ok) {
			logger.error({ status: res.status }, 'Discord webhook failed');
			throw new Error(`Discord webhook returned ${res.status}`);
		}
		logger.info({ agentId: notification.agentId, type: notification.type }, 'Discord notification sent');
	}
}
