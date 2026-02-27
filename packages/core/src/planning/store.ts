/**
 * InMemoryTaskPlanStore — Map-based task plan storage.
 * Capped at 200 plans, one active plan per agent.
 */

import { nanoid } from 'nanoid';
import type { AgentId } from '../types/common.js';
import { toISOTimestamp } from '../util/id.js';
import type {
	ITaskPlanStore,
	TaskPlan,
	TaskPlanStatus,
	TaskPlanStep,
} from '../types/task-plan.js';

const MAX_PLANS = 200;

export class InMemoryTaskPlanStore implements ITaskPlanStore {
	private readonly store = new Map<string, TaskPlan>();

	create(plan: Omit<TaskPlan, 'id' | 'createdAt' | 'updatedAt'>): TaskPlan {
		// Abandon any existing active plan for this agent
		const existing = this.getActive(plan.agentId);
		if (existing) {
			existing.status = 'abandoned';
			existing.updatedAt = toISOTimestamp();
		}

		const now = toISOTimestamp();
		const entry: TaskPlan = {
			...plan,
			id: `plan_${nanoid(12)}`,
			createdAt: now,
			updatedAt: now,
		};
		this.store.set(entry.id, entry);

		// Evict oldest if over cap
		if (this.store.size > MAX_PLANS) {
			const first = this.store.keys().next().value;
			if (first !== undefined) this.store.delete(first);
		}

		return entry;
	}

	getActive(agentId: AgentId): TaskPlan | undefined {
		for (const plan of this.store.values()) {
			if (plan.agentId === agentId && plan.status === 'active') {
				return plan;
			}
		}
		return undefined;
	}

	get(planId: string): TaskPlan | undefined {
		return this.store.get(planId);
	}

	list(filter?: { agentId?: AgentId; status?: TaskPlanStatus }): readonly TaskPlan[] {
		let entries = [...this.store.values()];
		if (filter?.agentId) {
			entries = entries.filter((p) => p.agentId === filter.agentId);
		}
		if (filter?.status) {
			entries = entries.filter((p) => p.status === filter.status);
		}
		return entries.reverse();
	}

	update(
		planId: string,
		updates: Partial<Pick<TaskPlan, 'status' | 'currentStepId' | 'updatedAt'>>,
	): boolean {
		const plan = this.store.get(planId);
		if (!plan) return false;

		if (updates.status !== undefined) plan.status = updates.status;
		if (updates.currentStepId !== undefined) plan.currentStepId = updates.currentStepId;
		plan.updatedAt = updates.updatedAt ?? toISOTimestamp();
		return true;
	}

	updateStep(
		planId: string,
		stepId: string,
		updates: Partial<Pick<TaskPlanStep, 'status' | 'output' | 'completedAt'>>,
	): boolean {
		const plan = this.store.get(planId);
		if (!plan) return false;

		const step = plan.steps.find((s) => s.id === stepId);
		if (!step) return false;

		if (updates.status !== undefined) step.status = updates.status;
		if (updates.output !== undefined) step.output = updates.output;
		if (updates.completedAt !== undefined) step.completedAt = updates.completedAt;
		plan.updatedAt = toISOTimestamp();
		return true;
	}
}
