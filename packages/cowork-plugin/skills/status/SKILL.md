---
name: status
description: Show the status of an ABF project — list agents, teams, workflows, and configuration. Use when the user asks about their ABF project, wants to see what agents exist, or needs an overview.
disable-model-invocation: true
---

# ABF Project Status

Analyze the current ABF project and display a comprehensive status report.

## Steps

1. **Find the project root** — Look for `abf.config.yaml` in the current directory or parent directories.

2. **Read the config** — Parse `abf.config.yaml` and display:
   - Project name and version
   - Storage backend (filesystem or postgres)
   - Bus backend (in-process or redis)
   - Gateway port
   - Security settings

3. **List all agents** — Read all `agents/*.agent.yaml` files and for each show:
   - Name and display name
   - Role and archetype
   - Team assignment
   - Tools count
   - Trigger types (cron/manual/message/webhook/heartbeat)
   - Model and provider

4. **List all teams** — Read all `teams/*.team.yaml` files and for each show:
   - Name and display name
   - Orchestrator
   - Members

5. **List workflows** — Read `workflows/*.workflow.yaml` if any exist.

6. **List knowledge files** — Show files in `knowledge/`.

7. **Check for issues**:
   - Agents referencing non-existent teams
   - Teams referencing non-existent agents
   - Agents with no triggers (can only be run manually)
   - Missing knowledge files (company.md, brand-voice.md)

8. **Format as a clear summary** with sections for each component.

## Output Format

```
ABF Project: <name> (v<version>)
Storage: <backend> | Bus: <backend> | Port: <port>

Agents (N):
  <name> — <role> [<archetype>] → <team> (<triggers>)
  ...

Teams (N):
  <name> — orchestrator: <agent>, members: [...]
  ...

Workflows (N):
  <name> — <step-count> steps
  ...

Knowledge (N files):
  company.md, brand-voice.md, ...

Issues:
  - <any problems found>
```
