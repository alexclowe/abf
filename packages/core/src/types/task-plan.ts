/**
 * Task Plan types — multi-session planning for agents.
 * A task plan breaks a complex goal into steps that span multiple sessions.
 */

import type { AgentId, ISOTimestamp } from './common.js';

export type TaskPlanStatus = 'active' | 'completed' | 'abandoned';
export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface TaskPlanStep {
	readonly id: string;
	readonly description: string;
	status: StepStatus;
	readonly dependsOn?: readonly string[] | undefined;
	output?: string | undefined;
	completedAt?: ISOTimestamp | undefined;
}

export interface TaskPlan {
	readonly id: string;
	readonly agentId: AgentId;
	readonly goal: string;
	readonly steps: TaskPlanStep[];
	currentStepId: string | null;
	status: TaskPlanStatus;
	readonly createdAt: ISOTimestamp;
	updatedAt: ISOTimestamp;
}

export interface ITaskPlanStore {
	/** Create a new plan. Only one active plan per agent. */
	create(plan: Omit<TaskPlan, 'id' | 'createdAt' | 'updatedAt'>): TaskPlan;

	/** Get the active plan for an agent. */
	getActive(agentId: AgentId): TaskPlan | undefined;

	/** Get a plan by ID. */
	get(planId: string): TaskPlan | undefined;

	/** List all plans, optionally filtered by agent or status. */
	list(filter?: { agentId?: AgentId; status?: TaskPlanStatus }): readonly TaskPlan[];

	/** Update a plan. */
	update(planId: string, updates: Partial<Pick<TaskPlan, 'status' | 'currentStepId' | 'updatedAt'>>): boolean;

	/** Update a step within a plan. */
	updateStep(planId: string, stepId: string, updates: Partial<Pick<TaskPlanStep, 'status' | 'output' | 'completedAt'>>): boolean;
}
