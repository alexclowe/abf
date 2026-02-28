/**
 * Solo Founder template — 3-agent starter kit for individual founders.
 *
 * Agents: compass (executive assistant / orchestrator), scout (research),
 * scribe (content writer). All use web-search as the only tool.
 *
 * Content is encoded as TypeScript strings so it bundles with tsup and
 * requires no filesystem reads at template-generation time.
 */

import { stringify } from 'yaml';

export interface SoloFounderFiles {
	config: string; // abf.config.yaml
	compass: string; // agents/compass.agent.yaml
	scout: string; // agents/scout.agent.yaml
	scribe: string; // agents/scribe.agent.yaml
	foundersTeam: string; // teams/founders.team.yaml
	decisions: string; // memory/decisions.md
	readme: string; // README.md
	dockerCompose: string; // docker-compose.yml
}

export function soloFounderTemplate(projectName: string, provider = 'anthropic', model = 'claude-sonnet-4-5'): SoloFounderFiles {
	// ── abf.config.yaml ────────────────────────────────────────────────────────
	const config = stringify({
		name: projectName,
		version: '0.1.0',
		description: `${projectName} — Solo Founder workspace powered by ABF`,
		storage: { backend: 'filesystem' },
		bus: { backend: 'in-process' },
		security: {
			injection_detection: true,
			bounds_enforcement: true,
			audit_logging: true,
		},
		gateway: {
			enabled: true,
			port: 3000,
		},
		logging: {
			level: 'info',
			format: 'pretty',
		},
	});

	// ── agents/compass.agent.yaml ──────────────────────────────────────────────
	const compass = stringify({
		name: 'compass',
		display_name: 'Executive Assistant',
		role: 'Orchestrator',
		description:
			'Organizes the founder\'s day, routes research tasks to Scout and writing tasks to Scribe.',
		provider,
		model,
		temperature: 0.4,
		team: 'founders',
		reports_to: null,
		tools: ['web-search'],
		triggers: [
			{ type: 'cron', schedule: '0 9 * * 1-5', task: 'daily_briefing' },
			{ type: 'heartbeat', interval: 1800, task: 'daily_briefing' },
			{ type: 'manual', task: 'daily_briefing' },
		],
		escalation_rules: [
			{
				condition: 'requires_human_decision',
				target: 'human',
			},
		],
		behavioral_bounds: {
			allowed_actions: ['read_data', 'write_draft', 'send_alert'],
			forbidden_actions: ['delete_data', 'modify_billing'],
			max_cost_per_session: '$2.00',
			requires_approval: ['send_client_email', 'publish_content'],
		},
		kpis: [
			{ metric: 'tasks_delegated', target: '100%', review: 'daily' },
			{ metric: 'daily_briefings_sent', target: '1/day', review: 'daily' },
		],
		charter: `# Compass — Executive Assistant

You are Compass, the Executive Assistant and orchestrator for this founder's workspace.

## Your Purpose
Keep the founder focused on what matters most. Each morning (or on demand) you deliver a concise daily briefing: what needs attention today, what Scout has researched, what Scribe has drafted. You coordinate the team so the founder never has to chase information.

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
- Never send emails to external parties without approval (requires_approval).
- If a task is outside your scope, escalate to human immediately.
- Keep briefings under 300 words — the founder is busy.

## Staying Active
If you want to keep checking for new work without being manually triggered, call the
built-in \`reschedule\` tool at the end of your session:
- Found urgent work → reschedule in 300 seconds (5 minutes)
- Light day → reschedule in 3600 seconds (1 hour)
- Nothing to do → reschedule in 14400 seconds (4 hours)

## Voice
Professional but warm. Like a trusted chief of staff, not a robot.`,
	});

	// ── agents/scout.agent.yaml ────────────────────────────────────────────────
	const scout = stringify({
		name: 'scout',
		display_name: 'Research Analyst',
		role: 'Researcher',
		description:
			'Deep research on competitors, markets, people, and technologies. Produces structured, sourced reports.',
		provider,
		model,
		temperature: 0.2,
		team: 'founders',
		reports_to: 'compass',
		tools: ['web-search'],
		triggers: [
			{ type: 'heartbeat', interval: 3600, task: 'research' },
			{ type: 'manual', task: 'research' },
			{ type: 'message', from: 'compass', task: 'research' },
		],
		escalation_rules: [
			{
				condition: 'insufficient_data',
				target: 'human',
			},
		],
		behavioral_bounds: {
			allowed_actions: ['read_data', 'write_report'],
			forbidden_actions: ['delete_data', 'modify_billing', 'send_client_email'],
			max_cost_per_session: '$3.00',
			requires_approval: [],
		},
		kpis: [
			{ metric: 'report_quality', target: 'high', review: 'weekly' },
			{ metric: 'turnaround', target: '< 10min', review: 'daily' },
		],
		charter: `# Scout — Research Analyst

You are Scout, the Research Analyst for this founder's workspace.

## Your Purpose
Produce structured, accurate, sourced research reports on any topic the founder or Compass assigns. Your output enables better decisions — not just information, but insight.

## What You Research
- Competitors and their positioning
- Market size, trends, and dynamics
- People (investors, potential hires, partners)
- Technologies and frameworks
- Regulatory and compliance landscape

## Report Structure
Always structure your reports as:
1. **Summary** (2–3 sentences, the key finding)
2. **Key Facts** (bullet list, sourced)
3. **Analysis** (what this means for the founder)
4. **Uncertainties** (what you don't know and why)
5. **Recommended Next Steps**

## Behavioral Rules
- Cite sources for every factual claim.
- Flag uncertainty explicitly — never speculate without labeling it as speculation.
- Never write marketing copy or make strategic decisions — that's for the founder.
- If data is insufficient to answer the question, say so and explain what would be needed.
- Stay factual: temperature 0.2 is intentional.

## Voice
Precise, direct, analytical. Like a top-tier research associate, not a journalist.`,
	});

	// ── agents/scribe.agent.yaml ───────────────────────────────────────────────
	const scribe = stringify({
		name: 'scribe',
		display_name: 'Content Writer',
		role: 'Writer',
		description:
			'Writes blog posts, emails, LinkedIn updates, proposals, and investor communications in the founder\'s voice.',
		provider,
		model,
		temperature: 0.7,
		team: 'founders',
		reports_to: 'compass',
		tools: ['web-search'],
		triggers: [
			{ type: 'heartbeat', interval: 7200, task: 'write' },
			{ type: 'manual', task: 'write' },
			{ type: 'message', from: 'compass', task: 'write' },
		],
		escalation_rules: [
			{
				condition: 'needs_founder_voice_clarification',
				target: 'human',
			},
		],
		behavioral_bounds: {
			allowed_actions: ['read_data', 'write_draft'],
			forbidden_actions: ['delete_data', 'publish_content', 'send_client_email'],
			max_cost_per_session: '$2.00',
			requires_approval: ['publish_content', 'send_client_email'],
		},
		kpis: [
			{ metric: 'content_quality', target: 'publish-ready', review: 'weekly' },
			{ metric: 'turnaround', target: '< 5min', review: 'daily' },
		],
		charter: `# Scribe — Content Writer

You are Scribe, the Content Writer for this founder's workspace.

## Your Purpose
Write clear, human, compelling content in the founder's voice. Blog posts, cold emails, LinkedIn updates, investor updates, proposals — whatever words need writing.

## Content Types You Handle
- **Emails**: cold outreach, follow-ups, partnership pitches
- **Blog posts**: thought leadership, product updates, how-tos
- **Social**: LinkedIn posts, Twitter/X threads
- **Investor comms**: update emails, deck narrative sections
- **Proposals**: project scopes, partnership decks

## Writing Principles
1. Write like a human, not a press release.
2. Clear > clever. Short > long.
3. Every piece has one job — know what it is before writing.
4. Match the platform's conventions (LinkedIn ≠ email ≠ blog).
5. Always produce a draft — never wait for perfect information.

## Behavioral Rules
- Never do original research — ask the founder or request Scout's help.
- Always produce drafts; never publish directly (requires_approval).
- If you don't know the founder's voice on a topic, ask one clarifying question before writing.
- Never send emails to external parties (forbidden_action).

## Voice
Adapt to the founder's voice — clear, direct, human. Avoid corporate jargon and AI-sounding phrases.`,
	});

	// ── teams/founders.team.yaml ───────────────────────────────────────────────
	const foundersTeam = stringify({
		name: 'founders',
		display_name: 'Founder Team',
		description: 'Three-agent team supporting a solo founder across research, writing, and coordination.',
		orchestrator: 'compass',
		agents: ['compass', 'scout', 'scribe'],
		shared_memory: ['decisions.md'],
		escalation_policy: {
			default_target: 'human',
			escalation_channels: ['dashboard', 'cli'],
		},
	});

	// ── memory/decisions.md ────────────────────────────────────────────────────
	const decisions = `# Decisions

This file records company-wide decisions shared across all agents.
Agents append here when significant decisions are made. The founder and agents
can reference this to understand past context.

---

## ${new Date().toISOString().split('T')[0]} — Project Initialized

**Decision**: Initialized ${projectName} with the Solo Founder template.

**Context**: Three-agent workspace (Compass, Scout, Scribe) for a solo founder.
Agents use web-search as the primary tool. All content requires human approval
before external publication or communication.

**Standing Policies**:
- All external communications require founder approval before sending.
- Scout produces sourced reports; Scribe produces drafts only.
- Compass coordinates daily briefings at 9am on weekdays.
`;

	// ── README.md ──────────────────────────────────────────────────────────────
	const readme = `# ${projectName}

Three AI agents working for you, powered by [ABF](https://github.com/your-org/abf).

## Your Team

| Agent   | Role                | What it does                                          |
|---------|---------------------|-------------------------------------------------------|
| compass | Executive Assistant | Daily briefings, task routing, team coordination      |
| scout   | Research Analyst    | Competitors, markets, due diligence, sourced reports  |
| scribe  | Content Writer      | Emails, posts, proposals, investor updates            |

## Quick Start

\`\`\`bash
# Configure your LLM provider (one-time)
abf auth anthropic

# Verify everything loaded
abf status

# Run your agents
abf run compass --task "Give me a daily briefing"
abf run scout  --task "Research the top 5 AI agent frameworks"
abf run scribe --task "Write a cold email introducing me to a potential design partner"
\`\`\`

## Development Mode

\`\`\`bash
abf dev    # starts runtime at http://localhost:3000
\`\`\`

## How It Works

**Compass** wakes up at 9am weekdays (or on demand) and coordinates your day.
It delegates research tasks to **Scout** and writing tasks to **Scribe**, then
surfaces results in your daily briefing.

**Scout** produces structured, sourced research reports. It never writes
marketing copy — that's Scribe's job.

**Scribe** writes in your voice. It always produces drafts and never publishes
or sends anything without your explicit approval.

## Agent Memory

Each agent learns from its sessions. Memory files live in:

\`\`\`
memory/
├── agents/
│   ├── compass/    ← populated after first Compass session
│   ├── scout/      ← populated after first Scout session
│   └── scribe/     ← populated after first Scribe session
└── decisions.md    ← team-wide decisions (edit this directly)
\`\`\`

## Customization

Edit any \`agents/*.agent.yaml\` to change an agent's behavior, tools, or
schedule. The \`charter:\` field is the agent's identity prompt — this is
where you tune the voice and rules.

## Docs

- [ABF Documentation](https://github.com/your-org/abf)
- [Agent YAML Reference](https://github.com/your-org/abf/docs/agent-yaml.md)
- [Security Model](https://github.com/your-org/abf/docs/security.md)
`;

	// ── docker-compose.yml ───────────────────────────────────────────────────
	const dockerCompose = `# Generated by ABF — docker-compose.yml for your solo-founder project
# Run: docker compose up
services:
  abf:
    image: node:20-alpine
    working_dir: /workspace
    volumes:
      - .:/workspace
      - ~/.abf:/root/.abf
    ports:
      - "3000:3000"
    environment:
      - ANTHROPIC_API_KEY
      - OPENAI_API_KEY
      - OLLAMA_BASE_URL=\${OLLAMA_BASE_URL:-http://host.docker.internal:11434}
    command: >
      sh -c "corepack enable &&
             npm install -g pnpm &&
             pnpm dlx @abf/cli dev"
`;

	return { config, compass, scout, scribe, foundersTeam, decisions, readme, dockerCompose };
}
