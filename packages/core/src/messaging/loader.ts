/**
 * Messaging plugin loader — reads interfaces/*.interface.yaml and instantiates plugins.
 * Supports env var expansion: ${VAR} or ${VAR:-default}
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { interfaceConfigSchema } from '../schemas/interface.schema.js';
import type { IMessagingPlugin } from './interfaces.js';
import { SlackPlugin } from './slack.js';
import { EmailPlugin } from './email.js';
import { DiscordPlugin } from './discord.js';
import { MessagingRouter } from './router.js';
import type { PluginWithConfig } from './router.js';
import { createLogger } from '../util/logger.js';

const logger = createLogger({ level: 'info', format: 'json', name: 'messaging:loader' });

export async function loadMessagingRouter(interfacesDir: string): Promise<MessagingRouter> {
	let entries: string[];
	try {
		entries = await readdir(interfacesDir);
	} catch {
		return new MessagingRouter([]); // interfaces/ dir may not exist
	}

	const pluginEntries: PluginWithConfig[] = [];
	const interfaceFiles = entries.filter((f) => f.endsWith('.interface.yaml'));

	for (const filename of interfaceFiles) {
		const filePath = join(interfacesDir, filename);
		try {
			const raw = await readFile(filePath, 'utf-8');
			// Expand env vars: ${VAR} or ${VAR:-default}
			const expanded = raw.replace(
				/\$\{([^}:]+)(?::-([^}]*))?\}/g,
				(_match, name: string, fallback: string | undefined) => {
					return process.env[name] ?? fallback ?? '';
				},
			);
			const parsed = interfaceConfigSchema.safeParse(parseYaml(expanded));
			if (!parsed.success) {
				logger.warn({ file: filename, errors: parsed.error.errors }, 'Invalid interface config');
				continue;
			}
			const config = parsed.data;
			let plugin: IMessagingPlugin;
			if (config.type === 'slack') {
				plugin = new SlackPlugin(config);
			} else if (config.type === 'email') {
				plugin = new EmailPlugin(config);
			} else {
				plugin = new DiscordPlugin(config);
			}
			pluginEntries.push({ plugin, config });
			logger.info({ type: config.type, file: filename }, 'Loaded messaging plugin');
		} catch (error) {
			logger.error({ file: filename, error }, 'Failed to load interface config');
		}
	}

	return new MessagingRouter(pluginEntries);
}
