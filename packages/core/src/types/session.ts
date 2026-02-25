/**
 * Work Session types.
 * A session is one complete agent work cycle — the 8-step lifecycle.
 */

import type { AgentId, ISOTimestamp, SessionId, USDCents } from './common.js';
import type { AgentMemoryContext } from './memory.js';
import type { BusMessage } from './message.js';
import type { TokenUsage } from './provider.js';
import type { ToolCall, ToolResult } from './tool.js';
import type { Activation } from './trigger.js';

// ─── Session Context ──────────────────────────────────────────────────

export interface SessionContext {
	readonly sessionId: SessionId;
	readonly agentId: AgentId;
	readonly activation: Activation;
	readonly memory: AgentMemoryContext;
	readonly pendingMessages: readonly BusMessage[];
	readonly startedAt: ISOTimestamp;
}

// ─── Escalation ───────────────────────────────────────────────────────

export type EscalationType = 'cost' | 'error' | 'approval' | 'bounds' | 'custom';

export interface Escalation {
	readonly type: EscalationType;
	readonly agentId: AgentId;
	readonly sessionId: SessionId;
	readonly message: string;
	readonly target: 'human' | AgentId;
	readonly timestamp: ISOTimestamp;
	readonly context?: Readonly<Record<string, unknown>> | undefined;
	readonly resolved: boolean;
}

// ─── KPI Report ───────────────────────────────────────────────────────

export interface KPIReport {
	readonly metric: string;
	readonly value: string;
	readonly target: string;
	readonly met: boolean;
	readonly timestamp: ISOTimestamp;
}

// ─── Session Result ───────────────────────────────────────────────────

export type SessionStatus = 'completed' | 'failed' | 'escalated' | 'timeout';

export interface SessionResult {
	readonly sessionId: SessionId;
	readonly agentId: AgentId;
	readonly status: SessionStatus;
	readonly startedAt: ISOTimestamp;
	readonly completedAt: ISOTimestamp;
	readonly toolCalls: readonly ToolCall[];
	readonly toolResults: readonly ToolResult[];
	readonly messagesEmitted: readonly BusMessage[];
	readonly escalations: readonly Escalation[];
	readonly kpiReports: readonly KPIReport[];
	readonly tokenUsage: TokenUsage;
	readonly cost: USDCents;
	readonly memoryUpdates: readonly string[];
	readonly outputText?: string | undefined;
	/** Seconds to wait before re-running this agent (set by the reschedule tool). */
	readonly rescheduleIn?: number | undefined;
	readonly error?: string | undefined;
}

// ─── Work Session (mutable during execution) ──────────────────────────

export interface WorkSession {
	readonly context: SessionContext;
	status: SessionStatus;
	toolCalls: ToolCall[];
	toolResults: ToolResult[];
	messagesEmitted: BusMessage[];
	escalations: Escalation[];
	tokenUsage: TokenUsage;
	cost: USDCents;
}
