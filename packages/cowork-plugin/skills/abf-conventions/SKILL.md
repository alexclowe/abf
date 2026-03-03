---
name: abf-conventions
description: ABF project conventions for Cowork sub-agents. Loaded automatically when working with agent definitions or knowledge files. Use when editing .claude/agents/*.md or knowledge/*.md files.
user-invocable: false
---

# ABF Conventions for Cowork

When working in a project with business agents (identified by `.claude/agents/` containing agent markdown files), follow these conventions.

## File Layout

- Agent definitions: `.claude/agents/<name>.md` — kebab-case name
- Knowledge files: `knowledge/<name>.md`
- Agent memory: `.claude/agent-memory/<name>/` (auto-managed by Cowork)
- Workflow scripts: `scripts/<name>.sh`
- Business data: `data/`
- Logs: `logs/`
- Project context: `CLAUDE.md`
- Team guide: `AGENTS.md`

## Sub-Agent Frontmatter

Every agent file must have YAML frontmatter with:

**Required:**
- `name` — kebab-case identifier
- `description` — When Claude should delegate to this agent (be specific!)

**Recommended:**
- `model` — haiku, sonnet, or opus (default: inherit from parent)
- `tools` — Comma-separated Cowork tools
- `memory` — project (for agents that should learn over time)

**Optional:**
- `background` — true to always run in background
- `isolation` — worktree for isolated git operations
- `permissionMode` — default, acceptEdits, dontAsk, bypassPermissions

## Tool Selection

Give agents only the tools they need:

| Role | Typical Tools |
|------|--------------|
| Read-only research | Read, Glob, Grep, WebSearch, WebFetch |
| Content creation | Read, Write, Edit, Glob |
| Operations / API calls | Read, Write, Bash |
| Orchestrator | Agent(...), Read, Write, Bash, Glob, Grep |
| Full access | Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch |

## Model Selection

- **haiku** — Fast, cheap. Good for: monitoring, lookups, FAQ, routine classification
- **sonnet** — Balanced. Good for: most work — research, writing, analysis, coding
- **opus** — Most capable, expensive. Good for: strategic planning, complex analysis

## The Orchestrator

Every project should have one orchestrator agent (typically `atlas`). It:
- Has `Agent(member1, member2, ...)` in its tools to delegate
- Understands the full business context
- Decides which specialist handles each request
- Synthesizes results from multiple agents

## Knowledge Files

- `knowledge/company.md` — Company overview, mission, customers, revenue model
- `knowledge/brand-voice.md` — Tone, style, do's and don'ts
- Additional domain-specific files as needed
- Agents read these for context — keep them current

## Agent Memory

When `memory: project` is set, the agent gets a persistent directory at `.claude/agent-memory/<name>/`. It uses this to store learnings across sessions. Agents should:
- Read their memory before starting work
- Update their memory after significant tasks
- Curate `MEMORY.md` to stay under 200 lines

## Automation

Agents run via `claude --agent <name>` and can be automated with:
- Cron jobs for scheduled tasks
- GitHub Actions for CI/CD-based scheduling
- Shell scripts for multi-agent workflows

## Common Patterns

- Every project needs an orchestrator
- Use `memory: project` for agents that benefit from learning
- Include "Use proactively" in the description for auto-delegated agents
- Knowledge files are shared context — all agents can read them
- Workflow scripts in `scripts/` coordinate multi-agent processes
