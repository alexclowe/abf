/**
 * Dispatcher — receives activations, manages concurrency, creates sessions.
 * Accepts a shared agentsMap so it stays in sync with SessionManager and Runtime.
 */

import { nanoid } from 'nanoid';
import type { AgentConfig, AgentState } from '../types/agent.js';
import type { AgentId, SessionId, USDCents } from '../types/common.js';
import type { ABFError, Result } from '../types/errors.js';
import { ABFError as ABFErrorClass, Err, Ok } from '../types/errors.js';
import type { KPIReport, SessionResult, WorkSession } from '../types/session.js';
import type { Activation, HeartbeatTrigger } from '../types/trigger.js';
import { createActivationId, createSessionId, toISOTimestamp } from '../util/id.js';
import type { EscalationItem, IDispatcher, ISessionManager } from './interfaces.js';

export class Dispatcher implements IDispatcher {
	private readonly activeSessions = new Map<string, WorkSession>();
	private readonly completedSessions = new Map<string, SessionResult>();
	private readonly agentStates = new Map<string, AgentState>();
	private readonly escalationsList: EscalationItem[] = [];
	private readonly kpiHistory = new Map<string, KPIReport[]>();
	private readonly maxConcurrent: number;
	/** Tracks pending heartbeat timers so they can be cleared on shutdown. */
	private readonly heartbeatTimers = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(
		private readonly sessionManager: ISessionManager,
		maxConcurrentSessions: number,
		/** Shared agents map — populated by Runtime.loadAgents() */
		private readonly agents: Map<string, AgentConfig>,
	) {
		this.maxConcurrent = maxConcurrentSessions;
	}

	registerAgent(agent: AgentConfig): void {
		// agents map is shared — caller writes to it, we just track state
		this.agentStates.set(agent.id, {
			id: agent.id,
			status: 'idle',
			currentSessionCost: 0 as USDCents,
			totalCost: 0 as USDCents,
			sessionsCompleted: 0,
			errorCount: 0,
		});

		// Start heartbeat loop for agents with a heartbeat trigger.
		// First run fires after one full interval (gives the runtime time to stabilize).
		const heartbeat = agent.triggers.find(
			(t): t is HeartbeatTrigger => t.type === 'heartbeat',
		);
		if (heartbeat) {
			this.scheduleHeartbeat(agent.id, heartbeat.interval, heartbeat.task);
		}
	}

	/** Stop all pending heartbeat timers (call on runtime shutdown). */
	clearHeartbeats(): void {
		for (const timer of this.heartbeatTimers.values()) {
			clearTimeout(timer);
		}
		this.heartbeatTimers.clear();
	}

	async dispatch(activation: Activation): Promise<Result<SessionId, ABFError>> {
		// Check concurrency limit
		if (this.activeSessions.size >= this.maxConcurrent) {
			return Err(
				new ABFErrorClass(
					'RUNTIME_ERROR',
					`Max concurrent sessions (${this.maxConcurrent}) reached`,
					{ activeCount: this.activeSessions.size },
				),
			);
		}

		// Check agent exists in shared map
		const agent = this.agents.get(activation.agentId);
		if (!agent) {
			return Err(
				new ABFErrorClass('AGENT_NOT_FOUND', `Agent ${activation.agentId} not registered`, {
					agentId: activation.agentId,
				}),
			);
		}

		// Check agent not already active
		const state = this.agentStates.get(activation.agentId);
		if (state?.status === 'active') {
			return Err(
				new ABFErrorClass(
					'AGENT_ALREADY_RUNNING',
					`Agent ${activation.agentId} already has an active session`,
					{ agentId: activation.agentId },
				),
			);
		}

		const sessionId = createSessionId();

		// Update agent state
		this.updateAgentState(activation.agentId, { status: 'active' });

		// Execute session asynchronously
		this.executeSession(activation, sessionId).catch(() => {
			this.updateAgentState(activation.agentId, { status: 'error' });
		});

		return Ok(sessionId);
	}

	getActiveSessions(): readonly WorkSession[] {
		return [...this.activeSessions.values()];
	}

	getAgentState(agentId: AgentId): AgentState | undefined {
		return this.agentStates.get(agentId);
	}

	getSessionResult(sessionId: SessionId): SessionResult | undefined {
		return this.completedSessions.get(sessionId);
	}

	getEscalations(): readonly EscalationItem[] {
		return this.escalationsList;
	}

	resolveEscalation(id: string): boolean {
		const item = this.escalationsList.find((e) => e.id === id);
		if (!item) return false;
		item.resolved = true;
		return true;
	}

	getKPIHistory(agentId?: AgentId): readonly KPIReport[] {
		if (agentId !== undefined) return this.kpiHistory.get(agentId) ?? [];
		const all: KPIReport[] = [];
		for (const reports of this.kpiHistory.values()) {
			all.push(...reports);
		}
		return all;
	}

	private async executeSession(activation: Activation, sessionId: SessionId): Promise<void> {
		const result = await this.sessionManager.execute(activation);

		if (result.ok) {
			this.onSessionComplete(activation.agentId, result.value);
		} else {
			this.updateAgentState(activation.agentId, { status: 'error' });
		}

		this.activeSessions.delete(sessionId);
	}

	private onSessionComplete(agentId: AgentId, result: SessionResult): void {
		const current = this.agentStates.get(agentId);
		if (!current) return;

		// Store completed session result (keep last 100)
		this.completedSessions.set(result.sessionId, result);
		if (this.completedSessions.size > 100) {
			const firstKey = this.completedSessions.keys().next().value;
			if (firstKey !== undefined) this.completedSessions.delete(firstKey);
		}

		// Collect escalations from session result
		for (const esc of result.escalations) {
			this.escalationsList.push({
				id: `esc_${nanoid(16)}`,
				agentId: esc.agentId,
				sessionId: esc.sessionId,
				type: esc.type,
				message: esc.message,
				target: esc.target,
				timestamp: esc.timestamp,
				resolved: false,
			});
		}
		if (this.escalationsList.length > 1000) {
			this.escalationsList.splice(0, this.escalationsList.length - 1000);
		}

		// Accumulate KPI reports
		if (result.kpiReports.length > 0) {
			const existing = this.kpiHistory.get(result.agentId) ?? [];
			existing.push(...result.kpiReports);
			if (existing.length > 500) existing.splice(0, existing.length - 500);
			this.kpiHistory.set(result.agentId, existing);
		}

		this.agentStates.set(agentId, {
			...current,
			status: 'idle',
			lastActive: toISOTimestamp(),
			currentSessionCost: 0 as USDCents,
			totalCost: ((current.totalCost as number) + (result.cost as number)) as USDCents,
			sessionsCompleted: current.sessionsCompleted + 1,
			errorCount: result.status === 'failed' ? current.errorCount + 1 : current.errorCount,
		});

		// Re-schedule: either from an explicit reschedule tool call (result.rescheduleIn)
		// or from the agent's heartbeat trigger configuration.
		const agent = this.agents.get(agentId);
		if (agent) {
			const heartbeatTrigger = agent.triggers.find(
				(t): t is HeartbeatTrigger => t.type === 'heartbeat',
			);
			if (result.rescheduleIn !== undefined && result.rescheduleIn > 0) {
				// Agent explicitly called the reschedule tool — use its requested delay.
				const nextTask = heartbeatTrigger?.task ?? 'heartbeat';
				this.scheduleHeartbeat(agentId, result.rescheduleIn, nextTask);
			} else if (heartbeatTrigger) {
				// No explicit reschedule — re-run heartbeat at its configured interval.
				this.scheduleHeartbeat(agentId, heartbeatTrigger.interval, heartbeatTrigger.task);
			}
		}
	}

	/** Schedule a heartbeat activation for an agent after `delaySecs` seconds. */
	private scheduleHeartbeat(agentId: AgentId, delaySecs: number, task: string): void {
		// Clear any existing timer for this agent
		const existing = this.heartbeatTimers.get(agentId);
		if (existing !== undefined) clearTimeout(existing);

		const timer = setTimeout(() => {
			this.heartbeatTimers.delete(agentId);
			const agent = this.agents.get(agentId);
			if (!agent) return; // agent was unregistered

			const activation: Activation = {
				id: createActivationId(),
				agentId,
				trigger: { type: 'heartbeat', interval: delaySecs, task },
				timestamp: toISOTimestamp(),
			};
			void this.dispatch(activation);
		}, delaySecs * 1000);

		this.heartbeatTimers.set(agentId, timer);
	}

	private updateAgentState(agentId: AgentId, updates: Partial<Pick<AgentState, 'status'>>): void {
		const current = this.agentStates.get(agentId);
		if (!current) return;

		this.agentStates.set(agentId, {
			...current,
			...updates,
		});
	}
}
