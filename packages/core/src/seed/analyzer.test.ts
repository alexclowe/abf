import { describe, it, expect, vi } from 'vitest';
import type { IProviderRegistry } from '../types/provider.js';
import type { ChatChunk, ChatRequest } from '../types/provider.js';
import { analyzeSeedDoc, reanalyzeSeedDoc } from './analyzer.js';
import type { CompanyPlan } from './types.js';

// ─── Mock Helpers ───────────────────────────────────────────────────────

/** Minimal valid plan JSON that passes validatePlanShape(). */
const VALID_PLAN = {
	company: { name: 'TestCo', description: 'A test company' },
	agents: [
		{
			name: 'scout',
			displayName: 'Scout',
			role: 'Researcher',
			description: 'Researches things',
			charter: '# Scout',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			temperature: 0.3,
			team: 'ops',
			reportsTo: null,
			tools: ['web-search'],
			triggers: [{ type: 'manual', task: 'research' }],
			kpis: [],
			behavioralBounds: {
				allowedActions: ['read_data'],
				forbiddenActions: ['delete_data'],
				maxCostPerSession: '$2.00',
				requiresApproval: [],
			},
		},
	],
	teams: [
		{
			name: 'ops',
			displayName: 'Operations',
			description: 'Main team',
			orchestrator: 'scout',
			members: ['scout'],
		},
	],
	knowledge: { 'company.md': '# TestCo' },
	workflows: [],
	escalationRules: [],
	toolGaps: [],
};

const VALID_PLAN_JSON = JSON.stringify(VALID_PLAN);

/**
 * Create a mock provider that returns successive responses from the array.
 * Each call to `chat()` returns a new async iterable yielding the next response.
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

/** Create a mock provider that yields an error chunk. */
function createErrorProvider(errorMessage: string) {
	return {
		name: 'error-provider',
		slug: 'error',
		auth: 'api_key' as const,
		chat: vi.fn().mockImplementation(() => {
			return (async function* (): AsyncIterable<ChatChunk> {
				yield { type: 'error' as const, error: errorMessage };
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

const SEED_TEXT = 'TestCo is a company that builds test automation tools.';

// ─── analyzeSeedDoc ─────────────────────────────────────────────────────

describe('analyzeSeedDoc', () => {
	it('returns a CompanyPlan when LLM produces valid JSON', async () => {
		const provider = createMockProvider([VALID_PLAN_JSON]);
		const registry = createMockRegistry(provider);

		const plan = await analyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: SEED_TEXT,
		});

		expect(plan.company.name).toBe('TestCo');
		expect(plan.agents).toHaveLength(1);
		expect(plan.teams).toHaveLength(1);
	});

	it('adds metadata fields (generatedAt, seedVersion, seedText)', async () => {
		const provider = createMockProvider([VALID_PLAN_JSON]);
		const registry = createMockRegistry(provider);

		const plan = await analyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: SEED_TEXT,
		});

		expect(plan.generatedAt).toBeDefined();
		expect(plan.seedVersion).toBe(1);
		expect(plan.seedText).toBe(SEED_TEXT);
	});

	it('strips markdown code fences from LLM response', async () => {
		const fencedResponse = '```json\n' + VALID_PLAN_JSON + '\n```';
		const provider = createMockProvider([fencedResponse]);
		const registry = createMockRegistry(provider);

		const plan = await analyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: SEED_TEXT,
		});

		expect(plan.company.name).toBe('TestCo');
	});

	it('strips ``` fences without json tag', async () => {
		const fencedResponse = '```\n' + VALID_PLAN_JSON + '\n```';
		const provider = createMockProvider([fencedResponse]);
		const registry = createMockRegistry(provider);

		const plan = await analyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: SEED_TEXT,
		});

		expect(plan.company.name).toBe('TestCo');
	});

	it('retries on JSON parse failure and succeeds', async () => {
		// First response is invalid JSON, second is valid
		const provider = createMockProvider([
			'This is not JSON at all',
			VALID_PLAN_JSON,
		]);
		const registry = createMockRegistry(provider);

		const plan = await analyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: SEED_TEXT,
			maxRetries: 2,
		});

		expect(plan.company.name).toBe('TestCo');
		// Should have called chat twice (initial + retry)
		expect(provider.chat).toHaveBeenCalledTimes(2);
	});

	it('retries on invalid plan shape and succeeds', async () => {
		// First response is valid JSON but missing required fields
		const invalidPlan = JSON.stringify({ company: { name: 'TestCo' } });
		const provider = createMockProvider([invalidPlan, VALID_PLAN_JSON]);
		const registry = createMockRegistry(provider);

		const plan = await analyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: SEED_TEXT,
			maxRetries: 2,
		});

		expect(plan.company.name).toBe('TestCo');
		expect(provider.chat).toHaveBeenCalledTimes(2);
	});

	it('retry messages include the error', async () => {
		const provider = createMockProvider(['not json', VALID_PLAN_JSON]);
		const registry = createMockRegistry(provider);

		await analyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: SEED_TEXT,
			maxRetries: 2,
		});

		// Second call should include the error message in the retry prompt
		const secondCall = provider.chat.mock.calls[1]![0] as ChatRequest;
		const lastMessage = secondCall.messages[secondCall.messages.length - 1];
		expect(lastMessage!.content).toContain('not valid JSON');
	});

	it('throws after exhausting all retries', async () => {
		const provider = createMockProvider([
			'bad response 1',
			'bad response 2',
			'bad response 3',
		]);
		const registry = createMockRegistry(provider);

		await expect(
			analyzeSeedDoc(registry, {
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				seedText: SEED_TEXT,
				maxRetries: 2,
			}),
		).rejects.toThrow('Failed to parse company plan after 3 attempts');
	});

	it('throws for unknown provider', async () => {
		const registry = createEmptyRegistry();

		await expect(
			analyzeSeedDoc(registry, {
				provider: 'nonexistent',
				model: 'some-model',
				seedText: SEED_TEXT,
			}),
		).rejects.toThrow('Provider "nonexistent" not found');
	});

	it('throws when LLM returns an error chunk', async () => {
		const provider = createErrorProvider('Rate limit exceeded');
		const registry = createMockRegistry(provider);

		await expect(
			analyzeSeedDoc(registry, {
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				seedText: SEED_TEXT,
			}),
		).rejects.toThrow('LLM error: Rate limit exceeded');
	});

	it('sends seed text in the user message', async () => {
		const provider = createMockProvider([VALID_PLAN_JSON]);
		const registry = createMockRegistry(provider);

		await analyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: 'My unique seed text content',
		});

		const firstCall = provider.chat.mock.calls[0]![0] as ChatRequest;
		const userMessage = firstCall.messages.find((m) => m.role === 'user');
		expect(userMessage!.content).toContain('My unique seed text content');
		expect(userMessage!.content).toContain('SEED DOCUMENT');
	});

	it('uses temperature 0.3 for initial request', async () => {
		const provider = createMockProvider([VALID_PLAN_JSON]);
		const registry = createMockRegistry(provider);

		await analyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: SEED_TEXT,
		});

		const request = provider.chat.mock.calls[0]![0] as ChatRequest;
		expect(request.temperature).toBe(0.3);
	});

	it('uses temperature 0.2 for retry requests', async () => {
		const provider = createMockProvider(['not json', VALID_PLAN_JSON]);
		const registry = createMockRegistry(provider);

		await analyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: SEED_TEXT,
			maxRetries: 2,
		});

		const retryRequest = provider.chat.mock.calls[1]![0] as ChatRequest;
		expect(retryRequest.temperature).toBe(0.2);
	});

	it('works with maxRetries=0 (no retries)', async () => {
		const provider = createMockProvider(['not json']);
		const registry = createMockRegistry(provider);

		await expect(
			analyzeSeedDoc(registry, {
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				seedText: SEED_TEXT,
				maxRetries: 0,
			}),
		).rejects.toThrow('Failed to parse company plan after 1 attempts');

		expect(provider.chat).toHaveBeenCalledTimes(1);
	});

	// ── Plan shape validation (tested indirectly) ─────────────────────

	it('rejects plan with missing company', async () => {
		const noCompany = JSON.stringify({
			agents: [{ name: 'a' }],
			teams: [{ name: 't' }],
		});
		const provider = createMockProvider([noCompany, noCompany, noCompany]);
		const registry = createMockRegistry(provider);

		await expect(
			analyzeSeedDoc(registry, {
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				seedText: SEED_TEXT,
				maxRetries: 2,
			}),
		).rejects.toThrow('Failed to parse company plan');
	});

	it('rejects plan with empty agents array', async () => {
		const emptyAgents = JSON.stringify({
			company: { name: 'X', description: 'X' },
			agents: [],
			teams: [{ name: 't' }],
		});
		const provider = createMockProvider([emptyAgents, emptyAgents, emptyAgents]);
		const registry = createMockRegistry(provider);

		await expect(
			analyzeSeedDoc(registry, {
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				seedText: SEED_TEXT,
				maxRetries: 2,
			}),
		).rejects.toThrow('Failed to parse company plan');
	});

	it('rejects plan with empty company name', async () => {
		const emptyName = JSON.stringify({
			company: { name: '', description: 'something' },
			agents: [{ name: 'a' }],
			teams: [{ name: 't' }],
		});
		const provider = createMockProvider([emptyName, emptyName, emptyName]);
		const registry = createMockRegistry(provider);

		await expect(
			analyzeSeedDoc(registry, {
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				seedText: SEED_TEXT,
				maxRetries: 2,
			}),
		).rejects.toThrow('Failed to parse company plan');
	});
});

// ─── reanalyzeSeedDoc ───────────────────────────────────────────────────

describe('reanalyzeSeedDoc', () => {
	const currentPlan: CompanyPlan = {
		...VALID_PLAN,
		generatedAt: '2024-01-01T00:00:00.000Z',
		seedVersion: 1,
		seedText: 'Original seed text.',
	};

	it('returns an updated plan with incremented seedVersion', async () => {
		const provider = createMockProvider([VALID_PLAN_JSON]);
		const registry = createMockRegistry(provider);

		const plan = await reanalyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: 'Updated seed text.',
			originalSeedText: 'Original seed text.',
			currentPlan,
		});

		expect(plan.seedVersion).toBe(2);
		expect(plan.seedText).toBe('Updated seed text.');
	});

	it('sends both original and updated seed text to LLM', async () => {
		const provider = createMockProvider([VALID_PLAN_JSON]);
		const registry = createMockRegistry(provider);

		await reanalyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: 'Updated seed text.',
			originalSeedText: 'Original seed text.',
			currentPlan,
		});

		const request = provider.chat.mock.calls[0]![0] as ChatRequest;
		const userMessage = request.messages.find((m) => m.role === 'user');
		expect(userMessage!.content).toContain('ORIGINAL SEED DOCUMENT');
		expect(userMessage!.content).toContain('UPDATED SEED DOCUMENT');
		expect(userMessage!.content).toContain('CURRENT COMPANY PLAN');
	});

	it('uses REANALYZE_SYSTEM_PROMPT', async () => {
		const provider = createMockProvider([VALID_PLAN_JSON]);
		const registry = createMockRegistry(provider);

		await reanalyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: 'Updated seed text.',
			originalSeedText: 'Original seed text.',
			currentPlan,
		});

		const request = provider.chat.mock.calls[0]![0] as ChatRequest;
		const systemMessage = request.messages.find((m) => m.role === 'system');
		expect(systemMessage!.content).toContain('seed document has been updated');
	});

	it('retries on JSON failure for reanalysis too', async () => {
		const provider = createMockProvider(['not json', VALID_PLAN_JSON]);
		const registry = createMockRegistry(provider);

		const plan = await reanalyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: 'Updated seed text.',
			originalSeedText: 'Original seed text.',
			currentPlan,
			maxRetries: 2,
		});

		expect(plan.company.name).toBe('TestCo');
		expect(provider.chat).toHaveBeenCalledTimes(2);
	});

	it('throws after exhausting retries on reanalysis', async () => {
		const provider = createMockProvider(['bad 1', 'bad 2', 'bad 3']);
		const registry = createMockRegistry(provider);

		await expect(
			reanalyzeSeedDoc(registry, {
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				seedText: 'Updated seed text.',
				originalSeedText: 'Original seed text.',
				currentPlan,
				maxRetries: 2,
			}),
		).rejects.toThrow('Failed to parse updated company plan after 3 attempts');
	});

	it('throws for unknown provider', async () => {
		const registry = createEmptyRegistry();

		await expect(
			reanalyzeSeedDoc(registry, {
				provider: 'nonexistent',
				model: 'some-model',
				seedText: 'Updated seed text.',
				originalSeedText: 'Original seed text.',
				currentPlan,
			}),
		).rejects.toThrow('Provider "nonexistent" not found');
	});

	it('increments version from current plan version', async () => {
		const v3Plan: CompanyPlan = { ...currentPlan, seedVersion: 3 };
		const provider = createMockProvider([VALID_PLAN_JSON]);
		const registry = createMockRegistry(provider);

		const plan = await reanalyzeSeedDoc(registry, {
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			seedText: 'Updated again.',
			originalSeedText: 'Original.',
			currentPlan: v3Plan,
		});

		expect(plan.seedVersion).toBe(4);
	});
});
