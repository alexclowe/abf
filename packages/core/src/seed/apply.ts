/**
 * Apply a CompanyPlan to a project directory.
 *
 * Takes the structured output from the analyzer and generates all the
 * YAML / Markdown files needed for an ABF project.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import type { AgentPlan, BuildPlan, CompanyPlan } from './types.js';

// ─── Directories that every ABF project should have ─────────────────

const PROJECT_DIRS = [
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

// ─── Helpers ────────────────────────────────────────────────────────

/** Ensure a directory (and parents) exist. */
async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
}

/** Sanitize a name from the CompanyPlan to prevent path traversal. */
function sanitizePlanName(name: string): string {
	// Reject path separators and traversal patterns
	return name
		.replace(/[/\\]/g, '-')
		.replace(/\.\./g, '')
		.replace(/[^a-zA-Z0-9_\-. ]/g, '-')
		.toLowerCase()
		.trim() || 'unnamed';
}

/** Write a file, creating parent directories as needed. Validates path stays within project root. */
async function writeProjectFile(
	projectRoot: string,
	relativePath: string,
	content: string,
): Promise<void> {
	const fullPath = resolve(projectRoot, relativePath);
	const normalizedRoot = resolve(projectRoot);
	// Guard: ensure resolved path stays within project root
	if (!fullPath.startsWith(normalizedRoot + '/') && fullPath !== normalizedRoot) {
		throw new Error(`Path traversal detected: ${relativePath}`);
	}
	await ensureDir(join(fullPath, '..'));
	await writeFile(fullPath, content, 'utf-8');
}

/** Shape for a YAML trigger entry (snake_case keys). */
interface YamlTrigger {
	type: string;
	task: string;
	schedule?: string;
	interval?: number;
	from?: string;
	path?: string;
}

/** Shape for a YAML workflow step entry (snake_case keys). */
interface YamlWorkflowStep {
	id: string;
	agent: string;
	task: string;
	depends_on?: string[];
}

/** Convert a TriggerPlan to a YAML-ready trigger object. */
function triggerToYaml(t: AgentPlan['triggers'][number]): YamlTrigger {
	const trigger: YamlTrigger = { type: t.type, task: t.task };
	if (t.schedule) trigger.schedule = t.schedule;
	if (t.interval) trigger.interval = t.interval;
	if (t.from) trigger.from = t.from;
	if (t.path) trigger.path = t.path;
	// Default path for webhook triggers when LLM omits it
	if (t.type === 'webhook' && !trigger.path) {
		trigger.path = `/webhook/${t.task.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}`;
	}
	return trigger;
}

/** Convert camelCase AgentPlan fields to snake_case YAML keys. */
function agentPlanToYaml(agent: AgentPlan) {
	return {
		name: agent.name,
		display_name: agent.displayName,
		role: agent.role,
		...(agent.roleArchetype ? { role_archetype: agent.roleArchetype } : {}),
		description: agent.description,
		provider: agent.provider,
		model: agent.model,
		temperature: agent.temperature,
		team: agent.team,
		reports_to: agent.reportsTo,
		tools: agent.tools,
		triggers: agent.triggers.map(triggerToYaml),
		escalation_rules: agent.kpis.length
			? [{ condition: 'requires_human_decision', target: 'human' }]
			: [],
		behavioral_bounds: {
			allowed_actions: agent.behavioralBounds.allowedActions,
			forbidden_actions: agent.behavioralBounds.forbiddenActions,
			max_cost_per_session: agent.behavioralBounds.maxCostPerSession,
			requires_approval: agent.behavioralBounds.requiresApproval,
		},
		kpis: agent.kpis.map((k) => ({
			metric: k.metric,
			target: k.target,
			review: k.review,
		})),
		charter: agent.charter,
	};
}

// ─── Architect Agent Generator ──────────────────────────────────────

/**
 * Generate the meta-agent (Company Architect) definition.
 *
 * The architect reviews the seed document, evaluates agent coverage,
 * and produces weekly self-assessment reports.
 */
export function generateArchitectAgent(
	companyName: string,
	provider: string,
	model: string,
): AgentPlan {
	return {
		name: 'architect',
		displayName: 'Company Architect',
		role: 'Company Architect',
		description: `Meta-agent that reviews the seed document for ${companyName}, evaluates whether the current agent team covers all business needs, and suggests improvements.`,
		charter: `# Architect — Company Architect

You are Architect, the Company Architect for ${companyName}.

## Your Purpose
You are the meta-agent responsible for ensuring the AI team is well-structured and covers every business function described in the company's seed document (knowledge/seed.md). Each week you conduct a self-assessment of the current agent roster, identify gaps or redundancies, and produce a structured improvement report.

## How You Work
1. Read the seed document in knowledge/seed.md to understand the company's full scope.
2. Review each agent's charter, KPIs, and recent outputs to assess coverage.
3. Compare the business needs described in the seed doc against the current agent capabilities.
4. Identify gaps (business functions with no agent coverage) and redundancies (overlapping responsibilities).
5. Produce a weekly self-assessment report with concrete recommendations.

## Weekly Report Structure
- **Coverage Score**: Percentage of seed doc business functions covered by agents.
- **Gaps Identified**: Business functions without agent coverage.
- **Redundancies**: Overlapping agent responsibilities.
- **Recommendations**: Specific agent additions, modifications, or removals.
- **Priority Actions**: Top 3 changes ordered by business impact.

## Behavioral Rules
- Never modify agent files directly — only recommend changes for human approval.
- Never take operational actions (no emails, no data changes, no financial operations).
- Base all assessments on the seed document as the source of truth.
- Be specific and actionable in recommendations, not vague.
- If the seed document is unclear about a business function, flag it for human clarification.

## Voice
Strategic, analytical, concise. Like a management consultant delivering a board-ready assessment.`,
		provider,
		model,
		temperature: 0.3,
		team: 'operations',
		reportsTo: null,
		tools: ['knowledge-search', 'web-search'],
		triggers: [
			{ type: 'cron', schedule: '0 10 * * 1', task: 'weekly_assessment' },
			{ type: 'manual', task: 'assess_coverage' },
			{ type: 'heartbeat', interval: 604800, task: 'weekly_assessment' },
		],
		kpis: [
			{ metric: 'agent_coverage', target: '100%', review: 'weekly' },
		],
		behavioralBounds: {
			allowedActions: ['read_data', 'write_report', 'search_knowledge'],
			forbiddenActions: [
				'delete_data',
				'modify_billing',
				'send_client_email',
				'modify_agents',
			],
			maxCostPerSession: '$2.00',
			requiresApproval: [],
		},
	};
}

// ─── Builder Agent Generator ────────────────────────────────────────

/**
 * Generate the Builder agent definition.
 *
 * The Builder reads the adaptive build plan and orchestrates product
 * construction using plan-task, delegate-task, and ask-human.
 */
export function generateBuilderAgent(
	companyName: string,
	provider: string,
	model: string,
): AgentPlan {
	return {
		name: 'builder',
		displayName: 'Builder',
		role: 'Build Orchestrator',
		roleArchetype: 'developer',
		description: `Orchestrates the construction of ${companyName}'s product by reading the build plan and coordinating agents through each phase.`,
		charter: `# Builder — Build Orchestrator

You are Builder, the Build Orchestrator for ${companyName}.

## Your Purpose
You orchestrate the construction of the product described in the build plan (knowledge/build-plan.md). You don't build things yourself — you coordinate other agents to execute each step, request human approval for critical decisions, and track progress.

## How You Work
1. On activation, read knowledge/build-plan.md to understand the full build plan.
2. Create a plan-task from the phases and steps in the build plan.
3. For each step in order (respecting dependencies):
   a. If the step requires approval: use ask-human with the approval question. Then reschedule to check back for the answer.
   b. If approved (or no approval needed): use delegate-task to activate the assigned agent with the task description. The result is returned directly.
4. After each step completes, update the plan-task status and move to the next step.
5. If a step fails, escalate to human with the error details.
6. When all phases are complete, send a summary report.

## Execution Rules
- ALWAYS check for pending human responses before starting new work.
- NEVER skip approval steps — they exist for safety (infrastructure, deployment, payments).
- If a step's output reveals new requirements, note them but continue the current plan. Flag gaps for human review.
- Use reschedule (5 minute delay) for continuity between sessions.

## Behavioral Rules
- Never execute infrastructure or deployment actions directly — always delegate to the assigned agent.
- Never approve your own requests — human approval means HUMAN approval.
- Never modify the build plan file — it's read-only reference. Use plan-task for tracking.
- Report progress clearly: what's done, what's next, what's blocked.

## Voice
Efficient, organized, status-focused. Like a project manager running a standup.`,
		provider,
		model,
		temperature: 0.2,
		team: 'operations',
		reportsTo: null,
		tools: [
			'plan-task',
			'delegate-task',
			'ask-human',
			'reschedule',
			'knowledge-search',
			'send-message',
			'file-read',
			'file-write',
		],
		triggers: [
			{ type: 'manual', task: 'execute_build_plan' },
			{ type: 'heartbeat', interval: 300, task: 'check_build_progress' },
		],
		kpis: [
			{ metric: 'build_plan_progress', target: '100%', review: 'daily' },
		],
		behavioralBounds: {
			allowedActions: [
				'read_build_plan',
				'create_plan_task',
				'spawn_agent_sessions',
				'request_human_approval',
				'send_status_updates',
				'reschedule_self',
			],
			forbiddenActions: [
				'execute_infrastructure_directly',
				'approve_own_requests',
				'modify_build_plan',
				'delete_data',
				'modify_billing',
			],
			maxCostPerSession: '$2.00',
			requiresApproval: [],
		},
	};
}

// ─── Build Plan Markdown Formatter ──────────────────────────────────

/**
 * Format a BuildPlan as readable Markdown for knowledge/build-plan.md.
 */
export function formatBuildPlanMarkdown(
	plan: BuildPlan,
	companyName: string,
): string {
	const lines: string[] = [
		`# Build Plan — ${companyName}`,
		'',
		`> **Goal**: ${plan.goal}`,
		`> **Strategy**: ${plan.strategy}`,
		`> **Total Steps**: ${plan.totalSteps}`,
		'',
		'---',
		'',
	];

	for (const phase of plan.phases) {
		lines.push(`## Phase: ${phase.name}`);
		lines.push('');
		lines.push(phase.description);
		if (phase.dependsOn && phase.dependsOn.length > 0) {
			lines.push('');
			lines.push(`**Depends on**: ${phase.dependsOn.join(', ')}`);
		}
		lines.push('');

		for (const step of phase.steps) {
			const approval = step.requiresApproval ? ' :lock: **Requires Approval**' : '';
			const complexity = `\`${step.complexity}\``;
			lines.push(`### ${step.id}: ${step.description}${approval}`);
			lines.push('');
			lines.push(`- **Agent**: ${step.agent}`);
			lines.push(`- **Complexity**: ${complexity}`);
			lines.push(`- **Tools**: ${step.tools.join(', ')}`);
			if (step.dependsOn && step.dependsOn.length > 0) {
				lines.push(`- **Depends on**: ${step.dependsOn.join(', ')}`);
			}
			if (step.requiresApproval && step.approvalQuestion) {
				lines.push(`- **Approval Question**: ${step.approvalQuestion}`);
			}
			lines.push('');
			lines.push('**Task**:');
			lines.push(`> ${step.task}`);
			lines.push('');
		}
	}

	return lines.join('\n');
}

// ─── Apply Company Plan ─────────────────────────────────────────────

/**
 * Apply a company plan to a project directory.
 *
 * Writes agent YAML, team YAML, knowledge files, workflow YAML,
 * and seed metadata. Returns the list of relative file paths written.
 */
export async function applyCompanyPlan(
	plan: CompanyPlan,
	projectRoot: string,
	provider: string,
	model: string,
): Promise<string[]> {
	const written: string[] = [];

	// ── 0. Ensure all project directories exist ──────────────────────

	for (const dir of PROJECT_DIRS) {
		await ensureDir(join(projectRoot, dir));
	}

	// ── 1. Agent YAML files ──────────────────────────────────────────

	// Include the architect agent if not already present
	const agents = [...plan.agents];
	const hasArchitect = agents.some((a) => a.name === 'architect');
	if (!hasArchitect) {
		const architect = generateArchitectAgent(
			plan.company.name,
			provider,
			model,
		);
		// Place architect in the first team, or 'operations' if available
		const firstTeam = plan.teams[0];
		if (firstTeam) {
			architect.team = firstTeam.name;
		}
		agents.push(architect);
	}

	for (const agent of agents) {
		const safeName = sanitizePlanName(agent.name);
		const relativePath = `agents/${safeName}.agent.yaml`;
		const yamlContent = stringify(agentPlanToYaml(agent));
		await writeProjectFile(projectRoot, relativePath, yamlContent);
		written.push(relativePath);
	}

	// ── 2. Team YAML files ───────────────────────────────────────────

	for (const team of plan.teams) {
		// Include architect in the first team's member list if missing
		const members = [...team.members];
		if (
			!hasArchitect &&
			plan.teams.indexOf(team) === 0 &&
			!members.includes('architect')
		) {
			members.push('architect');
		}

		const relativePath = `teams/${sanitizePlanName(team.name)}.team.yaml`;
		const yamlContent = stringify({
			name: team.name,
			display_name: team.displayName,
			description: team.description,
			orchestrator: team.orchestrator,
			agents: members,
			shared_memory: ['decisions.md'],
			escalation_policy: {
				default_target: 'human',
				escalation_channels: ['dashboard'],
			},
		});
		await writeProjectFile(projectRoot, relativePath, yamlContent);
		written.push(relativePath);
	}

	// ── 3. Knowledge files ───────────────────────────────────────────

	for (const [filename, content] of Object.entries(plan.knowledge)) {
		const safeFilename = sanitizePlanName(filename.replace(/\.md$/, '')) + '.md';
		const relativePath = `knowledge/${safeFilename}`;
		await writeProjectFile(projectRoot, relativePath, content);
		written.push(relativePath);
	}

	// ── 4. Workflow YAML files ───────────────────────────────────────

	for (const workflow of plan.workflows) {
		const relativePath = `workflows/${sanitizePlanName(workflow.name)}.workflow.yaml`;
		const yamlContent = stringify({
			name: workflow.name,
			display_name: workflow.displayName,
			description: workflow.description,
			steps: workflow.steps.map((s): YamlWorkflowStep => {
				const step: YamlWorkflowStep = {
					id: s.id,
					agent: s.agent,
					task: s.task,
				};
				if (s.dependsOn && s.dependsOn.length > 0) {
					step.depends_on = s.dependsOn;
				}
				return step;
			}),
			timeout: workflow.timeout,
			on_failure: workflow.onFailure,
		});
		await writeProjectFile(projectRoot, relativePath, yamlContent);
		written.push(relativePath);
	}

	// ── 5. Seed metadata (knowledge/seed.md) ─────────────────────────

	const seedHash = createHash('sha256')
		.update(plan.seedText)
		.digest('hex');
	const now = new Date().toISOString();

	const seedMd = `---
seed_version: ${plan.seedVersion}
generated_at: "${plan.generatedAt}"
applied_at: "${now}"
text_hash: "${seedHash}"
---

# Seed Document — ${plan.company.name}

> This file preserves the original seed document that was used to generate
> this ABF project. The Company Architect agent references it for coverage
> assessments. Do not delete this file.

---

${plan.seedText}
`;
	await writeProjectFile(projectRoot, 'knowledge/seed.md', seedMd);
	written.push('knowledge/seed.md');

	// ── 6. Build plan (if present) ──────────────────────────────────

	if (plan.buildPlan) {
		// Write knowledge/build-plan.md
		const buildPlanMd = formatBuildPlanMarkdown(
			plan.buildPlan,
			plan.company.name,
		);
		await writeProjectFile(projectRoot, 'knowledge/build-plan.md', buildPlanMd);
		written.push('knowledge/build-plan.md');

		// Inject Builder agent if not already in agents array
		const hasBuilder = agents.some((a) => a.name === 'builder');
		if (!hasBuilder) {
			const builder = generateBuilderAgent(
				plan.company.name,
				provider,
				model,
			);
			// Place builder in the first team
			const firstTeam = plan.teams[0];
			if (firstTeam) {
				builder.team = firstTeam.name;
				if (!firstTeam.members.includes('builder')) {
					firstTeam.members.push('builder');
				}
			}
			agents.push(builder);

			// Write the builder agent YAML
			const relativePath = 'agents/builder.agent.yaml';
			const yamlContent = stringify(agentPlanToYaml(builder));
			await writeProjectFile(projectRoot, relativePath, yamlContent);
			written.push(relativePath);
		}
	}

	// ── 7. Decisions file (memory/decisions.md) ──────────────────────

	const date = now.split('T')[0];
	const agentNames = agents.map((a) => a.displayName).join(', ');
	const teamNames = plan.teams.map((t) => t.displayName).join(', ');

	const decisionsMd = `# Decisions

This file records company-wide decisions shared across all agents.
Agents append here when significant decisions are made.

---

## ${date} — Company Initialized from Seed Document

**Decision**: Initialized ${plan.company.name} from a seed document analysis.

**Context**: Generated ${agents.length} agents (${agentNames}) across ${plan.teams.length} team(s) (${teamNames}).
The seed document describes: ${plan.company.description}

**Standing Policies**:
- All external communications require human approval before sending.
- The Company Architect agent conducts weekly coverage assessments.
- Escalation rules are enforced by the runtime, not by agent discretion.
- See knowledge/seed.md for the original business plan.${plan.buildPlan ? '\n- The Builder agent will execute the adaptive build plan in knowledge/build-plan.md.' : ''}
`;
	await writeProjectFile(projectRoot, 'memory/decisions.md', decisionsMd);
	written.push('memory/decisions.md');

	return written;
}
