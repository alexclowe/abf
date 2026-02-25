# Solo Founder Template

## Context

`abf init --template solo-founder` is accepted by the CLI but currently ignored — all templates produce the same minimal single-agent skeleton. The v0.1 spec requires at least one complete, working business template that proves the full stack end-to-end.

The Solo Founder template: 3 agents, no external APIs beyond the LLM, immediately useful, exercises every v0.1 primitive (agent configs, team, triggers, behavioral bounds, KPIs, charters, memory).

## What Gets Created

```
my-business/
├── abf.config.yaml
├── agents/
│   ├── compass.agent.yaml    ← Executive Assistant (orchestrator)
│   ├── scout.agent.yaml      ← Research Analyst
│   └── scribe.agent.yaml     ← Content Writer
├── teams/
│   └── founders.team.yaml
├── memory/
│   ├── agents/               ← (empty — populated at runtime)
│   └── decisions.md          ← seeded with template context
├── tools/                    ← empty (web-search is a built-in)
├── logs/                     ← empty
├── workflows/                ← empty
├── interfaces/               ← empty
├── templates/                ← empty (for user's own templates)
└── README.md                 ← Getting started guide (new — not in custom template)
```

## The Three Agents

### Compass — Executive Assistant (orchestrator)
- **Role**: Organizes the founder's day, routes work to Scout/Scribe
- **Triggers**: `manual` (task: `daily_briefing`) + `cron` (`0 9 * * 1-5`, task: `daily_briefing`)
- **Tools**: `web-search`
- **Temperature**: 0.4
- **Bounds**: allowed: read_data, write_draft, send_alert. forbidden: delete_data, modify_billing. requires_approval: send_client_email
- **KPIs**: tasks_delegated (100%, daily), daily_briefings_sent (1/day, daily)
- **Charter**: Keeps the founder focused. Coordinates Scout (research) and Scribe (writing). Never takes financial actions or sends external communications without approval.

### Scout — Research Analyst
- **Role**: Deep research — competitors, markets, people, technologies
- **Triggers**: `manual` (task: `research`) + `message` (from: `compass`, task: `research`)
- **Tools**: `web-search`
- **Temperature**: 0.2 (low for factual accuracy)
- **Bounds**: allowed: read_data, write_report. forbidden: delete_data, modify_billing, send_client_email
- **KPIs**: report_quality (high, weekly), turnaround (< 10min, daily)
- **Charter**: Produces structured, sourced research reports. Never writes marketing copy. Flags uncertainty clearly. Defers strategic decisions to the founder.

### Scribe — Content Writer
- **Role**: Blog posts, emails, LinkedIn, proposals, investor updates
- **Triggers**: `manual` (task: `write`) + `message` (from: `compass`, task: `write`)
- **Tools**: `web-search`
- **Temperature**: 0.7 (higher for creative writing)
- **Bounds**: allowed: read_data, write_draft. forbidden: delete_data, publish_content, send_client_email. requires_approval: publish_content, send_client_email
- **KPIs**: content_quality (publish-ready, weekly), turnaround (< 5min, daily)
- **Charter**: Writes in the founder's voice — clear, direct, human. Never does original research (asks founder or Scout). Always writes drafts, never publishes directly.

## Files to Change

| File | Action |
|------|--------|
| `packages/cli/src/templates/solo-founder.ts` | **New** — all template file content as exported functions |
| `packages/cli/src/commands/init.ts` | **Update** — branch on `options.template === 'solo-founder'` |

## Implementation Details

### `packages/cli/src/templates/solo-founder.ts`

```typescript
export interface SoloFounderFiles {
  config: string          // abf.config.yaml
  compass: string         // agents/compass.agent.yaml
  scout: string           // agents/scout.agent.yaml
  scribe: string          // agents/scribe.agent.yaml
  foundersTeam: string    // teams/founders.team.yaml
  decisions: string       // memory/decisions.md
  readme: string          // README.md
}

export function soloFounderTemplate(projectName: string): SoloFounderFiles
```

Use the `yaml` package `stringify()` for config + agent + team objects (same as init.ts already does for the custom template). Write README.md as a template literal string.

The charter field in each agent YAML is a multiline string (YAML block scalar `|`) containing the full agent identity prompt.

### `packages/cli/src/commands/init.ts`

Add a helper at the bottom of `initCommand`:

```typescript
if (options.template === 'solo-founder') {
  const { soloFounderTemplate } = await import('../templates/solo-founder.js');
  const files = soloFounderTemplate(projectName);
  await writeFile(join(root, 'abf.config.yaml'), files.config, 'utf-8');
  await writeFile(join(root, 'agents', 'compass.agent.yaml'), files.compass, 'utf-8');
  await writeFile(join(root, 'agents', 'scout.agent.yaml'), files.scout, 'utf-8');
  await writeFile(join(root, 'agents', 'scribe.agent.yaml'), files.scribe, 'utf-8');
  await writeFile(join(root, 'teams', 'founders.team.yaml'), files.foundersTeam, 'utf-8');
  await writeFile(join(root, 'memory', 'decisions.md'), files.decisions, 'utf-8');
  await writeFile(join(root, 'README.md'), files.readme, 'utf-8');
} else {
  // existing custom template logic (1 sample assistant agent)
}
```

Also update the success message to show template-specific next steps.

### README.md content outline

```markdown
# {projectName}

Three AI agents working for you, powered by ABF.

## Your Team

| Agent   | Role               | What it does                               |
|---------|--------------------|--------------------------------------------|
| compass | Executive Assistant | Daily briefings, task routing             |
| scout   | Research Analyst   | Competitors, markets, due diligence        |
| scribe  | Content Writer     | Emails, posts, proposals, updates         |

## Quick Start

abf auth anthropic      # configure your LLM (one-time)
abf status              # verify everything loaded

abf run compass --task "Give me a daily briefing"
abf run scout  --task "Research the top 5 AI agent frameworks"
abf run scribe --task "Write a cold email introducing me to a potential design partner"

## Development Mode

abf dev    # starts runtime at http://localhost:3000
```

## Key Design Decisions

1. **Charters embedded in YAML** — the session manager reads `agent.charter` directly from the parsed config. No separate charter.md files needed at init time (those are written by the runtime).

2. **`web-search` as the only tool** — already registered as a built-in stub; agents can reference it in their `tools:` list without any tool YAML needed in the project.

3. **Template content as TypeScript strings** — bundles cleanly with tsup, no filesystem reads at runtime. Template content stays alongside the CLI code.

4. **No pre-written memory files** — `memory/agents/` directories stay empty; the runtime creates and populates them on first session run.

5. **`founders` team name, `compass` as orchestrator** — mirrors the CiteRank naming convention and shows the team abstraction even without full orchestration in v0.1.

## Verification

```bash
# Build
pnpm --filter @abf/cli build

# Smoke test: generate project
node packages/cli/dist/index.js init --template solo-founder --name smoke-test
cd smoke-test

# Check structure
ls agents/   # compass.agent.yaml  scout.agent.yaml  scribe.agent.yaml
ls teams/    # founders.team.yaml
cat README.md

# Validate configs parse correctly
node ../packages/cli/dist/index.js status
# Expected: 3 agents (compass, scout, scribe), provider status

# Run an agent (requires ANTHROPIC_API_KEY or abf auth anthropic)
node ../packages/cli/dist/index.js run scout --task "What is the ABF framework?"
# Expected: ✓ Completed in ~N tokens ($X.XXXX)
# Verify: memory/agents/scout/history.md was created with session output
# Verify: logs/audit/YYYY-MM-DD.jsonl has session_start + session_end entries

# Typecheck
pnpm --filter @abf/cli typecheck
```
