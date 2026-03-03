---
name: abf-conventions
description: ABF project conventions and YAML schema reference. Loaded automatically when working with ABF agent definitions, team configs, or workflow files. Use when editing *.agent.yaml, *.team.yaml, or *.workflow.yaml files.
user-invocable: false
---

# ABF Conventions

When working in an ABF project (identified by the presence of `abf.config.yaml`), follow these conventions.

## File Naming

- Agent definitions: `agents/<name>.agent.yaml` — name is kebab-case
- Team definitions: `teams/<name>.team.yaml`
- Workflow definitions: `workflows/<name>.workflow.yaml`
- Monitor definitions: `monitors/<name>.monitor.yaml`
- Custom tools: `tools/<name>.tool.yaml` (definition) + `tools/<name>.tool.ts` (implementation)
- MCP servers: `tools/mcp-servers.yaml`
- Message templates: `templates/messages/<name>.template.yaml`
- Knowledge files: `knowledge/<name>.md`
- Agent memory: `memory/agents/<name>/charter.md` and `memory/agents/<name>/history.md`

## YAML Field Naming

All YAML files use **snake_case** for field names (e.g., `display_name`, `role_archetype`, `reports_to`, `max_cost_per_session`). The TypeScript runtime converts these to camelCase internally.

## Agent YAML Required Fields

- `name` (string, kebab-case)
- `display_name` (string)
- `role` (string)
- `description` (string)

## Agent YAML Optional Fields with Defaults

- `provider`: "anthropic"
- `model`: "claude-sonnet-4-6"
- `temperature`: from archetype or undefined
- `role_archetype`: optional (researcher|writer|orchestrator|analyst|customer-support|developer|marketer|finance|monitor|generalist)
- `team`: optional team name
- `reports_to`: optional agent name or null
- `tools`: [] (array of tool IDs)
- `triggers`: [] (array of trigger objects)
- `escalation_rules`: []
- `behavioral_bounds`: { allowed_actions: [], forbidden_actions: [], max_cost_per_session: "$2.00", requires_approval: [] }
- `kpis`: []
- `charter`: "" (multi-line string with agent identity prompt)

## Trigger Types

- `cron`: { type: cron, schedule: "<5-field cron>", task: "<description>" }
- `message`: { type: message, from: "<agent-name>", task: "<description>" }
- `webhook`: { type: webhook, path: "/webhooks/<name>", task: "<description>" }
- `manual`: { type: manual, task: "<description>" }
- `heartbeat`: { type: heartbeat, interval: <seconds>, task: "<description>" }
- `event`: { type: event, event: "<event-name>", task: "<description>" }

## Security Rules

- Agents start with zero permissions — only grant what's needed
- External-facing actions should use `requires_approval`
- `forbidden_actions` should always include `delete_data` and `modify_billing` unless explicitly needed
- `max_cost_per_session` defaults to $2.00 — adjust based on agent complexity
- Tool access is controlled per-agent — agents cannot install tools at runtime

## Common Patterns

- Every team needs an orchestrator agent
- Every agent should have at least a `manual` trigger
- The Company Architect agent is auto-generated for seed-based projects
- Knowledge files are injected into all agent prompts at session start
- Agent history (`memory/agents/<name>/history.md`) is append-only
