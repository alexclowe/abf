import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from 'yaml';
import { applyCompanyPlan, generateArchitectAgent } from './apply.js';
import type { CompanyPlan, AgentPlan } from './types.js';

// ─── Test Data Helpers ──────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentPlan> = {}): AgentPlan {
	return {
		name: 'scout',
		displayName: 'Scout',
		role: 'Researcher',
		description: 'Research agent',
		charter: '# Scout\nYou are Scout the researcher.',
		provider: 'anthropic',
		model: 'claude-sonnet-4-5',
		temperature: 0.3,
		team: 'ops',
		reportsTo: null,
		tools: ['web-search', 'knowledge-search'],
		triggers: [
			{ type: 'manual', task: 'research' },
			{ type: 'cron', schedule: '0 9 * * 1-5', task: 'daily_brief' },
		],
		kpis: [{ metric: 'coverage', target: '100%', review: 'weekly' }],
		behavioralBounds: {
			allowedActions: ['read_data', 'write_report'],
			forbiddenActions: ['delete_data', 'modify_billing'],
			maxCostPerSession: '$2.00',
			requiresApproval: ['send_client_email'],
		},
		...overrides,
	};
}

function makePlan(overrides: Partial<CompanyPlan> = {}): CompanyPlan {
	return {
		company: { name: 'TestCo', description: 'A test company for unit testing' },
		agents: [makeAgent()],
		teams: [
			{
				name: 'ops',
				displayName: 'Operations',
				description: 'Core operations team',
				orchestrator: 'scout',
				members: ['scout'],
			},
		],
		knowledge: {
			'company.md': '# TestCo\n\nWe build test things.',
			'brand-voice.md': 'Be professional and concise.',
		},
		workflows: [],
		escalationRules: [
			{ condition: 'cost > $10', target: 'human', description: 'Cost escalation' },
		],
		toolGaps: [],
		generatedAt: '2024-01-15T10:00:00.000Z',
		seedVersion: 1,
		seedText: 'TestCo is a company that tests things.',
		...overrides,
	};
}

// ─── generateArchitectAgent ─────────────────────────────────────────────

describe('generateArchitectAgent', () => {
	it('returns an AgentPlan with name "architect"', () => {
		const agent = generateArchitectAgent('TestCo', 'anthropic', 'claude-sonnet-4-5');
		expect(agent.name).toBe('architect');
		expect(agent.displayName).toBe('Company Architect');
		expect(agent.role).toBe('Company Architect');
	});

	it('includes company name in the description and charter', () => {
		const agent = generateArchitectAgent('PickleCoach', 'openai', 'gpt-4o');
		expect(agent.description).toContain('PickleCoach');
		expect(agent.charter).toContain('PickleCoach');
	});

	it('uses the provided provider and model', () => {
		const agent = generateArchitectAgent('TestCo', 'openai', 'gpt-4o');
		expect(agent.provider).toBe('openai');
		expect(agent.model).toBe('gpt-4o');
	});

	it('has a weekly cron trigger', () => {
		const agent = generateArchitectAgent('TestCo', 'anthropic', 'claude-sonnet-4-5');
		const cron = agent.triggers.find((t) => t.type === 'cron');
		expect(cron).toBeDefined();
		expect(cron!.schedule).toBe('0 10 * * 1'); // Monday 10am
		expect(cron!.task).toBe('weekly_assessment');
	});

	it('has a manual trigger', () => {
		const agent = generateArchitectAgent('TestCo', 'anthropic', 'claude-sonnet-4-5');
		const manual = agent.triggers.find((t) => t.type === 'manual');
		expect(manual).toBeDefined();
		expect(manual!.task).toBe('assess_coverage');
	});

	it('has a heartbeat trigger with 1-week interval', () => {
		const agent = generateArchitectAgent('TestCo', 'anthropic', 'claude-sonnet-4-5');
		const hb = agent.triggers.find((t) => t.type === 'heartbeat');
		expect(hb).toBeDefined();
		expect(hb!.interval).toBe(604800);
	});

	it('has read-only behavioral bounds', () => {
		const agent = generateArchitectAgent('TestCo', 'anthropic', 'claude-sonnet-4-5');
		expect(agent.behavioralBounds.allowedActions).toContain('read_data');
		expect(agent.behavioralBounds.forbiddenActions).toContain('modify_agents');
		expect(agent.behavioralBounds.forbiddenActions).toContain('send_client_email');
	});

	it('has low temperature (analytical)', () => {
		const agent = generateArchitectAgent('TestCo', 'anthropic', 'claude-sonnet-4-5');
		expect(agent.temperature).toBeLessThanOrEqual(0.3);
	});
});

// ─── applyCompanyPlan ───────────────────────────────────────────────────

describe('applyCompanyPlan', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'abf-apply-test-'));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	// ── Directory creation ─────────────────────────────────────────────

	it('creates all required project directories', async () => {
		const plan = makePlan();
		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const expectedDirs = [
			'agents',
			'teams',
			'knowledge',
			'workflows',
			'memory',
			'outputs',
			'logs',
			'tools',
			'datastore/schemas',
			'datastore/migrations',
			'monitors',
			'interfaces',
			'templates/messages',
		];

		for (const dir of expectedDirs) {
			const s = await stat(join(tempDir, dir));
			expect(s.isDirectory(), `${dir} should be a directory`).toBe(true);
		}
	});

	// ── Agent YAML files ──────────────────────────────────────────────

	it('writes agent YAML files with snake_case keys', async () => {
		const plan = makePlan();
		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const content = await readFile(join(tempDir, 'agents/scout.agent.yaml'), 'utf-8');
		const yaml = parse(content);

		expect(yaml.name).toBe('scout');
		expect(yaml.display_name).toBe('Scout');
		expect(yaml.role).toBe('Researcher');
		expect(yaml.reports_to).toBeNull();
		expect(yaml.tools).toEqual(['web-search', 'knowledge-search']);
	});

	it('converts behavioral bounds to snake_case', async () => {
		const plan = makePlan();
		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const content = await readFile(join(tempDir, 'agents/scout.agent.yaml'), 'utf-8');
		const yaml = parse(content);

		expect(yaml.behavioral_bounds).toBeDefined();
		expect(yaml.behavioral_bounds.allowed_actions).toEqual(['read_data', 'write_report']);
		expect(yaml.behavioral_bounds.forbidden_actions).toEqual(['delete_data', 'modify_billing']);
		expect(yaml.behavioral_bounds.max_cost_per_session).toBe('$2.00');
		expect(yaml.behavioral_bounds.requires_approval).toEqual(['send_client_email']);
	});

	it('converts triggers to proper YAML format', async () => {
		const plan = makePlan();
		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const content = await readFile(join(tempDir, 'agents/scout.agent.yaml'), 'utf-8');
		const yaml = parse(content);

		expect(yaml.triggers).toHaveLength(2);
		expect(yaml.triggers[0]).toEqual({ type: 'manual', task: 'research' });
		expect(yaml.triggers[1]).toEqual({
			type: 'cron',
			schedule: '0 9 * * 1-5',
			task: 'daily_brief',
		});
	});

	it('converts KPIs to YAML', async () => {
		const plan = makePlan();
		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const content = await readFile(join(tempDir, 'agents/scout.agent.yaml'), 'utf-8');
		const yaml = parse(content);

		expect(yaml.kpis).toEqual([
			{ metric: 'coverage', target: '100%', review: 'weekly' },
		]);
	});

	it('includes escalation_rules when agent has KPIs', async () => {
		const plan = makePlan();
		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const content = await readFile(join(tempDir, 'agents/scout.agent.yaml'), 'utf-8');
		const yaml = parse(content);

		// Agent has KPIs → gets a default escalation rule
		expect(yaml.escalation_rules).toEqual([
			{ condition: 'requires_human_decision', target: 'human' },
		]);
	});

	it('has empty escalation_rules when agent has no KPIs', async () => {
		const agent = makeAgent({ kpis: [] });
		const plan = makePlan({ agents: [agent] });

		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const content = await readFile(join(tempDir, 'agents/scout.agent.yaml'), 'utf-8');
		const yaml = parse(content);

		expect(yaml.escalation_rules).toEqual([]);
	});

	it('includes charter in agent YAML', async () => {
		const plan = makePlan();
		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const content = await readFile(join(tempDir, 'agents/scout.agent.yaml'), 'utf-8');
		const yaml = parse(content);

		expect(yaml.charter).toContain('Scout');
	});

	// ── Architect injection ───────────────────────────────────────────

	it('injects architect agent when not present in plan', async () => {
		const plan = makePlan();
		const written = await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		expect(written).toContain('agents/architect.agent.yaml');

		const content = await readFile(join(tempDir, 'agents/architect.agent.yaml'), 'utf-8');
		const yaml = parse(content);
		expect(yaml.name).toBe('architect');
		expect(yaml.display_name).toBe('Company Architect');
	});

	it('places architect in the first team', async () => {
		const plan = makePlan();
		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const content = await readFile(join(tempDir, 'agents/architect.agent.yaml'), 'utf-8');
		const yaml = parse(content);
		expect(yaml.team).toBe('ops');
	});

	it('adds architect to first team member list', async () => {
		const plan = makePlan();
		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const content = await readFile(join(tempDir, 'teams/ops.team.yaml'), 'utf-8');
		const yaml = parse(content);
		expect(yaml.agents).toContain('architect');
	});

	it('does NOT duplicate architect when already in plan', async () => {
		const architect = makeAgent({
			name: 'architect',
			displayName: 'My Architect',
			role: 'Architect',
		});
		const plan = makePlan({ agents: [makeAgent(), architect] });

		const written = await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		// Should have exactly 2 agent files, not 3
		const agentFiles = written.filter((f) => f.startsWith('agents/'));
		expect(agentFiles).toHaveLength(2);

		// And the architect file should use "My Architect" from the plan, not the generated one
		const content = await readFile(join(tempDir, 'agents/architect.agent.yaml'), 'utf-8');
		const yaml = parse(content);
		expect(yaml.display_name).toBe('My Architect');
	});

	// ── Team YAML files ───────────────────────────────────────────────

	it('writes team YAML files', async () => {
		const plan = makePlan();
		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const content = await readFile(join(tempDir, 'teams/ops.team.yaml'), 'utf-8');
		const yaml = parse(content);

		expect(yaml.name).toBe('ops');
		expect(yaml.display_name).toBe('Operations');
		expect(yaml.orchestrator).toBe('scout');
		expect(yaml.shared_memory).toEqual(['decisions.md']);
		expect(yaml.escalation_policy).toEqual({
			default_target: 'human',
			escalation_channels: ['dashboard'],
		});
	});

	// ── Knowledge files ───────────────────────────────────────────────

	it('writes knowledge files from plan', async () => {
		const plan = makePlan();
		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const company = await readFile(join(tempDir, 'knowledge/company.md'), 'utf-8');
		expect(company).toBe('# TestCo\n\nWe build test things.');

		const brand = await readFile(join(tempDir, 'knowledge/brand-voice.md'), 'utf-8');
		expect(brand).toBe('Be professional and concise.');
	});

	// ── Workflow YAML files ───────────────────────────────────────────

	it('writes workflow YAML files', async () => {
		const plan = makePlan({
			workflows: [
				{
					name: 'onboarding',
					displayName: 'Client Onboarding',
					description: 'Onboard new clients',
					steps: [
						{ id: 'step1', agent: 'scout', task: 'research_client' },
						{ id: 'step2', agent: 'scout', task: 'create_profile', dependsOn: ['step1'] },
					],
					timeout: 3600,
					onFailure: 'escalate',
				},
			],
		});

		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const content = await readFile(
			join(tempDir, 'workflows/onboarding.workflow.yaml'),
			'utf-8',
		);
		const yaml = parse(content);

		expect(yaml.name).toBe('onboarding');
		expect(yaml.display_name).toBe('Client Onboarding');
		expect(yaml.timeout).toBe(3600);
		expect(yaml.on_failure).toBe('escalate');
		expect(yaml.steps).toHaveLength(2);
		expect(yaml.steps[1].depends_on).toEqual(['step1']);
	});

	it('omits depends_on when step has no dependencies', async () => {
		const plan = makePlan({
			workflows: [
				{
					name: 'simple',
					displayName: 'Simple Flow',
					description: 'A simple workflow',
					steps: [{ id: 'only', agent: 'scout', task: 'do_thing' }],
					timeout: 1800,
					onFailure: 'stop',
				},
			],
		});

		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const content = await readFile(
			join(tempDir, 'workflows/simple.workflow.yaml'),
			'utf-8',
		);
		const yaml = parse(content);

		expect(yaml.steps[0]).not.toHaveProperty('depends_on');
	});

	// ── Seed metadata (knowledge/seed.md) ─────────────────────────────

	it('writes seed.md with frontmatter and original seed text', async () => {
		const plan = makePlan();
		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const content = await readFile(join(tempDir, 'knowledge/seed.md'), 'utf-8');

		// Check frontmatter
		expect(content).toContain('seed_version: 1');
		expect(content).toContain('generated_at:');

		// Check hash
		const expectedHash = createHash('sha256')
			.update('TestCo is a company that tests things.')
			.digest('hex');
		expect(content).toContain(`text_hash: "${expectedHash}"`);

		// Check original seed text preserved
		expect(content).toContain('TestCo is a company that tests things.');
		expect(content).toContain('# Seed Document — TestCo');
	});

	// ── Decisions file ────────────────────────────────────────────────

	it('writes memory/decisions.md with initialization entry', async () => {
		const plan = makePlan();
		await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		const content = await readFile(join(tempDir, 'memory/decisions.md'), 'utf-8');

		expect(content).toContain('# Decisions');
		expect(content).toContain('Company Initialized from Seed Document');
		expect(content).toContain('TestCo');
		expect(content).toContain('A test company for unit testing');
		expect(content).toContain('Standing Policies');
	});

	// ── Return value ──────────────────────────────────────────────────

	it('returns list of all written file paths', async () => {
		const plan = makePlan();
		const written = await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		// scout + architect agents
		expect(written).toContain('agents/scout.agent.yaml');
		expect(written).toContain('agents/architect.agent.yaml');
		// team
		expect(written).toContain('teams/ops.team.yaml');
		// knowledge
		expect(written).toContain('knowledge/company.md');
		expect(written).toContain('knowledge/brand-voice.md');
		// seed metadata + decisions
		expect(written).toContain('knowledge/seed.md');
		expect(written).toContain('memory/decisions.md');
	});

	it('handles empty knowledge, workflows, and toolGaps', async () => {
		const plan = makePlan({
			knowledge: {},
			workflows: [],
			toolGaps: [],
		});

		const written = await applyCompanyPlan(plan, tempDir, 'anthropic', 'claude-sonnet-4-5');

		// Should still write seed.md and decisions.md
		expect(written).toContain('knowledge/seed.md');
		expect(written).toContain('memory/decisions.md');
		// But no extra knowledge or workflow files
		const knowledgeFiles = written.filter(
			(f) => f.startsWith('knowledge/') && f !== 'knowledge/seed.md',
		);
		expect(knowledgeFiles).toHaveLength(0);
	});
});
