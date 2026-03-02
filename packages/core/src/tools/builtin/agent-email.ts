/**
 * agent-email — send messages to other agents via the virtual mailbox.
 *
 * This is the inter-agent communication tool. It routes to the in-memory
 * mailbox store (not external channels like Slack/Discord/email).
 * Messages appear in the recipient agent's "Unread Mail" section at next session.
 *
 * Rate limit: 50 per session. No approval required by default.
 */

import type { ITool, ToolDefinition } from '../../types/tool.js';
import type { ToolId } from '../../types/common.js';
import { Ok } from '../../types/errors.js';
import type { BuiltinToolContext } from './context.js';

// Rate limit: track emails sent per agent per runtime session
const sessionEmailCounts = new Map<string, number>();
const MAX_EMAILS_PER_SESSION = 50;

export function createAgentEmailTool(ctx: BuiltinToolContext): ITool | null {
	if (!ctx.mailboxStore || !ctx.agentsMap) return null;

	const mailboxStore = ctx.mailboxStore;
	const agentsMap = ctx.agentsMap;

	const definition: ToolDefinition = {
		id: 'agent-email' as ToolId,
		name: 'agent-email',
		description:
			'Send a message to another agent in the company. ' +
			'Messages arrive in the recipient\'s inbox and are read at their next session. ' +
			'Use this for inter-agent coordination, status updates, task delegation, and reports.',
		source: 'registry',
		parameters: [
			{
				name: 'to',
				type: 'string',
				description: 'Recipient agent name (e.g. "scout", "atlas")',
				required: true,
			},
			{
				name: 'subject',
				type: 'string',
				description: 'Message subject line',
				required: true,
			},
			{
				name: 'body',
				type: 'string',
				description: 'Message body (supports markdown)',
				required: true,
			},
			{
				name: 'in_reply_to',
				type: 'string',
				description: 'Message ID being replied to (for threading). Omit for new threads.',
				required: false,
			},
		],
	};

	return {
		definition,
		execute: async (args: Readonly<Record<string, unknown>>) => {
			const to = args['to'] as string;
			const subject = args['subject'] as string;
			const body = args['body'] as string;
			const inReplyTo = args['in_reply_to'] as string | undefined;

			if (!to || !subject || !body) {
				return Ok({ sent: false, error: 'to, subject, and body are required' });
			}

			// Validate recipient exists
			let recipientExists = false;
			for (const agent of agentsMap.values()) {
				if (agent.name === to) {
					recipientExists = true;
					break;
				}
			}
			if (!recipientExists) {
				return Ok({
					sent: false,
					error: `Agent "${to}" not found. Available agents: ${[...agentsMap.values()].map((a) => a.name).join(', ')}`,
				});
			}

			// Rate limit
			const senderKey = typeof args['_agentId'] === 'string' ? args['_agentId'] : 'unknown';
			const count = sessionEmailCounts.get(senderKey) ?? 0;
			if (count >= MAX_EMAILS_PER_SESSION) {
				return Ok({
					sent: false,
					error: `Rate limit: max ${MAX_EMAILS_PER_SESSION} emails per session`,
				});
			}
			sessionEmailCounts.set(senderKey, count + 1);

			// Derive threadId from inReplyTo or create new
			let threadId: string;
			if (inReplyTo) {
				const replyMsg = mailboxStore.get(inReplyTo);
				threadId = replyMsg?.threadId ?? `thread_${inReplyTo}`;
			} else {
				threadId = `thread_${Date.now().toString(36)}`;
			}

			// Get sender agent name
			const senderAgent = agentsMap.get(senderKey);
			const from = senderAgent?.name ?? senderKey;

			const message = mailboxStore.send({
				from,
				to,
				subject,
				body,
				threadId,
				...(inReplyTo ? { inReplyTo } : {}),
				source: 'agent',
			});

			return Ok({
				sent: true,
				messageId: message.id,
				threadId: message.threadId,
				to,
				subject,
			});
		},
	};
}
