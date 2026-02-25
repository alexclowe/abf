/**
 * Trigger types — what activates agents.
 * Uses discriminated unions so each trigger type carries only its relevant fields.
 */

import type { ActivationId, AgentId, ISOTimestamp } from './common.js';

// ─── Trigger Configs (discriminated union) ────────────────────────────

export interface CronTrigger {
	readonly type: 'cron';
	readonly schedule: string; // cron expression
	readonly task: string;
}

export interface EventTrigger {
	readonly type: 'event';
	readonly event: string;
	readonly task: string;
}

export interface MessageTrigger {
	readonly type: 'message';
	readonly from: AgentId | '*';
	readonly task: string;
}

export interface WebhookTrigger {
	readonly type: 'webhook';
	readonly path: string;
	readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined;
	readonly task: string;
}

export interface ManualTrigger {
	readonly type: 'manual';
	readonly task: string;
}

export interface HeartbeatTrigger {
	readonly type: 'heartbeat';
	/** Seconds to wait after a session completes before running again. */
	readonly interval: number;
	readonly task: string;
}

export type TriggerConfig =
	| CronTrigger
	| EventTrigger
	| MessageTrigger
	| WebhookTrigger
	| ManualTrigger
	| HeartbeatTrigger;

// ─── Activation ───────────────────────────────────────────────────────
// An activation is the runtime event that fires when a trigger condition is met.

export interface Activation {
	readonly id: ActivationId;
	readonly agentId: AgentId;
	readonly trigger: TriggerConfig;
	readonly timestamp: ISOTimestamp;
	readonly payload?: Readonly<Record<string, unknown>> | undefined;
}
