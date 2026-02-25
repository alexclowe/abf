/**
 * Branded ID factories.
 * Uses nanoid for URL-safe, collision-resistant IDs.
 */

import { nanoid } from 'nanoid';
import type {
	ActivationId,
	AgentId,
	ISOTimestamp,
	MessageId,
	ProviderId,
	SessionId,
	TeamId,
	ToolId,
	USDCents,
	WorkflowId,
} from '../types/common.js';

// ─── ID Generators ────────────────────────────────────────────────────

export function createAgentId(name: string): AgentId {
	return name as AgentId;
}

export function createTeamId(name: string): TeamId {
	return name as TeamId;
}

export function createSessionId(): SessionId {
	return `ses_${nanoid(16)}` as SessionId;
}

export function createMessageId(): MessageId {
	return `msg_${nanoid(16)}` as MessageId;
}

export function createToolId(name: string): ToolId {
	return name as ToolId;
}

export function createActivationId(): ActivationId {
	return `act_${nanoid(16)}` as ActivationId;
}

export function createProviderId(name: string): ProviderId {
	return name as ProviderId;
}

export function createWorkflowId(name: string): WorkflowId {
	return name as WorkflowId;
}

// ─── Value Constructors ───────────────────────────────────────────────

export function toISOTimestamp(date: Date = new Date()): ISOTimestamp {
	return date.toISOString() as ISOTimestamp;
}

export function toUSDCents(dollars: number): USDCents {
	return Math.round(dollars * 100) as USDCents;
}

export function usdCentsToDollars(cents: USDCents): number {
	return cents / 100;
}
