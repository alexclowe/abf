/**
 * Channel Gateway Factory — creates channel gateways from config.
 */

import type { ICredentialVault } from '../credentials/index.js';
import type { ChannelType, IChannelGateway } from './interfaces.js';

export interface ChannelGatewayConfig {
	readonly type: ChannelType;
	readonly token?: string | undefined;
	readonly webhookUrl?: string | undefined;
	readonly smtp?: {
		readonly host: string;
		readonly port: number;
		readonly user: string;
		readonly pass: string;
	} | undefined;
}

/**
 * Create a channel gateway instance from config.
 * Dynamically imports the appropriate gateway class.
 */
export async function createChannelGateway(
	config: ChannelGatewayConfig,
	_vault: ICredentialVault,
): Promise<IChannelGateway | null> {
	try {
		switch (config.type) {
			case 'telegram': {
				const { TelegramGateway } = await import('./telegram.js');
				return new TelegramGateway(config.token ?? '');
			}
			case 'slack': {
				const { SlackChannelGateway } = await import('./slack-gateway.js');
				return new SlackChannelGateway(config.token ?? '');
			}
			case 'discord': {
				const { DiscordChannelGateway } = await import('./discord-gateway.js');
				return new DiscordChannelGateway(config.token ?? '');
			}
			case 'email': {
				const { EmailChannelGateway } = await import('./email-gateway.js');
				return new EmailChannelGateway(config.smtp ?? { host: '', port: 587, user: '', pass: '' });
			}
			default:
				return null;
		}
	} catch {
		// Gateway module not available — skip silently
		return null;
	}
}
