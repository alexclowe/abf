/**
 * Channel routes — CRUD for messaging channels and routing rules.
 *
 * GET    /api/channels         — list channels with connection status
 * POST   /api/channels/:type   — configure a channel (store token in vault)
 * DELETE /api/channels/:type   — disconnect a channel
 * GET    /api/channels/routes  — list routing rules
 * POST   /api/channels/routes  — add/update routing rules
 */

import type { Hono } from 'hono';
import type { ICredentialVault } from '../../credentials/vault.js';
import type { ChannelRouter } from '../../messaging/channel-router.js';
import type { ChannelType } from '../../messaging/interfaces.js';

export interface ChannelRoutesDeps {
	readonly vault: ICredentialVault;
	readonly channelRouter: ChannelRouter;
}

const VALID_CHANNEL_TYPES: readonly ChannelType[] = ['slack', 'discord', 'telegram', 'email'];

export function registerChannelRoutes(app: Hono, deps: ChannelRoutesDeps): void {
	// List all channels with status
	app.get('/api/channels', (c) => {
		const statuses = deps.channelRouter.getStatus();
		const channels = VALID_CHANNEL_TYPES.map((type) => {
			const status = statuses.find((s) => s.type === type);
			return {
				type,
				connected: status?.connected ?? false,
				configured: status !== undefined,
			};
		});
		return c.json(channels);
	});

	// Configure a channel
	app.post('/api/channels/:type', async (c) => {
		const type = c.req.param('type') as ChannelType;
		if (!VALID_CHANNEL_TYPES.includes(type)) {
			return c.json({ error: `Invalid channel type: ${type}` }, 400);
		}

		const body = await c.req.json<{ token?: string; webhookUrl?: string; config?: Record<string, unknown> }>().catch(() => ({}));
		if (!body.token && !body.webhookUrl) {
			return c.json({ error: 'Either token or webhookUrl is required' }, 400);
		}

		// Store credentials in vault
		try {
			await deps.vault.set('channel', type, JSON.stringify(body));
		} catch {
			return c.json({ error: 'Failed to store channel credentials' }, 500);
		}

		return c.json({ success: true, type, message: `${type} channel configured. Restart to connect.` });
	});

	// Disconnect a channel
	app.delete('/api/channels/:type', async (c) => {
		const type = c.req.param('type') as ChannelType;
		if (!VALID_CHANNEL_TYPES.includes(type)) {
			return c.json({ error: `Invalid channel type: ${type}` }, 400);
		}

		await deps.vault.delete('channel', type);
		return c.json({ success: true, type, message: `${type} channel disconnected.` });
	});

	// List routing rules
	app.get('/api/channels/routes', (c) => {
		return c.json(deps.channelRouter.getRoutes());
	});

	// Add/update routing rules
	app.post('/api/channels/routes', async (c) => {
		const body = await c.req.json<{
			routes: Array<{ channel: ChannelType; agent: string; pattern?: string; respondInChannel?: boolean }>;
		}>().catch(() => ({ routes: [] }));

		if (!body.routes || !Array.isArray(body.routes)) {
			return c.json({ error: 'routes array is required' }, 400);
		}

		const routes = body.routes.map((r) => ({
			channel: r.channel,
			agent: r.agent,
			pattern: r.pattern,
			respondInChannel: r.respondInChannel ?? true,
		}));

		deps.channelRouter.setRoutes(routes);
		return c.json({ success: true, count: routes.length });
	});
}
