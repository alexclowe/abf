/**
 * Zod schema for workflow YAML definitions.
 * Handles snake_case YAML → camelCase TypeScript.
 */

import { z } from 'zod';
import type { WorkflowDefinition } from '../types/workflow.js';
import type { WorkflowId } from '../types/common.js';

const workflowStepSchema = z.object({
	id: z.string().min(1),
	agent: z.string().min(1),
	task: z.string().min(1),
	depends_on: z.array(z.string()).optional(),
	parallel: z.boolean().optional(),
	timeout: z.number().int().positive().optional(),
});

export const workflowYamlSchema = z.object({
	name: z.string().min(1),
	display_name: z.string().optional(),
	description: z.string().optional(),
	steps: z.array(workflowStepSchema).min(1),
	timeout: z.number().int().positive().optional(),
	on_failure: z.enum(['stop', 'continue', 'retry']).default('stop'),
});

export type WorkflowYamlInput = z.input<typeof workflowYamlSchema>;

export function transformWorkflowYaml(
	parsed: z.output<typeof workflowYamlSchema>,
	name: string,
): WorkflowDefinition {
	const id = `wf_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}` as WorkflowId;
	return {
		name,
		id,
		displayName: parsed.display_name ?? name,
		description: parsed.description,
		steps: parsed.steps.map((s) => ({
			id: s.id,
			agent: s.agent,
			task: s.task,
			dependsOn: s.depends_on,
			parallel: s.parallel,
			timeout: s.timeout,
		})),
		timeout: parsed.timeout,
		onFailure: parsed.on_failure,
	};
}
