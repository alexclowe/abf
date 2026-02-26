/**
 * End-to-end smoke test for the ABF runtime.
 *
 * Boots a real runtime with a mock LLM provider, makes HTTP requests to the
 * gateway, runs an agent session through the full lifecycle, and verifies
 * that every component (scheduler, dispatcher, session manager, bus, gateway,
 * memory, knowledge, outputs) works together correctly.
 *
 * This is NOT a unit test — it exercises the complete createRuntime() factory,
 * real file I/O, real HTTP server, and the full 8-step session lifecycle.
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Runtime } from '../runtime/runtime.js';
import type { AbfConfig } from '../types/config.js';
import type { IProvider, ChatRequest, ChatChunk, ModelInfo } from '../types/provider.js';
import type { ProviderId, USDCents } from '../types/common.js';

// ─── Mock scrypt with low-cost params for fast tests ──────────────────
// Production scrypt N=32768 can exceed memory limits in test environments.
// We intercept scrypt calls and force N=1024.

const { holder } = vi.hoisted(() => {
	const holder: { realScrypt: Function | null } = { realScrypt: null };
	return { holder };
});

vi.mock('node:crypto', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:crypto')>();
	holder.realScrypt = actual.scrypt;
	return {
		...actual,
		scrypt: (
			password: unknown,
			salt: unknown,
			keylen: number,
			optionsOrCb: unknown,
			maybeCb?: unknown,
		) => {
			const real = holder.realScrypt!;
			if (typeof optionsOrCb === 'function') {
				return real(password, salt, keylen, optionsOrCb);
			}
			const opts = { ...(optionsOrCb as Record<string, unknown>), N: 1024 };
			return real(password, salt, keylen, opts, maybeCb);
		},
	};
});

const { createRuntime } = await import('../runtime/factory.js');

// ─── Mock Provider ────────────────────────────────────────────────────
// Returns canned responses so we never hit a real LLM API.

class MockProvider implements IProvider {
	readonly id = 'mock' as ProviderId;
	readonly name = 'Mock';
	readonly slug = 'mock';
	readonly authType = 'api_key' as const;

	async *chat(_request: ChatRequest): AsyncIterable<ChatChunk> {
		yield { type: 'text', text: 'Hello from mock agent!' };
		yield {
			type: 'usage',
			usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
		};
		yield { type: 'done' };
	}

	async models(): Promise<readonly ModelInfo[]> {
		return [
			{
				id: 'mock-model',
				name: 'Mock Model',
				contextWindow: 4096,
				maxOutputTokens: 1024,
				supportsTools: true,
				supportsStreaming: true,
				costPerInputToken: 0,
				costPerOutputToken: 0,
			},
		];
	}

	estimateCost(_model: string, _tokens: number): USDCents {
		return 0 as USDCents;
	}
}

// ─── Test Fixtures ────────────────────────────────────────────────────

const AGENT_YAML = `
name: test-agent
display_name: Test Agent
role: Smoke Tester
description: A simple agent for end-to-end smoke testing.
provider: mock
model: mock-model
temperature: 0.1
tools: []
triggers:
  - type: manual
    task: smoke_test
escalation_rules: []
behavioral_bounds:
  allowed_actions: [read_data, write_report]
  forbidden_actions: [delete_data]
  max_cost_per_session: "$5.00"
  requires_approval: []
kpis:
  - metric: task_completion
    target: "100%"
    review: daily
charter: |
  # Test Agent
  You are a test agent used for smoke testing the ABF runtime.
  Respond concisely to any task you receive.
`.trim();

const KNOWLEDGE_MD = `
# Smoke Test Company

This is a test company used for end-to-end smoke testing.
Our mission is to verify the ABF runtime works correctly.
`.trim();

const CONFIG_YAML_TEMPLATE = (port: number) => `
name: smoke-test
version: "0.1.0"
description: E2E smoke test project
storage:
  backend: filesystem
bus:
  backend: in-process
gateway:
  enabled: true
  host: "127.0.0.1"
  port: ${port}
runtime:
  max_concurrent_sessions: 5
  session_timeout_ms: 30000
logging:
  level: error
  format: pretty
`.trim();

// ─── Test Suite ───────────────────────────────────────────────────────

describe('E2E Smoke Test — Full Runtime Lifecycle', () => {
	let tmpDir: string;
	let runtime: Runtime;
	let baseUrl: string;
	let port: number;
	const savedEnv: Record<string, string | undefined> = {};

	beforeAll(async () => {
		// Save env vars that could interfere
		savedEnv['ABF_API_KEY'] = process.env['ABF_API_KEY'];
		savedEnv['ABF_CORS_ORIGINS'] = process.env['ABF_CORS_ORIGINS'];
		savedEnv['ABF_VAULT_INSECURE'] = process.env['ABF_VAULT_INSECURE'];
		delete process.env['ABF_API_KEY'];
		delete process.env['ABF_CORS_ORIGINS'];
		// Allow insecure vault in test environment (no keychain available in CI)
		process.env['ABF_VAULT_INSECURE'] = 'true';

		// 1. Create temp project directory
		tmpDir = await mkdtemp(join(tmpdir(), 'abf-e2e-'));

		// Pick a random high port to avoid collisions
		port = 19000 + Math.floor(Math.random() * 10000);
		baseUrl = `http://127.0.0.1:${port}`;

		// 2. Scaffold project structure
		await mkdir(join(tmpDir, 'agents'), { recursive: true });
		await mkdir(join(tmpDir, 'teams'), { recursive: true });
		await mkdir(join(tmpDir, 'memory'), { recursive: true });
		await mkdir(join(tmpDir, 'knowledge'), { recursive: true });
		await mkdir(join(tmpDir, 'tools'), { recursive: true });
		await mkdir(join(tmpDir, 'logs'), { recursive: true });
		await mkdir(join(tmpDir, 'outputs'), { recursive: true });
		await mkdir(join(tmpDir, 'workflows'), { recursive: true });
		await mkdir(join(tmpDir, 'monitors'), { recursive: true });
		await mkdir(join(tmpDir, 'interfaces'), { recursive: true });
		await mkdir(join(tmpDir, 'templates', 'messages'), { recursive: true });

		// Write config
		await writeFile(join(tmpDir, 'abf.config.yaml'), CONFIG_YAML_TEMPLATE(port));

		// Write agent definition
		await writeFile(join(tmpDir, 'agents', 'test-agent.agent.yaml'), AGENT_YAML);

		// Write knowledge file
		await writeFile(join(tmpDir, 'knowledge', 'company.md'), KNOWLEDGE_MD);

		// 3. Create runtime from config (same as `abf dev` does internally)
		const config: AbfConfig = {
			name: 'smoke-test',
			version: '0.1.0',
			description: 'E2E smoke test project',
			storage: { backend: 'filesystem', basePath: '.' },
			bus: { backend: 'in-process' },
			security: {
				injectionDetection: true,
				boundsEnforcement: true,
				auditLogging: true,
				credentialRotationHours: 24,
				maxSessionCostDefault: 2.0,
			},
			gateway: {
				enabled: true,
				host: '127.0.0.1',
				port,
			},
			runtime: {
				maxConcurrentSessions: 5,
				sessionTimeoutMs: 30_000,
				healthCheckIntervalMs: 30_000,
			},
			logging: { level: 'error', format: 'pretty' },
			agentsDir: 'agents',
			teamsDir: 'teams',
			toolsDir: 'tools',
			memoryDir: 'memory',
			logsDir: 'logs',
			knowledgeDir: 'knowledge',
			outputsDir: 'outputs',
		};

		runtime = await createRuntime(config, tmpDir);

		// 4. Register mock provider BEFORE start (so agents can resolve it)
		runtime.components.providerRegistry.register(new MockProvider());

		// 5. Start runtime (loads agents, starts gateway + scheduler)
		await runtime.start();
	}, 30_000); // 30s timeout for setup

	afterAll(async () => {
		// Graceful shutdown
		if (runtime) {
			await runtime.stop();
		}

		// Clean up temp directory
		if (tmpDir) {
			await rm(tmpDir, { recursive: true, force: true });
		}

		// Restore env
		for (const [k, v] of Object.entries(savedEnv)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	}, 15_000);

	// ── 1. Health Check ───────────────────────────────────────────────

	it('GET /health returns ok with 1 agent', async () => {
		const res = await fetch(`${baseUrl}/health`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.status).toBe('ok');
		expect(body.agents).toBe(1);
		expect(body.activeSessions).toBe(0);
		expect(typeof body.uptime).toBe('number');
	});

	// ── 2. Status Endpoint ────────────────────────────────────────────

	it('GET /api/status returns configured=true with 1 agent', async () => {
		const res = await fetch(`${baseUrl}/api/status`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.configured).toBe(true);
		expect(body.agents).toBe(1);
		expect(body.name).toBe('ABF Runtime');
		expect(typeof body.uptime).toBe('number');
	});

	// ── 3. Agent Listing ──────────────────────────────────────────────

	it('GET /api/agents returns array with test-agent', async () => {
		const res = await fetch(`${baseUrl}/api/agents`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(1);

		const agent = body[0];
		expect(agent.config.name).toBe('test-agent');
		expect(agent.config.displayName).toBe('Test Agent');
		expect(agent.config.role).toBe('Smoke Tester');
		expect(agent.config.provider).toBe('mock');
		expect(agent.config.model).toBe('mock-model');
		expect(agent.state).toBeDefined();
		expect(agent.state.status).toBe('idle');
		expect(agent.state.sessionsCompleted).toBe(0);
	});

	// ── 4. Agent Detail ───────────────────────────────────────────────

	it('GET /api/agents/test-agent returns config, state, and memory', async () => {
		const res = await fetch(`${baseUrl}/api/agents/test-agent`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.config.id).toBe('test-agent');
		expect(body.config.charter).toContain('Test Agent');
		expect(body.state).toBeDefined();
		expect(body.memory).toBeDefined();
	});

	it('GET /api/agents/nonexistent returns 404', async () => {
		const res = await fetch(`${baseUrl}/api/agents/nonexistent`);
		expect(res.status).toBe(404);
	});

	// ── 5. Run Agent Session ──────────────────────────────────────────

	let capturedSessionId: string;

	it('POST /api/agents/test-agent/run dispatches session and returns 202', async () => {
		const res = await fetch(`${baseUrl}/api/agents/test-agent/run`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ task: 'Say hello for the smoke test' }),
		});

		expect(res.status).toBe(202);

		const body = await res.json();
		expect(body.sessionId).toBeDefined();
		expect(typeof body.sessionId).toBe('string');
		capturedSessionId = body.sessionId;
	});

	// ── 6. Session Completes ──────────────────────────────────────────

	it('session completes with mock provider response', async () => {
		// The mock provider is instant, but the session runs asynchronously.
		// Poll the agent state until sessionsCompleted >= 1 (max 5 seconds).
		// Note: The dispatcher creates its own sessionId (returned by POST /run),
		// while the session manager creates a separate sessionId for the actual
		// session result. We poll agent state to confirm completion.
		for (let attempt = 0; attempt < 50; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			const state = runtime.components.dispatcher.getAgentState(
				'test-agent' as import('../types/common.js').AgentId,
			);
			if (state && state.sessionsCompleted >= 1) break;
		}

		const finalState = runtime.components.dispatcher.getAgentState(
			'test-agent' as import('../types/common.js').AgentId,
		);
		expect(finalState).toBeDefined();
		expect(finalState!.sessionsCompleted).toBeGreaterThanOrEqual(1);
		expect(finalState!.status).toBe('idle');
	}, 10_000);

	it('completed session is retrievable via KPI history', async () => {
		// Since the session completed, KPI reports should have been generated
		const kpis = runtime.components.dispatcher.getKPIHistory(
			'test-agent' as import('../types/common.js').AgentId,
		);
		expect(kpis.length).toBeGreaterThanOrEqual(1);

		const taskKpi = kpis.find((k) => k.metric === 'task_completion');
		expect(taskKpi).toBeDefined();
		expect(taskKpi!.met).toBe(true);
	});

	// ── 7. Agent State Updated ────────────────────────────────────────

	it('agent state reflects 1 completed session after run', async () => {
		const res = await fetch(`${baseUrl}/api/agents/test-agent`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.state.sessionsCompleted).toBe(1);
		expect(body.state.status).toBe('idle');
		expect(body.state.errorCount).toBe(0);
	});

	// ── 8. Knowledge Was Loaded ───────────────────────────────────────

	it('agent memory endpoint is accessible', async () => {
		const res = await fetch(`${baseUrl}/api/agents/test-agent/memory`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body).toBeDefined();
		// Memory should have the agent's context (even if history is minimal)
		// The knowledge directory was loaded during the session
	});

	// ── 9. Escalations Empty ──────────────────────────────────────────

	it('GET /api/escalations returns empty array (no escalation triggers)', async () => {
		const res = await fetch(`${baseUrl}/api/escalations`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(0);
	});

	// ── 10. Teams Endpoint ────────────────────────────────────────────

	it('GET /api/teams returns empty array (no team files)', async () => {
		const res = await fetch(`${baseUrl}/api/teams`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(0);
	});

	// ── 11. Audit Trail Written ───────────────────────────────────────

	it('GET /api/audit returns session events in audit log', async () => {
		const res = await fetch(`${baseUrl}/api/audit?limit=50`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);

		// Should have at least session_start and session_end events
		const sessionEvents = body.filter(
			(e: Record<string, unknown>) =>
				e['agentId'] === 'test-agent' &&
				(e['eventType'] === 'session_start' || e['eventType'] === 'session_end'),
		);
		expect(sessionEvents.length).toBeGreaterThanOrEqual(2);
	});

	// ── 12. KPIs Reported ─────────────────────────────────────────────

	it('GET /api/kpis returns KPI reports for the completed session', async () => {
		const res = await fetch(`${baseUrl}/api/kpis?agentId=test-agent`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		// Our agent has 1 KPI (task_completion), which should have been reported
		expect(body.length).toBeGreaterThanOrEqual(1);

		const taskKpi = body.find((k: Record<string, unknown>) => k['metric'] === 'task_completion');
		expect(taskKpi).toBeDefined();
		expect(taskKpi['met']).toBe(true);
	});

	// ── 13. Sessions List ─────────────────────────────────────────────

	it('GET /api/sessions returns empty active sessions (all completed)', async () => {
		const res = await fetch(`${baseUrl}/api/sessions`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		// Active sessions should be empty since the mock session completed
		expect(body).toHaveLength(0);
	});

	// ── 14. Providers Endpoint ────────────────────────────────────────

	it('GET /api/providers lists registered providers including mock', async () => {
		const res = await fetch(`${baseUrl}/api/providers`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);

		const mockProvider = body.find((p: Record<string, unknown>) => p['slug'] === 'mock');
		expect(mockProvider).toBeDefined();
		expect(mockProvider['name']).toBe('Mock');
		expect(Array.isArray(mockProvider['models'])).toBe(true);
		expect(mockProvider['models'].length).toBe(1);
		expect(mockProvider['models'][0]['id']).toBe('mock-model');
	});

	// ── 15. Run a Second Session ──────────────────────────────────────
	// Verify that the runtime can handle multiple sequential sessions

	it('can run a second session and sessionsCompleted increments to 2', async () => {
		// Dispatch a second session
		const runRes = await fetch(`${baseUrl}/api/agents/test-agent/run`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ task: 'Second smoke test task' }),
		});
		expect(runRes.status).toBe(202);

		const { sessionId: sessionId2 } = await runRes.json();
		expect(sessionId2).toBeDefined();

		// Wait for session to complete by polling agent state
		for (let attempt = 0; attempt < 50; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			const state = runtime.components.dispatcher.getAgentState(
				'test-agent' as import('../types/common.js').AgentId,
			);
			if (state && state.sessionsCompleted >= 2) break;
		}

		// Verify agent state updated
		const agentRes = await fetch(`${baseUrl}/api/agents/test-agent`);
		const agentBody = await agentRes.json();
		expect(agentBody.state.sessionsCompleted).toBe(2);
		expect(agentBody.state.status).toBe('idle');
	}, 10_000);

	// ── 16. Workflows Endpoint ────────────────────────────────────────

	it('GET /api/workflows returns empty array (no workflow files)', async () => {
		const res = await fetch(`${baseUrl}/api/workflows`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(0);
	});

	// ── 17. Agent Inbox ───────────────────────────────────────────────

	it('POST and GET /api/agents/test-agent/inbox works for task queuing', async () => {
		// Push a task to inbox
		const pushRes = await fetch(`${baseUrl}/api/agents/test-agent/inbox`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				subject: 'Urgent task',
				body: 'Please handle this immediately',
				priority: 'high',
				from: 'operator',
			}),
		});
		expect(pushRes.status).toBe(200);
		const pushBody = await pushRes.json();
		expect(pushBody.queued).toBe(true);
		expect(pushBody.id).toBeDefined();

		// Peek at inbox
		const peekRes = await fetch(`${baseUrl}/api/agents/test-agent/inbox`);
		expect(peekRes.status).toBe(200);
		const peekBody = await peekRes.json();
		expect(Array.isArray(peekBody)).toBe(true);
		expect(peekBody.length).toBeGreaterThanOrEqual(1);

		const item = peekBody.find((i: Record<string, unknown>) => i['subject'] === 'Urgent task');
		expect(item).toBeDefined();
		expect(item['priority']).toBe('high');
	});

	// ── 18. Approvals Endpoint ────────────────────────────────────────

	it('GET /api/approvals returns empty list initially', async () => {
		const res = await fetch(`${baseUrl}/api/approvals`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(0);
	});

	// ── 19. Metrics Endpoint ──────────────────────────────────────────

	it('GET /api/metrics/runtime returns runtime metrics', async () => {
		const res = await fetch(`${baseUrl}/api/metrics/runtime`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body).toBeDefined();
		expect(typeof body.activeSessions).toBe('number');
	});

	it('GET /api/metrics/agents returns agent state metrics', async () => {
		const res = await fetch(`${baseUrl}/api/metrics/agents`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBeGreaterThanOrEqual(1);
	});

	// ── 20. Archetypes Endpoint ───────────────────────────────────────

	it('GET /api/archetypes returns built-in role archetypes', async () => {
		const res = await fetch(`${baseUrl}/api/archetypes`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBeGreaterThan(0);

		// Should include known archetypes like researcher, writer, etc.
		const names = body.map((a: Record<string, unknown>) => a['name']);
		expect(names).toContain('researcher');
		expect(names).toContain('writer');
	});

	// ── 21. Workflow Templates ────────────────────────────────────────

	it('GET /api/workflow-templates returns built-in templates', async () => {
		const res = await fetch(`${baseUrl}/api/workflow-templates`);
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBeGreaterThan(0);
	});

	// ── 22. 404 Handling ──────────────────────────────────────────────

	it('unknown routes return 404', async () => {
		const res = await fetch(`${baseUrl}/api/does-not-exist`);
		expect(res.status).toBe(404);

		const body = await res.json();
		expect(body.error).toBe('Not found');
	});

	// ── 23. Session Not Found ─────────────────────────────────────────

	it('GET /api/sessions/nonexistent returns 404', async () => {
		const res = await fetch(`${baseUrl}/api/sessions/nonexistent`);
		expect(res.status).toBe(404);

		const body = await res.json();
		expect(body.error).toBe('Session not found');
	});

	// ── 24. Memory Persistence ────────────────────────────────────────

	it('agent history is persisted after sessions', async () => {
		const res = await fetch(`${baseUrl}/api/agents/test-agent/memory`);
		expect(res.status).toBe(200);

		const body = await res.json();
		// After running sessions, the history should have entries
		expect(body.history).toBeDefined();
		expect(Array.isArray(body.history)).toBe(true);
		// At least one history entry from the completed sessions
		expect(body.history.length).toBeGreaterThanOrEqual(1);

		// History should contain the mock agent's response
		const allHistory = body.history.map((h: Record<string, unknown>) => h['content']).join(' ');
		expect(allHistory).toContain('Hello from mock agent!');
	});

	// ── 25. Runtime Health ────────────────────────────────────────────

	it('runtime.health() returns healthy when no sessions are saturated', () => {
		const health = runtime.health();
		expect(health).toBe('healthy');
	});
});
