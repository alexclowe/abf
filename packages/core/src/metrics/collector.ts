/**
 * MetricsCollector — aggregates runtime statistics for the metrics dashboard.
 */

import type { IDispatcher } from '../runtime/interfaces.js';

export interface RuntimeMetrics {
	readonly activeSessions: number;
	readonly totalEscalations: number;
	readonly resolvedEscalations: number;
	readonly agentCount: number;
	readonly sessionHistory: readonly SessionSnapshot[];
}

export interface SessionSnapshot {
	readonly agentId: string;
	readonly sessionId: string;
	readonly startedAt: string;
}

export class MetricsCollector {
	constructor(
		private readonly dispatcher: IDispatcher,
		private readonly agentsMap: ReadonlyMap<string, unknown>,
	) {}

	collect(): RuntimeMetrics {
		const activeSessions = this.dispatcher.getActiveSessions();
		const escalations = this.dispatcher.getEscalations();

		return {
			activeSessions: activeSessions.length,
			totalEscalations: escalations.length,
			resolvedEscalations: escalations.filter((e) => e.resolved).length,
			agentCount: this.agentsMap.size,
			sessionHistory: activeSessions.map((s) => ({
				agentId: s.context.agentId,
				sessionId: s.context.sessionId,
				startedAt: s.context.startedAt,
			})),
		};
	}

	/**
	 * Collect per-agent KPI metrics.
	 */
	collectKPIs(agentId?: string) {
		return this.dispatcher.getKPIHistory(agentId as import('../types/common.js').AgentId | undefined);
	}

	/**
	 * Collect per-agent states.
	 */
	collectAgentStates() {
		const states: Record<string, unknown>[] = [];
		for (const [id] of this.agentsMap) {
			const state = this.dispatcher.getAgentState(id as import('../types/common.js').AgentId);
			if (state) states.push({ ...state });
		}
		return states;
	}
}
