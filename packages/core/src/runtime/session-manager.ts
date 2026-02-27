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
import { createSessionId, toISOTimestamp } from '../util/id.js';
import { loadKnowledgeFiles } from '../knowledge/loader.js';
import type { ISessionManager, StreamEvent } from './interfaces.js';
import type { ContentPart } from '../types/provider.js';

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
}

export class SessionManager implements ISessionManager {
	constructor(private readonly deps: SessionManagerDeps) {}

	async execute(activation: Activation): Promise<Result<SessionResult, ABFError>> {
		const agent = this.deps.agents.get(activation.agentId);
		if (!agent) {
			return Err(new ABFErrorClass('AGENT_NOT_FOUND', `Agent ${activation.agentId} not found`));
		}

		const sessionId = createSessionId();
		const startedAt = toISOTimestamp();

		// Enforce session timeout via Promise.race
		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(
				() =>
					reject(
						new ABFErrorClass(
							'SESSION_TIMEOUT',
							`Session exceeded ${this.deps.sessionTimeoutMs}ms`,
						),
					),
				this.deps.sessionTimeoutMs,
			),
		);

		try {
			const result = await Promise.race([
				this.runSession(agent, activation, sessionId, startedAt),
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

		try {
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

			// Step 2: Build prompt — system message with charter + context
			const messages: ChatMessage[] = this.buildPrompt(agent, memory, activation, mergedKnowledge);

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
			const maxLoops = 10;
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
				});

				let responseText = '';
				const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

				for await (const chunk of chunks) {
					if (chunk.type === 'error') {
						onChunk({ type: 'error', error: chunk.error ?? 'Provider error' });
						throw new ABFErrorClass('PROVIDER_ERROR', chunk.error ?? 'Provider error');
					}
					if (chunk.type === 'text' && chunk.text) {
						responseText += chunk.text;
						onChunk({ type: 'token', text: chunk.text });
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

				// Execute tool calls with streaming events
				for (const tc of pendingToolCalls) {
					const tool = this.deps.toolRegistry.get(tc.name as import('../types/common.js').ToolId);
					if (!tool) continue;

					onChunk({
						type: 'tool_use',
						toolName: tc.name,
						toolArguments: JSON.parse(tc.arguments) as Record<string, unknown>,
					});

					const call: ToolCall = {
						toolId: tc.name as import('../types/common.js').ToolId,
						arguments: JSON.parse(tc.arguments) as Record<string, unknown>,
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

						onChunk({
							type: 'tool_result',
							toolName: tc.name,
							toolOutput: result.value.output,
						});

						messages.push({
							role: 'tool',
							content: JSON.stringify(result.value.output),
							toolCallId: tc.id,
						});
					}
				}
			}

			// Step 8: Report
			totalCost = ((totalCost as number) +
				provider.estimateCost(agent.model, totalUsage.totalTokens)) as USDCents;

			const lastMsg = messages[messages.length - 1];
			const outputText = lastMsg && lastMsg.role === 'assistant' && typeof lastMsg.content === 'string'
				? lastMsg.content
				: undefined;

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
		} catch (e) {
			return Err(new ABFErrorClass(
				'SESSION_FAILED',
				e instanceof Error ? e.message : String(e),
			));
		}
	}

	private async runSession(
		agent: AgentConfig,
		activation: Activation,
		sessionId: SessionId,
		startedAt: ISOTimestamp,
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

		// Log session start
		await this.deps.auditStore.log({
			timestamp: startedAt,
			eventType: 'session_start',
			agentId: activation.agentId,
			sessionId,
			details: { trigger: activation.trigger },
			severity: 'info',
		});

		// Step 2: Build prompt
		const messages: ChatMessage[] = this.buildPrompt(agent, memory, activation, mergedKnowledge, teammateOutputs, inboxItems);

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
		const maxLoops = 10;

		while (loopCount < maxLoops) {
			loopCount++;

			const chunks = provider.chat({
				model: agent.model,
				messages,
				temperature: agent.temperature,
				tools: chatTools.length > 0 ? chatTools : undefined,
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

			// Execute tool calls
			for (const tc of pendingToolCalls) {
				const tool = this.deps.toolRegistry.get(tc.name as import('../types/common.js').ToolId);
				if (!tool) continue;

				const call: ToolCall = {
					toolId: tc.name as import('../types/common.js').ToolId,
					arguments: JSON.parse(tc.arguments) as Record<string, unknown>,
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

					messages.push({
						role: 'tool',
						content: JSON.stringify(result.value.output),
						toolCallId: tc.id,
					});
				}
			}
		}

		// Capture the agent's final text response
		const lastMsg = messages[messages.length - 1];
		const outputText = lastMsg && lastMsg.role === 'assistant' && typeof lastMsg.content === 'string'
			? lastMsg.content
			: undefined;

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

		return Ok({
			sessionId,
			agentId: activation.agentId,
			status: escalations.length > 0 ? 'escalated' as SessionStatus : status,
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

	async abort(_sessionId: SessionId): Promise<void> {
		// In v0.1, abort is a no-op — sessions run to completion or timeout
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
			memory.history.length > 0
				? `Recent History:\n${memory.history.map((h) => h.content).join('\n---\n')}`
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
			memory.pendingMessages > 0 ? `You have ${memory.pendingMessages} pending messages.` : '',
			'',
			'KPIs:',
			...agent.kpis.map((k) => `- ${k.metric}: target ${k.target} (review ${k.review})`),
		]
			.filter(Boolean)
			.join('\n');

		const messages: ChatMessage[] = [{ role: 'system', content: systemContent }];

		if (activation.payload) {
			messages.push({
				role: 'user',
				content: JSON.stringify(activation.payload),
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
