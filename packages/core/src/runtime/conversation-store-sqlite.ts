/**
 * SQLiteConversationStore — persistent conversation storage using better-sqlite3.
 * Replaces InMemoryConversationStore for production use.
 *
 * Schema: conversations (metadata) + messages (individual messages).
 * Follows patterns from datastore/sqlite.store.ts.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ChatMessage } from '../types/provider.js';
import type { ConversationEntry, ConversationMeta, IConversationStore } from './conversation-store.js';

const MAX_MESSAGES_PER_CONVERSATION = 50;

export class SQLiteConversationStore implements IConversationStore {
	private db: import('better-sqlite3').Database | null = null;

	constructor(private readonly dbPath: string) {}

	async initialize(): Promise<void> {
		mkdirSync(dirname(this.dbPath), { recursive: true });
		const mod = await import('better-sqlite3');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const Database = (mod as any).default ?? mod;
		this.db = new Database(this.dbPath);
		this.db!.pragma('journal_mode = WAL');
		this.db!.pragma('foreign_keys = ON');

		this.db!.exec(`
			CREATE TABLE IF NOT EXISTS conversations (
				id TEXT PRIMARY KEY,
				agent_id TEXT NOT NULL,
				title TEXT NOT NULL DEFAULT '',
				message_count INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				last_accessed INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_conv_agent ON conversations(agent_id);

			CREATE TABLE IF NOT EXISTS messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
				role TEXT NOT NULL,
				content TEXT NOT NULL,
				content_type TEXT NOT NULL DEFAULT 'text',
				tool_call_id TEXT,
				tool_calls TEXT,
				name TEXT,
				created_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
		`);

		// Migrate from JSON file if it exists
		await this.migrateFromJson();
	}

	get(conversationId: string): ConversationEntry | undefined {
		if (!this.db) return undefined;

		const conv = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as
			| { id: string; agent_id: string; last_accessed: number }
			| undefined;
		if (!conv) return undefined;

		// Update last_accessed
		this.db.prepare('UPDATE conversations SET last_accessed = ? WHERE id = ?').run(Date.now(), conversationId);

		// Load messages (last 50, ordered by id ASC)
		const rows = this.db.prepare(
			'SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT ?',
		).all(conversationId, MAX_MESSAGES_PER_CONVERSATION) as Array<{
			role: string;
			content: string;
			content_type: string;
			tool_call_id: string | null;
			tool_calls: string | null;
			name: string | null;
		}>;

		const messages: ChatMessage[] = rows.map((r) => this.rowToMessage(r));

		return {
			agentId: conv.agent_id,
			messages,
			lastAccessed: Date.now(),
		};
	}

	getOrCreate(conversationId: string, agentId: string): ConversationEntry {
		if (!this.db) {
			return { agentId, messages: [], lastAccessed: Date.now() };
		}

		const now = Date.now();
		this.db.prepare(
			'INSERT OR IGNORE INTO conversations (id, agent_id, title, message_count, created_at, last_accessed) VALUES (?, ?, ?, 0, ?, ?)',
		).run(conversationId, agentId, '', now, now);

		return this.get(conversationId) ?? { agentId, messages: [], lastAccessed: now };
	}

	append(conversationId: string, ...messages: ChatMessage[]): void {
		if (!this.db || messages.length === 0) return;

		const now = Date.now();
		const insertMsg = this.db.prepare(
			'INSERT INTO messages (conversation_id, role, content, content_type, tool_call_id, tool_calls, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		);

		const transaction = this.db.transaction(() => {
			for (const msg of messages) {
				const { content, contentType } = this.serializeContent(msg.content);
				insertMsg.run(
					conversationId,
					msg.role,
					content,
					contentType,
					msg.toolCallId ?? null,
					msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
					msg.name ?? null,
					now,
				);
			}

			// Update conversation metadata
			this.db!.prepare(
				'UPDATE conversations SET last_accessed = ?, message_count = (SELECT COUNT(*) FROM messages WHERE conversation_id = ?) WHERE id = ?',
			).run(now, conversationId, conversationId);

			// Trim oldest non-system messages if over limit
			const count = (this.db!.prepare(
				'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?',
			).get(conversationId) as { cnt: number }).cnt;

			if (count > MAX_MESSAGES_PER_CONVERSATION) {
				const excess = count - MAX_MESSAGES_PER_CONVERSATION;
				this.db!.prepare(
					`DELETE FROM messages WHERE id IN (
						SELECT id FROM messages
						WHERE conversation_id = ? AND role != 'system'
						ORDER BY id ASC LIMIT ?
					)`,
				).run(conversationId, excess);
			}
		});

		transaction();
	}

	delete(conversationId: string): boolean {
		if (!this.db) return false;
		const result = this.db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
		return result.changes > 0;
	}

	size(): number {
		if (!this.db) return 0;
		const row = this.db.prepare('SELECT COUNT(*) as cnt FROM conversations').get() as { cnt: number };
		return row.cnt;
	}

	async load(): Promise<void> {
		// No-op for SQLite — data is always persisted
	}

	async save(): Promise<void> {
		// No-op for SQLite — writes are immediate
	}

	// ─── Conversation Metadata ───────────────────────────────────────────

	listByAgent(agentId: string): ConversationMeta[] {
		if (!this.db) return [];
		const rows = this.db.prepare(
			'SELECT id, agent_id, title, last_accessed, message_count FROM conversations WHERE agent_id = ? ORDER BY last_accessed DESC',
		).all(agentId) as Array<{
			id: string;
			agent_id: string;
			title: string;
			last_accessed: number;
			message_count: number;
		}>;

		return rows.map((r) => ({
			id: r.id,
			agentId: r.agent_id,
			title: r.title,
			lastAccessed: r.last_accessed,
			messageCount: r.message_count,
		}));
	}

	getMeta(conversationId: string): ConversationMeta | undefined {
		if (!this.db) return undefined;
		const row = this.db.prepare(
			'SELECT id, agent_id, title, last_accessed, message_count FROM conversations WHERE id = ?',
		).get(conversationId) as {
			id: string;
			agent_id: string;
			title: string;
			last_accessed: number;
			message_count: number;
		} | undefined;

		if (!row) return undefined;
		return {
			id: row.id,
			agentId: row.agent_id,
			title: row.title,
			lastAccessed: row.last_accessed,
			messageCount: row.message_count,
		};
	}

	upsertMeta(conversationId: string, agentId: string, title: string, messageCount: number): void {
		if (!this.db) return;
		const now = Date.now();
		this.db.prepare(
			`INSERT INTO conversations (id, agent_id, title, message_count, created_at, last_accessed)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET last_accessed = excluded.last_accessed, message_count = excluded.message_count`,
		).run(conversationId, agentId, title.slice(0, 50), messageCount, now, now);
	}

	deleteMeta(conversationId: string): void {
		// Deleting conversations also cascades to messages
		this.delete(conversationId);
	}

	// ─── Private Helpers ─────────────────────────────────────────────────

	private serializeContent(content: ChatMessage['content']): { content: string; contentType: string } {
		if (typeof content === 'string') {
			return { content, contentType: 'text' };
		}
		return { content: JSON.stringify(content), contentType: 'json' };
	}

	private rowToMessage(row: {
		role: string;
		content: string;
		content_type: string;
		tool_call_id: string | null;
		tool_calls: string | null;
		name: string | null;
	}): ChatMessage {
		const msg: ChatMessage = {
			role: row.role as ChatMessage['role'],
			content: row.content_type === 'json' ? JSON.parse(row.content) : row.content,
		};
		if (row.tool_call_id) (msg as Record<string, unknown>).toolCallId = row.tool_call_id;
		if (row.tool_calls) (msg as Record<string, unknown>).toolCalls = JSON.parse(row.tool_calls);
		if (row.name) (msg as Record<string, unknown>).name = row.name;
		return msg;
	}

	/** Migrate from legacy JSON file if it exists. */
	private async migrateFromJson(): Promise<void> {
		if (!this.db) return;

		const { dirname, join } = await import('node:path');
		const { readFile, rename } = await import('node:fs/promises');

		const dir = dirname(this.dbPath);
		const jsonPath = join(dir, 'conversations.json');

		try {
			const raw = await readFile(jsonPath, 'utf-8');
			const entries = JSON.parse(raw) as Array<[string, { agentId: string; messages: ChatMessage[]; lastAccessed: number }]>;

			if (!Array.isArray(entries) || entries.length === 0) return;

			const insertConv = this.db.prepare(
				'INSERT OR IGNORE INTO conversations (id, agent_id, title, message_count, created_at, last_accessed) VALUES (?, ?, ?, ?, ?, ?)',
			);
			const insertMsg = this.db.prepare(
				'INSERT INTO messages (conversation_id, role, content, content_type, tool_call_id, tool_calls, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
			);

			const transaction = this.db.transaction(() => {
				for (const [convId, entry] of entries) {
					if (!convId || !entry) continue;
					const firstUserMsg = entry.messages.find((m) => m.role === 'user');
					const title = firstUserMsg && typeof firstUserMsg.content === 'string'
						? firstUserMsg.content.slice(0, 50)
						: '';

					insertConv.run(
						convId,
						entry.agentId,
						title,
						entry.messages.length,
						entry.lastAccessed,
						entry.lastAccessed,
					);

					for (const msg of entry.messages) {
						const { content, contentType } = this.serializeContent(msg.content);
						insertMsg.run(
							convId,
							msg.role,
							content,
							contentType,
							msg.toolCallId ?? null,
							msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
							msg.name ?? null,
							entry.lastAccessed,
						);
					}
				}
			});

			transaction();

			// Rename the old file so migration doesn't run again
			await rename(jsonPath, `${jsonPath}.bak`);
		} catch {
			// File doesn't exist or parse error — skip migration
		}
	}
}
