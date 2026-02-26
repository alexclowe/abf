/**
 * SSE Events route — pushes real-time snapshots to the dashboard.
 * Replaces per-page SWR polling with a single persistent connection.
 */

import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { GatewayDeps } from './http.gateway.js';

const ABF_VERSION = '1.0.0';

export function registerEventRoutes(app: Hono, deps: GatewayDeps): void {
	app.get('/api/events', (c) => {
		// SSE auth: EventSource can't send headers, so accept token as query param
		const apiKey = process.env['ABF_API_KEY'];
		if (apiKey) {
			const token = c.req.query('token');
			const authHeader = c.req.header('Authorization');
			const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
			if (token !== apiKey && headerToken !== apiKey) {
				return c.json({ error: 'Unauthorized' }, 401);
			}
		}

		return streamSSE(c, async (stream) => {
			let id = 0;
			while (!stream.aborted) {
				const snapshot = buildSnapshot(deps);
				await stream.writeSSE({
					event: 'snapshot',
					data: JSON.stringify(snapshot),
					id: String(id++),
				});
				await stream.sleep(2000);
			}
		});
	});
}

function buildSnapshot(deps: GatewayDeps): Record<string, unknown> {
	const mc = deps.metricsCollector;
	const dispatcher = deps.dispatcher;

	return {
		status: {
			version: ABF_VERSION,
			uptime: process.uptime(),
			agents: deps.agentsMap.size,
		},
		runtime: mc?.collect() ?? {
			activeSessions: dispatcher.getActiveSessions().length,
			agentCount: deps.agentsMap.size,
			totalEscalations: dispatcher.getEscalations().length,
			resolvedEscalations: dispatcher.getEscalations().filter((e) => e.resolved).length,
		},
		agents: mc?.collectAgentStates() ?? [],
		escalations: dispatcher.getEscalations(),
	};
}
