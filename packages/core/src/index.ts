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

// ─── Knowledge ────────────────────────────────────────────────────────
export { loadKnowledgeFiles } from './knowledge/loader.js';

// ─── Archetypes ───────────────────────────────────────────────────────
export { BUILTIN_ARCHETYPES, listArchetypes, getArchetype } from './archetypes/index.js';
export type { ArchetypeDefaults } from './archetypes/index.js';

// ─── Approval ─────────────────────────────────────────────────────────
export { InMemoryApprovalStore } from './approval/index.js';
export type { ApprovalRequest, ApprovalStatus, IApprovalStore } from './types/approval.js';

// ─── Datastore ────────────────────────────────────────────────────
export { createDatastore, loadDatastoreSchemas, loadMigrationFiles, runMigrations } from './datastore/index.js';
export type { IDatastore, DatastoreConfig, DatastoreSchema, DatastoreQueryResult, DatastoreWriteResult } from './types/datastore.js';
export { datastoreSchemaYaml, transformDatastoreSchema } from './schemas/datastore.schema.js';

// ─── Workflow Templates ───────────────────────────────────────────────
export { BUILTIN_WORKFLOW_TEMPLATES, getWorkflowTemplate } from './workflows/templates.js';
export type { WorkflowTemplateDefinition, WorkflowTemplateStep } from './workflows/templates.js';

// ─── Message Templates ───────────────────────────────────────────────
export { MessageTemplateRegistry } from './messaging/templates.js';
export { messageTemplateSchema } from './schemas/message-template.schema.js';
export type { MessageTemplate } from './schemas/message-template.schema.js';

// ─── Inbox ────────────────────────────────────────────────────────────
export { InMemoryInbox } from './inbox/index.js';
export type { IInbox, InboxItem, InboxItemPriority, InboxItemSource } from './types/inbox.js';

// ─── Outputs ──────────────────────────────────────────────────────────
export { OutputsManager } from './memory/outputs.js';
export type { OutputEntry } from './memory/outputs.js';

// ─── Monitors ────────────────────────────────────────────────────────
export { MonitorRunner } from './monitor/index.js';
export type { MonitorDefinition, MonitorSnapshot } from './types/monitor.js';
export { monitorYamlSchema, transformMonitorYaml } from './schemas/monitor.schema.js';

// ─── Metrics ─────────────────────────────────────────────────────────
export { MetricsCollector } from './metrics/collector.js';

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
export { FilesystemCredentialVault, VaultV2, createVault, createKeychain } from './credentials/index.js';
export type { IKeychain } from './credentials/index.js';

// ─── Cloud Proxy ──────────────────────────────────────────────────────
export { CloudProxyProvider } from './providers/adapters/cloud-proxy.js';
export type { CloudConfig } from './types/config.js';

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

// ─── Seed-to-Company Pipeline ────────────────────────────────────────
export {
	extractText,
	detectFormat,
	applyCompanyPlan,
	generateArchitectAgent,
	ANALYZER_SYSTEM_PROMPT,
	REANALYZE_SYSTEM_PROMPT,
	INTERVIEW_SYSTEM_PROMPT,
	analyzeSeedDoc,
	reanalyzeSeedDoc,
	InterviewEngine,
} from './seed/index.js';
export type {
	CompanyPlan,
	CompanyInfo,
	AgentPlan as SeedAgentPlan,
	TeamPlan,
	WorkflowPlan,
	ToolGap,
	EscalationRule as SeedEscalationRule,
	InterviewSession,
	InterviewAnswer,
	InterviewStep,
	SeedMetadata,
	TriggerPlan,
	KPIPlan,
	BoundsPlan,
	WorkflowStepPlan,
} from './seed/types.js';
export type { AnalyzerOptions, ReanalyzeOptions } from './seed/analyzer.js';

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
