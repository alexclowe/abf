/**
 * MessagingRouter — routes notifications to eligible plugins based on type/severity filters.
 */

import type { IMessagingPlugin, AgentNotification, PluginConfig } from './interfaces.js';
import { createLogger } from '../util/logger.js';

const logger = createLogger({ level: 'info', format: 'json', name: 'messaging:router' });

export interface PluginWithConfig {
	readonly plugin: IMessagingPlugin;
	readonly config: Pick<PluginConfig, 'notifyOn' | 'severity'>;
}

export class MessagingRouter {
	constructor(private readonly entries: readonly PluginWithConfig[]) {}

	async send(notification: AgentNotification): Promise<void> {
		if (this.entries.length === 0) return;

		const eligible = this.entries.filter(({ config }) =>
			(config.notifyOn as readonly string[]).includes(notification.type) &&
			(config.severity as readonly string[]).includes(notification.severity),
		);

		await Promise.allSettled(
			eligible.map(async ({ plugin }) => {
				try {
					await plugin.send(notification);
				} catch (error) {
					logger.error({ plugin: plugin.type, error }, 'Messaging plugin send failed');
				}
			}),
		);
	}

	get hasPlugins(): boolean {
		return this.entries.length > 0;
	}
}
