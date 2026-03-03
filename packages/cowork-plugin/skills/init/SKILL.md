---
name: init
description: Initialize a new project with AI agent assistants for a solo founder. Creates the directory structure and starter Cowork sub-agents for running a business with AI. Use when the user wants to start a new business project with AI agents.
argument-hint: "[project-name]"
---

# Initialize Business Agent Project

You are setting up a new project where AI agents help a solo founder run their business. The agents run natively in Claude Cowork as sub-agents — no separate server or dashboard needed.

## Steps

1. **Ask the user** what kind of business they want to build. Offer these paths:
   - **From an idea**: Describe the business and you'll design the full agent team (use `/abf:seed` after init)
   - **From a template**: Choose from: `solo-founder`, `saas`, `marketing-agency`, `e-commerce`, `content-studio`, `consulting`
   - **Blank**: Start with just the orchestrator and add agents as needed

2. **Create the project directory** named `$ARGUMENTS` (or ask for a name):

```bash
mkdir -p $ARGUMENTS && cd $ARGUMENTS
git init
```

3. **Create the directory structure**:

```
<project>/
├── .claude/
│   └── agents/              # Cowork sub-agents (your AI team)
│       └── atlas.md         # Orchestrator agent (always present)
├── knowledge/               # Company knowledge base
│   ├── company.md
│   └── brand-voice.md
├── data/                    # Business data, reports, outputs
├── scripts/                 # Automation scripts
├── AGENTS.md                # Guide to your agent team
├── CLAUDE.md                # Project instructions for Claude
└── .gitignore
```

4. **Create `.claude/agents/atlas.md`** — the orchestrator:

```markdown
---
name: atlas
description: Business orchestrator. Coordinates work across all business agents, prioritizes tasks, and synthesizes outputs. Use proactively for any business-related request.
model: sonnet
tools: Agent, Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
memory: project
---

# Atlas — Business Orchestrator

You are Atlas, the business orchestrator. You coordinate all business operations by delegating to specialist agents and synthesizing their outputs.

## How to Work
1. When the founder asks for something, determine which agent(s) should handle it
2. Delegate with clear, specific instructions
3. Run agents in parallel when tasks are independent
4. Synthesize results into actionable summaries
5. Update your memory with decisions and learnings

## Your Principles
- Always explain what you're delegating and why
- Prefer parallel execution when tasks are independent
- Flag decisions that need human judgment
- Keep a running summary of business state in your memory
```

5. **Create `CLAUDE.md`** with project context:

```markdown
# <Project Name>

This project uses AI agents to help run the business. Agents are defined as
Cowork sub-agents in `.claude/agents/`. The orchestrator (Atlas) coordinates
all other agents.

## Key directories
- `.claude/agents/` — Agent definitions (sub-agent markdown files)
- `knowledge/` — Company knowledge base (context for agents)
- `data/` — Business data, reports, and outputs
- `scripts/` — Automation scripts

## Adding agents
Create a new `.md` file in `.claude/agents/` or use `/abf:agent-add`.

## Running agents
- Interactive: Just talk to Claude — it delegates automatically
- Direct: `claude --agent atlas`
- Automated: `claude --agent atlas --message "task" --headless`
```

6. **Create starter knowledge files**:
   - `knowledge/company.md` — Ask user for details or leave as template
   - `knowledge/brand-voice.md` — Brand voice guidelines template

7. **Create `AGENTS.md`**:

```markdown
# Agent Team

## Agents
- **Atlas** (orchestrator) — Coordinates all business agents

## How to Use

### Interactive
Talk to Claude. It delegates to the right agent automatically.

### Run the orchestrator
claude --agent atlas

### Automated (cron)
0 9 * * * cd /path/to/project && claude --agent atlas --message "Daily standup" --headless
```

8. **Create `.gitignore`**:

```
.claude/agent-memory/
.claude/agent-memory-local/
data/tmp/
*.log
.env
```

9. **Tell the user** what's next:
   - Design a full team: `/abf:seed` with their business plan
   - Add individual agents: `/abf:agent-add`
   - Start working: just talk to Claude

## Important

- Agent files are markdown in `.claude/agents/<name>.md`
- Knowledge files go in `knowledge/*.md`
- Agent memory is auto-managed by Cowork in `.claude/agent-memory/`
- The orchestrator's `tools` field controls which agents it can spawn
