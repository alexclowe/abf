/**
 * Runtime component interfaces.
 * These define the contracts for the 5 runtime components:
 * Scheduler, Dispatcher, Session Manager, Bus, Gateway.
 */

import type { AgentConfig, AgentState } from '../types/agent.js';
import type { AgentId, HealthStatus, ISOTimestamp, SessionId } from '../types/common.js';
import type { AbfConfig } from '../types/config.js';
import type { ABFError, Result } from '../types/errors.js';
import type { IMemoryStore } from '../types/memory.js';
import type { IBus } from '../types/message.js';
import type { IProviderRegistry } from '../types/provider.js';
import type { IAuditStore, SecurityContext } from '../types/security.js';
import type { EscalationType, KPIReport, SessionResult, WorkSession } from '../types/session.js';
import type { IToolRegistry, IToolSandbox } from '../types/tool.js';
import type { IApprovalStore } from '../types/approval.js';
import type { IDatastore } from '../types/datastore.js';
import type { Activation } from '../types/trigger.js';

// ─── Escalation Item (mutable wrapper for API) ──────────────────────

export interface EscalationItem {
	readonly id: string;
	readonly agentId: AgentId;
	readonly sessionId: SessionId;
	readonly type: EscalationType;
	readonly message: string;
	readonly target: 'human' | AgentId;
	readonly timestamp: ISOTimestamp;
	resolved: boolean;
}

// ─── Scheduler ────────────────────────────────────────────────────────
// Evaluates cron triggers, emits Activations.

export interface IScheduler {
	start(): void;
	stop(): void;
	registerAgent(agent: AgentConfig): void;
	unregisterAgent(agentId: AgentId): void;
}

// ─── Dispatcher ───────────────────────────────────────────────────────
// Receives activations, manages concurrency, creates sessions.

export interface IDispatcher {
	dispatch(activation: Activation): Promise<Result<SessionId, ABFError>>;
	registerAgent(agent: AgentConfig): void;
	getActiveSessions(): readonly WorkSession[];
	getAgentState(agentId: AgentId): AgentState | undefined;
	getSessionResult(sessionId: SessionId): SessionResult | undefined;
	getEscalations(): readonly EscalationItem[];
	resolveEscalation(id: string): boolean;
	getKPIHistory(agentId?: AgentId): readonly KPIReport[];
	clearHeartbeats(): void;
}

// ─── Session Manager ──────────────────────────────────────────────────
// Executes the 8-step work session lifecycle.

export interface ISessionManager {
	execute(activation: Activation): Promise<Result<SessionResult, ABFError>>;
	abort(sessionId: SessionId): Promise<void>;
}

// ─── Gateway ──────────────────────────────────────────────────────────
// HTTP server for webhooks, Dashboard API, REST management.

export interface IGateway {
	start(): Promise<void>;
	stop(): Promise<void>;
	readonly port: number;
}

// ─── Runtime (top-level orchestrator) ─────────────────────────────────

export interface RuntimeComponents {
	readonly config: AbfConfig;
	readonly agentsMap: ReadonlyMap<string, AgentConfig>;
	readonly bus: IBus;
	readonly memoryStore: IMemoryStore;
	readonly toolRegistry: IToolRegistry;
	readonly toolSandbox: IToolSandbox;
	readonly providerRegistry: IProviderRegistry;
	readonly auditStore: IAuditStore;
	readonly scheduler: IScheduler;
	readonly dispatcher: IDispatcher;
	readonly sessionManager: ISessionManager;
	readonly gateway: IGateway;
	readonly approvalStore?: IApprovalStore | undefined;
	readonly datastore?: IDatastore | undefined;
	readonly inbox?: import('../types/inbox.js').IInbox | undefined;
	readonly monitorRunner?: import('../monitor/runner.js').MonitorRunner | undefined;
}

export interface IRuntime {
	readonly config: AbfConfig;
	readonly components: RuntimeComponents;

	start(): Promise<void>;
	stop(): Promise<void>;
	health(): HealthStatus;

	/** Load and register all agents from config directory. */
	loadAgents(): Promise<Result<readonly AgentConfig[], ABFError>>;

	/** Get security context for an agent session. */
	createSecurityContext(agentId: AgentId, sessionId: SessionId): SecurityContext;
}
