/**
 * delegate-task — real multi-agent orchestration.
 * Lets an orchestrator synchronously invoke another agent, wait for the result,
 * and incorporate it into its response. Uses the event-driven dispatchAndWait()
 * instead of polling.
 */
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';
import type { IDispatcher } from '../../runtime/interfaces.js';
import type { AgentConfig } from '../../types/agent.js';
import { createActivationId, toISOTimestamp } from '../../util/id.js';
import type { Activation } from '../../types/trigger.js';

export function createDelegateTaskTool(
	_ctx: BuiltinToolContext,
	extra: {
		dispatcher: IDispatcher;
		agentsMap: ReadonlyMap<string, AgentConfig>;
	},
): ITool {
	const definition: ToolDefinition = {
		id: 'delegate-task' as ToolId,
		name: 'delegate-task',
		description:
			'Delegate a task to another agent and wait for the result. ' +
			'Runs a full independent AI session for the target agent with their own tools and knowledge. ' +
			'Use this to leverage specialist agents rather than doing everything yourself.',
		source: 'registry',
		parameters: [
			{
				name: 'agent',
				type: 'string',
				description: 'Name of the agent to delegate to',
				required: true,
			},
			{
				name: 'task',
				type: 'string',
				description: 'Task description for the agent',
				required: true,
			},
			{
				name: 'context',
				type: 'string',
				description: 'Additional context to append to the task',
				required: false,
			},
			{
				name: 'timeout_seconds',
				type: 'number',
				description: 'Max seconds to wait for completion (default 120, range 10-300)',
				required: false,
			},
		],
		estimatedCost: 0 as USDCents,
		timeout: 305_000, // slightly longer than the 300s max wait
	};

	return {
		definition,
		async execute(args) {
			const agentName = args['agent'];
			const task = args['task'];

			// Validate required params
			if (typeof agentName !== 'string' || !agentName.trim()) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'delegate-task: agent is required', {}),
				);
			}
			if (typeof task !== 'string' || !task.trim()) {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'delegate-task: task is required', {}),
				);
			}

			// Look up agent
			const agent = extra.agentsMap.get(agentName);
			if (!agent) {
				const available = [...extra.agentsMap.keys()].join(', ');
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`delegate-task: agent '${agentName}' not found. Available agents: ${available}`,
						{},
					),
				);
			}

			// Build combined task
			const context = typeof args['context'] === 'string' ? args['context'].trim() : '';
			const combinedTask = context
				? `${task}\n\nAdditional context:\n${context}`
				: task;

			// Clamp timeout to 10-300s
			const rawTimeout = typeof args['timeout_seconds'] === 'number'
				? args['timeout_seconds']
				: 120;
			const timeoutSeconds = Math.min(300, Math.max(10, rawTimeout));
			const timeoutMs = timeoutSeconds * 1000;

			// Build activation
			const activation: Activation = {
				id: createActivationId(),
				agentId: agent.id,
				trigger: { type: 'manual', task: combinedTask },
				timestamp: toISOTimestamp(),
				payload: { source: 'delegate-task' },
			};

			// Dispatch and wait for result
			const startTime = Date.now();
			const result = await extra.dispatcher.dispatchAndWait(activation, timeoutMs);

			const durationMs = Date.now() - startTime;

			if (result.ok) {
				const session = result.value;
				return Ok({
					success: true,
					agent: agentName,
					agentDisplayName: agent.displayName,
					status: session.status,
					response: session.outputText ?? null,
					escalations: session.escalations.length > 0
						? session.escalations.map((e) => ({
								type: e.type,
								message: e.message,
								target: e.target,
							}))
						: [],
					metadata: {
						sessionId: session.sessionId,
						cost: session.cost,
						toolCallCount: session.toolCalls.length,
						durationMs,
						hasEscalations: session.escalations.length > 0,
					},
				});
			}

			// Handle known dispatch errors gracefully (Ok with success: false)
			const errorCode = result.error.code;
			const errorMessage = result.error.message;

			if (errorCode === 'AGENT_ALREADY_RUNNING') {
				return Ok({
					success: false,
					agent: agentName,
					error: `Agent ${agent.displayName} is currently busy with another task. Try again later or delegate to a different agent.`,
				});
			}

			if (errorCode === 'SESSION_TIMEOUT') {
				return Ok({
					success: false,
					agent: agentName,
					error: `Agent ${agent.displayName} did not complete within ${timeoutSeconds}s. The task may be too complex or the agent may be stuck.`,
				});
			}

			// Other dispatch errors — still recoverable for the LLM
			return Ok({
				success: false,
				agent: agentName,
				error: `Delegation failed: ${errorMessage}`,
			});
		},
	};
}
