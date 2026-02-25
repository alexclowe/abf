/**
 * Zod schema for custom tool definitions.
 */

import { z } from 'zod';
import type { ToolId, USDCents } from '../types/common.js';
import type { ToolDefinition } from '../types/tool.js';

const toolParameterSchema = z.object({
	name: z.string(),
	type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
	description: z.string(),
	required: z.boolean().default(true),
	default: z.unknown().optional(),
});

export const toolYamlSchema = z.object({
	name: z.string(),
	description: z.string(),
	source: z.enum(['registry', 'mcp', 'custom']).default('custom'),
	parameters: z.array(toolParameterSchema).default([]),
	estimated_cost: z.number().optional(),
	timeout: z.number().optional(),
	requires_approval: z.boolean().optional(),
});

export type ToolYamlInput = z.input<typeof toolYamlSchema>;

export function transformToolYaml(parsed: z.output<typeof toolYamlSchema>): ToolDefinition {
	return {
		id: parsed.name as ToolId,
		name: parsed.name,
		description: parsed.description,
		source: parsed.source,
		parameters: parsed.parameters,
		estimatedCost:
			parsed.estimated_cost != null
				? (Math.round(parsed.estimated_cost * 100) as USDCents)
				: undefined,
		timeout: parsed.timeout,
		requiresApproval: parsed.requires_approval,
	};
}
