---
name: agent-add
description: Add a new AI agent to the project. Creates a Cowork sub-agent markdown file with the right archetype, tools, model, and system prompt. Use when the user wants to add a new agent or expand their team.
argument-hint: "[agent-name] [--archetype <type>]"
---

# Add Agent to Project

Create a new Cowork sub-agent for the project.

## Steps

1. **Parse arguments**: Extract agent name and archetype from `$ARGUMENTS`. If not provided, ask the user.

2. **Choose an archetype** (determines model and tools):

   | Archetype | Model | Tools |
   |-----------|-------|-------|
   | researcher | sonnet | Read, Grep, Glob, WebSearch, WebFetch, Bash |
   | writer | sonnet | Read, Write, Edit, Glob, WebSearch |
   | orchestrator | sonnet | Agent(...), Read, Write, Bash, Glob, Grep |
   | analyst | sonnet | Read, Bash, Grep, Glob |
   | customer-support | haiku | Read, Write, Bash, Grep |
   | developer | sonnet | Read, Write, Edit, Bash, Glob, Grep |
   | marketer | sonnet | Read, Write, WebSearch, WebFetch, Bash |
   | finance | sonnet | Read, Bash, Grep |
   | monitor | haiku | Read, WebFetch, WebSearch, Bash |
   | generalist | haiku | Read, Write, Bash |

3. **Determine the agent's role** — ask the user what this agent should do, or infer from archetype and name.

4. **Read existing agents** in `.claude/agents/` to understand the current team and avoid overlap.

5. **Generate the sub-agent file** at `.claude/agents/<name>.md`:

```markdown
---
name: <kebab-case>
description: <When should Claude delegate to this agent? Be specific.>
model: <haiku|sonnet|opus>
tools: <comma-separated Cowork tools>
memory: project
---

# <Name> — <Role>

You are <Name>, the <role> for this business.

## Core Responsibilities
- <Specific responsibility>
- <Specific responsibility>
- <Specific responsibility>

## Working Style
- <How they approach work>
- <Quality standards>

## Knowledge Access
- Read `knowledge/company.md` for company context
- Check your memory for past learnings before starting
- Update your memory after completing significant tasks

## Boundaries
- <What to escalate to the founder>
- <What to never do>
```

6. **Update the orchestrator** — read `.claude/agents/atlas.md` (or the orchestrator) and add the new agent to its `tools: Agent(...)` list and team description.

7. **Update `AGENTS.md`** — add the new agent to the team roster.

8. **Report** what was created.

## Rules

- Agent name must be kebab-case (e.g., `content-writer`)
- File goes in `.claude/agents/<name>.md`
- System prompt should be at least 15-20 lines
- Always update the orchestrator's `Agent(...)` list when adding a new agent
- Choose the cheapest model that can do the job (haiku for routine, sonnet for complex)
