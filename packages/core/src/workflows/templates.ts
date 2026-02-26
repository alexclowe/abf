/**
 * Built-in workflow templates — common multi-agent coordination patterns.
 */

export interface WorkflowTemplateDefinition {
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly pattern: 'fan-out-synthesize' | 'sequential-pipeline' | 'event-triggered';
	readonly steps: readonly WorkflowTemplateStep[];
	readonly timeout?: number;
	readonly onFailure: string;
}

export interface WorkflowTemplateStep {
	readonly id: string;
	readonly agentPlaceholder: string;
	readonly task: string;
	readonly dependsOn?: readonly string[];
	readonly parallel?: boolean;
}

/**
 * Fan-Out-Synthesize: Send a task to N agents in parallel, then synthesize results.
 * Use case: Research a topic from multiple angles, then combine findings.
 */
export const fanOutSynthesize: WorkflowTemplateDefinition = {
	name: 'fan-out-synthesize',
	displayName: 'Fan-Out & Synthesize',
	description:
		'Send a task to multiple agents in parallel, then have an orchestrator synthesize the results.',
	pattern: 'fan-out-synthesize',
	steps: [
		{ id: 'research-1', agentPlaceholder: 'AGENT_1', task: 'Research aspect 1 of the topic', parallel: true },
		{ id: 'research-2', agentPlaceholder: 'AGENT_2', task: 'Research aspect 2 of the topic', parallel: true },
		{ id: 'research-3', agentPlaceholder: 'AGENT_3', task: 'Research aspect 3 of the topic', parallel: true },
		{
			id: 'synthesize',
			agentPlaceholder: 'ORCHESTRATOR',
			task: 'Synthesize research findings into a unified report',
			dependsOn: ['research-1', 'research-2', 'research-3'],
		},
	],
	timeout: 600,
	onFailure: 'continue',
};

/**
 * Sequential Pipeline: Each agent processes output from the previous one.
 * Use case: Draft → Edit → Review → Publish pipeline.
 */
export const sequentialPipeline: WorkflowTemplateDefinition = {
	name: 'sequential-pipeline',
	displayName: 'Sequential Pipeline',
	description:
		'Process through a chain of agents, each building on the previous output.',
	pattern: 'sequential-pipeline',
	steps: [
		{ id: 'step-1', agentPlaceholder: 'AGENT_1', task: 'Create initial draft' },
		{ id: 'step-2', agentPlaceholder: 'AGENT_2', task: 'Review and improve the draft', dependsOn: ['step-1'] },
		{ id: 'step-3', agentPlaceholder: 'AGENT_3', task: 'Final review and polish', dependsOn: ['step-2'] },
	],
	timeout: 300,
	onFailure: 'abort',
};

/**
 * Event-Triggered: An agent monitors for events, then triggers a response chain.
 * Use case: Monitor → Analyze → Alert pipeline.
 */
export const eventTriggered: WorkflowTemplateDefinition = {
	name: 'event-triggered',
	displayName: 'Event-Triggered Response',
	description:
		'Monitor for events, analyze them, and trigger appropriate responses.',
	pattern: 'event-triggered',
	steps: [
		{ id: 'monitor', agentPlaceholder: 'MONITOR', task: 'Check for new events or changes' },
		{ id: 'analyze', agentPlaceholder: 'ANALYST', task: 'Analyze detected events', dependsOn: ['monitor'] },
		{ id: 'respond', agentPlaceholder: 'RESPONDER', task: 'Execute appropriate response', dependsOn: ['analyze'] },
	],
	timeout: 120,
	onFailure: 'continue',
};

/**
 * All built-in workflow templates.
 */
export const BUILTIN_WORKFLOW_TEMPLATES: readonly WorkflowTemplateDefinition[] = [
	fanOutSynthesize,
	sequentialPipeline,
	eventTriggered,
];

/**
 * Get a workflow template by name.
 */
export function getWorkflowTemplate(name: string): WorkflowTemplateDefinition | undefined {
	return BUILTIN_WORKFLOW_TEMPLATES.find((t) => t.name === name);
}
