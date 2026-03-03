---
name: agent-add
description: Add a new AI agent to an ABF project. Scaffolds the agent YAML definition with the right archetype, tools, triggers, and charter. Use when the user wants to add a new agent, create a new AI employee, or expand their agent team.
argument-hint: "[agent-name] [--archetype <type>] [--team <team>]"
---

# Add Agent to ABF Project

Create a new agent definition for an ABF project.

## Steps

1. **Parse arguments**: Extract agent name, archetype, and team from `$ARGUMENTS`. If not provided, ask the user.

2. **Choose an archetype** (provides default tools, temperature, and charter template):
   - `researcher` — temp 0.3, tools: web-search, knowledge-search
   - `writer` — temp 0.7, tools: knowledge-search, image-render
   - `orchestrator` — temp 0.2, tools: send-message, knowledge-search
   - `analyst` — temp 0.2, tools: database-query, knowledge-search
   - `customer-support` — temp 0.4, tools: send-message, knowledge-search, database-query, email-send, privacy-ops
   - `developer` — temp 0.3, tools: knowledge-search, github-ci, app-generate, app-deploy, backend-provision, code-generate
   - `marketer` — temp 0.6, tools: web-search, knowledge-search, send-message, email-send, image-render, social-publish
   - `finance` — temp 0.1, tools: database-query, knowledge-search, stripe-billing, privacy-ops
   - `monitor` — temp 0.1, tools: web-search, knowledge-search, send-message
   - `generalist` — temp 0.4, tools: knowledge-search

3. **Determine the agent's role** by asking the user what this agent should do, or infer from the archetype and name.

4. **Generate the agent YAML file** at `agents/<name>.agent.yaml`:

```yaml
name: <agent-name>
display_name: <Human Readable Name>
role: <Job Title>
description: <One-line description>
role_archetype: <archetype>
provider: anthropic
model: claude-sonnet-4-6
temperature: <from archetype or custom>
team: <team-name>
reports_to: <orchestrator-name or null>
tools: <merged archetype defaults + role-specific tools>
triggers:
  - type: manual
    task: <default_task>
  # Add cron/message/webhook triggers as appropriate
escalation_rules:
  - condition: session_cost > budget
    target: human
    message: Session cost exceeded budget
behavioral_bounds:
  allowed_actions: <from archetype + role-specific>
  forbidden_actions: <from archetype + role-specific>
  max_cost_per_session: "$2.00"
  requires_approval: <actions needing human sign-off>
kpis:
  - metric: <relevant metric>
    target: <target value>
    review: weekly
charter: |
  # <Name> — <Role>
  You are <Name>, the <role description>...

  ## Core Responsibilities
  - ...

  ## Working Style
  - ...
```

5. **Create memory directory** at `memory/agents/<name>/` with:
   - `charter.md` — Copy of the charter
   - `history.md` — Empty (will be appended to by the runtime)

6. **Update team file** if a team was specified — add the agent to the team's `members` list.

7. **Report** what was created and suggest next steps.

## Rules

- Agent name must be kebab-case (e.g., `content-writer`, not `contentWriter`)
- File must be `agents/<name>.agent.yaml` — this naming convention is required
- All YAML field names use snake_case
- The charter should be a detailed identity prompt (at least 10-15 lines)
- Default provider is `anthropic`, default model is `claude-sonnet-4-6`
- Always include at least a `manual` trigger so the agent can be run on demand
- `reports_to` should reference the team's orchestrator agent (or null if standalone)
