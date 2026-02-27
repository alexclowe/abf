/**
 * Task Plan API routes — view and manage agent task plans.
 */

import type { Hono } from 'hono';
import type { AgentId } from '../../types/common.js';
import type { ITaskPlanStore } from '../../types/task-plan.js';

export function registerPlanRoutes(
	app: Hono,
	deps: { taskPlanStore: ITaskPlanStore; agentsMap: ReadonlyMap<string, unknown> },
): void {
	const { taskPlanStore } = deps;

	// List all plans
	app.get('/api/plans', (c) => {
		const { agentId, status } = c.req.query();
		const filter: { agentId?: AgentId; status?: 'active' | 'completed' | 'abandoned' } = {};
		if (agentId) filter.agentId = agentId as AgentId;
		if (status === 'active' || status === 'completed' || status === 'abandoned') {
			filter.status = status;
		}
		return c.json(taskPlanStore.list(filter));
	});

	// Get active plan for an agent
	app.get('/api/agents/:id/plan', (c) => {
		const agentId = c.req.param('id') as AgentId;
		if (!deps.agentsMap.has(agentId)) {
			return c.json({ error: 'Agent not found' }, 404);
		}
		const plan = taskPlanStore.getActive(agentId);
		if (!plan) return c.json({ message: 'No active plan' }, 404);
		return c.json(plan);
	});

	// Create a plan for an agent (operator use)
	app.post('/api/agents/:id/plan', async (c) => {
		const agentId = c.req.param('id') as AgentId;
		if (!deps.agentsMap.has(agentId)) {
			return c.json({ error: 'Agent not found' }, 404);
		}

		const body = await c.req.json<{
			goal: string;
			steps: Array<{ id: string; description: string; dependsOn?: string[] }>;
		}>();

		if (!body.goal || !body.steps || body.steps.length === 0) {
			return c.json({ error: 'goal and steps are required' }, 400);
		}

		const plan = taskPlanStore.create({
			agentId,
			goal: body.goal,
			steps: body.steps.map((s) => ({
				id: s.id,
				description: s.description,
				status: 'pending' as const,
				dependsOn: s.dependsOn,
			})),
			currentStepId: body.steps[0]?.id ?? null,
			status: 'active',
		});

		return c.json(plan, 201);
	});
}
