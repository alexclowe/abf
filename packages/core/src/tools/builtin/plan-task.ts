/**
 * plan-task — multi-session task planning tool.
 * Allows agents to create, update, and track plans that span multiple sessions.
 */

import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { AgentId, ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { ITaskPlanStore, StepStatus } from '../../types/task-plan.js';
import { toISOTimestamp } from '../../util/id.js';

export function createPlanTaskTool(
	taskPlanStore: ITaskPlanStore,
): ITool {
	const definition: ToolDefinition = {
		id: 'plan-task' as ToolId,
		name: 'plan-task',
		description:
			'Create and manage multi-session task plans. Break complex goals into steps ' +
			'that can be worked on across multiple sessions. Use with reschedule for continuity.',
		source: 'registry',
		parameters: [
			{
				name: 'action',
				type: 'string',
				description: 'Action to perform: create, update-step, next, abandon, status',
				required: true,
			},
			{
				name: 'goal',
				type: 'string',
				description: 'Goal description (required for "create" action)',
				required: false,
			},
			{
				name: 'steps',
				type: 'object',
				description: 'Array of step objects with id and description (required for "create")',
				required: false,
			},
			{
				name: 'step_id',
				type: 'string',
				description: 'Step ID (required for "update-step")',
				required: false,
			},
			{
				name: 'step_status',
				type: 'string',
				description: 'Step status: pending, in_progress, completed, skipped (for "update-step")',
				required: false,
			},
			{
				name: 'step_output',
				type: 'string',
				description: 'Step output/notes (for "update-step")',
				required: false,
			},
			{
				name: 'agent_id',
				type: 'string',
				description: 'Agent ID (auto-populated from session context)',
				required: true,
			},
		],
		estimatedCost: 0 as USDCents,
	};

	return {
		definition,
		async execute(args) {
			const action = args['action'] as string;
			const agentId = args['agent_id'] as AgentId;

			if (!agentId) {
				return Err(new ToolError('TOOL_EXECUTION_FAILED', 'plan-task: agent_id is required', {}));
			}

			switch (action) {
				case 'create': {
					const goal = args['goal'] as string;
					const stepsRaw = args['steps'] as Array<{ id: string; description: string; dependsOn?: string[] }> | undefined;

					if (!goal || !stepsRaw || !Array.isArray(stepsRaw) || stepsRaw.length === 0) {
						return Err(new ToolError('TOOL_EXECUTION_FAILED', 'plan-task: goal and steps are required for create', {}));
					}

					const plan = taskPlanStore.create({
						agentId,
						goal,
						steps: stepsRaw.map((s) => ({
							id: s.id,
							description: s.description,
							status: 'pending' as const,
							dependsOn: s.dependsOn,
						})),
						currentStepId: stepsRaw[0]?.id ?? null,
						status: 'active',
					});

					return Ok({
						planId: plan.id,
						goal: plan.goal,
						stepCount: plan.steps.length,
						currentStep: plan.currentStepId,
						message: 'Plan created. Use reschedule to continue in next session.',
					});
				}

				case 'update-step': {
					const plan = taskPlanStore.getActive(agentId);
					if (!plan) {
						return Err(new ToolError('TOOL_EXECUTION_FAILED', 'plan-task: no active plan', {}));
					}

					const stepId = args['step_id'] as string;
					const stepStatus = args['step_status'] as StepStatus | undefined;
					const stepOutput = args['step_output'] as string | undefined;

					if (!stepId) {
						return Err(new ToolError('TOOL_EXECUTION_FAILED', 'plan-task: step_id is required', {}));
					}

					const updated = taskPlanStore.updateStep(plan.id, stepId, {
						status: stepStatus,
						output: stepOutput,
						completedAt: stepStatus === 'completed' ? toISOTimestamp() : undefined,
					});

					if (!updated) {
						return Err(new ToolError('TOOL_EXECUTION_FAILED', `plan-task: step ${stepId} not found`, {}));
					}

					return Ok({ planId: plan.id, stepId, status: stepStatus, updated: true });
				}

				case 'next': {
					const plan = taskPlanStore.getActive(agentId);
					if (!plan) {
						return Ok({ message: 'No active plan', hasNext: false });
					}

					// Find next pending step
					const nextStep = plan.steps.find((s) => s.status === 'pending');
					if (!nextStep) {
						taskPlanStore.update(plan.id, { status: 'completed' });
						return Ok({ message: 'All steps completed. Plan marked as completed.', hasNext: false });
					}

					taskPlanStore.update(plan.id, { currentStepId: nextStep.id });
					return Ok({
						planId: plan.id,
						currentStep: nextStep.id,
						description: nextStep.description,
						hasNext: true,
						remainingSteps: plan.steps.filter((s) => s.status === 'pending').length,
					});
				}

				case 'abandon': {
					const plan = taskPlanStore.getActive(agentId);
					if (!plan) {
						return Ok({ message: 'No active plan to abandon' });
					}
					taskPlanStore.update(plan.id, { status: 'abandoned' });
					return Ok({ planId: plan.id, status: 'abandoned' });
				}

				case 'status': {
					const plan = taskPlanStore.getActive(agentId);
					if (!plan) {
						return Ok({ message: 'No active plan', hasActivePlan: false });
					}
					return Ok({
						planId: plan.id,
						goal: plan.goal,
						status: plan.status,
						currentStep: plan.currentStepId,
						steps: plan.steps.map((s) => ({
							id: s.id,
							description: s.description,
							status: s.status,
							output: s.output,
						})),
						completedSteps: plan.steps.filter((s) => s.status === 'completed').length,
						totalSteps: plan.steps.length,
					});
				}

				default:
					return Err(new ToolError('TOOL_EXECUTION_FAILED', `plan-task: unknown action "${action}"`, {}));
			}
		},
	};
}
