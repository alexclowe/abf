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
import { FilesystemCredentialVault } from '../credentials/vault.js';
import { FilesystemMemoryStore } from '../memory/filesystem.store.js';
import { AnthropicProvider } from '../providers/adapters/anthropic.js';
import { OllamaProvider } from '../providers/adapters/ollama.js';
import { OpenAIProvider } from '../providers/adapters/openai.js';
import { ProviderRegistry } from '../providers/registry.js';
import { FileAuditStore } from '../security/audit.js';
import { createBuiltinTools } from '../tools/loader.js';
import { BasicToolSandbox } from '../tools/sandbox.js';
import { ToolRegistry } from '../tools/registry.js';
import type { AgentConfig } from '../types/agent.js';
import type { AbfConfig, RedisBusConfig } from '../types/config.js';
import { InProcessBus } from './bus/in-process.bus.js';
import { RedisBus } from './bus/redis.bus.js';
import { Dispatcher } from './dispatcher.js';
import { HttpGateway } from './gateway/http.gateway.js';
import { WorkflowRunner } from './workflow-runner.js';
import type { IMemoryStore } from '../types/memory.js';
import type { IBus } from '../types/message.js';
import type { RuntimeComponents } from './interfaces.js';
import { Runtime } from './runtime.js';
import { Scheduler } from './scheduler.js';
import { SessionManager } from './session-manager.js';

export async function createRuntime(
	config: AbfConfig,
	projectRoot: string,
): Promise<Runtime> {
	// 1. Credential vault
	const vault = new FilesystemCredentialVault();

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

	// Register built-in tools
	for (const tool of createBuiltinTools()) {
		toolRegistry.register(tool);
	}

	// Load MCP tools (if mcp-servers.yaml exists)
	const { loadMCPTools } = await import('../tools/mcp/loader.js');
	await loadMCPTools(join(projectRoot, config.toolsDir), toolRegistry);

	// Load messaging plugins from interfaces/ dir
	const { loadMessagingRouter } = await import('../messaging/loader.js');
	const messagingRouter = await loadMessagingRouter(join(projectRoot, 'interfaces'));

	// 8. Provider registry — register all available providers
	const providerRegistry = new ProviderRegistry();
	providerRegistry.register(new AnthropicProvider(vault));
	providerRegistry.register(new OpenAIProvider(vault));
	providerRegistry.register(new OllamaProvider(vault));

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
	});

	// 10. Dispatcher — receives shared agentsMap
	const dispatcher = new Dispatcher(
		sessionManager,
		config.runtime.maxConcurrentSessions,
		agentsMap,
	);

	// 11. Scheduler — wired directly to dispatcher
	const scheduler = new Scheduler((activation) => {
		void dispatcher.dispatch(activation);
	});

	// 12. Workflow runner
	const workflowRunner = new WorkflowRunner(dispatcher, agentsMap);
	const workflowsDir = join(projectRoot, 'workflows');

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
	};

	return new Runtime(config, projectRoot, components, vault);
}
