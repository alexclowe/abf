/**
 * Mail routes — virtual agent mailbox API.
 *
 * GET  /api/mail                       — list all messages (dashboard overview)
 * GET  /api/mail/:agentName            — agent's inbox
 * GET  /api/mail/:agentName/sent       — agent's sent messages
 * GET  /api/mail/message/:id           — get specific message
 * GET  /api/mail/thread/:threadId      — get all messages in a thread
 * POST /api/mail/:agentName            — operator sends message to agent
 * POST /api/mail/:agentName/read       — mark all as read
 */

import type { Hono } from 'hono';
import type { IMailboxStore } from '../../mailbox/types.js';
import { isAllowedSender } from '../../mailbox/sender-allowlist.js';

export interface MailRoutesDeps {
	readonly mailboxStore: IMailboxStore;
	readonly agentsMap: ReadonlyMap<string, import('../../types/agent.js').AgentConfig>;
	/** Glob patterns for allowed external senders. If empty/undefined, external mail is rejected. */
	readonly allowedSenders?: readonly string[] | undefined;
}

export function registerMailRoutes(app: Hono, deps: MailRoutesDeps): void {
	const { mailboxStore, agentsMap } = deps;

	// GET /api/mail — list all messages, optionally filtered by agent
	app.get('/api/mail', (c) => {
		const agent = c.req.query('agent');
		const limitStr = c.req.query('limit');
		const limit = limitStr ? Number(limitStr) : 100;
		return c.json(mailboxStore.listAll({ agentName: agent, limit }));
	});

	// GET /api/mail/message/:id — get specific message by ID
	// (must come before /:agentName to avoid matching "message" as an agent name)
	app.get('/api/mail/message/:id', (c) => {
		const msg = mailboxStore.get(c.req.param('id'));
		if (!msg) return c.json({ error: 'Message not found' }, 404);
		return c.json(msg);
	});

	// GET /api/mail/thread/:threadId — get all messages in a thread
	app.get('/api/mail/thread/:threadId', (c) => {
		const thread = mailboxStore.getThread(c.req.param('threadId'));
		return c.json(thread);
	});

	// GET /api/mail/:agentName — agent's inbox
	app.get('/api/mail/:agentName', (c) => {
		const agentName = c.req.param('agentName');
		const unread = c.req.query('unread') === 'true';
		const limitStr = c.req.query('limit');
		const limit = limitStr ? Number(limitStr) : 50;
		return c.json(mailboxStore.listInbox(agentName, { unreadOnly: unread, limit }));
	});

	// GET /api/mail/:agentName/sent — agent's sent messages
	app.get('/api/mail/:agentName/sent', (c) => {
		const agentName = c.req.param('agentName');
		const limitStr = c.req.query('limit');
		const limit = limitStr ? Number(limitStr) : 50;
		return c.json(mailboxStore.listSent(agentName, limit));
	});

	// POST /api/mail/:agentName — operator sends message to agent
	app.post('/api/mail/:agentName', async (c) => {
		const agentName = c.req.param('agentName');

		// Validate agent exists
		let agentExists = false;
		for (const agent of agentsMap.values()) {
			if (agent.name === agentName) {
				agentExists = true;
				break;
			}
		}
		if (!agentExists) {
			return c.json({ error: `Agent "${agentName}" not found` }, 404);
		}

		const body = await c.req.json<{
			subject?: string;
			body?: string;
			from?: string;
			source?: 'human' | 'email';
		}>();

		if (!body.subject?.trim() || !body.body?.trim()) {
			return c.json({ error: 'subject and body are required' }, 400);
		}

		const sender = body.from ?? 'operator';
		// Never trust caller-supplied 'agent' source — only the agent-email tool
		// (running inside a session sandbox) can set source='agent'.
		const source: 'human' | 'email' = body.source === 'email' ? 'email' : 'human';

		// Enforce sender allowlist for external mail
		const senderCheck = isAllowedSender(sender, source, deps.allowedSenders, agentsMap);
		if (!senderCheck.allowed) {
			return c.json({ error: senderCheck.reason ?? 'Sender not allowed' }, 403);
		}

		const message = mailboxStore.send({
			from: sender,
			to: agentName,
			subject: body.subject.trim(),
			body: body.body.trim(),
			threadId: `thread_${Date.now().toString(36)}`,
			source,
		});

		return c.json(message, 201);
	});

	// POST /api/mail/:agentName/read — mark all messages as read
	app.post('/api/mail/:agentName/read', (c) => {
		const agentName = c.req.param('agentName');
		const count = mailboxStore.markAllRead(agentName);
		return c.json({ markedRead: count });
	});
}
