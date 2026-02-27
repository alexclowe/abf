/**
 * ask-human — allows agents to ask humans free-form questions.
 * Creates an inquiry in the approval store that operators can answer
 * via the dashboard or API. Agent should call reschedule to check back.
 */

import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { AgentId, SessionId, ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import type { IApprovalStore } from '../../types/approval.js';
import { toISOTimestamp } from '../../util/id.js';

export function createAskHumanTool(approvalStore: IApprovalStore): ITool {
	const definition: ToolDefinition = {
		id: 'ask-human' as ToolId,
		name: 'ask-human',
		description:
			'Ask a human operator a question and get a free-form answer. ' +
			'The question will appear in the dashboard approval queue. ' +
			'Use reschedule to check back for the answer in a later session.',
		source: 'registry',
		parameters: [
			{
				name: 'question',
				type: 'string',
				description: 'The question to ask the human operator',
				required: true,
			},
			{
				name: 'context',
				type: 'string',
				description: 'Additional context to help the operator answer',
				required: false,
			},
			{
				name: 'options',
				type: 'string',
				description: 'Suggested answer options (comma-separated), if applicable',
				required: false,
			},
			{
				name: 'priority',
				type: 'string',
				description: 'Priority level: low, normal, high, urgent. Default: normal',
				required: false,
			},
			{
				name: 'agent_id',
				type: 'string',
				description: 'Agent ID (auto-populated from session context)',
				required: true,
			},
			{
				name: 'session_id',
				type: 'string',
				description: 'Session ID (auto-populated from session context)',
				required: true,
			},
		],
		estimatedCost: 0 as USDCents,
	};

	return {
		definition,
		async execute(args) {
			const question = args['question'] as string;
			const agentId = args['agent_id'] as AgentId;
			const sessionId = (args['session_id'] ?? '') as SessionId;

			if (!question?.trim()) {
				return Err(new ToolError('TOOL_EXECUTION_FAILED', 'ask-human: question is required', {}));
			}

			const context = args['context'] as string | undefined;
			const options = args['options'] as string | undefined;

			const inquiryId = approvalStore.create({
				agentId,
				sessionId,
				toolId: 'ask-human' as ToolId,
				toolName: 'ask-human',
				arguments: { question, context, options },
				createdAt: toISOTimestamp(),
				type: 'inquiry',
				question,
			});

			return Ok({
				inquiryId,
				status: 'pending',
				message: `Your question has been sent to the operator. Use reschedule to check back for the answer.`,
			});
		},
	};
}
