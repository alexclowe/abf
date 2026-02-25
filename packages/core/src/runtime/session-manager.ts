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
import type { ISessionManager } from './interfaces.js';

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
		const memoryResult = await this.deps.memoryStore.loadContext(activation.agentId);
		if (!memoryResult.ok) return memoryResult;
		const memory = memoryResult.value;

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
		const messages: ChatMessage[] = this.buildPrompt(agent, memory, activation);

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

		// Step 6: Write memory
		const lastMessage = messages[messages.length - 1];
		if (lastMessage && lastMessage.role === 'assistant' && typeof lastMessage.content === 'string') {
			await this.deps.memoryStore.append(
				activation.agentId,
				'history',
				`Task: ${activation.trigger.task}\n\n${lastMessage.content}`,
			);
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
	): ChatMessage[] {
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
