/**
 * HTTP Gateway — full REST API using Hono.
 * Serves Dashboard API, webhooks, and management endpoints.
 */

import type { ServerType } from '@hono/node-server';
import { serve } from '@hono/node-server';
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
import { registerCrudRoutes } from './crud.routes.js';
import { registerSeedRoutes } from './seed.routes.js';
import { registerEventRoutes } from './events.routes.js';
import { registerPlanRoutes } from './plans.routes.js';
import { registerSetupRoutes } from './setup.routes.js';
import { registerChannelRoutes } from './channel.routes.js';
import { registerBillingRoutes } from './billing.routes.js';
import { registerOAuthRoutes } from './oauth.routes.js';
import { isValidApiKey } from './auth-utils.js';
import { checkRateLimit } from './rate-limit.js';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';

const ABF_VERSION = '0.0.1';

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
	readonly dashboardPort?: number | undefined;
	readonly taskPlanStore?: import('../../types/task-plan.js').ITaskPlanStore | undefined;
	readonly channelRouter?: import('../../messaging/channel-router.js').ChannelRouter | undefined;
	readonly sessionEventBus?: import('../session-events.js').SessionEventBus | undefined;
	readonly billingLedger?: import('../../billing/types.js').IBillingLedger | undefined;
	readonly pluginRegistry?: import('./plugin-registry.js').PluginRegistry | undefined;
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

		// CORS — configurable origins (defaults to localhost dev ports + cloud platform URLs)
		const allowedOrigins = process.env['ABF_CORS_ORIGINS']
			? process.env['ABF_CORS_ORIGINS'].split(',').map((s) => s.trim())
			: (() => {
				const origins = ['http://localhost:3000', 'http://localhost:3001'];
				// Auto-detect cloud platform URLs
				const renderUrl = process.env['RENDER_EXTERNAL_URL'];
				if (renderUrl) origins.push(renderUrl);
				const railwayDomain = process.env['RAILWAY_PUBLIC_DOMAIN'];
				if (railwayDomain) origins.push(`https://${railwayDomain}`);
				return origins;
			})();

		app.use(
			'*',
			cors({
				origin: (origin) =>
					allowedOrigins.includes(origin) ? origin : (allowedOrigins[0] ?? ''),
				allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
				allowHeaders: ['Content-Type', 'Authorization'],
			}),
		);

		// Security headers middleware [I-01]
		app.use('*', async (c, next) => {
			await next();
			c.res.headers.set('X-Content-Type-Options', 'nosniff');
			c.res.headers.set('X-Frame-Options', 'DENY');
			c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
			c.res.headers.set('X-XSS-Protection', '1; mode=block');
		});

		// Rate limiting middleware [H-05]
		app.use('/api/*', async (c, next) => {
			const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
			const result = checkRateLimit(ip, c.req.path);
			if (!result.allowed) {
				c.res.headers.set('Retry-After', String(Math.ceil((result.resetAt - Date.now()) / 1000)));
				return c.json({ error: 'Too many requests' }, 429);
			}
			c.res.headers.set('X-RateLimit-Remaining', String(result.remaining));
			return next();
		});

		// CORS validation warning [M-03]
		if (process.env['ABF_CORS_ORIGINS']?.includes('*')) {
			console.warn('[gateway] WARNING: ABF_CORS_ORIGINS contains wildcard "*". This is insecure in production.');
		}

		// CSRF protection: enforce application/json on mutating API endpoints [M-05]
		app.use('/api/*', async (c, next) => {
			const method = c.req.method;
			if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
				const contentType = c.req.header('Content-Type') ?? '';
				// Allow requests with no body (DELETE often has no content-type) or JSON
				if (contentType && !contentType.includes('application/json')) {
					return c.json({ error: 'Content-Type must be application/json' }, 415);
				}
			}
			return next();
		});

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

		// -- CRUD routes (agents, teams, knowledge, workflows, monitors, etc.) ----
		if (deps.scheduler) {
			registerCrudRoutes(app, { ...deps, scheduler: deps.scheduler });
		}

		// -- Task Plans (R6) -------------------------------------------------------
		if (deps.taskPlanStore) {
			registerPlanRoutes(app, { taskPlanStore: deps.taskPlanStore, agentsMap: deps.agentsMap });
		}

		// -- Channel Routes (R10) -------------------------------------------------
		if (deps.channelRouter && deps.vault) {
			registerChannelRoutes(app, { vault: deps.vault, channelRouter: deps.channelRouter });
		}

		// -- Billing Routes -------------------------------------------------------
		if (deps.billingLedger) {
			registerBillingRoutes(app, { ledger: deps.billingLedger, providerRegistry: deps.providerRegistry });
		}

		// -- OAuth Routes ---------------------------------------------------------
		if (deps.vault) {
			registerOAuthRoutes(app, { vault: deps.vault, dashboardPort: deps.dashboardPort });
		}

		// -- SSE Events -----------------------------------------------------------
		registerEventRoutes(app, deps);

		// -- Session Observation SSE (R12) ----------------------------------------
		if (deps.sessionEventBus) {
			const eventBus = deps.sessionEventBus;

			// Stream all sessions for a specific agent
			app.get('/api/agents/:id/stream', (c) => {
				const agentId = c.req.param('id') as import('../../types/common.js').AgentId;
				if (!deps.agentsMap.has(agentId)) {
					return c.json({ error: 'Agent not found' }, 404);
				}

				return streamSSE(c, async (stream: SSEStreamingApi) => {
					let id = 0;
					const handler = (event: import('../session-events.js').SessionLifecycleEvent) => {
						void stream.writeSSE({
							event: event.type,
							data: JSON.stringify(event),
							id: String(id++),
						});
					};
					eventBus.on(`agent:${agentId}`, handler);
					stream.onAbort(() => { eventBus.off(`agent:${agentId}`, handler); });
					// Keep connection alive until aborted
					while (!stream.aborted) {
						await stream.sleep(30000);
					}
				});
			});

			// Stream a specific session
			app.get('/api/sessions/:id/stream', (c) => {
				const sessionId = c.req.param('id') as import('../../types/common.js').SessionId;

				return streamSSE(c, async (stream: SSEStreamingApi) => {
					let id = 0;
					const handler = (event: import('../session-events.js').SessionLifecycleEvent) => {
						void stream.writeSSE({
							event: event.type,
							data: JSON.stringify(event),
							id: String(id++),
						});
					};
					eventBus.on(`session:${sessionId}`, handler);
					stream.onAbort(() => { eventBus.off(`session:${sessionId}`, handler); });
					while (!stream.aborted) {
						await stream.sleep(30000);
					}
				});
			});
		}

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

		// -- Status (cached provider check for 30s) --------------------------------
		let statusCache: { data: unknown; expiresAt: number } | null = null;
		app.get('/api/status', async (c) => {
			// Return cached response if still fresh (30s TTL for provider status)
			if (statusCache && Date.now() < statusCache.expiresAt) {
				// Update dynamic fields (uptime, activeSessions) even from cache
				const cached = statusCache.data as Record<string, unknown>;
				return c.json({
					...cached,
					uptime: process.uptime(),
					activeSessions: deps.dispatcher.getActiveSessions().length,
					agents: deps.agentsMap.size,
					configured: deps.agentsMap.size > 0,
				});
			}

			const isCloud = Boolean(
				process.env['RENDER'] || process.env['RAILWAY_ENVIRONMENT'] || process.env['FLY_APP_NAME'],
			);

			// Check if any LLM provider is connected via env vars or vault
			let providerConnected = false;
			let connectedProvider: string | null = null;
			if (deps.vault) {
				for (const slug of ['anthropic', 'openai', 'ollama'] as const) {
					const key = await deps.vault.get(slug, 'api_key');
					if (key) {
						providerConnected = true;
						connectedProvider = slug;
						break;
					}
				}
			}

			const statusData = {
				version: ABF_VERSION,
				uptime: process.uptime(),
				name: 'ABF Runtime',
				agents: deps.agentsMap.size,
				activeSessions: deps.dispatcher.getActiveSessions().length,
				configured: deps.agentsMap.size > 0,
				isCloud,
				providerConnected,
				connectedProvider,
			};
			// Cache the provider check result for 30s
			statusCache = { data: statusData, expiresAt: Date.now() + 30_000 };
			return c.json(statusData);
		});

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

		// -- Generate Charter (AI) ------------------------------------------------
		app.post('/api/agents/generate-charter', async (c) => {
			const body = await c.req.json<{
				name?: string;
				role?: string;
				description?: string;
				tools?: string;
			}>().catch((): { name?: string; role?: string; description?: string; tools?: string } => ({}));

			if (!body.name || !body.role) {
				return c.json({ error: 'name and role are required' }, 400);
			}

			// Find a provider to generate the charter
			const slugs = ['anthropic', 'openai', 'ollama'];
			for (const slug of slugs) {
				const provider = deps.providerRegistry.getBySlug(slug);
				if (!provider) continue;
				try {
					const models = await provider.models();
					if (models.length === 0) continue;
					const model = models[0]!.id;
					let charter = '';
					const toolList = body.tools || 'web-search';
					const chunks = provider.chat({
						model,
						messages: [
							{
								role: 'system',
								content: 'You generate agent charters for an AI agent framework. Write a concise, professional charter in Markdown. Include: identity statement, goals (3-5 bullet points), guidelines (3-5 bullet points), and boundaries. Keep it under 500 words.',
							},
							{
								role: 'user',
								content: `Generate a charter for an AI agent named "${body.name}" with role "${body.role}". Description: ${body.description || 'Not specified'}. Available tools: ${toolList}.`,
							},
						],
						temperature: 0.4,
					});
					for await (const chunk of chunks) {
						if (chunk.type === 'text' && chunk.text) charter += chunk.text;
					}
					return c.json({ charter });
				} catch {
					// Try next provider
				}
			}
			return c.json({ error: 'No LLM provider available to generate charter' }, 503);
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

			// Answer an inquiry (R7)
			app.post('/api/approvals/:id/answer', async (c) => {
				const body = await c.req.json<{ answer: string }>();
				if (!body.answer?.trim()) {
					return c.json({ error: 'answer is required' }, 400);
				}
				const found = store.answer(c.req.param('id'), body.answer, 'operator');
				if (!found) return c.json({ error: 'Inquiry not found or already resolved' }, 404);
				return c.json({ answered: true });
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

		// -- Navigation & Plugins -------------------------------------------------
		const BASE_NAV_ITEMS: import('../../types/plugin.js').DashboardNavItem[] = [
			{ href: '/', label: 'Overview', icon: 'LayoutDashboard' },
			{ href: '/agents', label: 'Agents', icon: 'Bot' },
			{ href: '/teams', label: 'Teams', icon: 'Users' },
			{ href: '/workflows', label: 'Workflows', icon: 'GitBranch' },
			{ href: '/knowledge', label: 'Knowledge', icon: 'BookOpen' },
			{ href: '/monitors', label: 'Monitors', icon: 'Eye' },
			{ href: '/message-templates', label: 'Templates', icon: 'Mail' },
			{ href: '/approvals', label: 'Approvals', icon: 'ShieldCheck' },
			{ href: '/escalations', label: 'Escalations', icon: 'AlertTriangle' },
			{ href: '/channels', label: 'Channels', icon: 'MessageSquare' },
			{ href: '/metrics', label: 'Metrics', icon: 'BarChart3' },
			{ href: '/kpis', label: 'KPIs', icon: 'TrendingUp' },
			{ href: '/billing', label: 'Billing', icon: 'CreditCard' },
			{ href: '/settings', label: 'Settings', icon: 'Settings' },
			{ href: '/logs', label: 'Logs', icon: 'ScrollText' },
		];

		app.get('/api/navigation', (c) => {
			const pluginItems = deps.pluginRegistry?.getNavItems() ?? [];
			return c.json([...BASE_NAV_ITEMS, ...pluginItems]);
		});

		app.get('/api/plugins', (c) => {
			const plugins = deps.pluginRegistry?.getPlugins() ?? [];
			return c.json(plugins);
		});

		// -- MCP Library (R11) ----------------------------------------------------
		app.get('/api/tools/mcp-library', async (c) => {
			const { listMCPConfigs } = await import('../../tools/mcp/config-registry.js');
			const category = c.req.query('category');
			const entries = listMCPConfigs(category || undefined);
			return c.json(
				entries.map((e) => ({
					id: e.id,
					...e.metadata,
				})),
			);
		});

		app.get('/api/tools/mcp-library/:id', async (c) => {
			const { getMCPConfig } = await import('../../tools/mcp/config-registry.js');
			const entry = getMCPConfig(c.req.param('id'));
			if (!entry) return c.json({ error: 'MCP config not found' }, 404);
			return c.json(entry);
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

		// -- Stripe Webhook (must be before generic /webhook/* handler) ----------
		app.post('/webhook/stripe', async (c) => {
			const signature = c.req.header('Stripe-Signature');
			if (!signature) {
				return c.json({ error: 'Missing Stripe-Signature header' }, 400);
			}

			let webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
			if (!webhookSecret && deps.vault) {
				webhookSecret = (await deps.vault.get('stripe', 'webhook_secret')) ?? undefined;
			}
			if (!webhookSecret) {
				return c.json({ error: 'STRIPE_WEBHOOK_SECRET not configured' }, 500);
			}

			const rawBody = await c.req.text();

			try {
				const { default: Stripe } = await import('stripe');
				const stripe = new Stripe(process.env['STRIPE_SECRET_KEY'] ?? 'unused');
				const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

				// Find an agent that handles Stripe events and dispatch to it
				const stripeAgents = [...deps.agentsMap.values()].filter(
					(a) => a.tools?.includes('stripe-billing'),
				);
				if (stripeAgents.length > 0) {
					const targetAgent = stripeAgents[0]!;
					const activation = {
						id: createActivationId(),
						agentId: targetAgent.id,
						trigger: { type: 'webhook' as const, path: '/webhook/stripe', task: `stripe:${event.type}` },
						timestamp: toISOTimestamp(),
						payload: { event_type: event.type, event_id: event.id, data: event.data?.object },
					};
					void deps.dispatcher.dispatch(activation);
				}

				return c.json({ received: true, type: event.type });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return c.json({ error: `Webhook verification failed: ${message}` }, 400);
			}
		});

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

		// Dashboard proxy or 404 fallback
		if (deps.dashboardPort) {
			const dashboardOrigin = `http://127.0.0.1:${deps.dashboardPort}`;
			app.all('*', async (c) => {
				try {
					const url = new URL(c.req.url);
					// Only proxy non-API paths to dashboard
					if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/webhook/')) {
						return c.json({ error: 'Not found' }, 404);
					}
					const target = `${dashboardOrigin}${url.pathname}${url.search}`;
					const proxyHeaders = new Headers(c.req.raw.headers);
					proxyHeaders.delete('host');
					// Strip sensitive headers before proxying [H-06]
					proxyHeaders.delete('authorization');
					proxyHeaders.delete('cookie');
					proxyHeaders.delete('x-api-key');
					const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD';
					const init: RequestInit = {
						method: c.req.method,
						headers: proxyHeaders,
					};
					if (hasBody) {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						init.body = c.req.raw.body as any;
						// Node fetch requires duplex for streaming request bodies
						(init as Record<string, unknown>)['duplex'] = 'half';
					}
					const resp = await fetch(target, init);
					// Node fetch auto-decompresses the body but keeps the
					// original content-encoding/content-length headers — strip
					// them so the browser doesn't try to gunzip plain data.
					const respHeaders = new Headers(resp.headers);
					respHeaders.delete('content-encoding');
					respHeaders.delete('content-length');
					respHeaders.delete('transfer-encoding');
					return new Response(resp.body, {
						status: resp.status,
						statusText: resp.statusText,
						headers: respHeaders,
					});
				} catch {
					return c.text('Dashboard unavailable', 502);
				}
			});
		} else {
			app.notFound((c) => c.json({ error: 'Not found' }, 404));
		}
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
			// Close idle keep-alive connections immediately, then force-close
			// any remaining (e.g. SSE streams) after a short grace period.
			// Cast needed: Hono's ServerType doesn't expose these Node 18.2+ methods.
			const srv = this.server as import('node:http').Server;
			srv.closeIdleConnections();
			setTimeout(() => {
				srv.closeAllConnections();
			}, 500).unref();
		});
	}
}
