/**
 * Agent types — the core primitive.
 * An agent is an autonomous worker with role, tools, memory, and triggers.
 */

import type { AgentId, ISOTimestamp, TeamId, USDCents } from './common.js';
import type { TriggerConfig } from './trigger.js';

// ─── Behavioral Bounds ────────────────────────────────────────────────
// Runtime-enforced constraints. The LLM never sees these — the runtime checks them.

export interface BehavioralBounds {
	readonly allowedActions: readonly string[];
	readonly forbiddenActions: readonly string[];
	readonly maxCostPerSession: USDCents;
	readonly maxExternalRequests?: number | undefined;
	readonly requiresApproval: readonly string[];
}

// ─── Escalation Rules ─────────────────────────────────────────────────

export type EscalationTarget = 'human' | AgentId;

export interface EscalationRule {
	readonly condition: string; // e.g., "api_costs > budget_threshold"
	readonly target: EscalationTarget;
	readonly message?: string | undefined;
}

// ─── KPI Definition ───────────────────────────────────────────────────

export type KPIReviewCadence = 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface KPIDefinition {
	readonly metric: string;
	readonly target: string; // e.g., "100%", "> 95%", "< 5min"
	readonly review: KPIReviewCadence;
}

// ─── Agent Config ─────────────────────────────────────────────────────

export interface AgentConfig {
	readonly name: string;
	readonly id: AgentId;
	readonly displayName: string;
	readonly role: string;
	readonly description: string;
	readonly roleArchetype?: string | undefined;
	readonly provider: string;
	readonly model: string;
	readonly temperature?: number | undefined;
	readonly team?: TeamId | undefined;
	readonly reportsTo?: AgentId | undefined;
	readonly tools: readonly string[];
	readonly triggers: readonly TriggerConfig[];
	readonly escalationRules: readonly EscalationRule[];
	readonly behavioralBounds: BehavioralBounds;
	readonly kpis: readonly KPIDefinition[];
	readonly charter: string;
	readonly maxToolLoops?: number | undefined;
}

// ─── Agent Runtime State ──────────────────────────────────────────────

export type AgentStatus = 'idle' | 'active' | 'waiting' | 'error' | 'disabled';

export interface AgentState {
	readonly id: AgentId;
	readonly status: AgentStatus;
	readonly lastActive?: ISOTimestamp | undefined;
	readonly currentSessionCost: USDCents;
	readonly totalCost: USDCents;
	readonly sessionsCompleted: number;
	readonly errorCount: number;
	/** Most recent error message from a failed session (if any). */
	readonly lastError?: string | undefined;
}
