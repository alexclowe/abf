/**
 * Messaging plugin interfaces.
 * Defines notification types and plugin contracts for Slack, Email, Discord.
 */

import type { AgentId, SessionId, ISOTimestamp } from '../types/common.js';

export type NotificationType = 'escalation' | 'alert' | 'session_complete' | 'approval_required';
export type NotificationSeverity = 'info' | 'warn' | 'error' | 'critical';
export type MessagingPluginType = 'slack' | 'email' | 'discord';

export interface AgentNotification {
	readonly type: NotificationType;
	readonly agentId: AgentId;
	readonly sessionId: SessionId;
	readonly message: string;
	readonly severity: NotificationSeverity;
	readonly context?: Readonly<Record<string, unknown>> | undefined;
	readonly timestamp: ISOTimestamp;
}

export interface IMessagingPlugin {
	readonly type: MessagingPluginType;
	send(notification: AgentNotification): Promise<void>;
}

// Base config fields shared by all plugins
export interface BasePluginConfig {
	readonly notifyOn: readonly NotificationType[];
	readonly severity: readonly NotificationSeverity[];
}

export interface SlackPluginConfig extends BasePluginConfig {
	readonly type: 'slack';
	readonly webhookUrl: string;
	readonly channel?: string | undefined;
}

export interface EmailPluginConfig extends BasePluginConfig {
	readonly type: 'email';
	readonly smtp: {
		readonly host: string;
		readonly port: number;
		readonly user: string;
		readonly pass: string;
	};
	readonly to: readonly string[];
	readonly from?: string | undefined;
}

export interface DiscordPluginConfig extends BasePluginConfig {
	readonly type: 'discord';
	readonly webhookUrl: string;
	readonly username?: string | undefined;
}

export type PluginConfig = SlackPluginConfig | EmailPluginConfig | DiscordPluginConfig;
