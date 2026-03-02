/**
 * Session Manager — executes the 8-step work session lifecycle.
 *
 * 1. Load Context (charter + history + decisions + trigger payload)
 * 2. Build Prompt (system prompt with date, KPIs, pending messages)
 * 3. Execute (send to LLM provider)
 * 4. Tool Loop (execute tool calls, return results, repeat)
 * 5. Process Outputs (route messages to bus)
 * 6. Write Memory (append learnings to history)
 * 7. Check Escalations (route to human or orchestrator)
 * 8. Report (update KPIs, log cost, close session)
 */

import type { AgentConfig, EscalationRule, KPIDefinition } from '../types/agent.js';
import type { AgentId, ISOTimestamp, SessionId, USDCents } from '../types/common.js';
import type { ABFError, Result } from '../types/errors.js';
import { ABFError as ABFErrorClass, Err, Ok } from '../types/errors.js';
import type { IMemoryStore } from '../types/memory.js';
import type { IBus } from '../types/message.js';
import type { AgentNotification } from '../messaging/interfaces.js';
import type { MessagingRouter } from '../messaging/router.js';
import type { ChatMessage, IProviderRegistry, TokenUsage } from '../types/provider.js';
import type { IAuditStore } from '../types/security.js';
import type { Escalation, KPIReport, SessionResult, SessionStatus } from '../types/session.js';
import type { IToolRegistry, IToolSandbox, ToolCall, ToolResult } from '../types/tool.js';
import type { Activation } from '../types/trigger.js';
import type { IApprovalStore } from '../types/approval.js';
import type { InputSource } from '../types/common.js';
import { createSessionId, toISOTimestamp } from '../util/id.js';
import { loadKnowledgeFiles } from '../knowledge/loader.js';
import { checkBounds } from '../security/bounds-enforcer.js';
import { processInput } from '../security/input-pipeline.js';
import type { ISessionManager, StreamEvent } from './interfaces.js';
import type { ContentPart } from '../types/provider.js';

/** Tools whose output comes from external/untrusted sources. */
const EXTERNAL_TOOLS = new Set(['web-search', 'web-fetch', 'browse']);

/** Max characters for history section in prompts. */
const HISTORY_CHAR_BUDGET = 4000;

/**
 * Window history entries to fit within a character budget.
 * Keeps the most recent entries, truncating older ones first.
 */
function windowHistory(history: readonly { content: string }[]): string {
	if (history.length === 0) return '';

	// Join all entries
	const entries = history.map((h) => h.content);
	const full = entries.join('\n---\n');
	if (full.length <= HISTORY_CHAR_BUDGET) return full;

	// Take entries from the end until budget is exhausted
	const result: string[] = [];
	let remaining = HISTORY_CHAR_BUDGET;
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i]!;
		const needed = entry.length + (result.length > 0 ? 5 : 0); // 5 = '\n---\n'.length
		if (needed > remaining) {
			// Truncate this entry to fill remaining budget
			if (remaining > 10) {
				result.unshift(entry.slice(0, remaining - 1) + '\u2026');
			}
			break;
		}
		result.unshift(entry);
		remaining -= needed;
	}
	return result.join('\n---\n');
}

/** Map trigger types to InputSource for the security pipeline. */
function triggerToInputSource(trigger: import('../types/trigger.js').TriggerConfig): InputSource {
	switch (trigger.type) {
		case 'webhook': return 'webhook';
		case 'event': return trigger.event.startsWith('monitor:') ? 'web' : 'system';
		case 'message': return 'agent';
		default: return 'system';
	}
}

function evaluateKPI(
	kpi: KPIDefinition,
	session: {
		status: SessionStatus;
		cost: USDCents;
		durationMs: number;
		messagesEmitted: number;
	},
): KPIReport {
	const timestamp = toISOTimestamp();
	let value = '';
	let met = false;

	const metric = kpi.metric.toLowerCase();

	if (metric.includes('turnaround') || metric.includes('time') || metric.includes('speed')) {
		const minutes = Math.round(session.durationMs / 60000);
		value = `${minutes}min`;
		const match = /< ?(\d+)min/.exec(kpi.target);
		met = match !== null ? minutes < Number(match[1]) : session.status === 'completed';
	} else if (metric.includes('cost') || metric.includes('budget')) {
		const dollars = (session.cost as number) / 100;
		value = `$${dollars.toFixed(4)}`;
		met = session.status !== 'failed';
	} else if (
		metric.includes('task') ||
		metric.includes('delegat') ||
		metric.includes('message') ||
		metric.includes('brief')
	) {
		value = String(session.messagesEmitted);
		met = session.messagesEmitted > 0 || session.status === 'completed';
	} else if (metric.includes('quality') || metric.includes('report') || metric.includes('content')) {
		value = session.status === 'completed' ? 'completed' : 'failed';
		met = session.status === 'completed';
	} else {
		value = session.status;
		met = session.status === 'completed';
	}

	return { metric: kpi.metric, value, target: kpi.target, met, timestamp };
}

export interface SessionManagerDeps {
	readonly agents: Map<string, AgentConfig>;
	readonly memoryStore: IMemoryStore;
	readonly bus: IBus;
	readonly toolRegistry: IToolRegistry;
	readonly toolSandbox: IToolSandbox;
	readonly providerRegistry: IProviderRegistry;
	readonly auditStore: IAuditStore;
	readonly sessionTimeoutMs: number;
	readonly messagingRouter?: MessagingRouter | undefined;
	readonly knowledgeDir?: string | undefined;
	readonly outputsManager?: import('../memory/outputs.js').OutputsManager | undefined;
	readonly inbox?: import('../types/inbox.js').IInbox | undefined;
	readonly approvalStore?: IApprovalStore | undefined;
	readonly compactor?: import('../memory/compactor.js').MemoryCompactor | undefined;
	readonly taskPlanStore?: import('../types/task-plan.js').ITaskPlanStore | undefined;
	readonly sessionEventBus?: import('./session-events.js').SessionEventBus | undefined;
	readonly mailboxStore?: import('../mailbox/types.js').IMailboxStore | undefined;
}

export class SessionManager implements ISessionManager {
	/** Active sessions mapped by ID to their AbortController for cancellation. */
	private readonly activeSessions = new Map<SessionId, AbortController>();

	constructor(private readonly deps: SessionManagerDeps) {}

	async execute(activation: Activation): Promise<Result<SessionResult, ABFError>> {
		const agent = this.deps.agents.get(activation.agentId);
		if (!agent) {
			return Err(new ABFErrorClass('AGENT_NOT_FOUND', `Agent ${activation.agentId} not found`));
		}

		const sessionId = createSessionId();
		const startedAt = toISOTimestamp();

		// AbortController for cooperative cancellation — signals propagate to providers
		const controller = new AbortController();
		this.activeSessions.set(sessionId, controller);

		// Enforce session timeout via Promise.race (abort the session on timeout)
		let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutTimer = setTimeout(
				() => {
					controller.abort();
					reject(
						new ABFErrorClass(
							'SESSION_TIMEOUT',
							`Session exceeded ${this.deps.sessionTimeoutMs}ms`,
						),
					);
				},
				this.deps.sessionTimeoutMs,
			);
		});

		try {
			const result = await Promise.race([
				this.runSession(agent, activation, sessionId, startedAt, controller.signal),
				timeoutPromise,
			]);
			return result;
		} catch (e) {
			const status: SessionStatus = e instanceof ABFErrorClass && e.code === 'SESSION_TIMEOUT'
				? 'timeout'
				: 'failed';

			await this.deps.auditStore.log({
				timestamp: toISOTimestamp(),
				eventType: 'session_end',
				agentId: activation.agentId,
				sessionId,
				details: { status, error: e instanceof Error ? e.message : String(e) },
				severity: 'warn',
			});

			return Ok({
				sessionId,
				agentId: activation.agentId,
				status,
				startedAt,
				completedAt: toISOTimestamp(),
				toolCalls: [],
				toolResults: [],
				messagesEmitted: [],
				escalations: [],
				kpiReports: [],
				tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
				cost: 0 as USDCents,
				memoryUpdates: [],
				error: e instanceof Error ? e.message : String(e),
			});
		} finally {
			if (timeoutTimer) clearTimeout(timeoutTimer);
			this.activeSessions.delete(sessionId);
		}
	}

	async executeStreaming(
		activation: Activation,
		onChunk: (event: StreamEvent) => void,
		conversationHistory?: { role: string; content: ChatMessage['content'] }[],
	): Promise<Result<SessionResult, ABFError>> {
		const agent = this.deps.agents.get(activation.agentId);
		if (!agent) {
			return Err(new ABFErrorClass('AGENT_NOT_FOUND', `Agent ${activation.agentId} not found`));
		}

		const sessionId = createSessionId();
		const startedAt = toISOTimestamp();

		// AbortController for cooperative cancellation
		const controller = new AbortController();
		this.activeSessions.set(sessionId, controller);

		// Timeout for streaming sessions (mirrors execute() pattern)
		let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutTimer = setTimeout(
				() => {
					controller.abort();
					reject(
						new ABFErrorClass(
							'SESSION_TIMEOUT',
							`Streaming session exceeded ${this.deps.sessionTimeoutMs}ms`,
						),
					);
				},
				this.deps.sessionTimeoutMs,
			);
		});

		// Emit session start for streaming sessions (R12)
		this.deps.sessionEventBus?.emitSessionStart(activation.agentId, sessionId);

		// Tee onChunk events into the session event bus (R12)
		const eventBus = this.deps.sessionEventBus;
		const agentIdForEvents = activation.agentId;
		const emitChunk: (event: StreamEvent) => void = eventBus
			? (event: StreamEvent) => {
					onChunk(event);
					eventBus.emitStreamEvent(agentIdForEvents, sessionId, event);
				}
			: onChunk;

		try {
			const sessionResult = await Promise.race([
				this.runStreamingSession(
					agent, activation, sessionId, startedAt, controller.signal,
					emitChunk, conversationHistory,
				),
				timeoutPromise,
			]);
			return sessionResult;
		} catch (e) {
			const status: import('../types/session.js').SessionStatus =
				e instanceof ABFErrorClass && e.code === 'SESSION_TIMEOUT' ? 'timeout' : 'failed';

			// Emit session end on error (R12)
			this.deps.sessionEventBus?.emitSessionEnd(activation.agentId, sessionId, status);

			if (status === 'timeout') {
				return Ok({
					sessionId,
					agentId: activation.agentId,
					status,
					startedAt,
					completedAt: toISOTimestamp(),
					toolCalls: [],
					toolResults: [],
					messagesEmitted: [],
					escalations: [],
					kpiReports: [],
					tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
					cost: 0 as USDCents,
					memoryUpdates: [],
					error: e instanceof Error ? e.message : String(e),
				});
			}

			return Err(new ABFErrorClass(
				'SESSION_FAILED',
				e instanceof Error ? e.message : String(e),
			));
		} finally {
			if (timeoutTimer) clearTimeout(timeoutTimer);
			this.activeSessions.delete(sessionId);
		}
	}

	/** Inner streaming session logic — extracted for timeout wrapping via Promise.race. */
	private async runStreamingSession(
		agent: AgentConfig,
		activation: Activation,
		sessionId: SessionId,
		startedAt: ISOTimestamp,
		signal: AbortSignal,
		emitChunk: (event: StreamEvent) => void,
		conversationHistory?: { role: string; content: ChatMessage['content'] }[],
	): Promise<Result<SessionResult, ABFError>> {
		// Step 1: Load context (lightweight for chat — skip heavy memory loads)
		const [memoryResult, knowledgeFiles] = await Promise.all([
			this.deps.memoryStore.loadContext(activation.agentId),
			this.deps.knowledgeDir
				? loadKnowledgeFiles(this.deps.knowledgeDir)
				: Promise.resolve({} as Record<string, string>),
		]);
		if (!memoryResult.ok) return memoryResult;
		const memory = memoryResult.value;
		const mergedKnowledge = { ...memory.knowledge, ...knowledgeFiles };

		// Drain unread mail for streaming sessions too
		let unreadMail: readonly import('../mailbox/types.js').MailMessage[] = [];
		if (this.deps.mailboxStore) {
			unreadMail = this.deps.mailboxStore.listInbox(agent.name, { unreadOnly: true, limit: 10 });
			for (const msg of unreadMail) {
				this.deps.mailboxStore.markRead(msg.id);
			}
			// Audit-log any injection detections in external mail
			for (const msg of unreadMail) {
				if (msg.source !== 'agent') {
					const analysis = processInput(msg.body, msg.source === 'email' ? 'email' : 'api');
					if (analysis.injectionDetected) {
						void this.deps.auditStore.log({
							timestamp: toISOTimestamp(),
							eventType: 'injection_detected',
							agentId: activation.agentId,
							details: { source: `mail:${msg.source}`, from: msg.from, patterns: analysis.patterns, threatLevel: analysis.threatLevel },
							severity: 'warn',
						});
					}
				}
			}
		}

		// Step 2: Build prompt — system message with charter + context
		const messages: ChatMessage[] = this.buildPrompt(agent, memory, activation, mergedKnowledge, undefined, undefined, unreadMail);

		// Inject conversation history before the final user message
		if (conversationHistory && conversationHistory.length > 0) {
			// Remove the default user message added by buildPrompt (last element)
			const userMsg = messages.pop();
			// Add conversation history
			for (const h of conversationHistory) {
				messages.push({
					role: h.role as ChatMessage['role'],
					content: h.content as string,
				});
			}
			// Re-add the user message
			if (userMsg) messages.push(userMsg);
		}

		// Handle multimodal content in user message
		const payload = activation.payload as Record<string, unknown> | undefined;
		if (payload?.['contentParts']) {
			// Replace the last user message with multimodal content
			const lastIdx = messages.length - 1;
			if (messages[lastIdx]?.role === 'user') {
				messages[lastIdx] = {
					role: 'user',
					content: payload['contentParts'] as ContentPart[],
				};
			}
		}

		// Step 3: Get provider + tools
		const provider = this.deps.providerRegistry.getBySlug(agent.provider);
		if (!provider) {
			return Err(new ABFErrorClass('PROVIDER_NOT_FOUND', `Provider ${agent.provider} not registered`));
		}

		const agentTools = this.deps.toolRegistry.getForAgent(agent.id, agent.tools);
		const chatTools = agentTools.map((t) => {
			const properties: Record<string, { type: string; description: string }> = {};
			const required: string[] = [];
			for (const p of t.definition.parameters) {
				properties[p.name] = { type: p.type, description: p.description };
				if (p.required) required.push(p.name);
			}
			return {
				name: t.definition.name,
				description: t.definition.description,
				parameters: { type: 'object', properties, required },
			};
		});

		// Step 4: Streaming tool loop
		let loopCount = 0;
		const maxLoops = agent.maxToolLoops ?? 10;
		let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
		let totalCost: USDCents = 0 as USDCents;
		const toolCalls: ToolCall[] = [];
		const toolResults: ToolResult[] = [];

		while (loopCount < maxLoops) {
			loopCount++;

			const chunks = provider.chat({
				model: agent.model,
				messages,
				temperature: agent.temperature,
				tools: chatTools.length > 0 ? chatTools : undefined,
				signal,
			});

			let responseText = '';
			const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

			for await (const chunk of chunks) {
				if (chunk.type === 'error') {
					emitChunk({ type: 'error', error: chunk.error ?? 'Provider error' });
					throw new ABFErrorClass('PROVIDER_ERROR', chunk.error ?? 'Provider error');
				}
				if (chunk.type === 'text' && chunk.text) {
					responseText += chunk.text;
					emitChunk({ type: 'token', text: chunk.text });
				}
				if (chunk.type === 'tool_call' && chunk.toolCall) {
					pendingToolCalls.push(chunk.toolCall);
				}
				if (chunk.type === 'usage' && chunk.usage) {
					totalUsage = {
						inputTokens: totalUsage.inputTokens + chunk.usage.inputTokens,
						outputTokens: totalUsage.outputTokens + chunk.usage.outputTokens,
						totalTokens: totalUsage.totalTokens + chunk.usage.totalTokens,
					};
				}
			}

			if (pendingToolCalls.length === 0) {
				messages.push({ role: 'assistant', content: responseText });
				break;
			}

			// Push assistant message with tool_calls (providers require tool results
			// to be preceded by an assistant message declaring the tool calls)
			messages.push({
				role: 'assistant',
				content: responseText || '',
				toolCalls: pendingToolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
			});

			// Execute tool calls with streaming events
			for (const tc of pendingToolCalls) {
				const tool = this.deps.toolRegistry.get(tc.name as import('../types/common.js').ToolId);
				if (!tool) continue;

				const parsedArgs = JSON.parse(tc.arguments) as Record<string, unknown>;

				// Behavioral bounds enforcement (R3)
				const boundsMsg = await this.checkAndEnforceBounds(tc.name, agent, sessionId, totalCost, parsedArgs);
				if (boundsMsg) {
					emitChunk({ type: 'tool_result', toolName: tc.name, toolOutput: boundsMsg });
					messages.push({ role: 'tool', content: boundsMsg, toolCallId: tc.id });
					continue;
				}

				emitChunk({
					type: 'tool_use',
					toolName: tc.name,
					toolArguments: parsedArgs,
				});

				const call: ToolCall = {
					toolId: tc.name as import('../types/common.js').ToolId,
					arguments: parsedArgs,
					agentId: agent.id,
					timestamp: toISOTimestamp(),
				};
				toolCalls.push(call);

				const budgetRemaining = ((agent.behavioralBounds.maxCostPerSession as number) -
					(totalCost as number)) as USDCents;

				const result = await this.deps.toolSandbox.execute(call, tool, budgetRemaining);
				if (result.ok) {
					toolResults.push(result.value);
					totalCost = ((totalCost as number) + ((result.value.cost ?? 0) as number)) as USDCents;

					// Input security pipeline for external tool results (R4)
					let toolOutput = JSON.stringify(result.value.output);
					if (EXTERNAL_TOOLS.has(tc.name)) {
						const analysis = processInput(toolOutput, 'web');
						toolOutput = analysis.sanitizedContent;
					}

					emitChunk({
						type: 'tool_result',
						toolName: tc.name,
						toolOutput: result.value.output,
					});

					messages.push({
						role: 'tool',
						content: toolOutput,
						toolCallId: tc.id,
					});
				}
			}
		}

		// Step 6: Write memory + outputs (matching runSession behavior)
		const lastMessage = messages[messages.length - 1];
		if (lastMessage && lastMessage.role === 'assistant' && typeof lastMessage.content === 'string') {
			await this.deps.memoryStore.append(
				activation.agentId,
				'history',
				`Chat: ${activation.trigger.task}\n\n${lastMessage.content}`,
			);

			// Write to outputs/ for cross-agent sharing
			if (this.deps.outputsManager) {
				await this.deps.outputsManager.write(
					agent.name,
					`# Chat: ${activation.trigger.task}\n\n${lastMessage.content}`,
				);
			}

			// Fire-and-forget compaction check
			if (this.deps.compactor) {
				void this.deps.compactor.compactIfNeeded(activation.agentId);
			}
		}

		// Step 8: Report
		totalCost = ((totalCost as number) +
			provider.estimateCost(agent.model, totalUsage.totalTokens)) as USDCents;

		const outputText = lastMessage && lastMessage.role === 'assistant' && typeof lastMessage.content === 'string'
			? lastMessage.content
			: undefined;

		// Emit session end for streaming sessions (R12)
		this.deps.sessionEventBus?.emitSessionEnd(activation.agentId, sessionId, 'completed', outputText);

		return Ok({
			sessionId,
			agentId: activation.agentId,
			status: 'completed' as import('../types/session.js').SessionStatus,
			startedAt,
			completedAt: toISOTimestamp(),
			toolCalls,
			toolResults,
			messagesEmitted: [],
			escalations: [],
			kpiReports: [],
			tokenUsage: totalUsage,
			cost: totalCost,
			memoryUpdates: [],
			outputText,
		});
	}

	private async runSession(
		agent: AgentConfig,
		activation: Activation,
		sessionId: SessionId,
		startedAt: ISOTimestamp,
		signal?: AbortSignal,
	): Promise<Result<SessionResult, ABFError>> {
		const toolCalls: ToolCall[] = [];
		const toolResults: ToolResult[] = [];
		let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
		let totalCost: USDCents = 0 as USDCents;
		const status: SessionStatus = 'completed';

		// Step 1: Load context
		const [memoryResult, knowledgeFiles, teammateOutputs] = await Promise.all([
			this.deps.memoryStore.loadContext(activation.agentId),
			this.deps.knowledgeDir
				? loadKnowledgeFiles(this.deps.knowledgeDir)
				: Promise.resolve({} as Record<string, string>),
			this.deps.outputsManager
				? this.deps.outputsManager.readTeamRecent(agent.name, 3)
				: Promise.resolve([]),
		]);
		if (!memoryResult.ok) return memoryResult;
		const memory = memoryResult.value;

		// Merge project-level knowledge into memory context
		const mergedKnowledge = { ...memory.knowledge, ...knowledgeFiles };

		// Drain inbox items
		const inboxItems = this.deps.inbox ? this.deps.inbox.drain(activation.agentId) : [];

		// Drain unread mail
		let unreadMail: readonly import('../mailbox/types.js').MailMessage[] = [];
		if (this.deps.mailboxStore) {
			unreadMail = this.deps.mailboxStore.listInbox(agent.name, { unreadOnly: true, limit: 10 });
			for (const msg of unreadMail) {
				this.deps.mailboxStore.markRead(msg.id);
			}
			// Audit-log any injection detections in external mail
			for (const msg of unreadMail) {
				if (msg.source !== 'agent') {
					const analysis = processInput(msg.body, msg.source === 'email' ? 'email' : 'api');
					if (analysis.injectionDetected) {
						void this.deps.auditStore.log({
							timestamp: toISOTimestamp(),
							eventType: 'injection_detected',
							agentId: activation.agentId,
							sessionId,
							details: { source: `mail:${msg.source}`, from: msg.from, patterns: analysis.patterns, threatLevel: analysis.threatLevel },
							severity: 'warn',
						});
					}
				}
			}
		}

		// Log session start
		await this.deps.auditStore.log({
			timestamp: startedAt,
			eventType: 'session_start',
			agentId: activation.agentId,
			sessionId,
			details: { trigger: activation.trigger },
			severity: 'info',
		});

		// Emit session start event (R12)
		this.deps.sessionEventBus?.emitSessionStart(activation.agentId, sessionId);

		// Step 2: Build prompt
		const messages: ChatMessage[] = this.buildPrompt(agent, memory, activation, mergedKnowledge, teammateOutputs, inboxItems, unreadMail);

		// Step 3: Execute LLM call
		const provider = this.deps.providerRegistry.getBySlug(agent.provider);
		if (!provider) {
			return Err(
				new ABFErrorClass('PROVIDER_NOT_FOUND', `Provider ${agent.provider} not registered`),
			);
		}

		// Build tool definitions for the provider (proper JSON Schema format)
		const agentTools = this.deps.toolRegistry.getForAgent(agent.id, agent.tools);
		const chatTools = agentTools.map((t) => {
			const properties: Record<string, { type: string; description: string }> = {};
			const required: string[] = [];
			for (const p of t.definition.parameters) {
				properties[p.name] = { type: p.type, description: p.description };
				if (p.required) required.push(p.name);
			}
			return {
				name: t.definition.name,
				description: t.definition.description,
				parameters: { type: 'object', properties, required },
			};
		});

		// Step 4: Tool loop
		let loopCount = 0;
		const maxLoops = agent.maxToolLoops ?? 10;

		while (loopCount < maxLoops) {
			loopCount++;

			const chunks = provider.chat({
				model: agent.model,
				messages,
				temperature: agent.temperature,
				tools: chatTools.length > 0 ? chatTools : undefined,
				signal,
			});

			let responseText = '';
			const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

			for await (const chunk of chunks) {
				if (chunk.type === 'error') {
					throw new ABFErrorClass('PROVIDER_ERROR', chunk.error ?? 'Provider error');
				}
				if (chunk.type === 'text' && chunk.text) {
					responseText += chunk.text;
				}
				if (chunk.type === 'tool_call' && chunk.toolCall) {
					pendingToolCalls.push(chunk.toolCall);
				}
				if (chunk.type === 'usage' && chunk.usage) {
					totalUsage = {
						inputTokens: totalUsage.inputTokens + chunk.usage.inputTokens,
						outputTokens: totalUsage.outputTokens + chunk.usage.outputTokens,
						totalTokens: totalUsage.totalTokens + chunk.usage.totalTokens,
					};
				}
			}

			// No tool calls — we're done
			if (pendingToolCalls.length === 0) {
				messages.push({ role: 'assistant', content: responseText });
				break;
			}

			// Push assistant message with tool_calls (providers require tool results
			// to be preceded by an assistant message declaring the tool calls)
			messages.push({
				role: 'assistant',
				content: responseText || '',
				toolCalls: pendingToolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
			});

			// Execute tool calls
			for (const tc of pendingToolCalls) {
				const tool = this.deps.toolRegistry.get(tc.name as import('../types/common.js').ToolId);
				if (!tool) continue;

				const parsedArgs = JSON.parse(tc.arguments) as Record<string, unknown>;

				// Behavioral bounds enforcement (R3)
				const boundsMsg = await this.checkAndEnforceBounds(tc.name, agent, sessionId, totalCost, parsedArgs);
				if (boundsMsg) {
					messages.push({ role: 'tool', content: boundsMsg, toolCallId: tc.id });
					continue;
				}

				const call: ToolCall = {
					toolId: tc.name as import('../types/common.js').ToolId,
					arguments: parsedArgs,
					agentId: agent.id,
					timestamp: toISOTimestamp(),
				};
				toolCalls.push(call);

				// Emit tool_use event (R12)
				this.deps.sessionEventBus?.emitStreamEvent(activation.agentId, sessionId, {
					type: 'tool_use',
					toolName: tc.name,
					toolArguments: parsedArgs,
				});

				const budgetRemaining = ((agent.behavioralBounds.maxCostPerSession as number) -
					(totalCost as number)) as USDCents;

				const result = await this.deps.toolSandbox.execute(call, tool, budgetRemaining);
				if (result.ok) {
					toolResults.push(result.value);
					totalCost = ((totalCost as number) + ((result.value.cost ?? 0) as number)) as USDCents;

					// Input security pipeline for external tool results (R4)
					let toolOutput = JSON.stringify(result.value.output);
					if (EXTERNAL_TOOLS.has(tc.name)) {
						const analysis = processInput(toolOutput, 'web');
						toolOutput = analysis.sanitizedContent;
						if (analysis.injectionDetected) {
							void this.deps.auditStore.log({
								timestamp: toISOTimestamp(),
								eventType: 'injection_detected',
								agentId: agent.id,
								sessionId,
								details: { tool: tc.name, patterns: analysis.patterns, threatLevel: analysis.threatLevel },
								severity: 'warn',
							});
						}
					}

					messages.push({
						role: 'tool',
						content: toolOutput,
						toolCallId: tc.id,
					});

					// Emit tool_result event (R12)
					this.deps.sessionEventBus?.emitStreamEvent(activation.agentId, sessionId, {
						type: 'tool_result',
						toolName: tc.name,
						toolOutput: result.value.output,
					});
				}
			}
		}

		// Capture the agent's final text response
		const lastMsg = messages[messages.length - 1];
		const outputText = lastMsg && lastMsg.role === 'assistant' && typeof lastMsg.content === 'string'
			? lastMsg.content
			: undefined;

		// Emit text output event (R12)
		if (outputText) {
			this.deps.sessionEventBus?.emitStreamEvent(activation.agentId, sessionId, {
				type: 'token',
				text: outputText,
			});
		}

		// Step 5: Process outputs — notify on session completion
		if (this.deps.messagingRouter) {
			const notification: AgentNotification = {
				type: 'session_complete',
				agentId: agent.id,
				sessionId,
				message: `Session completed for agent ${agent.name} (task: ${activation.trigger.task})`,
				severity: 'info',
				timestamp: toISOTimestamp(),
			};
			await this.deps.messagingRouter.send(notification);
		}

		// Step 6: Write memory + outputs
		const lastMessage = messages[messages.length - 1];
		if (lastMessage && lastMessage.role === 'assistant' && typeof lastMessage.content === 'string') {
			await this.deps.memoryStore.append(
				activation.agentId,
				'history',
				`Task: ${activation.trigger.task}\n\n${lastMessage.content}`,
			);

			// Write to outputs/ for cross-agent sharing
			if (this.deps.outputsManager) {
				await this.deps.outputsManager.write(
					agent.name,
					`# ${activation.trigger.task}\n\n${lastMessage.content}`,
				);
			}

			// Fire-and-forget compaction check (R8) — single-pass, loads context once
			if (this.deps.compactor) {
				void this.deps.compactor.compactIfNeeded(activation.agentId);
			}
		}

		// Step 7: Check escalations
		const escalations: Escalation[] = [];
		if (agent.escalationRules.length > 0) {
			for (const rule of agent.escalationRules) {
				const triggered = this.evaluateEscalationCondition(rule, status, totalCost, agent);
				if (triggered) {
					const escalation: Escalation = {
						type: 'custom',
						agentId: agent.id,
						sessionId,
						message: rule.message ?? `Escalation triggered: ${rule.condition}`,
						target: rule.target as 'human' | AgentId,
						timestamp: toISOTimestamp(),
						resolved: false,
					};
					escalations.push(escalation);

					if (this.deps.messagingRouter) {
						const notification: AgentNotification = {
							type: 'escalation',
							agentId: agent.id,
							sessionId,
							message: escalation.message,
							severity: 'error',
							timestamp: escalation.timestamp,
						};
						await this.deps.messagingRouter.send(notification);
					}
				}
			}
		}

		// Step 8: Report
		const completedAt = toISOTimestamp();

		await this.deps.auditStore.log({
			timestamp: completedAt,
			eventType: 'session_end',
			agentId: activation.agentId,
			sessionId,
			details: { status, cost: totalCost, toolCallCount: toolCalls.length },
			severity: 'info',
		});

		totalCost = ((totalCost as number) +
			provider.estimateCost(agent.model, totalUsage.totalTokens)) as USDCents;

		const durationMs = Date.now() - new Date(startedAt).getTime();
		const kpiReports = agent.kpis.map((kpi) =>
			evaluateKPI(kpi, {
				status,
				cost: totalCost,
				durationMs,
				messagesEmitted: toolCalls.length,
			}),
		);

		// Check if the agent called the reschedule tool — extract requested delay.
		const rescheduleResult = toolResults.find((r) => r.toolId === 'reschedule');
		const rescheduleIn =
			rescheduleResult?.success &&
			typeof (rescheduleResult.output as Record<string, unknown>)?.['delay_seconds'] === 'number'
				? ((rescheduleResult.output as Record<string, unknown>)['delay_seconds'] as number)
				: undefined;

		// Emit session end event (R12)
		const finalStatus = escalations.length > 0 ? 'escalated' as SessionStatus : status;
		this.deps.sessionEventBus?.emitSessionEnd(activation.agentId, sessionId, finalStatus, outputText);

		return Ok({
			sessionId,
			agentId: activation.agentId,
			status: finalStatus,
			startedAt,
			completedAt,
			toolCalls,
			toolResults,
			messagesEmitted: [],
			escalations,
			kpiReports,
			tokenUsage: totalUsage,
			cost: totalCost,
			memoryUpdates: [],
			outputText,
			rescheduleIn,
		});
	}

	async abort(sessionId: SessionId): Promise<void> {
		const controller = this.activeSessions.get(sessionId);
		if (controller) {
			controller.abort();
			this.activeSessions.delete(sessionId);
		}
	}

	/**
	 * Check behavioral bounds before tool execution.
	 * Returns a message to push to the LLM if blocked, or null to proceed.
	 */
	private async checkAndEnforceBounds(
		toolName: string,
		agent: AgentConfig,
		sessionId: SessionId,
		totalCost: USDCents,
		toolArgs?: Record<string, unknown>,
	): Promise<string | null> {
		const result = checkBounds({
			action: toolName,
			bounds: agent.behavioralBounds,
			currentSessionCost: totalCost,
		});

		if (!result.ok) {
			// Cost limit exceeded
			await this.deps.auditStore.log({
				timestamp: toISOTimestamp(),
				eventType: 'bounds_check',
				agentId: agent.id,
				sessionId,
				details: { tool: toolName, reason: 'cost_limit_exceeded', error: result.error.message },
				severity: 'warn',
			});
			return `[BLOCKED] Cost limit exceeded: ${result.error.message}`;
		}

		const check = result.value;

		if (check.allowed === false) {
			await this.deps.auditStore.log({
				timestamp: toISOTimestamp(),
				eventType: 'bounds_check',
				agentId: agent.id,
				sessionId,
				details: { tool: toolName, reason: check.reason, blocked: true },
				severity: 'warn',
			});
			return `[BLOCKED] Behavioral bounds: ${check.reason}`;
		}

		if (check.allowed === 'requires_approval') {
			const isUnlisted = !!check.reason; // reason is set when tool wasn't in allowedActions
			if (this.deps.approvalStore) {
				this.deps.approvalStore.create({
					agentId: agent.id,
					sessionId,
					toolId: toolName as import('../types/common.js').ToolId,
					toolName,
					arguments: toolArgs ?? {},
					createdAt: toISOTimestamp(),
					escalationReason: isUnlisted ? 'unlisted_action' : 'requires_approval',
				});
			}
			const auditReason = check.reason ?? 'requires_approval';
			await this.deps.auditStore.log({
				timestamp: toISOTimestamp(),
				eventType: 'bounds_check',
				agentId: agent.id,
				sessionId,
				details: { tool: toolName, reason: auditReason, queued: true },
				severity: 'info',
			});
			return `[QUEUED] Tool "${toolName}" requires approval. It has been queued for human review.`;
		}

		return null; // Proceed
	}

	/** Build "Human Responses" section for answered inquiries (R7). */
	private buildHumanResponsesSection(agentId: import('../types/common.js').AgentId): string {
		if (!this.deps.approvalStore) return '';
		const answered = this.deps.approvalStore.list({ agentId }).filter(
			(r) => r.type === 'inquiry' && r.status === 'answered' && r.answer,
		);
		if (answered.length === 0) return '';

		return [
			'Human Responses:',
			...answered.map(
				(r) => `- Q: ${r.question ?? '(unknown)'}\n  A: ${r.answer}`,
			),
		].join('\n');
	}

	/** Build the "Current Task Plan" section for the system prompt (R6). */
	private buildPlanSection(agentId: import('../types/common.js').AgentId): string {
		if (!this.deps.taskPlanStore) return '';
		const plan = this.deps.taskPlanStore.getActive(agentId);
		if (!plan) return '';

		const stepLines = plan.steps.map((s) => {
			const marker = s.id === plan.currentStepId ? '→' : ' ';
			const statusIcon = s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '…' : s.status === 'skipped' ? '–' : '○';
			return `  ${marker} [${statusIcon}] ${s.id}: ${s.description}${s.output ? ` (output: ${s.output.slice(0, 200)})` : ''}`;
		});

		return [
			'Current Task Plan:',
			`Goal: ${plan.goal}`,
			`Status: ${plan.status} | Current step: ${plan.currentStepId ?? 'none'}`,
			...stepLines,
		].join('\n');
	}

	private evaluateEscalationCondition(
		rule: EscalationRule,
		sessionStatus: SessionStatus,
		sessionCost: USDCents,
		agent: AgentConfig,
	): boolean {
		const condition = rule.condition.toLowerCase();
		if (condition.includes('error') && sessionStatus === 'failed') return true;
		if (condition.includes('timeout') && sessionStatus === 'timeout') return true;
		if (condition.includes('cost') || condition.includes('budget')) {
			return (sessionCost as number) >= (agent.behavioralBounds.maxCostPerSession as number);
		}
		return false;
	}

	private buildPrompt(
		agent: AgentConfig,
		memory: import('../types/memory.js').AgentMemoryContext,
		activation: Activation,
		knowledge?: Readonly<Record<string, string>>,
		teammateOutputs?: readonly import('../memory/outputs.js').OutputEntry[],
		inboxItems?: readonly import('../types/inbox.js').InboxItem[],
		unreadMail?: readonly import('../mailbox/types.js').MailMessage[],
	): ChatMessage[] {
		// Build knowledge base section (truncate each entry to ~2000 chars)
		const knowledgeEntries = Object.entries(knowledge ?? {});
		const knowledgeSection =
			knowledgeEntries.length > 0
				? [
						'Knowledge Base:',
						...knowledgeEntries.map(
							([name, content]) =>
								`### ${name}\n${content.length > 2000 ? `${content.slice(0, 2000)}…` : content}`,
						),
					].join('\n')
				: '';

		// Build teammate outputs section
		const outputsSection =
			teammateOutputs && teammateOutputs.length > 0
				? [
						'Recent Teammate Outputs:',
						...teammateOutputs.map(
							(o) =>
								`### ${o.agent} (${o.timestamp})\n${o.content.length > 1500 ? `${o.content.slice(0, 1500)}…` : o.content}`,
						),
					].join('\n')
				: '';

		const systemContent = [
			agent.charter,
			'',
			`Date: ${new Date().toISOString().slice(0, 10)}`,
			`Role: ${agent.role}`,
			`Task: ${activation.trigger.task}`,
			'',
			memory.summary
				? `Historical Summary:\n${memory.summary}`
				: '',
			memory.history.length > 0
				? `Recent History:\n${windowHistory(memory.history)}`
				: '',
			memory.decisions.length > 0
				? `Team Decisions:\n${memory.decisions.map((d) => d.content).join('\n')}`
				: '',
			knowledgeSection,
			outputsSection,
			inboxItems && inboxItems.length > 0
				? [
						`Inbox (${inboxItems.length} items):`,
						...inboxItems.map(
							(item) =>
								`- [${item.priority.toUpperCase()}] ${item.subject}${item.from ? ` (from: ${item.from})` : ''}\n  ${item.body.length > 500 ? `${item.body.slice(0, 500)}…` : item.body}`,
						),
					].join('\n')
				: '',
			unreadMail && unreadMail.length > 0
				? [
						`Unread Mail (${unreadMail.length} messages):`,
						...unreadMail.map((msg) => {
							const isTrusted = msg.source === 'agent';
							const prefix = isTrusted ? '' : '[EXTERNAL] ';
							// Sanitize non-agent mail through the input pipeline (prompt injection defense)
							const rawBody = msg.body.length > 500 ? `${msg.body.slice(0, 500)}…` : msg.body;
							const safeBody = isTrusted
								? rawBody
								: processInput(rawBody, msg.source === 'email' ? 'email' : 'api').sanitizedContent;
							return `- ${prefix}From: ${msg.from} | Subject: ${msg.subject} | Thread: ${msg.threadId}\n  ${safeBody}`;
						}),
					].join('\n')
				: '',
			memory.pendingMessages > 0 ? `You have ${memory.pendingMessages} pending messages.` : '',
			// Human responses to inquiries (R7)
			this.buildHumanResponsesSection(activation.agentId),
			// Active task plan (R6)
			this.buildPlanSection(activation.agentId),
			'',
			'KPIs:',
			...agent.kpis.map((k) => `- ${k.metric}: target ${k.target} (review ${k.review})`),
		]
			.filter(Boolean)
			.join('\n');

		const messages: ChatMessage[] = [{ role: 'system', content: systemContent }];

		if (activation.payload) {
			// Input security pipeline: process external payloads (R4)
			const source = triggerToInputSource(activation.trigger);
			let payloadContent = JSON.stringify(activation.payload);
			if (source !== 'system' && source !== 'agent') {
				const analysis = processInput(payloadContent, source);
				payloadContent = analysis.sanitizedContent;
				if (analysis.injectionDetected) {
					void this.deps.auditStore.log({
						timestamp: toISOTimestamp(),
						eventType: 'injection_detected',
						agentId: activation.agentId,
						details: { source, patterns: analysis.patterns, threatLevel: analysis.threatLevel, trigger: activation.trigger.type },
						severity: 'warn',
					});
				}
			}
			messages.push({
				role: 'user',
				content: payloadContent,
			});
		} else {
			messages.push({
				role: 'user',
				content: `Execute task: ${activation.trigger.task}`,
			});
		}

		return messages;
	}
}
