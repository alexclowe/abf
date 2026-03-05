/**
 * createRuntime() — assembles all 10 runtime components with proper wiring.
 *
 * Component dependency order:
 * 1. vault         (no deps)
 * 2. agentsMap     (shared Map injected into dispatcher + sessionManager)
 * 3. memoryStore   (needs config.memoryDir)
 * 4. auditStore    (needs config.logsDir)
 * 5. bus           (no deps)
 * 6. toolRegistry  (no deps)
 * 7. toolSandbox   (no deps)
 * 8. providerRegistry (needs vault)
 * 9. sessionManager   (needs shared agentsMap + most other deps)
 * 10. dispatcher      (needs sessionManager + shared agentsMap)
 * 11. scheduler        (wired directly to dispatcher.dispatch)
 * 12. gateway          (needs config + health handler)
 */

import { join } from 'node:path';
import { createVault } from '../credentials/vault-v2.js';
import { FilesystemMemoryStore } from '../memory/filesystem.store.js';
import { AnthropicProvider } from '../providers/adapters/anthropic.js';
import { OllamaProvider } from '../providers/adapters/ollama.js';
import { OpenAIProvider } from '../providers/adapters/openai.js';
import { ProviderRegistry } from '../providers/registry.js';
import { FileAuditStore } from '../security/audit.js';
import { InMemoryApprovalStore } from '../approval/store.js';
import { createBuiltinTools } from '../tools/loader.js';
import { BasicToolSandbox } from '../tools/sandbox.js';
import { ToolRegistry } from '../tools/registry.js';
import type { AgentConfig } from '../types/agent.js';
import type { AbfConfig, RedisBusConfig } from '../types/config.js';
import { InProcessBus } from './bus/in-process.bus.js';
import { RedisBus } from './bus/redis.bus.js';
import { Dispatcher } from './dispatcher.js';
import { HttpGateway } from './gateway/http.gateway.js';
import type { IConversationStore } from './conversation-store.js';
import { WorkflowRunner } from './workflow-runner.js';
import type { IMemoryStore } from '../types/memory.js';
import type { IBus } from '../types/message.js';
import type { RuntimeComponents } from './interfaces.js';
import { Runtime } from './runtime.js';
import { Scheduler } from './scheduler.js';
import { SessionManager } from './session-manager.js';
import { createActivationId, toISOTimestamp } from '../util/id.js';

export interface CreateRuntimeOptions {
	dashboardPort?: number | undefined;
	masterPassword?: string | undefined;
}

export async function createRuntime(
	config: AbfConfig,
	projectRoot: string,
	options?: CreateRuntimeOptions,
): Promise<Runtime> {
	// 1. Credential vault (v2 — OS Keychain or scrypt)
	const vault = await createVault(
		options?.masterPassword ? { masterPassword: options.masterPassword } : undefined,
	);

	// 2. Shared agents map (single source of truth for both dispatcher + session manager)
	const agentsMap = new Map<string, AgentConfig>();

	// 3. Memory store
	const memoryStore: IMemoryStore =
		config.storage.backend === 'postgres'
			? await (async () => {
					const { PostgresMemoryStore } = await import('../memory/postgres.store.js');
					const store = new PostgresMemoryStore(
						(config.storage as import('../types/config.js').PostgresStorageConfig).connectionString,
						(config.storage as import('../types/config.js').PostgresStorageConfig).poolSize,
					);
					await store.initialize();
					return store;
				})()
			: new FilesystemMemoryStore(join(projectRoot, config.memoryDir));

	// 4. Audit store
	const auditStore = new FileAuditStore(join(projectRoot, config.logsDir));

	// 4b. Session store (persists session results for stats recovery across restarts)
	const { FileSessionStore } = await import('../sessions/file-session-store.js');
	const sessionStore = new FileSessionStore(join(projectRoot, config.logsDir));

	// 5. Message bus
	let bus: IBus;
	if (config.bus.backend === 'redis') {
		const redisBus = new RedisBus((config.bus as RedisBusConfig).url);
		await redisBus.connect();
		bus = redisBus;
	} else {
		bus = new InProcessBus();
	}

	// 6. Tool registry + 7. sandbox
	const toolRegistry = new ToolRegistry();
	const toolSandbox = new BasicToolSandbox();

	// Parallel dynamic imports — group independent modules to reduce startup time
	const [
		{ loadMessagingRouter },
		{ MessageTemplateRegistry },
		{ InMemoryTaskPlanStore },
		{ OutputsManager },
		{ InMemoryInbox },
		{ MemoryCompactor },
		{ SessionEventBus },
	] = await Promise.all([
		import('../messaging/loader.js'),
		import('../messaging/templates.js'),
		import('../planning/store.js'),
		import('../memory/outputs.js'),
		import('../inbox/store.js'),
		import('../memory/compactor.js'),
		import('./session-events.js'),
	]);

	// Load messaging plugins from interfaces/ dir (needed by tool context)
	const messagingRouter = await loadMessagingRouter(join(projectRoot, 'interfaces'));

	// Approval store (in-memory, shared across tools and gateway)
	const approvalStore = new InMemoryApprovalStore();

	// Datastore (optional — only if configured)
	let datastore: import('../types/datastore.js').IDatastore | undefined;
	if (config.datastore) {
		const { createDatastore, loadDatastoreSchemas, loadMigrationFiles, runMigrations } =
			await import('../datastore/index.js');
		const dsConfig = { ...config.datastore };
		// Default sqlite path relative to project root
		if (dsConfig.backend === 'sqlite' && !dsConfig.sqlitePath) {
			(dsConfig as { sqlitePath?: string }).sqlitePath = join(projectRoot, 'data.db');
		}
		datastore = createDatastore(dsConfig);
		const initResult = await datastore.initialize();
		if (initResult.ok) {
			// Apply schemas
			const schemasDir = join(projectRoot, config.datastore.schemasDir ?? 'datastore/schemas');
			const schemas = loadDatastoreSchemas(schemasDir);
			if (schemas.length > 0) {
				await datastore.applySchemas(schemas);
			}
			// Run migrations
			const migrationsDir = join(projectRoot, config.datastore.migrationsDir ?? 'datastore/migrations');
			const migrations = loadMigrationFiles(migrationsDir);
			if (migrations.length > 0) {
				await runMigrations(datastore, migrations);
			}
		}
	}

	// Load message templates (if templates/messages/ exists)
	const messageTemplates = new MessageTemplateRegistry();
	messageTemplates.load(join(projectRoot, 'templates', 'messages'));

	// Task plan store (R6)
	const taskPlanStore = new InMemoryTaskPlanStore();

	// Virtual agent mailbox (inter-agent communication)
	const { FilesystemMailboxStore } = await import('../mailbox/store.js');
	const mailboxStore = new FilesystemMailboxStore(join(projectRoot, 'mail'));
	await mailboxStore.load();

	// Detect cloud deployment (ABF Cloud or known cloud platforms)
	const isCloud = Boolean(
		process.env['ABF_CLOUD'] || process.env['RENDER'] ||
		process.env['RAILWAY_ENVIRONMENT'] || process.env['FLY_APP_NAME'],
	);

	// Cloud proxy endpoint — set when cloud config exists or running in cloud mode
	const cloudEndpoint = config.cloud?.endpoint ?? (isCloud ? 'https://api.abf.cloud/v1' : undefined);

	// Build tool context with all dependencies
	const toolContext: import('../tools/builtin/context.js').BuiltinToolContext = {
		vault,
		projectRoot,
		messagingPlugins: messagingRouter.pluginEntries,
		approvalStore,
		datastore,
		messageTemplates,
		taskPlanStore,
		isCloud,
		cloudEndpoint,
		mailboxStore,
		agentsMap,
	};

	// Register built-in tools
	for (const tool of createBuiltinTools(toolContext)) {
		toolRegistry.register(tool);
	}

	// Load MCP tools (if mcp-servers.yaml exists)
	const { loadMCPTools } = await import('../tools/mcp/loader.js');
	await loadMCPTools(join(projectRoot, config.toolsDir), toolRegistry);

	// Load custom tools (*.tool.yaml + optional *.tool.js)
	// Custom tools receive a ScopedVault that restricts credential access to providers
	// their agent actually needs — enforcing least-privilege at the credential layer.
	const { loadToolConfigs } = await import('../tools/loader.js');
	const { ScopedVault, deriveAllowedProviders } = await import('../tools/scoped-vault.js');
	const allAgentTools = [...agentsMap.values()].flatMap((a) => a.tools);
	const allowedProviders = deriveAllowedProviders(allAgentTools);
	const scopedVault = new ScopedVault(vault, allowedProviders, (provider, op) => {
		console.log(`[security] ScopedVault denied ${op} for provider "${provider}"`);
	});
	const customToolCtx = { projectRoot, vault: scopedVault, datastore, log: (msg: string) => console.log(`[tools] ${msg}`) };
	const customToolsResult = await loadToolConfigs(join(projectRoot, config.toolsDir), customToolCtx);
	if (customToolsResult.ok) {
		for (const tool of customToolsResult.value) {
			toolRegistry.register(tool);
		}
	}

	// 8. Provider registry — register all available providers
	const providerRegistry = new ProviderRegistry();
	providerRegistry.register(new AnthropicProvider(vault));
	providerRegistry.register(new OpenAIProvider(vault));
	providerRegistry.register(new OllamaProvider(vault));

	// Register ABF Cloud provider if cloud config is present (Path 4)
	if (config.cloud) {
		const { CloudProxyProvider } = await import('../providers/adapters/cloud-proxy.js');
		providerRegistry.register(new CloudProxyProvider(config.cloud, vault));
	}

	// Register OpenAI-compatible provider presets (Moonshot, DeepSeek, Groq, Together, OpenRouter)
	const { OpenAICompatProvider } = await import('../providers/adapters/openai-compat.js');
	const { PROVIDER_PRESETS } = await import('../providers/presets.js');
	for (const preset of Object.values(PROVIDER_PRESETS)) {
		providerRegistry.register(new OpenAICompatProvider(preset, vault));
	}

	// Register custom providers from config (override presets if same slug)
	if (config.providers && config.providers.length > 0) {
		for (const cp of config.providers) {
			providerRegistry.register(
				new OpenAICompatProvider(
					{ ...cp, slug: cp.id, authType: 'api_key' },
					vault,
				),
			);
		}
	}

	// Outputs manager for cross-agent memory
	const outputsManager = new OutputsManager(join(projectRoot, config.outputsDir));

	// Agent inbox
	const inbox = new InMemoryInbox();

	// Memory compactor (R8)
	const compactor = new MemoryCompactor(memoryStore, providerRegistry, {
		windowSize: config.memoryWindowSize ?? 20,
		threshold: config.memorySummarizationThreshold ?? 50,
		enabled: config.memorySummarizationEnabled ?? true,
	});

	// Session event bus (R12) — real-time observation of automated sessions
	const sessionEventBus = new SessionEventBus();

	// Conversation store for multi-turn chat (persistent SQLite)
	const { SQLiteConversationStore } = await import('./conversation-store-sqlite.js');
	const sqliteConvStore = new SQLiteConversationStore(
		join(projectRoot, 'logs', 'conversations.db'),
	);
	await sqliteConvStore.initialize();
	const conversationStore: IConversationStore = sqliteConvStore;

	// 9. Session manager — receives shared agentsMap
	const sessionManager = new SessionManager({
		agents: agentsMap,
		memoryStore,
		bus,
		toolRegistry,
		toolSandbox,
		providerRegistry,
		auditStore,
		sessionTimeoutMs: config.runtime.sessionTimeoutMs,
		messagingRouter,
		knowledgeDir: join(projectRoot, config.knowledgeDir),
		outputsManager,
		inbox,
		approvalStore,
		compactor,
		taskPlanStore,
		sessionEventBus,
		mailboxStore,
		conversationStore,
	});

	// 10. Dispatcher — receives shared agentsMap + session store for persistence
	const dispatcher = new Dispatcher(
		sessionManager,
		config.runtime.maxConcurrentSessions,
		agentsMap,
		sessionStore,
	);

	// Operator notifications — fire when approvals/escalations are created
	const { OperatorNotifier } = await import('../messaging/operator-notifier.js');
	const operatorNotifier = new OperatorNotifier(projectRoot, vault);

	approvalStore.onCreated = (request) => {
		void operatorNotifier.notify({
			type: 'approval_required',
			agentId: request.agentId,
			sessionId: request.sessionId,
			message: `${request.agentId} wants to use ${request.toolName}`,
			severity: 'warn',
			timestamp: request.createdAt,
		});
	};

	approvalStore.onApproved = (request) => {
		if (request.type === 'inquiry') return;
		const agent = agentsMap.get(request.agentId);
		if (!agent) return;

		void dispatcher.dispatch({
			id: createActivationId(),
			agentId: request.agentId,
			trigger: {
				type: 'approval_resume' as const,
				task: request.originalTask ?? `Execute approved tool: ${request.toolName}`,
				approvalId: request.id,
				toolName: request.toolName,
				toolArguments: request.arguments,
				conversationId: request.conversationId,
			},
			timestamp: toISOTimestamp(),
			payload: {
				approvalId: request.id,
				toolName: request.toolName,
				toolArguments: request.arguments,
				conversationId: request.conversationId,
			},
		});
	};

	dispatcher.onEscalationCreated = (escalation) => {
		void operatorNotifier.notify({
			type: 'escalation',
			agentId: escalation.agentId,
			sessionId: escalation.sessionId,
			message: escalation.message,
			severity: 'error',
			timestamp: escalation.timestamp,
		});
	};

	// Register sessions-spawn tool (needs dispatcher + agentsMap, deferred until now — R1)
	const { createSessionsSpawnTool } = await import('../tools/builtin/sessions-spawn.js');
	toolRegistry.register(createSessionsSpawnTool(toolContext, { dispatcher, agentsMap }));

	// Register delegate-task tool (real multi-agent orchestration via dispatchAndWait)
	const { createDelegateTaskTool } = await import('../tools/builtin/delegate-task.js');
	toolRegistry.register(createDelegateTaskTool(toolContext, { dispatcher, agentsMap }));

	// Proactive evaluator (R9)
	const { ProactiveEvaluator } = await import('./proactive-evaluator.js');
	const proactiveEvaluator = new ProactiveEvaluator(providerRegistry);

	// 11. Scheduler — wired directly to dispatcher, with proactive evaluation
	const scheduler = new Scheduler(
		(activation) => {
			void dispatcher.dispatch(activation);
		},
		async (agent, trigger) => {
			const result = await proactiveEvaluator.evaluate(agent, trigger);
			return result.shouldAct;
		},
	);

	// 12. Workflow runner
	const workflowRunner = new WorkflowRunner(dispatcher, agentsMap);
	const workflowsDir = join(projectRoot, 'workflows');

	// Monitor runner (external source monitoring) — load configs only; start() deferred to Runtime.start()
	const { MonitorRunner } = await import('../monitor/runner.js');
	const monitorRunner = new MonitorRunner();
	monitorRunner.loadMonitors(join(projectRoot, 'monitors'));

	// Metrics collector
	const { MetricsCollector } = await import('../metrics/collector.js');
	const metricsCollector = new MetricsCollector(dispatcher, agentsMap);

	// Channel router (R10) — routes inbound messages from external channels to agents
	const { ChannelRouter } = await import('../messaging/channel-router.js');
	const channelRouter = new ChannelRouter();
	channelRouter.setDispatcher(dispatcher);

	// Wire channel gateways from config
	if (config.channels && config.channels.length > 0) {
		const { createChannelGateway } = await import('../messaging/gateway-factory.js');
		const configuredTypes = new Set(config.channels.map((r) => r.channel));
		for (const channelType of configuredTypes) {
			const gw = await createChannelGateway({ type: channelType }, vault);
			if (gw) {
				channelRouter.addGateway(gw);
			}
		}
		channelRouter.setRoutes([...config.channels]);
	}

	// OperatorChannel — unified bidirectional agent↔operator communication
	const { OperatorChannel } = await import('../messaging/operator-channel.js');
	const notifConfig = (config as unknown as Record<string, unknown>)['notifications'] as Record<string, unknown> | undefined;
	const preferredChannel = (notifConfig?.['channel'] as string) ?? undefined;
	const notificationTarget = (notifConfig?.['target'] as string) ?? undefined;
	const operatorChannel = new OperatorChannel(
		conversationStore,
		operatorNotifier,
		channelRouter,
		preferredChannel && preferredChannel !== 'none'
			? (preferredChannel as import('../messaging/interfaces.js').ChannelType)
			: undefined,
		notificationTarget,
	);

	// Wire OperatorChannel ↔ ChannelRouter (deferred injection, both need each other)
	channelRouter.setOperatorChannel(operatorChannel);

	// Wire Dispatcher → OperatorChannel (agent session output → operator)
	dispatcher.onSessionOutputCreated = (output) => {
		operatorChannel.send({
			...output,
			content: output.outputText,
			source: 'session_output',
		});
	};

	// Plugin registry — extension point for cloud repo and third-party plugins
	const { PluginRegistry } = await import('./gateway/plugin-registry.js');
	const pluginRegistry = new PluginRegistry();

	// 13. Gateway
	const gateway = new HttpGateway(config.gateway, {
		agentsMap,
		dispatcher,
		memoryStore,
		bus,
		auditStore,
		providerRegistry,
		projectRoot,
		teamsDir: join(projectRoot, config.teamsDir),
		workflowsDir,
		workflowRunner,
		approvalStore,
		inbox,
		metricsCollector,
		vault,
		scheduler,
		dashboardPort: options?.dashboardPort,
		taskPlanStore,
		channelRouter,
		sessionEventBus,
		pluginRegistry,
		sessionManager,
		conversationStore,
		mailboxStore,
		mailAllowedSenders: config.mail?.allowedSenders,
		operatorChannel,
	});

	const components: RuntimeComponents = {
		config,
		agentsMap,
		bus,
		memoryStore,
		toolRegistry,
		toolSandbox,
		providerRegistry,
		auditStore,
		scheduler,
		dispatcher,
		sessionManager,
		gateway,
		sessionStore,
		monitorRunner,
		channelRouter,
		pluginRegistry,
	};

	return new Runtime(config, projectRoot, components, vault);
}
