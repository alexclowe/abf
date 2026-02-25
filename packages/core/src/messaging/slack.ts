/**
 * Slack messaging plugin — sends notifications via Slack webhook.
 */

import type { IMessagingPlugin, AgentNotification, SlackPluginConfig } from './interfaces.js';
import { createLogger } from '../util/logger.js';

const logger = createLogger({ level: 'info', format: 'json', name: 'messaging:slack' });

const SEVERITY_EMOJI: Record<string, string> = {
	info: 'i',
	warn: '!',
	error: 'X',
	critical: '!!',
};

export class SlackPlugin implements IMessagingPlugin {
	readonly type = 'slack' as const;

	constructor(private readonly config: SlackPluginConfig) {}

	async send(notification: AgentNotification): Promise<void> {
		const emoji = SEVERITY_EMOJI[notification.severity] ?? '*';
		const payload = {
			...(this.config.channel !== undefined ? { channel: this.config.channel } : {}),
			text: `[${emoji}] *ABF Alert* [${notification.type.toUpperCase()}]`,
			blocks: [
				{
					type: 'header',
					text: {
						type: 'plain_text',
						text: `[${emoji}] ${notification.type.replace('_', ' ').toUpperCase()}`,
					},
				},
				{
					type: 'section',
					fields: [
						{ type: 'mrkdwn', text: `*Agent:*\n${notification.agentId}` },
						{ type: 'mrkdwn', text: `*Severity:*\n${notification.severity}` },
					],
				},
				{
					type: 'section',
					text: { type: 'mrkdwn', text: notification.message },
				},
				{
					type: 'context',
					elements: [
						{ type: 'mrkdwn', text: `Session: ${notification.sessionId} | ${notification.timestamp}` },
					],
				},
			],
		};

		const res = await fetch(this.config.webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});

		if (!res.ok) {
			logger.error({ status: res.status }, 'Slack webhook failed');
			throw new Error(`Slack webhook returned ${res.status}`);
		}
		logger.info({ agentId: notification.agentId, type: notification.type }, 'Slack notification sent');
	}
}
