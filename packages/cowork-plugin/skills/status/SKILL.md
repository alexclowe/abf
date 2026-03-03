---
name: status
description: Show the status of a business agent project — list agents, knowledge files, and team configuration. Use when the user asks about their agents, wants to see the team, or needs an overview.
disable-model-invocation: true
---

# Agent Team Status

Analyze the current project and display a comprehensive status report.

## Steps

1. **Find agents** — Read all `.claude/agents/*.md` files. For each, parse the YAML frontmatter and show:
   - Name and description
   - Model (haiku/sonnet/opus)
   - Tools available
   - Memory enabled (yes/no)
   - For the orchestrator: which agents it can delegate to

2. **Identify the orchestrator** — The agent with `Agent(...)` in its tools list.

3. **List knowledge files** — Show files in `knowledge/`.

4. **Check `CLAUDE.md`** and **`AGENTS.md`** — Do they exist? Are they current?

5. **Check for issues**:
   - Agents not listed in the orchestrator's `Agent(...)` tools
   - Missing knowledge files (company.md, brand-voice.md)
   - Agents with no description (Claude won't know when to use them)
   - Orchestrator missing `memory: project`

6. **Check agent memory** — Look for `.claude/agent-memory/` directories.

## Output Format

```
Agent Team Status
=================

Orchestrator: <name> (<model>)
  Delegates to: <agent1>, <agent2>, ...

Agents (N):
  <name> — <description snippet> [<model>] (memory: yes/no)
  ...

Knowledge (N files):
  company.md, brand-voice.md, ...

Agent Memory:
  <name>: <file count> files
  ...

Issues:
  - <any problems found>

Run interactively: claude --agent <orchestrator>
Run headless: claude --agent <orchestrator> --message "task" --headless
```
