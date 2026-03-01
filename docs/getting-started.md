# Getting Started with ABF

This guide walks you through installing ABF, creating your first project, running your agents, and understanding what happens under the hood. It should take under 5 minutes.

---

## Prerequisites

- **Node.js 20 or later** -- Check with `node --version`
- **pnpm 10 or later** -- Install with `npm install -g pnpm` if needed
- An API key for at least one LLM provider (Anthropic, OpenAI) or a running Ollama instance for local-only operation

---

## 1. Install the CLI

```bash
npm install -g @abf/cli
```

Verify:

```bash
abf --version
# 1.0.0
```

Alternatively, use `npx` without installing globally:

```bash
npx @abf/cli init --template solo-founder --name my-business
```

---

## 2. Create a Project

ABF provides three paths to create a project. Pick the one that fits your situation.

### Path A: Start from a template (fastest)

```bash
abf init --template solo-founder --name my-business
cd my-business
```

This creates three agents (Compass the executive assistant, Scout the researcher, and Scribe the content writer) organized into a single team. You should see output like:

```
Created my-business/abf.config.yaml
Created my-business/agents/compass.agent.yaml
Created my-business/agents/scout.agent.yaml
Created my-business/agents/scribe.agent.yaml
Created my-business/teams/founders.team.yaml
Created my-business/memory/decisions.md
Created my-business/knowledge/company.md
Created my-business/knowledge/brand-voice.md
Created my-business/docker-compose.yml
Created my-business/README.md

Project "my-business" created with solo-founder template.
```

Available templates:

| Template | Command | Agents | Description |
|---|---|---|---|
| Solo Founder | `--template solo-founder` | 3 | Executive assistant, researcher, writer |
| SaaS Startup | `--template saas` | 5 | Product + go-to-market teams |
| Marketing Agency | `--template marketing-agency` | 4 | Director, strategist, copywriter, analyst |

### Path B: Start from a business plan

If you have a business plan, pitch deck, or company description document (`.docx`, `.pdf`, `.txt`, or `.md`):

```bash
abf init --seed ./my-business-plan.md
```

ABF parses the document, sends it to an LLM for analysis, and generates a complete project with agents, teams, knowledge files, and workflows tailored to your specific business. See the full [Seed-to-Company Guide](guides/seed-to-company.md) for details.

### Path C: Start from the setup wizard

For a fully visual experience:

```bash
abf setup
```

This opens the Dashboard setup wizard in your browser, where you can choose between answering interview questions about your business idea, uploading a document, or picking a template -- all through a guided UI.

---

## 3. Configure an LLM Provider

ABF needs access to at least one LLM to power your agents. The default templates use Anthropic (Claude).

### Anthropic (recommended)

```bash
abf auth anthropic
# Enter your Anthropic API key: sk-ant-...
# Credential stored securely.
```

### OpenAI

```bash
abf auth openai
```

After adding the key, update each agent YAML to use OpenAI:

```yaml
provider: openai
model: gpt-4o
```

### Ollama (local, no API key)

Start Ollama on your machine, then:

```bash
abf auth ollama
```

Update each agent YAML:

```yaml
provider: ollama
model: llama3.2
```

### Verify your setup

```bash
abf auth --list
# Configured providers:
#   anthropic  ok
```

---

## 4. Start the Runtime

```bash
abf dev
```

Expected output:

```
ABF runtime starting...
  Loaded 3 agents: compass, scout, scribe
  Loaded 1 team: founders
  Gateway listening on http://localhost:3000
  Scheduler started (2 cron triggers registered)
```

The runtime is now running with all five components:

- **Scheduler** -- Fires cron and heartbeat triggers
- **Dispatcher** -- Handles agent activations, spawns sessions
- **Session Manager** -- Loads context, calls LLM, runs tools, writes memory
- **Bus** -- Routes messages between agents
- **Gateway** -- Serves the REST API and Dashboard on port 3000

Leave this terminal running and open a new one for the next steps.

---

## 5. Open the Dashboard

Navigate to:

```
http://localhost:3000
```

You will see the ABF Dashboard with:

- **Overview** -- System status, number of active agents, recent sessions
- **Agents** -- Your three agents with status indicators
- **Teams** -- The "founders" team with Compass as orchestrator

Click on any agent to see its details: charter, configuration, KPIs, and a form to send tasks to its inbox.

---

## 6. Run Your First Agent

### From the CLI

In a second terminal:

```bash
abf run compass --task daily_briefing
```

This triggers Compass to execute its `daily_briefing` task. You will see the session output in your terminal, including any tool calls, LLM responses, and the final output.

### From the Dashboard

1. Go to the **Agents** page
2. Click on **Compass**
3. Use the "Send Task to Inbox" form
4. Type a task like "Give me a briefing on today's priorities"
5. Click **Send**

The agent picks up the task on its next activation.

---

## 7. What Just Happened

When an agent runs a session, ABF executes an 8-step lifecycle:

1. **Load Context** -- Reads the agent's charter, history, team decisions, and knowledge files
2. **Build Prompt** -- Assembles the system prompt with date, KPIs, pending messages, and inbox items
3. **Call LLM** -- Sends the prompt to the configured provider (Anthropic, OpenAI, Ollama)
4. **Tool Loop** -- Executes any tool calls the LLM requests, returns results, repeats
5. **Process Outputs** -- Routes any inter-agent messages to the bus
6. **Write Memory** -- Appends learnings to the agent's history file
7. **Check Escalations** -- Routes to human or orchestrator if escalation rules trigger
8. **Report** -- Updates KPIs, logs cost, closes the session

After a session completes, you can find the results in several places:

**Session logs:**
```bash
abf logs --agent compass
```

**Agent history** (accumulated learnings):
```
memory/agents/compass/history.md
```

**Session outputs** (readable by teammate agents):
```
outputs/compass/2026-03-01T10-00-00.md
```

**Team decisions:**
```
memory/decisions.md
```

---

## 8. Customize an Agent

Open an agent definition to modify its behavior:

```bash
$EDITOR agents/scout.agent.yaml
```

### Change the model

```yaml
provider: openai
model: gpt-4o
temperature: 0.3
```

### Adjust triggers

```yaml
triggers:
  - type: cron
    schedule: '0 */4 * * *'     # Every 4 hours
    task: research_scan
  - type: message
    from: compass               # Triggered when Compass sends a message
    task: on_demand_research
  - type: manual
    task: research_scan
```

### Tighten behavioral bounds

```yaml
behavioral_bounds:
  allowed_actions: [read_data, write_report]
  forbidden_actions: [delete_data, modify_billing, access_credentials]
  max_cost_per_session: $0.50
  requires_approval: [publish_content, send_client_email]
```

### Edit the charter

The `charter` field is the agent's identity and instructions. Change how the agent thinks and responds by editing this field.

After making changes, restart the runtime (`Ctrl+C` and `abf dev` again) to pick up the new configuration.

---

## 9. Add a New Agent

Scaffold from a built-in archetype:

```bash
abf agent add --name analyst --archetype analyst --team founders
```

This creates `agents/analyst.agent.yaml` with sensible defaults for an analyst: lower temperature, analytical tools, and a starter charter.

Available archetypes:

| Archetype | Temperature | Default Tools | Description |
|---|---|---|---|
| `researcher` | 0.3 | web-search, knowledge-search | Deep research and information gathering |
| `writer` | 0.7 | file-write, knowledge-search | Content creation and drafting |
| `orchestrator` | 0.4 | send-message | Team coordination and task routing |
| `analyst` | 0.2 | database-query, knowledge-search | Data analysis and reporting |
| `customer-support` | 0.5 | send-message, knowledge-search | Customer interaction and issue resolution |
| `developer` | 0.2 | code-execute, file-write | Technical tasks and code-related work |
| `marketer` | 0.6 | web-search, send-message | Marketing strategy and campaigns |
| `finance` | 0.1 | database-query | Financial analysis and reporting |
| `monitor` | 0.2 | web-search | Watching for changes and alerting |
| `generalist` | 0.5 | knowledge-search | General-purpose agent |

---

## 10. Next Steps

You now have a running ABF project. Here is where to go next:

| Goal | Guide |
|---|---|
| Understand ABF's mental model | [Concepts](concepts.md) |
| Generate a custom agent team from a business plan | [Seed-to-Company Guide](guides/seed-to-company.md) |
| Deploy to production | [Self-Hosting Guide](self-hosting.md) |
| Build multi-agent workflows | Add a workflow: `abf workflow add --template sequential-pipeline --name my-flow` |
| Set up a business database | Add `datastore` config to `abf.config.yaml`, then `abf migrate` |
| Write a custom tool | Create `tools/my-tool.tool.yaml` + `tools/my-tool.tool.js` |
| Add shared knowledge | Drop `.md` files into the `knowledge/` directory |
| Monitor external URLs | Create `monitors/my-monitor.monitor.yaml` |
| Explore the API | [API Reference](api-reference.md) |

---

## Troubleshooting

### "Command not found: abf"

The CLI is not installed globally. Either install it:
```bash
npm install -g @abf/cli
```

Or use `npx`:
```bash
npx @abf/cli dev
```

### "No provider configured"

You need at least one LLM provider. Run `abf auth anthropic` (or `openai` / `ollama`) and enter your API key.

### Agent sessions fail with "model not found"

The agent YAML references a model that your configured provider does not support. Check the `provider` and `model` fields in the agent YAML match your configured provider.

### Port 3000 is already in use

Start on a different port:
```bash
abf dev --port 3001
```

### Dashboard shows no agents

Make sure you are in the project directory (the one containing `abf.config.yaml`) when running `abf dev`.
