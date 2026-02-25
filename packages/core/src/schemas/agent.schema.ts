/**
 * Zod schema for agent YAML definitions.
 * Handles snake_case YAML → camelCase TypeScript, cost parsing, defaults.
 */

import { z } from 'zod';
import type { AgentConfig } from '../types/agent.js';
import type { AgentId, TeamId, USDCents } from '../types/common.js';
import type { TriggerConfig } from '../types/trigger.js';

// ─── Cost Parser ──────────────────────────────────────────────────────

function parseDollarsToCents(value: string | number): USDCents {
	if (typeof value === 'number') return Math.round(value * 100) as USDCents;
	const cleaned = String(value).replace('$', '').trim();
	return Math.round(Number.parseFloat(cleaned) * 100) as USDCents;
}

// ─── Trigger Schema ───────────────────────────────────────────────────

const cronTriggerSchema = z.object({
	type: z.literal('cron'),
	schedule: z.string(),
	task: z.string(),
});

const eventTriggerSchema = z.object({
	type: z.literal('event'),
	event: z.string(),
	task: z.string(),
});

const messageTriggerSchema = z.object({
	type: z.literal('message'),
	from: z.string(),
	task: z.string(),
});

const webhookTriggerSchema = z.object({
	type: z.literal('webhook'),
	path: z.string(),
	method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
	task: z.string(),
});

const manualTriggerSchema = z.object({
	type: z.literal('manual'),
	task: z.string(),
});

const heartbeatTriggerSchema = z.object({
	type: z.literal('heartbeat'),
	interval: z.number().int().positive(),
	task: z.string(),
});

const triggerSchema = z.discriminatedUnion('type', [
	cronTriggerSchema,
	eventTriggerSchema,
	messageTriggerSchema,
	webhookTriggerSchema,
	manualTriggerSchema,
	heartbeatTriggerSchema,
]);

// ─── Behavioral Bounds Schema ─────────────────────────────────────────

const behavioralBoundsSchema = z.object({
	allowed_actions: z.array(z.string()).default([]),
	forbidden_actions: z.array(z.string()).default([]),
	max_cost_per_session: z.union([z.string(), z.number()]).default('$2.00'),
	max_external_requests: z.number().optional(),
	requires_approval: z.array(z.string()).default([]),
});

// ─── Escalation Rule Schema ──────────────────────────────────────────

const escalationRuleSchema = z.object({
	condition: z.string(),
	target: z.string(), // 'human' or agent name
	message: z.string().optional(),
});

// ─── KPI Schema ───────────────────────────────────────────────────────

const kpiSchema = z.object({
	metric: z.string(),
	target: z.string(),
	review: z.enum(['hourly', 'daily', 'weekly', 'monthly']),
});

// ─── Agent Schema (snake_case YAML input) ─────────────────────────────

export const agentYamlSchema = z.object({
	name: z.string(),
	display_name: z.string(),
	role: z.string(),
	description: z.string(),
	provider: z.string().default('anthropic'),
	model: z.string().default('claude-sonnet-4-5'),
	temperature: z.number().min(0).max(2).optional(),
	team: z.string().optional(),
	reports_to: z.string().optional(),
	tools: z.array(z.string()).default([]),
	triggers: z.array(triggerSchema).default([]),
	escalation_rules: z.array(escalationRuleSchema).default([]),
	behavioral_bounds: behavioralBoundsSchema.default({}),
	kpis: z.array(kpiSchema).default([]),
	charter: z.string().default(''),
});

export type AgentYamlInput = z.input<typeof agentYamlSchema>;

// ─── Transform to AgentConfig ─────────────────────────────────────────

export function transformAgentYaml(parsed: z.output<typeof agentYamlSchema>): AgentConfig {
	return {
		name: parsed.name,
		id: parsed.name as AgentId,
		displayName: parsed.display_name,
		role: parsed.role,
		description: parsed.description,
		provider: parsed.provider,
		model: parsed.model,
		temperature: parsed.temperature,
		team: parsed.team as TeamId | undefined,
		reportsTo: parsed.reports_to as AgentId | undefined,
		tools: parsed.tools,
		triggers: parsed.triggers as unknown as readonly TriggerConfig[],
		escalationRules: parsed.escalation_rules.map((r) => ({
			condition: r.condition,
			target: r.target as 'human' | AgentId,
			message: r.message,
		})),
		behavioralBounds: {
			allowedActions: parsed.behavioral_bounds.allowed_actions,
			forbiddenActions: parsed.behavioral_bounds.forbidden_actions,
			maxCostPerSession: parseDollarsToCents(parsed.behavioral_bounds.max_cost_per_session),
			maxExternalRequests: parsed.behavioral_bounds.max_external_requests,
			requiresApproval: parsed.behavioral_bounds.requires_approval,
		},
		kpis: parsed.kpis,
		charter: parsed.charter,
	};
}
