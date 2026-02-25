/**
 * Workflow types — multi-agent coordination definitions.
 */

import type { WorkflowId } from './common.js';

export interface WorkflowStep {
	readonly id: string;
	readonly agent: string;
	readonly task: string;
	readonly dependsOn?: readonly string[] | undefined;
	readonly parallel?: boolean | undefined;
	readonly timeout?: number | undefined;
}

export type WorkflowOnFailure = 'stop' | 'continue' | 'retry';

export interface WorkflowDefinition {
	readonly name: string;
	readonly id: WorkflowId;
	readonly displayName: string;
	readonly description?: string | undefined;
	readonly steps: readonly WorkflowStep[];
	readonly timeout?: number | undefined;
	readonly onFailure: WorkflowOnFailure;
}

export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';

export interface WorkflowStepResult {
	readonly stepId: string;
	readonly agentName: string;
	readonly sessionId: string;
	readonly status: WorkflowRunStatus;
	readonly startedAt: string;
	readonly completedAt?: string | undefined;
	readonly error?: string | undefined;
}

export interface WorkflowRun {
	readonly id: string;
	readonly workflowName: string;
	readonly status: WorkflowRunStatus;
	readonly input: Record<string, unknown>;
	readonly startedAt: string;
	readonly completedAt?: string | undefined;
	readonly steps: WorkflowStepResult[];
}
