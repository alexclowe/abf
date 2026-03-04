/**
 * OperatorNotifier — dispatches notifications to operators via their
 * configured channel (Slack, Discord, Telegram).
 *
 * Reads notification preferences from abf.config.yaml and secrets from
 * the encrypted vault. Notification failures are caught silently — they
 * must never block the approval/escalation flow.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ICredentialVault } from '../credentials/vault.js';
import type { AgentNotification } from './interfaces.js';

interface NotificationConfig {
	readonly onApproval: boolean;
	readonly onAlert: boolean;
	readonly onAgentMessage: boolean;
	readonly channel: string;
}

export class OperatorNotifier {
	constructor(
		private readonly projectRoot: string,
		private readonly vault: ICredentialVault,
	) {}

	async notify(notification: AgentNotification): Promise<void> {
		try {
			const config = await this.loadConfig();
			if (!config) return;

			// Check if notifications are enabled for this type
			if (notification.type === 'approval_required' && !config.onApproval) return;
			if ((notification.type === 'escalation' || notification.type === 'alert') && !config.onAlert) return;
			if (notification.type === 'agent_message' && !config.onAgentMessage) return;

			const channel = config.channel;
			if (!channel || channel === 'none') return;

			await this.dispatch(channel, notification);
		} catch {
			// Notification failure is non-fatal — never block the runtime
		}
	}

	private async dispatch(channel: string, notification: AgentNotification): Promise<void> {
		switch (channel) {
			case 'slack': {
				const webhookUrl = await this.vault.get('notifications', 'slack');
				if (!webhookUrl) return;
				const { SlackPlugin } = await import('./slack.js');
				const plugin = new SlackPlugin({
					type: 'slack',
					webhookUrl,
					notifyOn: [notification.type],
					severity: [notification.severity],
				});
				await plugin.send(notification);
				break;
			}
			case 'discord': {
				const webhookUrl = await this.vault.get('notifications', 'discord');
				if (!webhookUrl) return;
				const { DiscordPlugin } = await import('./discord.js');
				const plugin = new DiscordPlugin({
					type: 'discord',
					webhookUrl,
					notifyOn: [notification.type],
					severity: [notification.severity],
				});
				await plugin.send(notification);
				break;
			}
			case 'telegram': {
				const botToken = await this.vault.get('notifications', 'telegram_token');
				const chatId = await this.vault.get('notifications', 'telegram_chat_id');
				if (!botToken || !chatId) return;
				const { TelegramNotificationPlugin } = await import('./telegram-notify.js');
				const plugin = new TelegramNotificationPlugin(botToken, chatId);
				await plugin.send(notification);
				break;
			}
		}
	}

	private async loadConfig(): Promise<NotificationConfig | null> {
		const configPath = join(this.projectRoot, 'abf.config.yaml');
		if (!existsSync(configPath)) return null;
		try {
			const { parse } = await import('yaml');
			const raw = await readFile(configPath, 'utf-8');
			const parsed = parse(raw) as Record<string, unknown>;
			const notifications = (parsed?.['notifications'] ?? {}) as Record<string, unknown>;
			return {
				onApproval: Boolean(notifications['onApproval']),
				onAlert: Boolean(notifications['onAlert']),
				onAgentMessage: notifications['onAgentMessage'] !== false, // default ON
				channel: (notifications['channel'] as string) ?? 'none',
			};
		} catch {
			return null;
		}
	}
}
