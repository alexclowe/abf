import { describe, it, expect, vi, } from 'vitest';
import type { IProviderRegistry } from '../types/provider.js';
import type { ChatChunk, ChatRequest } from '../types/provider.js';
import { InterviewEngine } from './interview.js';

// ─── Mock Helpers ───────────────────────────────────────────────────────

function questionResponse(question: string, progress: string) {
	return JSON.stringify({ question, progress, complete: false });
}

function completionResponse(seedText: string) {
	return JSON.stringify({
		question: null,
		progress: 'complete',
		complete: true,
		seedText,
	});
}

/**
 * Create a mock provider that returns successive responses.
 * Each call to chat() yields the next response as a text chunk.
 */
function createMockProvider(responses: string[]) {
	let callIndex = 0;
	return {
		name: 'mock-provider',
		slug: 'mock',
		auth: 'api_key' as const,
		chat: vi.fn().mockImplementation((_req: ChatRequest) => {
			const text = responses[callIndex++] ?? '';
			return (async function* (): AsyncIterable<ChatChunk> {
				yield { type: 'text' as const, text };
				yield { type: 'done' as const };
			})();
		}),
		models: vi.fn().mockResolvedValue([]),
		estimateCost: vi.fn().mockReturnValue(0),
	};
}

function createMockRegistry(provider: ReturnType<typeof createMockProvider>) {
	return {
		get: vi.fn().mockReturnValue(provider),
		register: vi.fn(),
		list: vi.fn().mockReturnValue([]),
	} as unknown as IProviderRegistry;
}

function createEmptyRegistry() {
	return {
		get: vi.fn().mockReturnValue(undefined),
		register: vi.fn(),
		list: vi.fn().mockReturnValue([]),
	} as unknown as IProviderRegistry;
}

// ─── InterviewEngine ────────────────────────────────────────────────────

describe('InterviewEngine', () => {
	// ── start() ───────────────────────────────────────────────────────

	describe('start', () => {
		it('returns a sessionId and first question', async () => {
			const provider = createMockProvider([
				questionResponse("What's your company about?", '1 of ~10'),
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			const { sessionId, step } = await engine.start('new');

			expect(sessionId).toBeDefined();
			expect(typeof sessionId).toBe('string');
			expect(step.question).toBe("What's your company about?");
			expect(step.progress).toBe('1 of ~10');
			expect(step.complete).toBe(false);
		});

		it('creates an active session', async () => {
			const provider = createMockProvider([
				questionResponse('First question?', '1 of ~10'),
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			const { sessionId } = await engine.start('new');
			const session = engine.getSession(sessionId);

			expect(session).toBeDefined();
			expect(session!.status).toBe('active');
			expect(session!.companyType).toBe('new');
			expect(session!.answers).toHaveLength(0);
		});

		it('handles "existing" company type', async () => {
			const provider = createMockProvider([
				questionResponse('Tell me about your company.', '1 of ~10'),
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			const { sessionId } = await engine.start('existing');
			const session = engine.getSession(sessionId);

			expect(session!.companyType).toBe('existing');
		});

		it('sends appropriate initial message for new company', async () => {
			const provider = createMockProvider([
				questionResponse('Q?', '1 of ~10'),
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			await engine.start('new');

			const request = provider.chat.mock.calls[0]![0] as ChatRequest;
			const userMessage = request.messages.find((m) => m.role === 'user');
			expect(userMessage!.content).toContain('brand new company');
		});

		it('sends appropriate initial message for existing company', async () => {
			const provider = createMockProvider([
				questionResponse('Q?', '1 of ~10'),
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			await engine.start('existing');

			const request = provider.chat.mock.calls[0]![0] as ChatRequest;
			const userMessage = request.messages.find((m) => m.role === 'user');
			expect(userMessage!.content).toContain('existing company');
		});

		it('throws for unknown provider', async () => {
			const registry = createEmptyRegistry();
			const engine = new InterviewEngine(registry, 'nonexistent', 'model');

			await expect(engine.start('new')).rejects.toThrow(
				'Provider "nonexistent" not found',
			);
		});

		it('handles immediate completion from start', async () => {
			// Edge case: LLM decides to complete immediately
			const provider = createMockProvider([
				completionResponse('# Complete Seed Doc'),
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			const { sessionId, step } = await engine.start('new');

			expect(step.complete).toBe(true);
			expect(step.seedText).toBe('# Complete Seed Doc');

			const session = engine.getSession(sessionId);
			expect(session!.status).toBe('completed');
			expect(session!.seedText).toBe('# Complete Seed Doc');
		});
	});

	// ── respond() ─────────────────────────────────────────────────────

	describe('respond', () => {
		it('returns the next question', async () => {
			const provider = createMockProvider([
				questionResponse('Q1?', '1 of ~10'),
				questionResponse('Q2?', '2 of ~10'),
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			const { sessionId } = await engine.start('new');
			const step = await engine.respond(sessionId, 'We build test tools.');

			expect(step.question).toBe('Q2?');
			expect(step.progress).toBe('2 of ~10');
			expect(step.complete).toBe(false);
		});

		it('records the answer in the session', async () => {
			const provider = createMockProvider([
				questionResponse('Q1?', '1 of ~10'),
				questionResponse('Q2?', '2 of ~10'),
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			const { sessionId } = await engine.start('new');
			await engine.respond(sessionId, 'We build test tools.');

			const session = engine.getSession(sessionId);
			expect(session!.answers).toHaveLength(1);
			expect(session!.answers[0]!.answer).toBe('We build test tools.');
			expect(session!.answers[0]!.timestamp).toBeDefined();
		});

		it('handles interview completion', async () => {
			const provider = createMockProvider([
				questionResponse('Q1?', '1 of ~10'),
				completionResponse('# Generated Seed Document\n\nContent here.'),
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			const { sessionId } = await engine.start('new');
			const step = await engine.respond(sessionId, 'Final answer.');

			expect(step.complete).toBe(true);
			expect(step.seedText).toBe('# Generated Seed Document\n\nContent here.');
			expect(step.question).toBeNull();

			const session = engine.getSession(sessionId);
			expect(session!.status).toBe('completed');
			expect(session!.seedText).toBe('# Generated Seed Document\n\nContent here.');
		});

		it('builds full conversation history for LLM', async () => {
			const provider = createMockProvider([
				questionResponse('Q1?', '1 of ~10'),
				questionResponse('Q2?', '2 of ~10'),
				questionResponse('Q3?', '3 of ~10'),
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			const { sessionId } = await engine.start('new');
			await engine.respond(sessionId, 'Answer 1');
			await engine.respond(sessionId, 'Answer 2');

			// Third call (second respond) should have full history
			const thirdCall = provider.chat.mock.calls[2]![0] as ChatRequest;
			const messages = thirdCall.messages;

			// system, user (initial), assistant (Q1), user (A1), assistant (Q2), user (A2)
			expect(messages[0]!.role).toBe('system');
			expect(messages[1]!.role).toBe('user');
			expect(messages[2]!.role).toBe('assistant');
			expect(messages[3]!.role).toBe('user');
			expect(messages[3]!.content).toBe('Answer 1');
			expect(messages[4]!.role).toBe('assistant');
			expect(messages[5]!.role).toBe('user');
			expect(messages[5]!.content).toBe('Answer 2');
		});

		it('throws for non-existent session', async () => {
			const provider = createMockProvider([]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			await expect(
				engine.respond('non-existent-session', 'answer'),
			).rejects.toThrow('Interview session "non-existent-session" not found');
		});

		it('throws for completed session', async () => {
			const provider = createMockProvider([
				questionResponse('Q1?', '1 of ~10'),
				completionResponse('# Seed Doc'),
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			const { sessionId } = await engine.start('new');
			await engine.respond(sessionId, 'answer');

			// Session is now completed — further responds should throw
			await expect(
				engine.respond(sessionId, 'more answers'),
			).rejects.toThrow('is completed, not active');
		});

		it('throws for expired session (1 hour limit)', async () => {
			vi.useFakeTimers();

			try {
				const provider = createMockProvider([
					questionResponse('Q1?', '1 of ~10'),
					questionResponse('Q2?', '2 of ~10'),
				]);
				const registry = createMockRegistry(provider);
				const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

				const { sessionId } = await engine.start('new');

				// Advance past the 1-hour expiry
				vi.advanceTimersByTime(61 * 60 * 1000);

				await expect(
					engine.respond(sessionId, 'late answer'),
				).rejects.toThrow('has expired (1 hour limit)');

				// Session should be marked as abandoned
				const session = engine.getSession(sessionId);
				expect(session!.status).toBe('abandoned');
			} finally {
				vi.useRealTimers();
			}
		});

		it('forces completion at MAX_QUESTIONS (15)', async () => {
			// Need: 1 response for start() + 14 question responses + 1 completion response
			const responses: string[] = [];
			for (let i = 0; i < 15; i++) {
				responses.push(questionResponse(`Q${i + 1}?`, `${i + 1} of ~10`));
			}
			responses.push(completionResponse('# Forced Seed Doc'));

			const provider = createMockProvider(responses);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			const { sessionId } = await engine.start('new');

			// Answer 14 questions (questionCount goes from 1 to 15)
			for (let i = 0; i < 14; i++) {
				await engine.respond(sessionId, `Answer ${i + 1}`);
			}

			// 15th respond — should force completion
			const finalStep = await engine.respond(sessionId, 'Final answer');

			// Verify the force completion mechanism
			const lastChatCall = provider.chat.mock.calls[provider.chat.mock.calls.length - 1];
			const lastRequest = lastChatCall![0] as ChatRequest;

			// maxTokens should be 8192 for force completion
			expect(lastRequest.maxTokens).toBe(8192);

			// User message should include the system note
			const lastMessage = lastRequest.messages[lastRequest.messages.length - 1];
			expect(lastMessage!.content).toContain('[SYSTEM NOTE:');
			expect(lastMessage!.content).toContain('You MUST complete the interview now');

			expect(finalStep.complete).toBe(true);
			expect(finalStep.seedText).toBe('# Forced Seed Doc');
		});

		it('uses maxTokens 2048 for normal questions', async () => {
			const provider = createMockProvider([
				questionResponse('Q1?', '1 of ~10'),
				questionResponse('Q2?', '2 of ~10'),
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			const { sessionId } = await engine.start('new');
			await engine.respond(sessionId, 'Answer');

			const request = provider.chat.mock.calls[1]![0] as ChatRequest;
			expect(request.maxTokens).toBe(2048);
		});

		it('handles LLM response wrapped in code fences', async () => {
			const fencedResponse =
				'```json\n' +
				JSON.stringify({ question: 'Fenced Q?', progress: '2 of ~10', complete: false }) +
				'\n```';

			const provider = createMockProvider([
				questionResponse('Q1?', '1 of ~10'),
				fencedResponse,
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			const { sessionId } = await engine.start('new');
			const step = await engine.respond(sessionId, 'Answer');

			expect(step.question).toBe('Fenced Q?');
		});
	});

	// ── getSession / listSessions ─────────────────────────────────────

	describe('getSession', () => {
		it('returns the session for a valid ID', async () => {
			const provider = createMockProvider([
				questionResponse('Q?', '1 of ~10'),
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			const { sessionId } = await engine.start('new');
			const session = engine.getSession(sessionId);

			expect(session).toBeDefined();
			expect(session!.id).toBe(sessionId);
		});

		it('returns undefined for unknown ID', () => {
			const provider = createMockProvider([]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			expect(engine.getSession('unknown')).toBeUndefined();
		});
	});

	describe('listSessions', () => {
		it('returns empty array when no sessions exist', () => {
			const provider = createMockProvider([]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			expect(engine.listSessions()).toEqual([]);
		});

		it('returns all sessions', async () => {
			const provider = createMockProvider([
				questionResponse('Q1?', '1 of ~10'),
				questionResponse('Q2?', '1 of ~10'),
			]);
			const registry = createMockRegistry(provider);
			const engine = new InterviewEngine(registry, 'anthropic', 'claude-sonnet-4-5');

			await engine.start('new');
			await engine.start('existing');

			const sessions = engine.listSessions();
			expect(sessions).toHaveLength(2);

			const types = sessions.map((s) => s.companyType);
			expect(types).toContain('new');
			expect(types).toContain('existing');
		});
	});
});
