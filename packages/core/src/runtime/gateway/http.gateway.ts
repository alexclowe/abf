/**
 * HTTP Gateway — full REST API using Hono.
 * Serves Dashboard API, webhooks, and management endpoints.
 */

import type { ServerType } from '@hono/node-server';
import { serve } from '@hono/node-server';
import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { loadTeamConfigs } from '../../config/loader.js';
import { BUILTIN_ARCHETYPES } from '../../archetypes/registry.js';
import type { AgentConfig } from '../../types/agent.js';
import type { AgentId, ISOTimestamp } from '../../types/common.js';
import type { GatewayConfig } from '../../types/config.js';
import type { IMemoryStore } from '../../types/memory.js';
import type { IBus } from '../../types/message.js';
import type { IProviderRegistry } from '../../types/provider.js';
import type { IAuditStore } from '../../types/security.js';
import { createActivationId, toISOTimestamp } from '../../util/id.js';
import type { IApprovalStore } from '../../types/approval.js';
import type { ICredentialVault } from '../../credentials/vault.js';
import type { IGateway, IDispatcher, IScheduler } from '../interfaces.js';
import { registerAuthRoutes } from './auth.routes.js';
import { registerSeedRoutes } from './seed.routes.js';
import { registerEventRoutes } from './events.routes.js';
import { registerSetupRoutes } from './setup.routes.js';

/** Timing-safe API key comparison to prevent timing attacks. */
const ABF_VERSION = '1.0.0';

function isValidApiKey(received: string | undefined, required: string): boolean {
	if (!received) return false;
	const expected = `Bearer ${required}`;
	if (received.length !== expected.length) return false;
	return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export interface GatewayDeps {
	readonly agentsMap: ReadonlyMap<string, AgentConfig>;
	readonly dispatcher: IDispatcher;
	readonly memoryStore: IMemoryStore;
	readonly bus: IBus;
	readonly auditStore: IAuditStore;
	readonly providerRegistry: IProviderRegistry;
	readonly projectRoot: string;
	readonly teamsDir: string;
	readonly onWebhook?: ((path: string, body: unknown) => Promise<unknown>) | undefined;
	readonly workflowsDir?: string | undefined;
	readonly workflowRunner?: import('../workflow-runner.js').WorkflowRunner | undefined;
	readonly approvalStore?: IApprovalStore | undefined;
	readonly inbox?: import('../../types/inbox.js').IInbox | undefined;
	readonly metricsCollector?: import('../../metrics/collector.js').MetricsCollector | undefined;
	readonly vault?: ICredentialVault | undefined;
	readonly scheduler?: IScheduler | undefined;
}

/** @deprecated Use GatewayDeps instead. Kept for backwards compatibility. */
export type GatewayHandlers = GatewayDeps;

export class HttpGateway implements IGateway {
	private server: ServerType | null = null;
	readonly port: number;
	private readonly app: Hono;
	private readonly workflowRuns = new Map<string, import('../../types/workflow.js').WorkflowRun>();
	private providerCache: { data: unknown; expiresAt: number } | null = null;

	constructor(
		private readonly config: GatewayConfig,
		private readonly deps: GatewayDeps,
	) {
		this.port = config.port;
		this.app = new Hono();
		this.registerRoutes();
	}

	private registerRoutes(): void {
		const { app, deps } = this;
		const workflowRuns = this.workflowRuns;
		const providerCacheRef = { current: this.providerCache };

		// CORS — configurable origins (defaults to localhost dev ports)
		const allowedOrigins = process.env['ABF_CORS_ORIGINS']
			? process.env['ABF_CORS_ORIGINS'].split(',').map((s) => s.trim())
			: ['http://localhost:3000', 'http://localhost:3001'];

		app.use(
			'*',
			cors({
				origin: (origin) =>
					allowedOrigins.includes(origin) ? origin : (allowedOrigins[0] ?? ''),
				allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
				allowHeaders: ['Content-Type', 'Authorization'],
			}),
		);

		// Auth middleware — protects /api/*, /webhook/*, and /auth/* if ABF_API_KEY env var is set
		app.use('/api/*', async (c, next) => {
			const requiredKey = process.env['ABF_API_KEY'];
			if (!requiredKey) return next();
			if (!isValidApiKey(c.req.header('Authorization'), requiredKey)) {
				return c.json(
					{ error: 'Unauthorized. Set Authorization: Bearer {ABF_API_KEY}' },
					401,
				);
			}
			return next();
		});
		app.use('/webhook/*', async (c, next) => {
			const requiredKey = process.env['ABF_API_KEY'];
			if (!requiredKey) return next();
			if (!isValidApiKey(c.req.header('Authorization'), requiredKey)) {
				return c.json({ error: 'Unauthorized' }, 401);
			}
			return next();
		});
		// Protect /auth/* routes when ABF_API_KEY is configured (allow unauthenticated during first-time setup)
		app.use('/auth/*', async (c, next) => {
			const requiredKey = process.env['ABF_API_KEY'];
			if (!requiredKey) return next();
			if (!isValidApiKey(c.req.header('Authorization'), requiredKey)) {
				return c.json({ error: 'Unauthorized' }, 401);
			}
			return next();
		});

		// -- Auth routes ----------------------------------------------------------
		if (deps.vault) {
			registerAuthRoutes(app, { vault: deps.vault });
		}

		// -- Setup routes (project creation from wizard) --------------------------
		if (deps.scheduler) {
			registerSetupRoutes(app, { ...deps, scheduler: deps.scheduler });
		}

		// -- Seed routes (seed-to-company pipeline) --------------------------------
		if (deps.scheduler) {
			registerSeedRoutes(app, { ...deps, scheduler: deps.scheduler });
		}

		// -- SSE Events -----------------------------------------------------------
		registerEventRoutes(app, deps);

		// -- Health ---------------------------------------------------------------
		app.get('/health', (c) => {
			const active = deps.dispatcher.getActiveSessions().length;
			return c.json({
				status: 'ok',
				agents: deps.agentsMap.size,
				activeSessions: active,
				uptime: process.uptime(),
			});
		});

		// -- Status ---------------------------------------------------------------
		app.get('/api/status', (c) =>
			c.json({
				version: ABF_VERSION,
				uptime: process.uptime(),
				name: 'ABF Runtime',
				agents: deps.agentsMap.size,
				activeSessions: deps.dispatcher.getActiveSessions().length,
				configured: deps.agentsMap.size > 0,
			}),
		);

		// -- Agents ---------------------------------------------------------------
		app.get('/api/agents', (c) => {
			const agents = [...deps.agentsMap.values()].map((cfg) => ({
				config: cfg,
				state: deps.dispatcher.getAgentState(cfg.id),
			}));
			return c.json(agents);
		});

		app.get('/api/agents/:id', async (c) => {
			const id = c.req.param('id') as AgentId;
			const cfg = deps.agentsMap.get(id);
			if (!cfg) return c.json({ error: 'Agent not found' }, 404);
			const state = deps.dispatcher.getAgentState(id);
			const memResult = await deps.memoryStore.loadContext(id);
			const memory = memResult.ok ? memResult.value : null;
			return c.json({ config: cfg, state, memory });
		});

		app.get('/api/agents/:id/memory', async (c) => {
			const id = c.req.param('id') as AgentId;
			if (!deps.agentsMap.has(id)) return c.json({ error: 'Agent not found' }, 404);
			const result = await deps.memoryStore.loadContext(id);
			if (!result.ok) return c.json({ error: result.error.message }, 500);
			return c.json(result.value);
		});

		app.post('/api/agents/:id/run', async (c) => {
			const id = c.req.param('id') as AgentId;
			const cfg = deps.agentsMap.get(id);
			if (!cfg) return c.json({ error: 'Agent not found' }, 404);

			const body = await c.req.json<{ task?: string; payload?: Record<string, unknown> }>();
			const task = body.task ?? 'manual';

			const activation = {
				id: createActivationId(),
				agentId: id,
				trigger: { type: 'manual' as const, task },
				timestamp: toISOTimestamp(),
				payload: body.payload,
			};

			const result = await deps.dispatcher.dispatch(activation);
			if (!result.ok) return c.json({ error: result.error.message }, 400);
			return c.json({ sessionId: result.value }, 202);
		});

		// -- Sessions -------------------------------------------------------------
		app.get('/api/sessions', (c) => {
			return c.json(deps.dispatcher.getActiveSessions());
		});

		app.get('/api/sessions/:id', (c) => {
			const result = deps.dispatcher.getSessionResult(c.req.param('id') as import('../../types/common.js').SessionId);
			if (!result) return c.json({ error: 'Session not found' }, 404);
			return c.json(result);
		});

		// -- Teams ----------------------------------------------------------------
		app.get('/api/teams', async (c) => {
			const result = await loadTeamConfigs(deps.teamsDir);
			if (!result.ok) return c.json([]);
			return c.json(result.value);
		});

		// -- Messages -------------------------------------------------------------
		app.get('/api/messages/:agentId', async (c) => {
			const agentId = c.req.param('agentId') as AgentId;
			const [pending, history] = await Promise.all([
				deps.bus.getPending(agentId),
				deps.bus.getHistory(agentId, 50),
			]);
			return c.json({ pending, history });
		});

		// -- Audit ----------------------------------------------------------------
		app.get('/api/audit', async (c) => {
			const { agentId, since, limit } = c.req.query();
			const filter: {
				agentId?: AgentId;
				since?: ISOTimestamp;
				limit?: number;
			} = {};
			if (agentId) filter.agentId = agentId as AgentId;
			if (since) filter.since = since as ISOTimestamp;
			filter.limit = limit ? Number(limit) : 100;

			const result = await deps.auditStore.query(filter);
			if (!result.ok) return c.json({ error: result.error.message }, 500);
			return c.json(result.value);
		});

		// -- Escalations ----------------------------------------------------------
		app.get('/api/escalations', (c) => {
			return c.json(deps.dispatcher.getEscalations());
		});

		app.post('/api/escalations/:id/resolve', (c) => {
			const found = deps.dispatcher.resolveEscalation(c.req.param('id'));
			if (!found) return c.json({ error: 'Escalation not found' }, 404);
			return c.json({ resolved: true });
		});

		// -- KPIs -----------------------------------------------------------------
		app.get('/api/kpis', (c) => {
			const { agentId, metric, limit } = c.req.query();
			let reports = agentId
				? deps.dispatcher.getKPIHistory(agentId as AgentId)
				: deps.dispatcher.getKPIHistory();
			if (metric) {
				reports = reports.filter((r) => r.metric.toLowerCase().includes(metric.toLowerCase()));
			}
			const limitN = limit ? Number(limit) : 200;
			return c.json([...reports].slice(-limitN));
		});

		// -- Approvals ------------------------------------------------------------
		if (deps.approvalStore) {
			const store = deps.approvalStore;

			app.get('/api/approvals', (c) => {
				const { status, agentId } = c.req.query();
				const filter: { status?: 'pending' | 'approved' | 'rejected'; agentId?: AgentId } = {};
				if (status === 'pending' || status === 'approved' || status === 'rejected') {
					filter.status = status;
				}
				if (agentId) filter.agentId = agentId as AgentId;
				return c.json(store.list(filter));
			});

			app.get('/api/approvals/:id', (c) => {
				const item = store.get(c.req.param('id'));
				if (!item) return c.json({ error: 'Approval not found' }, 404);
				return c.json(item);
			});

			app.post('/api/approvals/:id/approve', (c) => {
				const found = store.approve(c.req.param('id'), 'operator');
				if (!found) return c.json({ error: 'Approval not found or already resolved' }, 404);
				return c.json({ approved: true });
			});

			app.post('/api/approvals/:id/reject', (c) => {
				const found = store.reject(c.req.param('id'), 'operator');
				if (!found) return c.json({ error: 'Approval not found or already resolved' }, 404);
				return c.json({ rejected: true });
			});
		}

		// -- Providers ------------------------------------------------------------
		app.get('/api/providers', async (c) => {
			// Return cached response if still fresh (1 hour TTL)
			if (providerCacheRef.current !== null && Date.now() < providerCacheRef.current.expiresAt) {
				return c.json(providerCacheRef.current.data);
			}

			const providers = deps.providerRegistry.getAll();
			const statuses = await Promise.all(
				providers.map(async (p) => {
					let models: readonly import('../../types/provider.js').ModelInfo[] = [];
					try {
						models = await p.models();
					} catch {
						models = [];
					}
					return { id: p.id, name: p.name, slug: p.slug, authType: p.authType, models };
				}),
			);

			// Cache for 1 hour
			providerCacheRef.current = { data: statuses, expiresAt: Date.now() + 3_600_000 };
			return c.json(statuses);
		});

		// -- Archetypes -----------------------------------------------------------
		app.get('/api/archetypes', (c) => {
			return c.json(
				Object.entries(BUILTIN_ARCHETYPES).map(([name, defaults]) => ({
					name,
					temperature: defaults.temperature,
					tools: defaults.tools,
					allowedActions: defaults.allowedActions,
					forbiddenActions: defaults.forbiddenActions,
				})),
			);
		});

		// -- Workflow Templates ----------------------------------------------------
		app.get('/api/workflow-templates', async (c) => {
			const { BUILTIN_WORKFLOW_TEMPLATES } = await import('../../workflows/templates.js');
			return c.json(
				BUILTIN_WORKFLOW_TEMPLATES.map((t) => ({
					name: t.name,
					displayName: t.displayName,
					description: t.description,
					pattern: t.pattern,
					stepsCount: t.steps.length,
				})),
			);
		});

		// -- Metrics --------------------------------------------------------------
		if (deps.metricsCollector) {
			const mc = deps.metricsCollector;
			app.get('/api/metrics/runtime', (c) => c.json(mc.collect()));
			app.get('/api/metrics/agents', (c) => c.json(mc.collectAgentStates()));
			app.get('/api/metrics/kpis', (c) => {
				const agentId = c.req.query('agentId');
				return c.json(mc.collectKPIs(agentId));
			});
		}

		// -- Agent Inbox ----------------------------------------------------------
		if (deps.inbox) {
			const inbox = deps.inbox;
			app.get('/api/agents/:id/inbox', (c) => {
				const agentId = c.req.param('id') as AgentId;
				const items = inbox.peek(agentId);
				return c.json(items);
			});

			app.post('/api/agents/:id/inbox', async (c) => {
				const agentId = c.req.param('id') as AgentId;
				const body = (await c.req.json()) as {
					subject: string;
					body: string;
					priority?: string;
					from?: string;
				};
				const id = inbox.push({
					agentId,
					source: 'human',
					priority: (body.priority as 'low' | 'normal' | 'high' | 'urgent') ?? 'normal',
					subject: body.subject,
					body: body.body,
					...(body.from != null && { from: body.from }),
				});
				return c.json({ id, queued: true });
			});
		}

		// -- Webhook passthrough --------------------------------------------------
		app.post('/webhook/*', async (c) => {
			const path = c.req.path.slice('/webhook/'.length);
			const body = await c.req.json().catch(() => null);
			if (deps.onWebhook) {
				const result = await deps.onWebhook(path, body);
				return c.json(result ?? { received: true });
			}
			return c.json({ received: true });
		});

		// -- Workflows ------------------------------------------------------------
		app.get('/api/workflows', async (c) => {
			if (!deps.workflowsDir) return c.json([]);
			const { loadWorkflowConfigs } = await import('../../config/loader.js');
			const result = await loadWorkflowConfigs(deps.workflowsDir);
			return c.json(result.ok ? result.value : []);
		});

		// Static prefix route must come BEFORE dynamic :name to avoid "runs" matching as :name
		app.get('/api/workflows/runs/:runId', (c) => {
			const run = workflowRuns.get(c.req.param('runId'));
			if (!run) return c.json({ error: 'Run not found' }, 404);
			return c.json(run);
		});

		app.get('/api/workflows/:name', async (c) => {
			if (!deps.workflowsDir) return c.json({ error: 'Workflows not configured' }, 404);
			const { loadWorkflowConfigs } = await import('../../config/loader.js');
			const result = await loadWorkflowConfigs(deps.workflowsDir);
			if (!result.ok) return c.json({ error: 'Failed to load workflows' }, 500);
			const wf = result.value.find((w) => w.name === c.req.param('name'));
			if (!wf) return c.json({ error: 'Workflow not found' }, 404);
			return c.json(wf);
		});

		app.post('/api/workflows/:name/run', async (c) => {
			if (!deps.workflowRunner || !deps.workflowsDir) {
				return c.json({ error: 'Workflows not configured' }, 501);
			}
			const { loadWorkflowConfigs } = await import('../../config/loader.js');
			const result = await loadWorkflowConfigs(deps.workflowsDir);
			if (!result.ok) return c.json({ error: 'Failed to load workflows' }, 500);
			const wf = result.value.find((w) => w.name === c.req.param('name'));
			if (!wf) return c.json({ error: 'Workflow not found' }, 404);

			const body = await c.req.json<{ input?: Record<string, unknown> }>().catch((): { input?: Record<string, unknown> } => ({}));
			const { nanoid } = await import('nanoid');
			const runId = nanoid();

			void deps.workflowRunner.run(wf, body.input ?? {}).then((run) => {
				workflowRuns.set(runId, run);
				if (workflowRuns.size > 100) {
					const first = workflowRuns.keys().next().value;
					if (first !== undefined) workflowRuns.delete(first);
				}
			});

			return c.json({ runId }, 202);
		});

		// 404 fallback
		app.notFound((c) => c.json({ error: 'Not found' }, 404));
	}

	async start(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			try {
				this.server = serve(
					{
						fetch: this.app.fetch,
						port: this.port,
						hostname: this.config.host,
					},
					() => resolve(),
				);
				(this.server as unknown as { on: (e: string, cb: (err: Error) => void) => void }).on(
					'error',
					reject,
				);
			} catch (err) {
				reject(err);
			}
		});
	}

	async stop(): Promise<void> {
		return new Promise<void>((resolve) => {
			if (!this.server) {
				resolve();
				return;
			}
			this.server.close(() => resolve());
		});
	}
}
