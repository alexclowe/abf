/**
 * WorkflowRunner — executes multi-agent workflow definitions.
 * Handles sequential and parallel steps with dependency ordering.
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
	constructor(
		private readonly dispatcher: IDispatcher,
		private readonly agentsMap: ReadonlyMap<string, AgentConfig>,
	) {}

	async run(
		workflow: WorkflowDefinition,
		input: Record<string, unknown>,
	): Promise<WorkflowRun> {
		const runId = nanoid();
		const startedAt = toISOTimestamp();
		const stepResults: WorkflowStepResult[] = [];
		let runStatus: WorkflowRunStatus = 'running';

		try {
			const waves = this.buildWaves(workflow.steps);

			for (const wave of waves) {
				if (runStatus === 'failed' && workflow.onFailure === 'stop') break;

				const waveResults = await Promise.all(
					wave.map((step) => this.executeStep(step, input)),
				);

				for (const result of waveResults) {
					stepResults.push(result);
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
		input: Record<string, unknown>,
	): Promise<WorkflowStepResult> {
		const startedAt = toISOTimestamp();
		const task = this.interpolate(step.task, input);

		// Find agent by name
		const agent = [...this.agentsMap.values()].find((a) => a.name === step.agent);
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
			payload: { workflowInput: input },
		};

		const result = await this.dispatcher.dispatch(activation);
		const completedAt = toISOTimestamp();

		if (!result.ok) {
			return {
				stepId: step.id,
				agentName: step.agent,
				sessionId: '',
				status: 'failed',
				startedAt,
				completedAt,
				error: result.error.message,
			};
		}

		return {
			stepId: step.id,
			agentName: step.agent,
			sessionId: result.value,
			status: 'completed',
			startedAt,
			completedAt,
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

	/** Replace {{input.key}} with value from input object. */
	private interpolate(template: string, input: Record<string, unknown>): string {
		return template.replace(/\{\{input\.([^}]+)\}\}/g, (match, key: string) => {
			const val = input[key];
			return val !== undefined ? String(val) : match;
		});
	}
}
