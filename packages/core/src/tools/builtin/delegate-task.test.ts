import { describe, it, expect, vi } from 'vitest';
import { createDelegateTaskTool } from './delegate-task.js';
import type { BuiltinToolContext } from './context.js';
import type { IDispatcher } from '../../runtime/interfaces.js';
import type { AgentConfig } from '../../types/agent.js';
import type { AgentId } from '../../types/common.js';
import type { SessionResult } from '../../types/session.js';
import { ABFError } from '../../types/errors.js';

// Minimal mock context — delegate-task only uses extra deps, not toolContext
const mockCtx = {} as BuiltinToolContext;

function makeAgent(name: string): AgentConfig {
	return {
		name,
		id: name as AgentId,
		displayName: name.charAt(0).toUpperCase() + name.slice(1),
		role: 'Test',
		description: 'Test agent',
		provider: 'anthropic',
		model: 'claude-sonnet-4-6',
		tools: [],
		triggers: [],
		escalationRules: [],
		behavioralBounds: {
			allowedActions: [],
			forbiddenActions: [],
			requiresApproval: [],
		},
		kpis: [],
		charter: 'test charter',
	};
}

function makeSessionResult(overrides?: Partial<SessionResult>): SessionResult {
	return {
		sessionId: 'ses_123' as import('../../types/common.js').SessionId,
		agentId: 'writer' as AgentId,
		status: 'completed',
		startedAt: '2026-01-01T00:00:00.000Z' as import('../../types/common.js').ISOTimestamp,
		completedAt: '2026-01-01T00:00:05.000Z' as import('../../types/common.js').ISOTimestamp,
		toolCalls: [],
		toolResults: [],
		messagesEmitted: [],
		escalations: [],
		kpiReports: [],
		tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
		cost: 5 as import('../../types/common.js').USDCents,
		memoryUpdates: [],
		outputText: 'Here is the draft blog post about AI agents.',
		...overrides,
	};
}

function makeDispatcher(overrides?: Partial<IDispatcher>): IDispatcher {
	return {
		dispatch: vi.fn(),
		dispatchAndWait: vi.fn(),
		registerAgent: vi.fn(),
		recordExternalSession: vi.fn(),
		getActiveSessions: vi.fn().mockReturnValue([]),
		getAgentState: vi.fn(),
		getSessionResult: vi.fn(),
		getCompletedSessionsForAgent: vi.fn().mockReturnValue([]),
		getEscalations: vi.fn().mockReturnValue([]),
		resolveEscalation: vi.fn(),
		getKPIHistory: vi.fn().mockReturnValue([]),
		shutdown: vi.fn(),
		...overrides,
	} as unknown as IDispatcher;
}

describe('delegate-task tool', () => {
	const agentsMap = new Map<string, AgentConfig>([
		['writer', makeAgent('writer')],
		['researcher', makeAgent('researcher')],
		['analyst', makeAgent('analyst')],
	]);

	describe('definition', () => {
		it('has correct id, name, and 4 parameters', () => {
			const tool = createDelegateTaskTool(mockCtx, {
				dispatcher: makeDispatcher(),
				agentsMap,
			});

			expect(tool.definition.id).toBe('delegate-task');
			expect(tool.definition.name).toBe('delegate-task');
			expect(tool.definition.parameters).toHaveLength(4);

			const paramNames = tool.definition.parameters.map((p) => p.name);
			expect(paramNames).toEqual(['agent', 'task', 'context', 'timeout_seconds']);
		});

		it('has timeout of 305000ms', () => {
			const tool = createDelegateTaskTool(mockCtx, {
				dispatcher: makeDispatcher(),
				agentsMap,
			});
			expect(tool.definition.timeout).toBe(305_000);
		});
	});

	describe('validation', () => {
		it('returns Err when agent is missing', async () => {
			const tool = createDelegateTaskTool(mockCtx, {
				dispatcher: makeDispatcher(),
				agentsMap,
			});

			const result = await tool.execute({ task: 'write a post' });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.message).toContain('agent is required');
			}
		});

		it('returns Err when agent is empty string', async () => {
			const tool = createDelegateTaskTool(mockCtx, {
				dispatcher: makeDispatcher(),
				agentsMap,
			});

			const result = await tool.execute({ agent: '  ', task: 'write a post' });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.message).toContain('agent is required');
			}
		});

		it('returns Err when task is missing', async () => {
			const tool = createDelegateTaskTool(mockCtx, {
				dispatcher: makeDispatcher(),
				agentsMap,
			});

			const result = await tool.execute({ agent: 'writer' });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.message).toContain('task is required');
			}
		});

		it('returns Err with available agents when agent not found', async () => {
			const tool = createDelegateTaskTool(mockCtx, {
				dispatcher: makeDispatcher(),
				agentsMap,
			});

			const result = await tool.execute({ agent: 'nonexistent', task: 'do something' });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.message).toContain("'nonexistent' not found");
				expect(result.error.message).toContain('writer');
				expect(result.error.message).toContain('researcher');
				expect(result.error.message).toContain('analyst');
			}
		});
	});

	describe('successful delegation', () => {
		it('returns Ok with response and metadata', async () => {
			const sessionResult = makeSessionResult();
			const dispatcher = makeDispatcher({
				dispatchAndWait: vi.fn().mockResolvedValue({ ok: true, value: sessionResult }),
			});

			const tool = createDelegateTaskTool(mockCtx, { dispatcher, agentsMap });

			const result = await tool.execute({ agent: 'writer', task: 'Write a blog post about AI' });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value).toMatchObject({
					success: true,
					agent: 'writer',
					agentDisplayName: 'Writer',
					status: 'completed',
					response: 'Here is the draft blog post about AI agents.',
					escalations: [],
				});
				expect(result.value.metadata).toMatchObject({
					sessionId: 'ses_123',
					cost: 5,
					toolCallCount: 0,
					hasEscalations: false,
				});
				expect(result.value.metadata.durationMs).toBeGreaterThanOrEqual(0);
			}
		});

		it('passes correct activation to dispatcher', async () => {
			const dispatchAndWait = vi.fn().mockResolvedValue({
				ok: true,
				value: makeSessionResult(),
			});
			const dispatcher = makeDispatcher({ dispatchAndWait });

			const tool = createDelegateTaskTool(mockCtx, { dispatcher, agentsMap });

			await tool.execute({ agent: 'writer', task: 'Write a post' });

			expect(dispatchAndWait).toHaveBeenCalledTimes(1);
			const activation = dispatchAndWait.mock.calls[0][0];
			expect(activation.agentId).toBe('writer');
			expect(activation.trigger.type).toBe('manual');
			expect(activation.trigger.task).toBe('Write a post');
			expect(activation.payload).toEqual({ source: 'delegate-task' });
		});
	});

	describe('context parameter', () => {
		it('appends context to task in activation', async () => {
			const dispatchAndWait = vi.fn().mockResolvedValue({
				ok: true,
				value: makeSessionResult(),
			});
			const dispatcher = makeDispatcher({ dispatchAndWait });

			const tool = createDelegateTaskTool(mockCtx, { dispatcher, agentsMap });

			await tool.execute({
				agent: 'writer',
				task: 'Write a blog post',
				context: 'The topic is AI agents in business.',
			});

			const activation = dispatchAndWait.mock.calls[0][0];
			expect(activation.trigger.task).toBe(
				'Write a blog post\n\nAdditional context:\nThe topic is AI agents in business.',
			);
		});

		it('does not append context section when context is empty', async () => {
			const dispatchAndWait = vi.fn().mockResolvedValue({
				ok: true,
				value: makeSessionResult(),
			});
			const dispatcher = makeDispatcher({ dispatchAndWait });

			const tool = createDelegateTaskTool(mockCtx, { dispatcher, agentsMap });

			await tool.execute({ agent: 'writer', task: 'Write a post', context: '' });

			const activation = dispatchAndWait.mock.calls[0][0];
			expect(activation.trigger.task).toBe('Write a post');
		});
	});

	describe('timeout clamping', () => {
		it('clamps timeout > 300 to 300', async () => {
			const dispatchAndWait = vi.fn().mockResolvedValue({
				ok: true,
				value: makeSessionResult(),
			});
			const dispatcher = makeDispatcher({ dispatchAndWait });

			const tool = createDelegateTaskTool(mockCtx, { dispatcher, agentsMap });

			await tool.execute({ agent: 'writer', task: 'Write a post', timeout_seconds: 600 });

			// dispatchAndWait called with 300 * 1000 = 300000ms
			expect(dispatchAndWait.mock.calls[0][1]).toBe(300_000);
		});

		it('clamps timeout < 10 to 10', async () => {
			const dispatchAndWait = vi.fn().mockResolvedValue({
				ok: true,
				value: makeSessionResult(),
			});
			const dispatcher = makeDispatcher({ dispatchAndWait });

			const tool = createDelegateTaskTool(mockCtx, { dispatcher, agentsMap });

			await tool.execute({ agent: 'writer', task: 'Write a post', timeout_seconds: 3 });

			expect(dispatchAndWait.mock.calls[0][1]).toBe(10_000);
		});

		it('uses default timeout of 120s when not specified', async () => {
			const dispatchAndWait = vi.fn().mockResolvedValue({
				ok: true,
				value: makeSessionResult(),
			});
			const dispatcher = makeDispatcher({ dispatchAndWait });

			const tool = createDelegateTaskTool(mockCtx, { dispatcher, agentsMap });

			await tool.execute({ agent: 'writer', task: 'Write a post' });

			expect(dispatchAndWait.mock.calls[0][1]).toBe(120_000);
		});
	});

	describe('error handling', () => {
		it('returns Ok with success:false on AGENT_ALREADY_RUNNING', async () => {
			const dispatcher = makeDispatcher({
				dispatchAndWait: vi.fn().mockResolvedValue({
					ok: false,
					error: new ABFError('AGENT_ALREADY_RUNNING', 'Agent writer already has an active session'),
				}),
			});

			const tool = createDelegateTaskTool(mockCtx, { dispatcher, agentsMap });

			const result = await tool.execute({ agent: 'writer', task: 'Write a post' });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.success).toBe(false);
				expect(result.value.agent).toBe('writer');
				expect(result.value.error).toContain('currently busy');
			}
		});

		it('returns Ok with success:false on SESSION_TIMEOUT', async () => {
			const dispatcher = makeDispatcher({
				dispatchAndWait: vi.fn().mockResolvedValue({
					ok: false,
					error: new ABFError('SESSION_TIMEOUT', 'Timed out'),
				}),
			});

			const tool = createDelegateTaskTool(mockCtx, { dispatcher, agentsMap });

			const result = await tool.execute({ agent: 'writer', task: 'Write a post' });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.success).toBe(false);
				expect(result.value.error).toContain('did not complete');
			}
		});

		it('returns Ok with success:false on other dispatch errors', async () => {
			const dispatcher = makeDispatcher({
				dispatchAndWait: vi.fn().mockResolvedValue({
					ok: false,
					error: new ABFError('RUNTIME_ERROR', 'Something unexpected'),
				}),
			});

			const tool = createDelegateTaskTool(mockCtx, { dispatcher, agentsMap });

			const result = await tool.execute({ agent: 'writer', task: 'Write a post' });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.success).toBe(false);
				expect(result.value.error).toContain('Something unexpected');
			}
		});
	});

	describe('escalations', () => {
		it('includes escalation info in successful result', async () => {
			const sessionResult = makeSessionResult({
				escalations: [
					{
						agentId: 'writer' as AgentId,
						sessionId: 'ses_123' as import('../../types/common.js').SessionId,
						type: 'cost_limit',
						message: 'Cost limit exceeded',
						target: 'human',
						timestamp: '2026-01-01T00:00:05.000Z' as import('../../types/common.js').ISOTimestamp,
					},
				],
			});

			const dispatcher = makeDispatcher({
				dispatchAndWait: vi.fn().mockResolvedValue({ ok: true, value: sessionResult }),
			});

			const tool = createDelegateTaskTool(mockCtx, { dispatcher, agentsMap });

			const result = await tool.execute({ agent: 'writer', task: 'Write a post' });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.success).toBe(true);
				expect(result.value.escalations).toHaveLength(1);
				expect(result.value.escalations[0]).toEqual({
					type: 'cost_limit',
					message: 'Cost limit exceeded',
					target: 'human',
				});
				expect(result.value.metadata.hasEscalations).toBe(true);
			}
		});
	});
});
