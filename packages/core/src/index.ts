// @abf/core — Agentic Business Framework
// Public API

// ─── Types ────────────────────────────────────────────────────────────
export * from './types/index.js';

// ─── Schemas ──────────────────────────────────────────────────────────
export {
	agentYamlSchema,
	transformAgentYaml,
	teamYamlSchema,
	transformTeamYaml,
	configYamlSchema,
	transformConfigYaml,
	toolYamlSchema,
	transformToolYaml,
	mcpServerSchema,
	mcpServersFileSchema,
	interfaceConfigSchema,
	workflowYamlSchema,
	transformWorkflowYaml,
} from './schemas/index.js';

// ─── Config ───────────────────────────────────────────────────────────
export {
	DEFAULT_CONFIG,
	loadConfig,
	loadAgentConfig,
	loadAgentConfigs,
	loadTeamConfig,
	loadTeamConfigs,
	loadWorkflowConfig,
	loadWorkflowConfigs,
} from './config/index.js';

// ─── Runtime ──────────────────────────────────────────────────────────
export {
	Scheduler,
	Dispatcher,
	SessionManager,
	InProcessBus,
	RedisBus,
	HttpGateway,
	WorkflowRunner,
	Runtime,
	createRuntime,
} from './runtime/index.js';
export type {
	IScheduler,
	IDispatcher,
	ISessionManager,
	IGateway,
	IRuntime,
	RuntimeComponents,
	EscalationItem,
	ActivationHandler,
	SessionManagerDeps,
	GatewayDeps,
	GatewayHandlers,
} from './runtime/index.js';

// ─── Memory ───────────────────────────────────────────────────────────
export { FilesystemMemoryStore, PostgresMemoryStore } from './memory/index.js';

// ─── Providers ────────────────────────────────────────────────────────
export {
	ProviderRegistry,
	AnthropicProvider,
	OpenAIProvider,
	OllamaProvider,
} from './providers/index.js';

// ─── Credentials ──────────────────────────────────────────────────────
export type { ICredentialVault } from './credentials/index.js';
export { FilesystemCredentialVault } from './credentials/index.js';

// ─── Tools ────────────────────────────────────────────────────────────
export { ToolRegistry, BasicToolSandbox, loadToolConfigs, createBuiltinTools, MCPClient, MCPToolAdapter, loadMCPTools } from './tools/index.js';
export type { BuiltinToolContext } from './tools/index.js';
export type { MCPServerConfig, MCPServersFile } from './schemas/mcp-servers.schema.js';

// ─── Messaging ────────────────────────────────────────────────────
export { MessagingRouter, loadMessagingRouter } from './messaging/index.js';
export type { IMessagingPlugin, AgentNotification, NotificationType, NotificationSeverity } from './messaging/index.js';

// ─── Security ─────────────────────────────────────────────────────────
export {
	checkBounds,
	isolateContent,
	detectInjection,
	processInput,
	FileAuditStore,
} from './security/index.js';
export type { BoundsCheckInput, BoundsCheckResult } from './security/index.js';

// ─── Utilities ────────────────────────────────────────────────────────
export {
	collectResults,
	tryResult,
	tryResultAsync,
	createAgentId,
	createTeamId,
	createSessionId,
	createMessageId,
	createToolId,
	createActivationId,
	createProviderId,
	createWorkflowId,
	toISOTimestamp,
	toUSDCents,
	usdCentsToDollars,
	computeChecksum,
	verifyChecksum,
} from './util/index.js';

export { createLogger } from './util/logger.js';
export type { LoggerOptions } from './util/logger.js';
