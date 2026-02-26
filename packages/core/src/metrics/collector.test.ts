import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricsCollector } from './collector.js';
import type { IDispatcher, EscalationItem } from '../runtime/interfaces.js';
import type { AgentState } from '../types/agent.js';
import type { WorkSession, KPIReport } from '../types/session.js';
import type { AgentId, ISOTimestamp, SessionId, USDCents } from '../types/common.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function mockDispatcher(overrides: Partial<IDispatcher> = {}): IDispatcher {
	return {
		dispatch: vi.fn(),
		registerAgent: vi.fn(),
		getActiveSessions: vi.fn().mockReturnValue([]),
		getAgentState: vi.fn().mockReturnValue(undefined),
		getSessionResult: vi.fn().mockReturnValue(undefined),
		getEscalations: vi.fn().mockReturnValue([]),
		resolveEscalation: vi.fn().mockReturnValue(false),
		getKPIHistory: vi.fn().mockReturnValue([]),
		clearHeartbeats: vi.fn(),
		...overrides,
	};
}

function makeWorkSession(agentId: string, sessionId: string): WorkSession {
	return {
		context: {
			sessionId: sessionId as SessionId,
			agentId: agentId as AgentId,
			activation: {
				id: 'act_test' as import('../types/common.js').ActivationId,
				agentId: agentId as AgentId,
				trigger: { type: 'manual', task: 'test' },
				payload: {},
				timestamp: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
			},
			memory: { charter: '', history: '', decisions: '' },
			pendingMessages: [],
			startedAt: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
		},
		status: 'completed',
		toolCalls: [],
		toolResults: [],
		messagesEmitted: [],
		escalations: [],
		tokenUsage: { inputTokens: 0, outputTokens: 0 },
		cost: 0 as USDCents,
	};
}

function makeEscalation(resolved: boolean): EscalationItem {
	return {
		id: `esc_${Math.random().toString(36).slice(2)}`,
		agentId: 'scout' as AgentId,
		sessionId: 'ses_test' as SessionId,
		type: 'error',
		message: 'something broke',
		target: 'human',
		timestamp: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
		resolved,
	};
}

function makeAgentState(id: string): AgentState {
	return {
		id: id as AgentId,
		status: 'idle',
		currentSessionCost: 0 as USDCents,
		totalCost: 0 as USDCents,
		sessionsCompleted: 3,
		errorCount: 0,
	};
}

function makeKPIReport(agentId: string): KPIReport {
	return {
		metric: 'coverage',
		value: '95%',
		target: '100%',
		met: false,
		timestamp: '2026-01-15T12:00:00.000Z' as ISOTimestamp,
	};
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('MetricsCollector', () => {
	// ── collect() ─────────────────────────────────────────────────────

	describe('collect()', () => {
		it('returns zeros when dispatcher has no sessions or escalations', () => {
			const dispatcher = mockDispatcher();
			const agentsMap = new Map<string, unknown>();
			const collector = new MetricsCollector(dispatcher, agentsMap);

			const metrics = collector.collect();

			expect(metrics.activeSessions).toBe(0);
			expect(metrics.totalEscalations).toBe(0);
			expect(metrics.resolvedEscalations).toBe(0);
			expect(metrics.agentCount).toBe(0);
			expect(metrics.sessionHistory).toHaveLength(0);
		});

		it('returns correct active session count and session history', () => {
			const sessions: WorkSession[] = [
				makeWorkSession('scout', 'ses_001'),
				makeWorkSession('lens', 'ses_002'),
			];
			const dispatcher = mockDispatcher({
				getActiveSessions: vi.fn().mockReturnValue(sessions),
			});
			const agentsMap = new Map<string, unknown>([
				['scout', {}],
				['lens', {}],
			]);
			const collector = new MetricsCollector(dispatcher, agentsMap);

			const metrics = collector.collect();

			expect(metrics.activeSessions).toBe(2);
			expect(metrics.agentCount).toBe(2);
			expect(metrics.sessionHistory).toHaveLength(2);
			expect(metrics.sessionHistory[0]!.agentId).toBe('scout');
			expect(metrics.sessionHistory[0]!.sessionId).toBe('ses_001');
			expect(metrics.sessionHistory[1]!.agentId).toBe('lens');
		});

		it('counts total and resolved escalations separately', () => {
			const escalations: EscalationItem[] = [
				makeEscalation(false),
				makeEscalation(true),
				makeEscalation(true),
				makeEscalation(false),
			];
			const dispatcher = mockDispatcher({
				getEscalations: vi.fn().mockReturnValue(escalations),
			});
			const agentsMap = new Map<string, unknown>();
			const collector = new MetricsCollector(dispatcher, agentsMap);

			const metrics = collector.collect();

			expect(metrics.totalEscalations).toBe(4);
			expect(metrics.resolvedEscalations).toBe(2);
		});

		it('reports agentCount from agentsMap size', () => {
			const dispatcher = mockDispatcher();
			const agentsMap = new Map<string, unknown>([
				['scout', {}],
				['lens', {}],
				['sage', {}],
			]);
			const collector = new MetricsCollector(dispatcher, agentsMap);

			const metrics = collector.collect();
			expect(metrics.agentCount).toBe(3);
		});
	});

	// ── collectAgentStates() ──────────────────────────────────────────

	describe('collectAgentStates()', () => {
		it('returns an array of agent states for all agents in the map', () => {
			const scoutState = makeAgentState('scout');
			const lensState = makeAgentState('lens');
			const dispatcher = mockDispatcher({
				getAgentState: vi.fn().mockImplementation((id: AgentId) => {
					if (id === 'scout') return scoutState;
					if (id === 'lens') return lensState;
					return undefined;
				}),
			});
			const agentsMap = new Map<string, unknown>([
				['scout', {}],
				['lens', {}],
			]);
			const collector = new MetricsCollector(dispatcher, agentsMap);

			const states = collector.collectAgentStates();

			expect(states).toHaveLength(2);
			expect(states[0]).toEqual(expect.objectContaining({ id: 'scout', status: 'idle' }));
			expect(states[1]).toEqual(expect.objectContaining({ id: 'lens', status: 'idle' }));
		});

		it('returns empty array when no agents have state', () => {
			const dispatcher = mockDispatcher({
				getAgentState: vi.fn().mockReturnValue(undefined),
			});
			const agentsMap = new Map<string, unknown>([['scout', {}]]);
			const collector = new MetricsCollector(dispatcher, agentsMap);

			const states = collector.collectAgentStates();
			expect(states).toHaveLength(0);
		});

		it('returns empty array when agentsMap is empty', () => {
			const dispatcher = mockDispatcher();
			const agentsMap = new Map<string, unknown>();
			const collector = new MetricsCollector(dispatcher, agentsMap);

			const states = collector.collectAgentStates();
			expect(states).toHaveLength(0);
		});
	});

	// ── collectKPIs() ─────────────────────────────────────────────────

	describe('collectKPIs()', () => {
		it('returns full KPI history when called without agentId', () => {
			const kpis: KPIReport[] = [
				makeKPIReport('scout'),
				makeKPIReport('lens'),
			];
			const dispatcher = mockDispatcher({
				getKPIHistory: vi.fn().mockReturnValue(kpis),
			});
			const agentsMap = new Map<string, unknown>();
			const collector = new MetricsCollector(dispatcher, agentsMap);

			const result = collector.collectKPIs();

			expect(result).toHaveLength(2);
			expect(dispatcher.getKPIHistory).toHaveBeenCalledWith(undefined);
		});

		it('passes agentId filter to dispatcher when provided', () => {
			const kpis: KPIReport[] = [makeKPIReport('scout')];
			const dispatcher = mockDispatcher({
				getKPIHistory: vi.fn().mockReturnValue(kpis),
			});
			const agentsMap = new Map<string, unknown>();
			const collector = new MetricsCollector(dispatcher, agentsMap);

			const result = collector.collectKPIs('scout');

			expect(result).toHaveLength(1);
			expect(dispatcher.getKPIHistory).toHaveBeenCalledWith('scout');
		});

		it('returns empty array when dispatcher has no KPI history', () => {
			const dispatcher = mockDispatcher({
				getKPIHistory: vi.fn().mockReturnValue([]),
			});
			const agentsMap = new Map<string, unknown>();
			const collector = new MetricsCollector(dispatcher, agentsMap);

			const result = collector.collectKPIs();
			expect(result).toHaveLength(0);
		});
	});
});
