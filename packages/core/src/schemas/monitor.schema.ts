/**
 * Zod schema for *.monitor.yaml definitions.
 */

import { z } from 'zod';
import type { MonitorDefinition } from '../types/monitor.js';

export const monitorYamlSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	url: z.string().url(),
	interval: z.string().default('5m'), // e.g., '5m', '1h', '30s'
	agent: z.string(),
	task: z.string(),
	method: z.enum(['GET', 'POST']).optional(),
	headers: z.record(z.string()).optional(),
});

function parseInterval(interval: string): number {
	const match = /^(\d+)(s|m|h)$/.exec(interval);
	if (!match) return 300_000; // default 5 minutes
	const value = Number(match[1]);
	const unit = match[2];
	if (unit === 's') return value * 1000;
	if (unit === 'm') return value * 60_000;
	if (unit === 'h') return value * 3_600_000;
	return 300_000;
}

export function transformMonitorYaml(
	parsed: z.output<typeof monitorYamlSchema>,
): MonitorDefinition {
	const result: MonitorDefinition & Record<string, unknown> = {
		name: parsed.name,
		url: parsed.url,
		intervalMs: parseInterval(parsed.interval),
		agentId: parsed.agent,
		task: parsed.task,
	};
	if (parsed.description != null) (result as { description?: string }).description = parsed.description;
	if (parsed.method != null) (result as { method?: string }).method = parsed.method;
	if (parsed.headers != null) (result as { headers?: Record<string, string> }).headers = parsed.headers;
	return result;
}
