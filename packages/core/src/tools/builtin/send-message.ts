/**
 * send-message -- send a message to a human via email, Slack, or Discord.
 * Routes to configured messaging plugins (from interfaces/*.interface.yaml).
 * Default requiresApproval: true -- agents must list 'send_client_email' in
 * behavioral_bounds.allowed_actions to use this without escalation.
 *
 * If an approval store is available and the tool is in the agent's
 * requires_approval list, the action is queued for human review.
 */
import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { AgentId, SessionId, ToolId, USDCents } from '../../types/common.js';
import { Ok, Err, ToolError } from '../../types/errors.js';
import { toISOTimestamp } from '../../util/id.js';
import type { BuiltinToolContext } from './context.js';

// Rate limit: track messages sent per agent per runtime session
const sessionMessageCounts = new Map<string, number>();
const MAX_MESSAGES_PER_SESSION = 10;

export function createSendMessageTool(ctx: BuiltinToolContext): ITool {
	const definition: ToolDefinition = {
		id: 'send-message' as ToolId,
		name: 'send-message',
		description:
			'Send a message to a human via email, Slack, or Discord. ' +
			'Requires the channel to be configured in interfaces/. ' +
			'Messages to external parties require send_client_email in behavioral_bounds.allowed_actions.',
		source: 'registry',
		parameters: [
			{
				name: 'channel',
				type: 'string',
				description: 'Delivery channel: "email", "slack", or "discord"',
				required: true,
			},
			{
				name: 'to',
				type: 'string',
				description: 'Recipient: email address, Slack channel/user, or Discord channel',
				required: true,
			},
			{
				name: 'body',
				type: 'string',
				description: 'Message body (supports markdown)',
				required: true,
			},
			{
				name: 'subject',
				type: 'string',
				description: 'Message subject (required for email)',
				required: false,
			},
			{
				name: 'template',
				type: 'string',
				description: 'Name of a message template to use (from templates/messages/)',
				required: false,
			},
			{
				name: 'variables',
				type: 'object',
				description: 'Variables to resolve in the template (key-value pairs)',
				required: false,
			},
		],
		estimatedCost: 0 as USDCents,
		timeout: 15_000,
		requiresApproval: true,
	};

	return {
		definition,
		async execute(args) {
			const channel = args['channel'];
			const to = args['to'];
			let body = args['body'];
			let subject = args['subject'];

			// Resolve message template if provided
			if (typeof args['template'] === 'string' && ctx.messageTemplates) {
				const vars = (args['variables'] as Record<string, string>) ?? {};
				const resolved = ctx.messageTemplates.resolve(args['template'], vars);
				if (resolved) {
					body = resolved.body;
					if (resolved.subject) subject = resolved.subject;
				}
			}

			if (typeof channel !== 'string') {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'send-message: channel is required', {}),
				);
			}
			if (typeof to !== 'string') {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'send-message: to is required', {}),
				);
			}
			if (typeof body !== 'string') {
				return Err(
					new ToolError('TOOL_EXECUTION_FAILED', 'send-message: body is required', {}),
				);
			}
			if (channel === 'email' && typeof subject !== 'string') {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						'send-message: subject is required for email',
						{},
					),
				);
			}

			// Check if this action should be queued for approval
			if (ctx.approvalStore) {
				const approvalId = ctx.approvalStore.create({
					agentId: (args['_agentId'] as AgentId) ?? ('unknown' as AgentId),
					sessionId: (args['_sessionId'] as SessionId) ?? ('unknown' as SessionId),
					toolId: 'send-message' as ToolId,
					toolName: 'send-message',
					arguments: { channel, to, body, subject: args['subject'] },
					createdAt: toISOTimestamp(),
				});
				return Ok({
					sent: false,
					queued: true,
					approvalId,
					message: 'Message queued for approval. An operator must approve before delivery.',
				});
			}

			// Find the matching plugin
			const entry = ctx.messagingPlugins.find(e => e.plugin.type === channel);
			if (!entry) {
				return Ok({
					sent: false,
					channel,
					queuedForApproval: false,
					error:
						`No ${channel} plugin configured. ` +
						`Create interfaces/${channel}.interface.yaml to enable this channel.`,
				});
			}

			// Rate limiting per runtime session (using channel+to as key)
			const rateKey = `${channel}:${to}`;
			const count = sessionMessageCounts.get(rateKey) ?? 0;
			if (count >= MAX_MESSAGES_PER_SESSION) {
				return Err(
					new ToolError(
						'TOOL_EXECUTION_FAILED',
						`send-message: rate limit reached (max ${String(MAX_MESSAGES_PER_SESSION)} messages to ${to} per session)`,
						{},
					),
				);
			}
			sessionMessageCounts.set(rateKey, count + 1);

			// Construct notification -- reuse AgentNotification shape
			const notification = {
				type: 'alert' as const,
				severity: 'info' as const,
				agentId: 'system' as AgentId,
				sessionId: 'tool-call' as SessionId,
				message: body,
				timestamp: toISOTimestamp(),
				context: {
					to,
					channel,
					...(typeof subject === 'string' ? { subject: subject } : {}),
				},
			};

			await entry.plugin.send(notification);

			return Ok({
				sent: true,
				channel,
				queuedForApproval: false,
			});
		},
	};
}
