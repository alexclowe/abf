/**
 * SSE Events route — pushes real-time snapshots to the dashboard.
 * Replaces per-page SWR polling with a single persistent connection.
 *
 * Optimizations:
 * - Delta-based: only sends when snapshot hash changes
 * - Adaptive interval: 2s when sessions active, 5s when idle
 * - Heartbeat every 30s to keep connection alive
 * - Agent charters stripped (clients fetch on demand via /api/agents/:id)
 */

import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { GatewayDeps } from './http.gateway.js';
import { isValidApiKey } from './auth-utils.js';

const ABF_VERSION = '1.0.0';
const IDLE_INTERVAL_MS = 5000;
const ACTIVE_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 30_000;

export function registerEventRoutes(app: Hono, deps: GatewayDeps): void {
	app.get('/api/events', (c) => {
		// SSE auth: EventSource can't send headers, so accept token as query param
		const apiKey = process.env['ABF_API_KEY'];
		if (apiKey) {
			const token = c.req.query('token');
			const authHeader = c.req.header('Authorization');
			// Use timing-safe comparison for both token and header
			const tokenValid = token ? isValidApiKey(`Bearer ${token}`, apiKey) : false;
			const headerValid = isValidApiKey(authHeader, apiKey);
			if (!tokenValid && !headerValid) {
				return c.json({ error: 'Unauthorized' }, 401);
			}
		}

		return streamSSE(c, async (stream) => {
			let id = 0;
			let lastHash = '';
			let lastHeartbeat = Date.now();

			while (!stream.aborted) {
				const snapshot = buildSnapshot(deps);
				const json = JSON.stringify(snapshot);
				const hash = createHash('md5').update(json).digest('hex');

				// Only send if snapshot changed (delta-based)
				if (hash !== lastHash) {
					lastHash = hash;
					await stream.writeSSE({
						event: 'snapshot',
						data: json,
						id: String(id++),
					});
				}

				// Send heartbeat every 30s for connection keep-alive
				const now = Date.now();
				if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
					lastHeartbeat = now;
					await stream.writeSSE({
						event: 'heartbeat',
						data: JSON.stringify({ ts: now }),
						id: String(id++),
					});
				}

				// Adaptive interval: faster when sessions active
				const hasActiveSessions = deps.dispatcher.getActiveSessions().length > 0;
				await stream.sleep(hasActiveSessions ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS);
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
			activeSessions: dispatcher.getActiveSessions().length,
			configured: deps.agentsMap.size > 0,
		},
		runtime: mc?.collect() ?? {
			activeSessions: dispatcher.getActiveSessions().length,
			agentCount: deps.agentsMap.size,
			totalEscalations: dispatcher.getEscalations().length,
			resolvedEscalations: dispatcher.getEscalations().filter((e) => e.resolved).length,
		},
		// Agent list with charter stripped (clients fetch full config on demand)
		agents: [...deps.agentsMap.values()].map((cfg) => ({
			config: { ...cfg, charter: undefined },
			state: dispatcher.getAgentState(cfg.id),
		})),
		// Flat agent states for the metrics page
		agentStates: mc?.collectAgentStates() ?? [],
		sessions: dispatcher.getActiveSessions(),
		escalations: dispatcher.getEscalations(),
		agentMessages: deps.operatorChannel?.getRecentMessages().map((m) => ({
			conversationId: `agent-${m.sessionId}`,
			agentId: m.agentId,
			agentName: m.agentDisplayName,
			title: m.task,
			content: m.content.slice(0, 200),
			timestamp: new Date(m.timestamp).getTime(),
			source: m.source,
		})) ?? [],
	};
}
