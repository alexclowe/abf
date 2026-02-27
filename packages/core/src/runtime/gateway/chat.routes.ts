/**
 * Chat routes — real-time streaming chat with any agent.
 *
 * POST /api/agents/:id/chat — SSE streaming endpoint
 *   Body (AI SDK v6): { id, messages, trigger?, messageId? }
 *   Returns: UI Message Stream v1 (SSE) — uses text-start/text-delta/text-end,
 *   tool-input-start/tool-input-available/tool-output-available lifecycle events.
 */

import type { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AgentId } from '../../types/common.js';
import type { ChatMessage, ContentPart } from '../../types/provider.js';
import { createActivationId, toISOTimestamp } from '../../util/id.js';
import type { GatewayDeps } from './http.gateway.js';
import type { InMemoryConversationStore } from '../conversation-store.js';
import type { ISessionManager, StreamEvent } from '../interfaces.js';

/** Shape of a UI Message part sent by the AI SDK client. */
interface UIMessagePart {
	readonly type: string;
	readonly text?: string;
	readonly mediaType?: string;
	readonly url?: string;
	readonly [key: string]: unknown;
}

/** Shape of a UI Message sent by the AI SDK client. */
interface UIMessage {
	readonly id: string;
	readonly role: 'user' | 'assistant' | 'system';
	readonly parts: readonly UIMessagePart[];
}

export interface ChatRoutesDeps extends GatewayDeps {
	readonly sessionManager: ISessionManager;
	readonly conversationStore: InMemoryConversationStore;
}

// ─── Helpers ────────────────────────────────────────────────────────

const UI_MESSAGE_STREAM_HEADERS = {
	'Content-Type': 'text/event-stream',
	'Cache-Control': 'no-cache',
	'Connection': 'keep-alive',
	'x-vercel-ai-ui-message-stream': 'v1',
	'x-accel-buffering': 'no',
} as const;

function sseData(obj: unknown): string {
	return `data: ${JSON.stringify(obj)}\n\n`;
}

/** Extract plain text from a UIMessage's parts array. */
function extractText(parts: readonly UIMessagePart[]): string {
	return parts
		.filter((p) => p.type === 'text' && typeof p.text === 'string')
		.map((p) => p.text!)
		.join('');
}

/**
 * Extract content parts from a UIMessage, handling both text and file parts.
 * Returns string for text-only messages, ContentPart[] for multimodal messages.
 */
function extractContentParts(parts: readonly UIMessagePart[]): string | ContentPart[] {
	const hasFiles = parts.some((p) => p.type === 'file' && p.url);
	if (!hasFiles) {
		return extractText(parts);
	}

	const contentParts: ContentPart[] = [];
	for (const p of parts) {
		if (p.type === 'text' && p.text) {
			contentParts.push({ type: 'text', text: p.text });
		} else if (p.type === 'file' && p.url && p.mediaType) {
			// Strip data URL prefix: "data:image/png;base64,..." → base64 data
			const url = p.url;
			const commaIdx = url.indexOf(',');
			const data = commaIdx >= 0 ? url.slice(commaIdx + 1) : url;
			contentParts.push({ type: 'image', mediaType: p.mediaType, data });
		}
	}
	return contentParts;
}

/** Convert AI SDK UIMessages to ABF ChatMessages for the provider. */
function toChatMessages(messages: readonly UIMessage[]) {
	return messages.map((m) => ({
		role: m.role as 'user' | 'assistant' | 'system',
		content: extractContentParts(m.parts),
	}));
}

// ─── Feedback Store (in-memory, capped) ──────────────────────────────

const feedbackStore = new Map<string, { messageId: string; feedback: string; timestamp: number }>();
const MAX_FEEDBACK = 1000;

// ─── Conversation Metadata Store (for sidebar) ──────────────────────

interface ConversationMeta {
	id: string;
	agentId: string;
	title: string;
	lastAccessed: number;
	messageCount: number;
}

const conversationMeta = new Map<string, ConversationMeta>();
const MAX_CONVERSATION_META = 200;

function upsertConversationMeta(convId: string, agentId: string, userText: string, msgCount: number) {
	const existing = conversationMeta.get(convId);
	if (existing) {
		existing.lastAccessed = Date.now();
		existing.messageCount = msgCount;
	} else {
		// Evict oldest if at capacity
		if (conversationMeta.size >= MAX_CONVERSATION_META) {
			let oldestKey: string | undefined;
			let oldestTime = Number.POSITIVE_INFINITY;
			for (const [key, val] of conversationMeta) {
				if (val.lastAccessed < oldestTime) {
					oldestTime = val.lastAccessed;
					oldestKey = key;
				}
			}
			if (oldestKey) conversationMeta.delete(oldestKey);
		}
		conversationMeta.set(convId, {
			id: convId,
			agentId,
			title: userText.slice(0, 50),
			lastAccessed: Date.now(),
			messageCount: msgCount,
		});
	}
}

// ─── Route Registration ─────────────────────────────────────────────

export function registerChatRoutes(app: Hono, deps: ChatRoutesDeps): void {
	app.post('/api/agents/:id/chat', async (c) => {
		let agentId = c.req.param('id') as AgentId;
		const agent = deps.agentsMap.get(agentId);
		if (!agent) {
			return c.json({ error: 'Agent not found' }, 404);
		}

		const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));

		// Support both AI SDK format { id, messages[] } and legacy { message, conversationId }
		let userText: string;
		let conversationHistory: { role: string; content: ChatMessage['content'] }[];

		if (Array.isArray(body['messages'])) {
			// AI SDK DefaultChatTransport format
			const messages = body['messages'] as UIMessage[];
			const lastUser = [...messages].reverse().find((m) => m.role === 'user');
			if (!lastUser) return c.json({ error: 'No user message' }, 400);
			userText = extractText(lastUser.parts);
			// All messages except the last user message become conversation history
			conversationHistory = toChatMessages(messages.slice(0, -1));

			// Track conversation metadata for sidebar
			const convId = typeof body['id'] === 'string' ? body['id'] : nanoid();
			upsertConversationMeta(convId, agentId, userText, messages.length);
		} else {
			// Legacy format: { message: string, conversationId?: string }
			userText = typeof body['message'] === 'string' ? (body['message'] as string) : '';
			const convId = (body['conversationId'] as string) || nanoid();
			const conv = deps.conversationStore.getOrCreate(convId, agentId);
			conversationHistory = [...conv.messages];
		}

		if (!userText.trim()) {
			return c.json({ error: 'message is required' }, 400);
		}

		// Handle @mention routing — route to mentioned agent if it exists
		const mentionMatch = userText.match(/@([\w-]+)/);
		if (mentionMatch) {
			const mentionedName = mentionMatch[1]!;
			// Find agent by name
			for (const [id, agentCfg] of deps.agentsMap) {
				if (agentCfg.name === mentionedName) {
					agentId = id as AgentId;
					userText = userText.replace(/@[\w-]+\s*/, '').trim();
					break;
				}
			}
		}

		// Build activation
		const activation = {
			id: createActivationId(),
			agentId,
			trigger: { type: 'manual' as const, task: userText.trim() },
			timestamp: toISOTimestamp(),
			payload: { message: userText.trim() } as Record<string, unknown>,
		};

		// Create SSE stream with UI Message Stream v1 protocol
		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		const encoder = new TextEncoder();

		// Abort controller — allows cancelling the LLM call if the client disconnects
		const abortController = new AbortController();
		let closed = false;

		// Serialized write queue — ensures ordering even though onChunk is sync
		let writeChain = Promise.resolve();
		const write = (data: unknown) => {
			if (closed) return;
			writeChain = writeChain.then(() =>
				writer.write(encoder.encode(sseData(data))).catch(() => {
					// Client disconnected mid-write — abort the LLM call
					closed = true;
					abortController.abort();
				}),
			);
		};

		// Detect client disconnect via the request signal (if available)
		const reqSignal = c.req.raw.signal;
		if (reqSignal) {
			reqSignal.addEventListener('abort', () => {
				closed = true;
				abortController.abort();
			}, { once: true });
		}

		// For multimodal messages, pass the full content parts to the session manager
		const lastUser = Array.isArray(body['messages'])
			? [...(body['messages'] as UIMessage[])].reverse().find((m) => m.role === 'user')
			: undefined;
		const lastUserContent = lastUser ? extractContentParts(lastUser.parts) : userText.trim();

		void (async () => {
			try {
				// ── AI SDK v6 UI Message Stream v1 protocol ──
				// Text lifecycle:    text-start → text-delta(s) → text-end
				// Tool lifecycle:    tool-input-start → tool-input-available → tool-output-available
				// Message lifecycle: start → start-step → ... → finish-step → finish

				let textBlockId: string | null = null;
				let toolCallCounter = 0;
				const toolCallIds = new Map<string, string>(); // toolName → toolCallId

				// Signal: message stream begins
				write({ type: 'start' });
				write({ type: 'start-step' });

				const onChunk = (event: StreamEvent) => {
					if (closed) return;

					if (event.type === 'token' && event.text) {
						// Start a new text block if not already in one
						if (!textBlockId) {
							textBlockId = nanoid();
							write({ type: 'text-start', id: textBlockId });
						}
						write({ type: 'text-delta', id: textBlockId, delta: event.text });

					} else if (event.type === 'tool_use' && event.toolName) {
						// Close any open text block before tool call
						if (textBlockId) {
							write({ type: 'text-end', id: textBlockId });
							textBlockId = null;
						}
						const tcId = `tc-${toolCallCounter++}`;
						toolCallIds.set(event.toolName, tcId);
						// tool-input-start signals the tool call is beginning
						write({
							type: 'tool-input-start',
							toolCallId: tcId,
							toolName: event.toolName,
						});
						// tool-input-available signals the full input is ready
						write({
							type: 'tool-input-available',
							toolCallId: tcId,
							toolName: event.toolName,
							input: event.toolArguments ?? {},
						});

					} else if (event.type === 'tool_result' && event.toolName) {
						const tcId = toolCallIds.get(event.toolName) ?? `tc-${toolCallCounter++}`;
						write({
							type: 'tool-output-available',
							toolCallId: tcId,
							output: event.toolOutput ?? null,
						});

					} else if (event.type === 'error' && event.error) {
						// Close any open text block before error
						if (textBlockId) {
							write({ type: 'text-end', id: textBlockId });
							textBlockId = null;
						}
						write({ type: 'error', errorText: event.error });
					}
				};

				// If the user message has multimodal content, override the activation payload
				if (typeof lastUserContent !== 'string') {
					activation.payload = { message: userText.trim(), contentParts: lastUserContent } as Record<string, unknown>;
				}

				const result = await deps.sessionManager.executeStreaming(
					activation,
					onChunk,
					conversationHistory,
				);

				// Close any open text block
				if (textBlockId) {
					write({ type: 'text-end', id: textBlockId });
					textBlockId = null;
				}

				// If executeStreaming returned an Err result, surface the error
				if (!result.ok) {
					write({ type: 'error', errorText: result.error.message });
				}

				// Signal: step and message complete
				write({ type: 'finish-step' });
				write({ type: 'finish', finishReason: 'stop' });

				await writeChain;
			} catch (e) {
				if (!closed) {
					await writeChain;
					write({
						type: 'error',
						errorText: e instanceof Error ? e.message : String(e),
					});
					write({ type: 'finish-step' });
					write({ type: 'finish', finishReason: 'error' });
					await writeChain;
				}
			} finally {
				if (!closed) {
					writer.write(encoder.encode('data: [DONE]\n\n')).then(
						() => writer.close(),
						() => writer.close().catch(() => {}),
					);
				} else {
					writer.close().catch(() => {});
				}
			}
		})();

		return new Response(readable, {
			status: 200,
			headers: UI_MESSAGE_STREAM_HEADERS,
		});
	});

	// POST /api/agents/:id/chat/feedback — store feedback on a message
	app.post('/api/agents/:id/chat/feedback', async (c) => {
		const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
		const messageId = typeof body['messageId'] === 'string' ? body['messageId'] : '';
		const feedback = typeof body['feedback'] === 'string' ? body['feedback'] : '';
		if (!messageId) return c.json({ error: 'messageId required' }, 400);

		// Evict oldest if at capacity
		if (feedbackStore.size >= MAX_FEEDBACK) {
			let oldestKey: string | undefined;
			let oldestTime = Number.POSITIVE_INFINITY;
			for (const [key, val] of feedbackStore) {
				if (val.timestamp < oldestTime) {
					oldestTime = val.timestamp;
					oldestKey = key;
				}
			}
			if (oldestKey) feedbackStore.delete(oldestKey);
		}

		feedbackStore.set(messageId, { messageId, feedback, timestamp: Date.now() });
		return c.json({ ok: true });
	});

	// GET /api/agents/:id/conversations — list conversations for an agent
	app.get('/api/agents/:id/conversations', (c) => {
		const agentId = c.req.param('id');
		const convs: ConversationMeta[] = [];
		for (const meta of conversationMeta.values()) {
			if (meta.agentId === agentId) convs.push(meta);
		}
		convs.sort((a, b) => b.lastAccessed - a.lastAccessed);
		return c.json(convs);
	});

	// DELETE /api/agents/:id/conversations/:cid — delete conversation
	app.delete('/api/agents/:id/conversations/:cid', (c) => {
		const cid = c.req.param('cid');
		conversationMeta.delete(cid);
		deps.conversationStore.delete(cid);
		return c.json({ ok: true });
	});

	// PUT /api/agents/:id/conversations/:cid — rename conversation
	app.put('/api/agents/:id/conversations/:cid', async (c) => {
		const cid = c.req.param('cid');
		const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
		const title = typeof body['title'] === 'string' ? body['title'] : '';
		const meta = conversationMeta.get(cid);
		if (!meta) return c.json({ error: 'Conversation not found' }, 404);
		meta.title = title.slice(0, 50);
		return c.json({ ok: true });
	});

	// GET /api/agents/:id/conversations/:convId — retrieve conversation history
	app.get('/api/agents/:id/conversations/:convId', (c) => {
		const convId = c.req.param('convId');
		const entry = deps.conversationStore.get(convId);
		if (!entry) return c.json({ error: 'Conversation not found' }, 404);
		return c.json({
			conversationId: convId,
			agentId: entry.agentId,
			messages: entry.messages,
		});
	});
}
