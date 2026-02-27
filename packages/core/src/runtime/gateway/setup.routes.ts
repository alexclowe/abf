/**
 * Setup routes — POST /api/projects endpoint for the Dashboard setup wizard.
 *
 * Generates agent/team/knowledge files from a template selection,
 * writes them to the running project's directories, and hot-reloads
 * agents into the live runtime.
 */

import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import type { Hono } from 'hono';
import { loadAgentConfigs } from '../../config/loader.js';
import type { IScheduler } from '../interfaces.js';
import type { GatewayDeps } from './http.gateway.js';
import type { AgentConfig } from '../../types/agent.js';

// ─── Provider ↔ Model mapping ────────────────────────────────────────

function defaultModel(provider: string): string {
	switch (provider) {
		case 'anthropic':
			return 'claude-sonnet-4-5';
		case 'openai':
			return 'gpt-4o';
		case 'ollama':
			return 'llama3.2';
		default:
			return 'claude-sonnet-4-5';
	}
}

// ─── Template file generators ────────────────────────────────────────

interface TemplateFile {
	/** Path relative to project root, e.g. "agents/compass.agent.yaml" */
	path: string;
	content: string;
}

function makeAgent(
	name: string,
	displayName: string,
	role: string,
	description: string,
	provider: string,
	model: string,
	temperature: number,
	team: string,
	reportsTo: string | null,
	charter: string,
	extra?: {
		triggers?: unknown[];
		kpis?: unknown[];
		allowedActions?: string[];
		forbiddenActions?: string[];
		requiresApproval?: string[];
		maxCost?: string;
	},
): TemplateFile {
	return {
		path: `agents/${name}.agent.yaml`,
		content: stringify({
			name,
			display_name: displayName,
			role,
			description,
			provider,
			model,
			temperature,
			team,
			reports_to: reportsTo,
			tools: ['web-search'],
			triggers: extra?.triggers ?? [
				{ type: 'heartbeat', interval: 3600, task: role.toLowerCase() },
				{ type: 'manual', task: role.toLowerCase() },
			],
			escalation_rules: [{ condition: 'requires_human_decision', target: 'human' }],
			behavioral_bounds: {
				allowed_actions: extra?.allowedActions ?? ['read_data', 'write_draft'],
				forbidden_actions: extra?.forbiddenActions ?? ['delete_data', 'modify_billing'],
				max_cost_per_session: extra?.maxCost ?? '$2.00',
				requires_approval: extra?.requiresApproval ?? [],
			},
			kpis: extra?.kpis ?? [],
			charter,
		}),
	};
}

function soloFounderFiles(provider: string): TemplateFile[] {
	const model = defaultModel(provider);
	return [
		makeAgent(
			'compass',
			'Executive Assistant',
			'Orchestrator',
			"Organizes the founder's day, routes research tasks to Scout and writing tasks to Scribe.",
			provider,
			model,
			0.4,
			'founders',
			null,
			`# Compass — Executive Assistant

You are Compass, the Executive Assistant and orchestrator for this founder's workspace.

## Your Purpose
Keep the founder focused on what matters most. Each morning (or on demand) you deliver a concise daily briefing: what needs attention today, what Scout has researched, what Scribe has drafted.

## Your Team
- **Scout** — your research arm. Delegate any question about competitors, markets, people, or technologies.
- **Scribe** — your writing arm. Delegate any drafting: emails, posts, proposals, investor updates.

## How You Work
1. Greet the founder by name and date.
2. Surface the top 3–5 priorities for today.
3. Report any pending items from Scout or Scribe.
4. Ask one clarifying question if anything is ambiguous.
5. Route new tasks to the right agent via a message.

## Behavioral Rules
- Never take financial actions or modify billing without explicit founder approval.
- Never send emails to external parties without approval.
- If a task is outside your scope, escalate to human immediately.
- Keep briefings under 300 words.`,
			{
				triggers: [
					{ type: 'cron', schedule: '0 9 * * 1-5', task: 'daily_briefing' },
					{ type: 'heartbeat', interval: 1800, task: 'daily_briefing' },
					{ type: 'manual', task: 'daily_briefing' },
				],
				kpis: [
					{ metric: 'tasks_delegated', target: '100%', review: 'daily' },
					{ metric: 'daily_briefings_sent', target: '1/day', review: 'daily' },
				],
				allowedActions: ['read_data', 'write_draft', 'send_alert'],
				requiresApproval: ['send_client_email', 'publish_content'],
			},
		),
		makeAgent(
			'scout',
			'Research Analyst',
			'Researcher',
			'Deep research on competitors, markets, people, and technologies. Produces structured, sourced reports.',
			provider,
			model,
			0.2,
			'founders',
			'compass',
			`# Scout — Research Analyst

You are Scout, the Research Analyst for this founder's workspace.

## Your Purpose
Produce structured, accurate, sourced research reports on any topic the founder or Compass assigns.

## Report Structure
1. **Summary** (2–3 sentences)
2. **Key Facts** (bullet list, sourced)
3. **Analysis** (what this means for the founder)
4. **Uncertainties** (what you don't know)
5. **Recommended Next Steps**

## Behavioral Rules
- Cite sources for every factual claim.
- Flag uncertainty explicitly — never speculate without labeling it.
- If data is insufficient, say so and explain what would be needed.`,
			{
				triggers: [
					{ type: 'heartbeat', interval: 3600, task: 'research' },
					{ type: 'manual', task: 'research' },
					{ type: 'message', from: 'compass', task: 'research' },
				],
				kpis: [
					{ metric: 'report_quality', target: 'high', review: 'weekly' },
					{ metric: 'turnaround', target: '< 10min', review: 'daily' },
				],
				maxCost: '$3.00',
			},
		),
		makeAgent(
			'scribe',
			'Content Writer',
			'Writer',
			"Writes blog posts, emails, LinkedIn updates, proposals, and investor communications in the founder's voice.",
			provider,
			model,
			0.7,
			'founders',
			'compass',
			`# Scribe — Content Writer

You are Scribe, the Content Writer for this founder's workspace.

## Your Purpose
Write clear, human, compelling content in the founder's voice: blog posts, cold emails, LinkedIn updates, investor updates, proposals.

## Writing Principles
1. Write like a human, not a press release.
2. Clear > clever. Short > long.
3. Every piece has one job — know what it is before writing.
4. Match the platform's conventions.

## Behavioral Rules
- Never do original research — ask Scout.
- Always produce drafts; never publish directly.
- Never send emails to external parties.`,
			{
				triggers: [
					{ type: 'heartbeat', interval: 7200, task: 'write' },
					{ type: 'manual', task: 'write' },
					{ type: 'message', from: 'compass', task: 'write' },
				],
				kpis: [
					{ metric: 'content_quality', target: 'publish-ready', review: 'weekly' },
					{ metric: 'turnaround', target: '< 5min', review: 'daily' },
				],
				forbiddenActions: ['delete_data', 'publish_content', 'send_client_email'],
				requiresApproval: ['publish_content', 'send_client_email'],
			},
		),
		{
			path: 'teams/founders.team.yaml',
			content: stringify({
				name: 'founders',
				display_name: 'Founder Team',
				description: 'Three-agent team supporting a solo founder across research, writing, and coordination.',
				orchestrator: 'compass',
				agents: ['compass', 'scout', 'scribe'],
				shared_memory: ['decisions.md'],
				escalation_policy: { default_target: 'human', escalation_channels: ['dashboard', 'cli'] },
			}),
		},
	];
}

function saasFiles(provider: string): TemplateFile[] {
	const model = defaultModel(provider);
	return [
		makeAgent(
			'atlas',
			'Product Orchestrator',
			'Orchestrator',
			'Coordinates product and go-to-market teams. Runs weekly standups, delegates work, and makes roadmap decisions.',
			provider,
			model,
			0.4,
			'product',
			null,
			`# Atlas — Product Orchestrator

You are Atlas, the Product Orchestrator for this SaaS startup workspace.

## Your Purpose
You are the strategic hub. Every weekday morning you run a product standup: review what each agent has produced, identify blockers, set priorities for the day, and ensure the product roadmap stays on track.

## Your Team
- **Scout** — research arm. Competitors, pricing, user needs, market sizing.
- **Scribe** — writing arm. Product docs, changelogs, blog posts, in-app copy.
- **Signal** — GTM strategist. Positioning, messaging, launch planning.
- **Herald** — customer success analyst. User feedback synthesis, churn signals.

## How You Work
1. Open each standup with the date and a state-of-the-product summary.
2. Review pending outputs from each agent.
3. Identify top 3 priorities for the day.
4. Delegate new tasks.
5. Flag blockers that need human decision.`,
			{
				triggers: [
					{ type: 'cron', schedule: '0 9 * * 1-5', task: 'product_standup' },
					{ type: 'heartbeat', interval: 3600, task: 'product_standup' },
					{ type: 'manual', task: 'product_standup' },
				],
				kpis: [
					{ metric: 'roadmap_clarity', target: 'high', review: 'weekly' },
					{ metric: 'team_coordination', target: '100%', review: 'daily' },
				],
				allowedActions: ['read_data', 'write_draft', 'send_alert'],
				requiresApproval: ['publish_content', 'send_client_email'],
			},
		),
		makeAgent(
			'scout',
			'Market Research',
			'Researcher',
			'Competitive analysis, market sizing, user research, and technology landscape for the product team.',
			provider,
			model,
			0.2,
			'product',
			'atlas',
			`# Scout — Market Research

You are Scout, the Market Research analyst for this SaaS startup.

## Your Purpose
Produce structured, sourced research that informs product and GTM decisions. Competitors, pricing, user needs, market dynamics.

## Report Structure
1. **Summary** (key finding in 2–3 sentences)
2. **Key Facts** (sourced bullet list)
3. **Analysis** (implications for our product)
4. **Uncertainties**
5. **Recommended Next Steps**`,
			{
				triggers: [
					{ type: 'heartbeat', interval: 3600, task: 'research' },
					{ type: 'manual', task: 'research' },
					{ type: 'message', from: 'atlas', task: 'research' },
				],
				kpis: [{ metric: 'report_quality', target: 'high', review: 'weekly' }],
				maxCost: '$3.00',
			},
		),
		makeAgent(
			'scribe',
			'Product Writer',
			'Writer',
			'Writes product documentation, changelogs, blog posts, and in-app copy.',
			provider,
			model,
			0.7,
			'product',
			'atlas',
			`# Scribe — Product Writer

You are Scribe, the Product Writer for this SaaS startup.

## Your Purpose
Write clear product docs, changelogs, blog posts, and in-app copy. Make complex features understandable. Match our brand voice.

## Writing Principles
1. Users first — write for them, not for us.
2. Clear > clever. Concise > comprehensive.
3. Every piece has one job.`,
			{
				triggers: [
					{ type: 'heartbeat', interval: 7200, task: 'write' },
					{ type: 'manual', task: 'write' },
					{ type: 'message', from: 'atlas', task: 'write' },
				],
				kpis: [{ metric: 'content_quality', target: 'publish-ready', review: 'weekly' }],
				forbiddenActions: ['delete_data', 'publish_content', 'send_client_email'],
				requiresApproval: ['publish_content'],
			},
		),
		makeAgent(
			'signal',
			'GTM Strategist',
			'Marketer',
			'Positioning, messaging, launch planning, and channel strategy for go-to-market.',
			provider,
			model,
			0.5,
			'gtm',
			'atlas',
			`# Signal — GTM Strategist

You are Signal, the Go-To-Market Strategist for this SaaS startup.

## Your Purpose
Own positioning, messaging, and launch strategy. Translate product capabilities into compelling market narratives.

## What You Do
- Positioning briefs and messaging frameworks
- Launch plans and channel strategies
- Competitive positioning analysis
- Pricing strategy recommendations`,
			{
				triggers: [
					{ type: 'heartbeat', interval: 7200, task: 'strategy' },
					{ type: 'manual', task: 'strategy' },
					{ type: 'message', from: 'atlas', task: 'strategy' },
				],
				kpis: [{ metric: 'strategy_clarity', target: 'high', review: 'weekly' }],
				requiresApproval: ['publish_content'],
			},
		),
		makeAgent(
			'herald',
			'Customer Success',
			'Analyst',
			'Synthesizes user feedback, identifies churn signals, and reviews support patterns.',
			provider,
			model,
			0.3,
			'gtm',
			'atlas',
			`# Herald — Customer Success Analyst

You are Herald, the Customer Success Analyst for this SaaS startup.

## Your Purpose
Synthesize user feedback into actionable insights. Identify churn signals early. Surface patterns from support tickets.

## What You Produce
- Weekly user feedback summaries
- Churn risk assessments
- Support pattern reports
- Feature request rankings`,
			{
				triggers: [
					{ type: 'heartbeat', interval: 7200, task: 'analyze' },
					{ type: 'manual', task: 'analyze' },
					{ type: 'message', from: 'atlas', task: 'analyze' },
				],
				kpis: [{ metric: 'feedback_coverage', target: '100%', review: 'weekly' }],
			},
		),
		{
			path: 'teams/product.team.yaml',
			content: stringify({
				name: 'product',
				display_name: 'Product Team',
				description: 'Core product team: orchestration, research, and writing.',
				orchestrator: 'atlas',
				agents: ['atlas', 'scout', 'scribe'],
				shared_memory: ['decisions.md'],
				escalation_policy: { default_target: 'human', escalation_channels: ['dashboard'] },
			}),
		},
		{
			path: 'teams/gtm.team.yaml',
			content: stringify({
				name: 'gtm',
				display_name: 'Go-To-Market Team',
				description: 'GTM team: strategy and customer success.',
				orchestrator: 'atlas',
				agents: ['signal', 'herald'],
				shared_memory: ['decisions.md'],
				escalation_policy: { default_target: 'human', escalation_channels: ['dashboard'] },
			}),
		},
	];
}

function marketingAgencyFiles(provider: string): TemplateFile[] {
	const model = defaultModel(provider);
	return [
		makeAgent(
			'director',
			'Account Director',
			'Orchestrator',
			'Coordinates the agency team. Manages client relationships (with approval). Routes work to Strategist, Copywriter, and Analyst.',
			provider,
			model,
			0.4,
			'agency',
			null,
			`# Director — Account Director

You are Director, the Account Director and orchestrator for this marketing agency.

## Your Purpose
You are the hub. Every weekday morning you run a standup: review active campaigns, check deliverable status, identify blockers, and ensure client work stays on track.

## Your Team
- **Analyst** — data arm. Campaign performance, competitive analysis, market data.
- **Strategist** — planning arm. Campaign strategy, media planning, channel selection.
- **Copywriter** — creative arm. Ad copy, social posts, email campaigns, landing pages.`,
			{
				triggers: [
					{ type: 'cron', schedule: '0 9 * * 1-5', task: 'daily_standup' },
					{ type: 'heartbeat', interval: 1800, task: 'daily_standup' },
					{ type: 'manual', task: 'daily_standup' },
				],
				kpis: [
					{ metric: 'client_satisfaction', target: 'high', review: 'weekly' },
					{ metric: 'deliverables_on_time', target: '100%', review: 'weekly' },
				],
				allowedActions: ['read_data', 'write_draft', 'send_alert'],
				requiresApproval: ['send_client_email', 'publish_content'],
			},
		),
		makeAgent(
			'strategist',
			'Campaign Strategist',
			'Marketer',
			'Plans and coordinates campaigns, selects channels, defines targeting, and creates campaign briefs.',
			provider,
			model,
			0.5,
			'agency',
			'director',
			`# Strategist — Campaign Strategist

You are Strategist, the Campaign Strategist for this marketing agency.

## Your Purpose
Plan campaigns from brief to launch. Define strategy, select channels, set targeting, and coordinate with Copywriter for creative.

## What You Produce
- Campaign briefs and timelines
- Channel strategy recommendations
- Audience targeting definitions
- Budget allocation suggestions`,
			{
				triggers: [
					{ type: 'heartbeat', interval: 3600, task: 'strategy' },
					{ type: 'manual', task: 'strategy' },
					{ type: 'message', from: 'director', task: 'strategy' },
				],
				kpis: [{ metric: 'campaign_plans_delivered', target: '100%', review: 'weekly' }],
				requiresApproval: ['publish_content'],
			},
		),
		makeAgent(
			'copywriter',
			'Creative Writer',
			'Writer',
			'Writes ad copy, social media posts, email campaigns, landing page content, and brand messaging.',
			provider,
			model,
			0.8,
			'agency',
			'director',
			`# Copywriter — Creative Writer

You are Copywriter, the Creative Writer for this marketing agency.

## Your Purpose
Write compelling ad copy, social posts, email campaigns, and landing page content. Adapt voice to each client's brand.

## Writing Principles
1. Hook first — grab attention in the first line.
2. Benefits over features.
3. Match the platform's format and tone.
4. Every piece has a clear CTA.`,
			{
				triggers: [
					{ type: 'heartbeat', interval: 3600, task: 'write' },
					{ type: 'manual', task: 'write' },
					{ type: 'message', from: 'director', task: 'write' },
				],
				kpis: [{ metric: 'content_quality', target: 'publish-ready', review: 'weekly' }],
				forbiddenActions: ['delete_data', 'publish_content', 'send_client_email'],
				requiresApproval: ['publish_content', 'send_client_email'],
			},
		),
		makeAgent(
			'analyst',
			'Performance Analyst',
			'Analyst',
			'Tracks campaign metrics, runs competitive analysis, and produces performance reports.',
			provider,
			model,
			0.2,
			'agency',
			'director',
			`# Analyst — Performance Analyst

You are Analyst, the Performance Analyst for this marketing agency.

## Your Purpose
Track campaign performance, run competitive analysis, and produce actionable reports. Data-driven decisions only.

## Report Structure
1. **Summary** (key metrics at a glance)
2. **Performance Data** (sourced, with trends)
3. **Analysis** (what the data means)
4. **Recommendations** (what to do next)`,
			{
				triggers: [
					{ type: 'heartbeat', interval: 3600, task: 'analyze' },
					{ type: 'manual', task: 'analyze' },
					{ type: 'message', from: 'director', task: 'analyze' },
				],
				kpis: [{ metric: 'report_accuracy', target: 'high', review: 'weekly' }],
				maxCost: '$3.00',
			},
		),
		{
			path: 'teams/agency.team.yaml',
			content: stringify({
				name: 'agency',
				display_name: 'Agency Team',
				description: 'Full-service marketing agency team: strategy, creative, and analytics.',
				orchestrator: 'director',
				agents: ['director', 'strategist', 'copywriter', 'analyst'],
				shared_memory: ['decisions.md'],
				escalation_policy: { default_target: 'human', escalation_channels: ['dashboard'] },
			}),
		},
	];
}

function customFiles(provider: string): TemplateFile[] {
	const model = defaultModel(provider);
	return [
		makeAgent(
			'assistant',
			'General Assistant',
			'Assistant',
			'A general-purpose AI assistant.',
			provider,
			model,
			0.3,
			'',
			null,
			`# Assistant

You are a helpful general-purpose assistant. Follow the user's instructions carefully and produce clear, useful output.`,
			{
				triggers: [{ type: 'manual', task: 'assist' }],
			},
		),
	];
}

function sharedKnowledgeFiles(): TemplateFile[] {
	return [
		{
			path: 'knowledge/company.md',
			content: '# Company Overview\n\nDescribe your company here. This file is shared with all agents.\n\n## Mission\n\n## Product\n\n## Target Market\n\n## Key Metrics\n',
		},
		{
			path: 'knowledge/brand-voice.md',
			content: "# Brand Voice\n\nDefine your brand voice and communication style here.\n\n## Tone\n\n## Do's\n\n## Don'ts\n\n## Examples\n",
		},
	];
}

function decisionsFile(projectName: string, templateName: string): TemplateFile {
	const date = new Date().toISOString().split('T')[0];
	return {
		path: 'memory/decisions.md',
		content: `# Decisions

This file records company-wide decisions shared across all agents.

---

## ${date} — Project Initialized

**Decision**: Initialized ${projectName} with the ${templateName} template.

**Standing Policies**:
- All external communications require human approval before sending.
- Agents produce drafts only — never publish directly.
`,
	};
}

function getTemplateFiles(template: string, provider: string, projectName: string): TemplateFile[] {
	let files: TemplateFile[];
	switch (template) {
		case 'solo-founder':
			files = soloFounderFiles(provider);
			break;
		case 'saas':
			files = saasFiles(provider);
			break;
		case 'marketing-agency':
			files = marketingAgencyFiles(provider);
			break;
		default:
			files = customFiles(provider);
			break;
	}
	return [...files, ...sharedKnowledgeFiles(), decisionsFile(projectName, template)];
}

// ─── Route registration ──────────────────────────────────────────────

export interface SetupDeps extends GatewayDeps {
	readonly scheduler: IScheduler;
}

export function registerSetupRoutes(app: Hono, deps: SetupDeps): void {
	app.post('/api/projects', async (c) => {
		const body = await c.req.json<{
			template?: string;
			projectName?: string;
			provider?: string;
		}>().catch(() => ({}) as { template?: string; projectName?: string; provider?: string });

		const template = body.template ?? 'custom';
		const projectName = body.projectName?.trim();
		const provider = body.provider ?? 'anthropic';

		if (!projectName) {
			return c.json({ error: 'projectName is required' }, 400);
		}

		// Sanitize projectName — alphanumeric, hyphens, underscores only
		if (!/^[a-zA-Z0-9_-]+$/.test(projectName)) {
			return c.json({ error: 'projectName must be alphanumeric (hyphens and underscores allowed)' }, 400);
		}

		const validTemplates = ['solo-founder', 'saas', 'marketing-agency', 'custom'];
		if (!validTemplates.includes(template)) {
			return c.json({ error: `Invalid template. Choose from: ${validTemplates.join(', ')}` }, 400);
		}

		const root = deps.projectRoot;

		try {
			// Generate template files
			const files = getTemplateFiles(template, provider, projectName);

			// Ensure directories exist
			const dirs = new Set<string>();
			for (const f of files) {
				const parts = f.path.split('/');
				if (parts.length > 1) {
					dirs.add(join(root, ...parts.slice(0, -1)));
				}
			}
			for (const dir of dirs) {
				await mkdir(dir, { recursive: true });
			}

			// Write files
			for (const f of files) {
				await writeFile(join(root, f.path), f.content, 'utf-8');
			}

			// Generate abf.config.yaml if it doesn't exist
			const configPath = join(root, 'abf.config.yaml');
			try {
				await access(configPath);
			} catch {
				const configContent = stringify({
					name: projectName,
					version: '0.1.0',
					storage: { backend: 'filesystem' },
					bus: { backend: 'in-process' },
					gateway: { enabled: true, host: '0.0.0.0', port: 3000 },
				});
				await writeFile(configPath, configContent, 'utf-8');
			}

			// Reload agents from disk
			const agentsDir = join(root, 'agents');
			const loadResult = await loadAgentConfigs(agentsDir);

			if (!loadResult.ok) {
				return c.json({ error: `Failed to load agents: ${loadResult.error.message}` }, 500);
			}

			const agentsMap = deps.agentsMap as Map<string, AgentConfig>;
			const newAgents: AgentConfig[] = [];

			for (const agent of loadResult.value) {
				if (!agentsMap.has(agent.id)) {
					agentsMap.set(agent.id, agent);
					deps.scheduler.registerAgent(agent);
					deps.dispatcher.registerAgent(agent);
					newAgents.push(agent);
				}
			}

			return c.json({
				success: true,
				template,
				agents: [...agentsMap.values()].map((a) => ({
					id: a.id,
					name: a.name,
					displayName: a.displayName,
					role: a.role,
				})),
				newAgents: newAgents.length,
			});
		} catch (e) {
			return c.json({ error: `Setup failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
		}
	});
}
