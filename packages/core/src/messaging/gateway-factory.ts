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
 * Module paths for each channel type.
 * Kept as a map so TypeScript doesn't statically analyze the import paths
 * (the gateway modules are optional and may not be installed).
 */
const GATEWAY_MODULES: Record<ChannelType, string> = {
	telegram: './telegram.js',
	slack: './slack-gateway.js',
	discord: './discord-gateway.js',
	email: './email-gateway.js',
};

/** Export class names expected from each gateway module. */
const GATEWAY_CLASSES: Record<ChannelType, string> = {
	telegram: 'TelegramGateway',
	slack: 'SlackChannelGateway',
	discord: 'DiscordChannelGateway',
	email: 'EmailChannelGateway',
};

/**
 * Create a channel gateway instance from config.
 * Dynamically imports the appropriate gateway class.
 * Returns null if the module is not available.
 */
export async function createChannelGateway(
	config: ChannelGatewayConfig,
	_vault: ICredentialVault,
): Promise<IChannelGateway | null> {
	const modulePath = GATEWAY_MODULES[config.type];
	const className = GATEWAY_CLASSES[config.type];
	if (!modulePath || !className) return null;

	try {
		// Dynamic import via variable path — TS won't resolve these at type-check time
		const mod = (await import(modulePath)) as Record<string, new (...args: unknown[]) => IChannelGateway>;
		const GatewayClass = mod[className];
		if (!GatewayClass) return null;

		if (config.type === 'email') {
			return new GatewayClass(config.smtp ?? { host: '', port: 587, user: '', pass: '' });
		}
		return new GatewayClass(config.token ?? '');
	} catch {
		// Gateway module not available — skip silently
		return null;
	}
}
