/**
 * WorkflowRunner — executes multi-agent workflow definitions.
 * Handles sequential and parallel steps with dependency ordering.
 * Supports data flow between steps via {{steps.<stepId>.output}} interpolation.
 */

import { nanoid } from 'nanoid';
import type { AgentConfig } from '../types/agent.js';
import type { AgentId } from '../types/common.js';
import type {
	WorkflowDefinition,
	WorkflowRun,
	WorkflowRunStatus,
	WorkflowStep,
	WorkflowStepResult,
} from '../types/workflow.js';
import { createActivationId, toISOTimestamp } from '../util/id.js';
import type { IDispatcher } from './interfaces.js';

export class WorkflowRunner {
	/** Name→AgentConfig index for O(1) lookup by agent name in workflow steps. */
	private readonly agentsByName: Map<string, AgentConfig>;

	constructor(
		private readonly dispatcher: IDispatcher,
		agentsMap: ReadonlyMap<string, AgentConfig>,
	) {
		this.agentsByName = new Map();
		for (const agent of agentsMap.values()) {
			this.agentsByName.set(agent.name, agent);
		}
	}

	async run(
		workflow: WorkflowDefinition,
		input: Record<string, unknown>,
	): Promise<WorkflowRun> {
		const runId = nanoid();
		const startedAt = toISOTimestamp();
		const stepResults: WorkflowStepResult[] = [];
		let runStatus: WorkflowRunStatus = 'running';

		// Context accumulates step outputs for interpolation into subsequent tasks
		const context: Record<string, unknown> = { ...input };

		try {
			const waves = this.buildWaves(workflow.steps);

			for (const wave of waves) {
				if (runStatus === 'failed' && workflow.onFailure === 'stop') break;

				const waveResults = await Promise.all(
					wave.map((step) => this.executeStep(step, context)),
				);

				for (const result of waveResults) {
					stepResults.push(result);
					// Accumulate step outputs for downstream interpolation
					if (result.output) {
						context[`steps.${result.stepId}.output`] = result.output;
					}
					if (result.status === 'failed' || result.status === 'timeout') {
						runStatus = result.status;
					}
				}
			}

			if (runStatus === 'running') runStatus = 'completed';
		} catch {
			runStatus = 'failed';
		}

		return {
			id: runId,
			workflowName: workflow.name,
			status: runStatus,
			input,
			startedAt,
			completedAt: toISOTimestamp(),
			steps: stepResults,
		};
	}

	private async executeStep(
		step: WorkflowStep,
		context: Record<string, unknown>,
	): Promise<WorkflowStepResult> {
		const startedAt = toISOTimestamp();
		const task = this.interpolate(step.task, context);

		// Find agent by name (O(1) via index)
		const agent = this.agentsByName.get(step.agent);
		if (!agent) {
			return {
				stepId: step.id,
				agentName: step.agent,
				sessionId: '',
				status: 'failed',
				startedAt,
				completedAt: toISOTimestamp(),
				error: `Agent "${step.agent}" not found`,
			};
		}

		const activation = {
			id: createActivationId(),
			agentId: agent.id as AgentId,
			trigger: { type: 'manual' as const, task },
			timestamp: startedAt,
			payload: { workflowInput: context },
		};

		// Use dispatchAndWait to get the session result (R2)
		const timeoutMs = step.timeout ? step.timeout * 1000 : 300_000;
		const result = await this.dispatcher.dispatchAndWait(activation, timeoutMs);
		const completedAt = toISOTimestamp();

		if (!result.ok) {
			return {
				stepId: step.id,
				agentName: step.agent,
				sessionId: '',
				status: result.error.code === 'SESSION_TIMEOUT' ? 'timeout' : 'failed',
				startedAt,
				completedAt,
				error: result.error.message,
			};
		}

		return {
			stepId: step.id,
			agentName: step.agent,
			sessionId: result.value.sessionId,
			status: result.value.status === 'completed' ? 'completed' : 'failed',
			startedAt,
			completedAt,
			output: result.value.outputText,
			error: result.value.status !== 'completed' ? result.value.error : undefined,
		};
	}

	/** Build execution waves via topological sort. */
	private buildWaves(steps: readonly WorkflowStep[]): WorkflowStep[][] {
		const completed = new Set<string>();
		const remaining = [...steps];
		const waves: WorkflowStep[][] = [];

		while (remaining.length > 0) {
			const ready = remaining.filter(
				(step) => !step.dependsOn || step.dependsOn.every((dep) => completed.has(dep)),
			);

			if (ready.length === 0) {
				// Circular dependency — add remaining as one wave to avoid infinite loop
				waves.push([...remaining]);
				break;
			}

			waves.push(ready);
			for (const step of ready) {
				completed.add(step.id);
				const idx = remaining.indexOf(step);
				if (idx >= 0) remaining.splice(idx, 1);
			}
		}

		return waves;
	}

	/**
	 * Replace {{input.key}} and {{steps.<stepId>.output}} with values from context.
	 * Supports dot-path access for nested step outputs.
	 */
	private interpolate(template: string, context: Record<string, unknown>): string {
		return template.replace(/\{\{([^}]+)\}\}/g, (match, path: string) => {
			// Try direct key first (handles both "input.key" and "steps.step1.output" flat keys)
			const directVal = context[path];
			if (directVal !== undefined) return String(directVal);

			// Try nested dot-path traversal (for "input.nested.key" patterns)
			const parts = path.split('.');
			let current: unknown = context;
			for (const part of parts) {
				if (current == null || typeof current !== 'object') return match;
				current = (current as Record<string, unknown>)[part];
			}
			return current !== undefined ? String(current) : match;
		});
	}
}
