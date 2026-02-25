/**
 * Security types — audit trail, input analysis, security context.
 */

import type { AgentId, ISOTimestamp, InputSource, SessionId } from './common.js';
import type { ABFError, Result } from './errors.js';

// ─── Security Context ─────────────────────────────────────────────────
// Attached to every session for access control.

export interface SecurityContext {
	readonly agentId: AgentId;
	readonly sessionId: SessionId;
	readonly allowedActions: readonly string[];
	readonly forbiddenActions: readonly string[];
	readonly requiresApproval: readonly string[];
}

// ─── Input Analysis ───────────────────────────────────────────────────

export type ThreatLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface InputAnalysis {
	readonly source: InputSource;
	readonly threatLevel: ThreatLevel;
	readonly injectionDetected: boolean;
	readonly patterns: readonly string[];
	readonly sanitizedContent: string;
	readonly timestamp: ISOTimestamp;
}

// ─── Audit Trail ──────────────────────────────────────────────────────

export type AuditEventType =
	| 'session_start'
	| 'session_end'
	| 'tool_call'
	| 'tool_result'
	| 'message_sent'
	| 'message_received'
	| 'memory_read'
	| 'memory_write'
	| 'escalation'
	| 'bounds_check'
	| 'injection_detected'
	| 'credential_access'
	| 'config_change';

export interface AuditEntry {
	readonly timestamp: ISOTimestamp;
	readonly eventType: AuditEventType;
	readonly agentId: AgentId;
	readonly sessionId?: SessionId | undefined;
	readonly details: Readonly<Record<string, unknown>>;
	readonly severity: 'info' | 'warn' | 'error' | 'security';
}

// ─── Audit Store Interface ────────────────────────────────────────────

export interface IAuditStore {
	log(entry: AuditEntry): Promise<void>;
	query(filter: {
		readonly agentId?: AgentId | undefined;
		readonly sessionId?: SessionId | undefined;
		readonly eventType?: AuditEventType | undefined;
		readonly since?: ISOTimestamp | undefined;
		readonly limit?: number | undefined;
	}): Promise<Result<readonly AuditEntry[], ABFError>>;
}
