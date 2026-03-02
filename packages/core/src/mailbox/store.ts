/**
 * FilesystemMailboxStore — in-memory mailbox with JSON file persistence.
 *
 * Cross-indexed by agent name, message ID, and thread ID for O(1) lookups.
 * Debounced saves (2s) to avoid excessive disk writes during bursts.
 * 500 messages per agent cap with oldest-first eviction.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { IMailboxStore, MailMessage, MailMessageCreate } from './types.js';

const MAX_MESSAGES_PER_AGENT = 500;
const SAVE_DEBOUNCE_MS = 2000;

export class FilesystemMailboxStore implements IMailboxStore {
	/** agentName → messages received (inbox). */
	private readonly inboxes = new Map<string, MailMessage[]>();
	/** agentName → messages sent. */
	private readonly sentBoxes = new Map<string, MailMessage[]>();
	/** messageId → MailMessage. */
	private readonly byId = new Map<string, MailMessage>();
	/** threadId → MailMessage[]. */
	private readonly threads = new Map<string, MailMessage[]>();

	private saveTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly filePath: string;

	constructor(mailDir: string) {
		this.filePath = join(mailDir, 'mailbox.json');
	}

	send(msg: MailMessageCreate): MailMessage {
		const message: MailMessage = {
			...msg,
			id: `mail_${nanoid(12)}`,
			timestamp: new Date().toISOString(),
			read: false,
		};

		// Add to recipient's inbox
		this.addToInbox(msg.to, message);

		// Add to sender's sent box (auto-read for sender)
		const sentCopy = { ...message, read: true };
		const sentBox = this.sentBoxes.get(msg.from) ?? [];
		sentBox.push(sentCopy);
		if (sentBox.length > MAX_MESSAGES_PER_AGENT) sentBox.shift();
		this.sentBoxes.set(msg.from, sentBox);

		// Index by ID and thread
		this.byId.set(message.id, message);
		const thread = this.threads.get(message.threadId) ?? [];
		thread.push(message);
		this.threads.set(message.threadId, thread);

		this.scheduleSave();
		return message;
	}

	listInbox(agentName: string, opts?: { unreadOnly?: boolean; limit?: number }): readonly MailMessage[] {
		const inbox = this.inboxes.get(agentName) ?? [];
		let result: MailMessage[] = inbox;

		if (opts?.unreadOnly) {
			result = result.filter((m) => !m.read);
		}

		// Return newest first
		const sorted = [...result].reverse();
		return opts?.limit ? sorted.slice(0, opts.limit) : sorted;
	}

	listSent(agentName: string, limit?: number): readonly MailMessage[] {
		const sent = this.sentBoxes.get(agentName) ?? [];
		const sorted = [...sent].reverse();
		return limit ? sorted.slice(0, limit) : sorted;
	}

	get(messageId: string): MailMessage | undefined {
		return this.byId.get(messageId);
	}

	markRead(messageId: string): boolean {
		const msg = this.byId.get(messageId);
		if (!msg) return false;
		msg.read = true;
		this.scheduleSave();
		return true;
	}

	markAllRead(agentName: string): number {
		const inbox = this.inboxes.get(agentName) ?? [];
		let count = 0;
		for (const msg of inbox) {
			if (!msg.read) {
				msg.read = true;
				count++;
			}
		}
		if (count > 0) this.scheduleSave();
		return count;
	}

	getThread(threadId: string): readonly MailMessage[] {
		return this.threads.get(threadId) ?? [];
	}

	listAll(opts?: { limit?: number; agentName?: string }): readonly MailMessage[] {
		let all: MailMessage[] = [];

		if (opts?.agentName) {
			// Messages where agent is sender or recipient
			const inbox = this.inboxes.get(opts.agentName) ?? [];
			const sent = this.sentBoxes.get(opts.agentName) ?? [];
			all = [...inbox, ...sent];
		} else {
			// All messages across all inboxes
			for (const msgs of this.inboxes.values()) {
				all.push(...msgs);
			}
		}

		// Sort by timestamp descending (newest first)
		all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
		return opts?.limit ? all.slice(0, opts.limit) : all;
	}

	async save(): Promise<void> {
		try {
			await mkdir(join(this.filePath, '..'), { recursive: true });
			const data = {
				inboxes: [...this.inboxes.entries()],
				sentBoxes: [...this.sentBoxes.entries()],
			};
			await writeFile(this.filePath, JSON.stringify(data), 'utf-8');
		} catch {
			// Non-fatal — data still in memory
		}
	}

	async load(): Promise<void> {
		try {
			const raw = await readFile(this.filePath, 'utf-8');
			const data = JSON.parse(raw) as {
				inboxes: [string, MailMessage[]][];
				sentBoxes: [string, MailMessage[]][];
			};

			// Rebuild inboxes
			for (const [name, msgs] of data.inboxes) {
				this.inboxes.set(name, msgs);
			}
			// Rebuild sent boxes
			for (const [name, msgs] of data.sentBoxes) {
				this.sentBoxes.set(name, msgs);
			}
			// Rebuild cross-indexes
			this.rebuildIndexes();
		} catch {
			// File doesn't exist or is corrupt — start fresh
		}
	}

	/** Rebuild byId and threads indexes from inbox/sent data. */
	private rebuildIndexes(): void {
		this.byId.clear();
		this.threads.clear();

		const indexMsg = (msg: MailMessage) => {
			this.byId.set(msg.id, msg);
			const thread = this.threads.get(msg.threadId) ?? [];
			thread.push(msg);
			this.threads.set(msg.threadId, thread);
		};

		for (const msgs of this.inboxes.values()) {
			for (const msg of msgs) indexMsg(msg);
		}
		for (const msgs of this.sentBoxes.values()) {
			for (const msg of msgs) indexMsg(msg);
		}
	}

	private addToInbox(agentName: string, message: MailMessage): void {
		const inbox = this.inboxes.get(agentName) ?? [];
		inbox.push(message);
		if (inbox.length > MAX_MESSAGES_PER_AGENT) inbox.shift();
		this.inboxes.set(agentName, inbox);
	}

	private scheduleSave(): void {
		if (this.saveTimer !== undefined) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			this.saveTimer = undefined;
			void this.save();
		}, SAVE_DEBOUNCE_MS);
	}
}
