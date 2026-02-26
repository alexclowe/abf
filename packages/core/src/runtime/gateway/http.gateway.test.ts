/**
 * Tests for HttpGateway — spins up a real HTTP server on a random port
 * and validates routes with fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpGateway } from './http.gateway.js';
import type { GatewayDeps } from './http.gateway.js';
import type { AgentConfig } from '../../types/agent.js';
import type { AgentId } from '../../types/common.js';

// ─── Helpers ──────────────────────────────────────────────────────────

function makeAgent(id: string, displayName = 'Test Agent'): AgentConfig {
	return {
		id: id as AgentId,
		name: id,
		displayName,
		role: 'tester',
		description: 'A test agent',
		provider: 'anthropic',
		model: 'claude-sonnet-4-5',
		temperature: 0.3,
		team: undefined,
		reportsTo: undefined,
		tools: ['web-search'],
		triggers: [],
		escalationRules: [],
		behavioralBounds: {
			allowedActions: ['read_data'],
			forbiddenActions: ['delete_data'],
			maxCostPerSession: 200,
			requiresApproval: [],
		},
		kpis: [],
		charter: 'You are a test agent.',
	} as unknown as AgentConfig;
}

function makeMockDispatcher() {
	return {
		dispatch: vi.fn().mockResolvedValue({ ok: true, value: 'session-1' }),
		getActiveSessions: vi.fn().mockReturnValue([]),
		getAgentState: vi.fn().mockReturnValue({
			id: 'test-agent',
			status: 'idle',
			currentSessionCost: 0,
			totalCost: 0,
			sessionsCompleted: 3,
			errorCount: 0,
		}),
		getSessionResult: vi.fn(),
		getEscalations: vi.fn().mockReturnValue([]),
		resolveEscalation: vi.fn(),
		getKPIHistory: vi.fn().mockReturnValue([]),
		clearHeartbeats: vi.fn(),
		registerAgent: vi.fn(),
	};
}

function makeMockApprovalStore() {
	return {
		create: vi.fn().mockReturnValue('approval-1'),
		get: vi.fn(),
		list: vi.fn().mockReturnValue([
			{ id: 'approval-1', agentId: 'test-agent', status: 'pending', toolName: 'send-email' },
		]),
		approve: vi.fn().mockReturnValue(true),
		reject: vi.fn().mockReturnValue(true),
	};
}

function makeMockDeps(overrides: Partial<GatewayDeps> = {}): GatewayDeps {
	const agentsMap = new Map<string, AgentConfig>();
	agentsMap.set('test-agent', makeAgent('test-agent', 'Test Agent'));
	agentsMap.set('scout', makeAgent('scout', 'Scout'));

	return {
		agentsMap,
		dispatcher: makeMockDispatcher() as unknown as GatewayDeps['dispatcher'],
		memoryStore: {
			loadContext: vi.fn().mockResolvedValue({
				ok: true,
				value: { charter: 'Test charter', history: '', decisions: '' },
			}),
			saveContext: vi.fn().mockResolvedValue({ ok: true }),
		} as unknown as GatewayDeps['memoryStore'],
		bus: {
			getPending: vi.fn().mockResolvedValue([]),
			getHistory: vi.fn().mockResolvedValue([]),
		} as unknown as GatewayDeps['bus'],
		auditStore: {
			query: vi.fn().mockResolvedValue({ ok: true, value: [] }),
			append: vi.fn().mockResolvedValue({ ok: true }),
		} as unknown as GatewayDeps['auditStore'],
		providerRegistry: {
			getAll: vi.fn().mockReturnValue([]),
			get: vi.fn(),
			getBySlug: vi.fn(),
		} as unknown as GatewayDeps['providerRegistry'],
		projectRoot: '/tmp/test-project',
		teamsDir: '/tmp/test-project/teams',
		...overrides,
	};
}

// Use a counter to avoid port collisions between parallel test suites
let portCounter = 19_000 + Math.floor(Math.random() * 5_000);
function nextPort(): number {
	return portCounter++;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('HttpGateway', () => {
	let gateway: HttpGateway;
	let baseUrl: string;
	let deps: GatewayDeps;
	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(async () => {
		// Save and clear env vars that affect behavior
		savedEnv['ABF_API_KEY'] = process.env['ABF_API_KEY'];
		savedEnv['ABF_CORS_ORIGINS'] = process.env['ABF_CORS_ORIGINS'];
		delete process.env['ABF_API_KEY'];
		delete process.env['ABF_CORS_ORIGINS'];

		const port = nextPort();
		deps = makeMockDeps();
		gateway = new HttpGateway({ port, host: '127.0.0.1' }, deps);
		await gateway.start();
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterEach(async () => {
		await gateway.stop();
		// Restore env
		for (const [k, v] of Object.entries(savedEnv)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	// ── Health ─────────────────────────────────────────────────────

	it('GET /health returns status and agent count', async () => {
		const res = await fetch(`${baseUrl}/health`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('ok');
		expect(body.agents).toBe(2);
		expect(typeof body.uptime).toBe('number');
		expect(body.activeSessions).toBe(0);
	});

	// ── Status ─────────────────────────────────────────────────────

	it('GET /api/status returns version and uptime', async () => {
		const res = await fetch(`${baseUrl}/api/status`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.version).toBe('1.0.0');
		expect(body.name).toBe('ABF Runtime');
		expect(typeof body.uptime).toBe('number');
		expect(body.agents).toBe(2);
		expect(body.configured).toBe(true);
	});

	// ── Agents ─────────────────────────────────────────────────────

	it('GET /api/agents returns agent list from deps.agentsMap', async () => {
		const res = await fetch(`${baseUrl}/api/agents`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toHaveLength(2);
		expect(body[0].config.name).toBe('test-agent');
		expect(body[0].state).toBeDefined();
		expect(body[1].config.name).toBe('scout');
	});

	it('GET /api/agents/:id returns agent detail when found', async () => {
		const res = await fetch(`${baseUrl}/api/agents/test-agent`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.config.id).toBe('test-agent');
		expect(body.config.displayName).toBe('Test Agent');
		expect(body.state).toBeDefined();
		expect(body.memory).toBeDefined();
	});

	it('GET /api/agents/:id returns 404 for unknown agent', async () => {
		const res = await fetch(`${baseUrl}/api/agents/nonexistent`);
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error).toBe('Agent not found');
	});

	// ── Run Agent ──────────────────────────────────────────────────

	it('POST /api/agents/:id/run dispatches activation', async () => {
		const dispatcher = deps.dispatcher as unknown as ReturnType<typeof makeMockDispatcher>;
		const res = await fetch(`${baseUrl}/api/agents/test-agent/run`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ task: 'scan_websites' }),
		});
		expect(res.status).toBe(202);
		const body = await res.json();
		expect(body.sessionId).toBe('session-1');
		expect(dispatcher.dispatch).toHaveBeenCalledOnce();
		const activation = dispatcher.dispatch.mock.calls[0][0];
		expect(activation.agentId).toBe('test-agent');
		expect(activation.trigger.task).toBe('scan_websites');
		expect(activation.trigger.type).toBe('manual');
	});

	it('POST /api/agents/:id/run returns 404 for unknown agent', async () => {
		const res = await fetch(`${baseUrl}/api/agents/nonexistent/run`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(404);
	});

	// ── Teams ──────────────────────────────────────────────────────

	it('GET /api/teams returns teams (empty when dir missing)', async () => {
		const res = await fetch(`${baseUrl}/api/teams`);
		expect(res.status).toBe(200);
		const body = await res.json();
		// teamsDir points to a non-existent directory, so loadTeamConfigs returns failure
		expect(Array.isArray(body)).toBe(true);
	});

	// ── Escalations ────────────────────────────────────────────────

	it('GET /api/escalations returns escalation list', async () => {
		const res = await fetch(`${baseUrl}/api/escalations`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(0);
	});

	// ── 404 fallback ───────────────────────────────────────────────

	it('returns 404 for unknown routes', async () => {
		const res = await fetch(`${baseUrl}/api/this-does-not-exist`);
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error).toBe('Not found');
	});

	it('returns 404 for completely unknown path', async () => {
		const res = await fetch(`${baseUrl}/no-such-route`);
		expect(res.status).toBe(404);
	});
});

// ── Approval Routes ────────────────────────────────────────────────

describe('HttpGateway — Approvals', () => {
	let gateway: HttpGateway;
	let baseUrl: string;
	let approvalStore: ReturnType<typeof makeMockApprovalStore>;
	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(async () => {
		savedEnv['ABF_API_KEY'] = process.env['ABF_API_KEY'];
		delete process.env['ABF_API_KEY'];

		approvalStore = makeMockApprovalStore();
		const port = nextPort();
		const deps = makeMockDeps({ approvalStore: approvalStore as unknown as GatewayDeps['approvalStore'] });
		gateway = new HttpGateway({ port, host: '127.0.0.1' }, deps);
		await gateway.start();
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterEach(async () => {
		await gateway.stop();
		for (const [k, v] of Object.entries(savedEnv)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it('GET /api/approvals returns approval list', async () => {
		const res = await fetch(`${baseUrl}/api/approvals`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
		expect(body).toHaveLength(1);
		expect(body[0].id).toBe('approval-1');
		expect(approvalStore.list).toHaveBeenCalledOnce();
	});

	it('POST /api/approvals/:id/approve approves a request', async () => {
		const res = await fetch(`${baseUrl}/api/approvals/approval-1/approve`, { method: 'POST' });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.approved).toBe(true);
		expect(approvalStore.approve).toHaveBeenCalledWith('approval-1', 'operator');
	});

	it('POST /api/approvals/:id/reject rejects a request', async () => {
		const res = await fetch(`${baseUrl}/api/approvals/approval-1/reject`, { method: 'POST' });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.rejected).toBe(true);
		expect(approvalStore.reject).toHaveBeenCalledWith('approval-1', 'operator');
	});
});

// ── API Key Auth ───────────────────────────────────────────────────

describe('HttpGateway — API Key Auth', () => {
	let gateway: HttpGateway;
	let baseUrl: string;
	const API_KEY = 'test-secret-key-12345';

	beforeEach(async () => {
		process.env['ABF_API_KEY'] = API_KEY;

		const port = nextPort();
		const deps = makeMockDeps();
		gateway = new HttpGateway({ port, host: '127.0.0.1' }, deps);
		await gateway.start();
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterEach(async () => {
		await gateway.stop();
		delete process.env['ABF_API_KEY'];
	});

	it('rejects /api/* requests without auth header', async () => {
		const res = await fetch(`${baseUrl}/api/status`);
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toContain('Unauthorized');
	});

	it('rejects /api/* requests with wrong Bearer token', async () => {
		const res = await fetch(`${baseUrl}/api/status`, {
			headers: { Authorization: 'Bearer wrong-key' },
		});
		expect(res.status).toBe(401);
	});

	it('passes /api/* requests with correct Bearer token', async () => {
		const res = await fetch(`${baseUrl}/api/status`, {
			headers: { Authorization: `Bearer ${API_KEY}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.version).toBe('1.0.0');
	});

	it('allows /health without auth (not under /api/*)', async () => {
		const res = await fetch(`${baseUrl}/health`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('ok');
	});

	it('rejects /webhook/* without auth when ABF_API_KEY is set', async () => {
		const res = await fetch(`${baseUrl}/webhook/test`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(401);
	});

	it('allows /webhook/* with correct Bearer token', async () => {
		const res = await fetch(`${baseUrl}/webhook/test`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${API_KEY}`,
			},
			body: JSON.stringify({ event: 'test' }),
		});
		expect(res.status).toBe(200);
	});
});
