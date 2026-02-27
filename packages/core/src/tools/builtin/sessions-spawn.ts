/**
 * sessions-spawn -- allow an agent to activate another agent's session.
 * Supports fire-and-forget or wait-for-result modes.
 */
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';
import type { IDispatcher } from '../../runtime/interfaces.js';
import type { AgentConfig } from '../../types/agent.js';
import { createActivationId, toISOTimestamp } from '../../util/id.js';
import type { Activation } from '../../types/trigger.js';

export function createSessionsSpawnTool(
	_ctx: BuiltinToolContext,
	extra: {
		dispatcher: IDispatcher;
		agentsMap: ReadonlyMap<string, AgentConfig>;
	},
): ITool {
	const definition: ToolDefinition = {
		id: 'sessions-spawn' as ToolId,
		name: 'sessions-spawn',
		description:
			'Activate another agent by spawning a new work session. ' +
			'Use wait=true to block until the session completes and get the result.',
		source: 'registry',
		parameters: [
			{
				name: 'agent',
				type: 'string',
				description: 'Name or ID of the agent to activate',
				required: true,
			},
			{
				name: 'task',
				type: 'string',
				description: 'Task description to send to the agent',
				required: true,
			},
			{
				name: 'payload',
				type: 'object',
				description: 'Additional data to pass to the agent session',
				required: false,
			},
			{
				name: 'wait',
				type: 'boolean',
				description: 'If true, wait for the session to complete and return the result (up to 60s)',
				required: false,
			},
		],
		estimatedCost: 0 as USDCents,
		timeout: 65_000, // slightly longer than the 60s wait max
	};

	return {
		definition,
		async execute(args) {
			const agentName = args['agent'];
			const task = args['task'];
			if (typeof agentName !== 'string' || !agentName.trim()) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'sessions-spawn: agent is required', {}),
				);
			}
			if (typeof task !== 'string' || !task.trim()) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'sessions-spawn: task is required', {}),
				);
			}

			// Look up agent
			const agent = extra.agentsMap.get(agentName);
			if (!agent) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`sessions-spawn: agent '${agentName}' not found`,
						{},
					),
				);
			}

			const payload =
				typeof args['payload'] === 'object' && args['payload'] !== null
					? (args['payload'] as Record<string, unknown>)
					: {};
			const wait = args['wait'] === true;

			const activation: Activation = {
				id: createActivationId(),
				agentId: agent.id,
				trigger: { type: 'manual', task },
				timestamp: toISOTimestamp(),
				payload,
			};

			const dispatchResult = await extra.dispatcher.dispatch(activation);
			if (!dispatchResult.ok) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`sessions-spawn: dispatch failed: ${dispatchResult.error.message}`,
						{},
					),
				);
			}

			const sessionId = dispatchResult.value;

			if (!wait) {
				return Ok({ sessionId, status: 'dispatched' });
			}

			// Poll for completion (max 60s, every 500ms)
			const deadline = Date.now() + 60_000;
			while (Date.now() < deadline) {
				const result = extra.dispatcher.getSessionResult(sessionId);
				if (result) {
					return Ok({
						sessionId,
						status: result.status,
						outputText: result.outputText ?? null,
						cost: result.cost,
					});
				}
				await new Promise<void>((resolve) => setTimeout(resolve, 500));
			}

			return Ok({ sessionId, status: 'timeout', outputText: null });
		},
	};
}
