/**
 * Mailbox types — virtual agent email system.
 *
 * Each agent has an inbox and sent folder. Messages are threaded via threadId/inReplyTo.
 * Designed as a future upgrade path to real email (agent@company.com).
 */

export interface MailMessage {
	/** Unique message ID (mail_xxxxxxxxxxxx). */
	readonly id: string;
	/** Sender: agent name, "operator", or email address. */
	readonly from: string;
	/** Recipient: agent name. */
	readonly to: string;
	readonly subject: string;
	/** Markdown body. */
	readonly body: string;
	readonly timestamp: string;
	/** Groups related messages into a conversation thread. */
	readonly threadId: string;
	/** Message ID being replied to (for threading). */
	readonly inReplyTo?: string;
	readonly source: 'agent' | 'human' | 'email';
	read: boolean;
}

export type MailMessageCreate = Omit<MailMessage, 'id' | 'timestamp' | 'read'>;

export interface IMailboxStore {
	/** Send a message. Returns the created message with generated id + timestamp. */
	send(msg: MailMessageCreate): MailMessage;

	/** List messages in an agent's inbox (received messages). */
	listInbox(agentName: string, opts?: { unreadOnly?: boolean; limit?: number }): readonly MailMessage[];

	/** List messages sent by an agent. */
	listSent(agentName: string, limit?: number): readonly MailMessage[];

	/** Get a specific message by ID. */
	get(messageId: string): MailMessage | undefined;

	/** Mark a single message as read. Returns true if found. */
	markRead(messageId: string): boolean;

	/** Mark all messages in an agent's inbox as read. Returns count marked. */
	markAllRead(agentName: string): number;

	/** Get all messages in a thread. */
	getThread(threadId: string): readonly MailMessage[];

	/** List all messages (for dashboard overview), optionally filtered by agent. */
	listAll(opts?: { limit?: number; agentName?: string }): readonly MailMessage[];

	/** Persist to disk. */
	save(): Promise<void>;

	/** Load from disk. */
	load(): Promise<void>;
}
