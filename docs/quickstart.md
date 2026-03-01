# ABF Quickstart Guide

> **Note**: This page has been superseded by the [Getting Started Guide](getting-started.md), which is more comprehensive and up to date. This page is kept for existing links.

This guide walks you through creating your first ABF project, configuring an LLM provider, running your agents, and understanding what happens under the hood.

---

## Prerequisites

- **Node.js 20 or later** -- Check with `node --version`
- **pnpm 10 or later** -- Install with `npm install -g pnpm` if needed
- An API key for at least one LLM provider (Anthropic, OpenAI, or a running Ollama instance)

---

## 1. Install ABF

Install the CLI globally:

```bash
npm install -g @abf/cli
```

Verify the installation:

```bash
abf --version
```

You should see output like:

```
1.0.0
```

---

## 2. Create a Project

ABF ships with three templates. For this guide, we will use the **Solo Founder** template, which creates three agents: Compass (executive assistant), Scout (researcher), and Scribe (content writer).

```bash
abf init --template solo-founder --name my-business
```

Expected output:

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

Move into the project directory:

```bash
cd my-business
```

### Alternative: Create from a Seed Document

If you have a business plan, pitch deck, or company description document, ABF can generate a custom agent team tailored to your business:

```bash
abf init --seed ./my-business-plan.md
```

ABF accepts `.docx`, `.pdf`, `.txt`, and `.md` files. The pipeline:

1. **Parses** the document (extracts text from any format)
2. **Analyzes** it with an LLM to design the optimal agent team
3. **Generates** agents, teams, knowledge base, workflows, and project structure
4. **Identifies tool gaps** -- capabilities your business needs that require custom tools

Example output:

```
Seed document loaded (1,847 words)
  PickleCoachAI is a digital coaching platform that uses AI...

Analyzing seed document with anthropic/claude-sonnet-4-5...
Company plan generated

  Company: PickleCoachAI
  Agents: 7 (head-coach, scout, content-creator, community-manager, performance-analyst, support-agent, architect)
  Teams: 2 (coaching, operations)
  Knowledge files: 4
  Tool gaps: 2 (Video analysis platform, Payment processing integration)

Creating project: picklecoachai
Project created: /home/user/picklecoachai

  7 agents across 2 teams:
    coaching: head-coach (orchestrator), scout, content-creator, community-manager
    operations: performance-analyst, support-agent, architect

  2 tool gaps identified (see knowledge/tool-gaps.md):
    • Video analysis platform (required)
    • Payment processing integration (important)

  Next steps:
    cd picklecoachai
    abf status                  Verify agents loaded
    abf dev                     Start the runtime
```

The generated project includes a **Company Architect** meta-agent that runs weekly self-assessments, comparing your seed document against the current agent team to identify coverage gaps and recommend improvements.

---

## 3. Explore the Project Structure

Your project now looks like this:

```
my-business/
├── abf.config.yaml          # Global configuration
├── agents/
│   ├── compass.agent.yaml   # Executive assistant / orchestrator
│   ├── scout.agent.yaml     # Research analyst
│   └── scribe.agent.yaml    # Content writer
├── teams/
│   └── founders.team.yaml   # Team definition
├── memory/
│   └── decisions.md         # Team-wide decision log
├── knowledge/
│   ├── company.md           # Company context for agents
│   └── brand-voice.md       # Brand voice guidelines
├── docker-compose.yml       # Docker deployment config
└── README.md
```

Key files:

- **`abf.config.yaml`** -- Global settings: storage backend, bus backend, security flags, gateway port, logging level.
- **`agents/*.agent.yaml`** -- Each agent's definition: name, role, model, tools, triggers, behavioral bounds, KPIs, and charter.
- **`teams/*.team.yaml`** -- Team composition and orchestrator assignment.
- **`knowledge/*.md`** -- Shared Markdown files injected into every agent's prompt.

---

## 4. Configure an LLM Provider

ABF needs access to at least one LLM provider. The default templates use Anthropic (Claude), but you can switch to OpenAI or Ollama.

### Option A: Anthropic (recommended for templates)

```bash
abf auth anthropic
```

You will be prompted for your API key:

```
Enter your Anthropic API key: sk-ant-...
Credential stored securely.
```

### Option B: OpenAI

```bash
abf auth openai
```

After adding the key, edit each agent's YAML file to use OpenAI:

```yaml
provider: openai
model: gpt-4o
```

### Option C: Ollama (local, no API key needed)

Start Ollama on your machine, then:

```bash
abf auth ollama
```

Edit each agent's YAML file:

```yaml
provider: ollama
model: llama3
```

### Verify configured providers

```bash
abf auth --list
```

```
Configured providers:
  anthropic  ✓
```

---

## 5. Start the Runtime

Launch ABF in development mode:

```bash
abf dev
```

You will see output similar to:

```
ABF runtime starting...
  Loaded 3 agents: compass, scout, scribe
  Loaded 1 team: founders
  Gateway listening on http://localhost:3000
  Scheduler started (2 cron triggers registered)
  Dashboard available at http://localhost:3001
```

The runtime is now running. It will:

- Start the **Scheduler**, which fires cron and heartbeat triggers
- Initialize the **Dispatcher** to handle agent activations
- Launch the **Gateway** HTTP server on port 3000
- Serve the **Dashboard** on port 3001
- Begin monitoring for events and messages

Leave this terminal running.

---

## 6. Open the Dashboard

Open your browser to:

```
http://localhost:3001
```

You will see the ABF Dashboard with:

- **Overview** -- System status, active agents, recent sessions
- **Agents** -- List of your three agents with status indicators
- **Teams** -- The "founders" team with Compass as orchestrator

Click on an agent to see its details: charter, configuration, KPIs, and an inbox form to send tasks.

If you created your project from a seed document, the Dashboard shows all your generated agents with their auto-created charters, KPIs, and team assignments.

---

## 7. Run Your First Agent

You can trigger an agent in two ways.

### From the CLI

Open a second terminal and run:

```bash
abf run compass --task daily_briefing
```

This manually triggers Compass to execute its `daily_briefing` task. You will see the session output in your terminal.

### From the Dashboard

1. Go to the **Agents** page
2. Click on **Compass**
3. Use the "Send Task to Inbox" form
4. Type a task like "Give me a briefing on today's priorities" and submit

The agent will pick up the task on its next activation.

---

## 8. Understanding What Happened

After an agent runs a session, several things are written to disk.

### Session Logs

Check the logs directory:

```bash
abf logs --agent compass
```

This shows the session log: what the agent was asked, what tools it called, what it responded, and the cost.

### Memory

After a session, the agent appends learnings to its history file:

```
memory/agents/compass/history.md
```

This file grows over time as the agent accumulates context. The charter file at `memory/agents/compass/charter.md` contains the agent's identity and is read-only during sessions.

### Outputs

Session outputs are written to:

```
outputs/compass/
```

Each file is a timestamped Markdown file with the session's results. Teammate agents can read these outputs -- Compass can see what Scout and Scribe produced, and vice versa.

### Decisions

Team-wide decisions are logged in:

```
memory/decisions.md
```

---

## 9. Customize an Agent

Open an agent definition to modify its behavior:

```bash
# Open in your editor
$EDITOR agents/scout.agent.yaml
```

Common customizations:

### Change the model

```yaml
provider: openai
model: gpt-4o
temperature: 0.3
```

### Adjust triggers

Add a new trigger so Scout runs every 4 hours:

```yaml
triggers:
  - type: cron
    schedule: '0 */4 * * *'
    task: research_scan
  - type: message
    from: compass
    task: on_demand_research
  - type: manual
    task: research_scan
```

### Modify behavioral bounds

Restrict or expand what the agent can do:

```yaml
behavioral_bounds:
  allowed_actions: [read_data, write_report, send_alert]
  forbidden_actions: [delete_data, modify_billing, access_credentials]
  max_cost_per_session: $1.00
  requires_approval: [publish_content]
```

### Update the charter

The charter is the agent's identity and instructions. Edit the `charter` field in the YAML to change how the agent thinks and responds.

After editing, restart the runtime (`Ctrl+C` and `abf dev` again) to pick up changes.

---

## 10. Add a New Agent

Use the CLI to scaffold a new agent from a built-in archetype:

```bash
abf agent add --name analyst --archetype analyst --team founders
```

This creates `agents/analyst.agent.yaml` with sensible defaults for an analyst role: lower temperature, analytical tools, and a starter charter.

Available archetypes:

| Archetype | Description |
|---|---|
| `researcher` | Deep research and information gathering |
| `writer` | Content creation and drafting |
| `orchestrator` | Team coordination and task routing |
| `analyst` | Data analysis and reporting |
| `customer-support` | Customer interaction and issue resolution |
| `developer` | Technical tasks and code-related work |
| `marketer` | Marketing strategy and campaigns |
| `finance` | Financial analysis and reporting |
| `monitor` | Watching for changes and alerting |
| `generalist` | General-purpose agent |

After creating the agent, edit the YAML file to customize its charter, tools, and triggers for your specific needs.

---

## 10b. Use the Interactive Interview

If you don't have a business plan document, ABF can interview you to build one. From the Dashboard setup wizard:

1. Choose your AI provider and enter your API key
2. Select **"Start a new company from an idea"**
3. Answer 8-12 questions about your business -- vision, customers, revenue model, operations, metrics, brand voice
4. Review the generated company plan -- agents, teams, knowledge, tool gaps
5. Click **Create Project**

The interview generates a comprehensive seed document (800-2000 words) that feeds into the same analyzer pipeline as `--seed`. You can also access the interview via the API:

```bash
# Start an interview
curl -X POST http://localhost:3000/api/seed/interview/start \
  -H 'Content-Type: application/json' \
  -d '{"companyType": "new"}'

# Answer questions
curl -X POST http://localhost:3000/api/seed/interview/{sessionId}/respond \
  -H 'Content-Type: application/json' \
  -d '{"answer": "We are building a SaaS platform for..."}'
```

### Re-analyzing After Changes

If your business plan evolves, update your seed document and re-analyze:

```bash
# Via the API
curl -X POST http://localhost:3000/api/seed/reanalyze \
  -H 'Content-Type: application/json' \
  -d '{
    "originalSeedText": "...",
    "updatedSeedText": "...",
    "currentPlan": { ... }
  }'
```

The re-analyzer focuses on the delta -- it preserves existing agents and only adds, removes, or modifies what changed. The seed version number increments with each re-analysis.

---

## 11. Next Steps

### Add a workflow

Workflows coordinate multiple agents in sequence or parallel:

```bash
abf workflow add --template sequential-pipeline --name content-pipeline
```

This creates `workflows/content-pipeline.workflow.yaml`. Edit it to define steps where Scout researches, then Scribe writes based on Scout's output.

Available workflow templates: `fan-out-synthesize`, `sequential-pipeline`, `event-triggered`.

### Set up the knowledge base

Add Markdown files to the `knowledge/` directory. These are automatically loaded and injected into every agent's prompt:

```bash
echo "# Product Roadmap\n\n- Q1: Launch MVP\n- Q2: Add integrations" > knowledge/roadmap.md
```

Agents can also search the knowledge base using the `knowledge-search` tool.

### Configure a business database

Add a datastore to your config for agents to read and write structured data:

```yaml
# In abf.config.yaml
datastore:
  backend: sqlite
  sqlite_path: ./datastore/business.db
  schemas_dir: ./datastore/schemas
  migrations_dir: ./datastore/migrations
```

Create schema files in `datastore/schemas/` and run migrations:

```bash
abf migrate
```

Agents can then use the `database-query` and `database-write` tools.

### Set up external monitoring

Create a monitor to watch a URL and trigger an agent when content changes:

```yaml
# monitors/competitor-pricing.monitor.yaml
name: competitor-pricing
url: https://competitor.example.com/pricing
interval: 1h
agent: scout
task: analyze_pricing_change
```

The monitor checks the URL at the specified interval and dispatches an activation to the named agent when the page content changes.

### Deploy to production

Generate deployment configuration for your preferred platform:

```bash
abf deploy --target railway
```

This creates the necessary configuration files (Dockerfile, Procfile, or platform-specific configs) for one-click deployment. See the [deployment guide](deployment.md) for detailed instructions on Railway, Render, and Fly.io.

### Use the setup wizard

For a visual configuration experience, run:

```bash
abf setup
```

This opens the Dashboard's setup wizard in your browser, where you can configure providers, agents, and teams through a guided interface.

---

## Reference

- [CLAUDE.md](../CLAUDE.md) -- Complete framework documentation
- [Deployment Guide](deployment.md) -- Production deployment instructions
- [CLI help](https://github.com/your-org/abf) -- Run `abf --help` for all commands
- [Seed-to-Company Pipeline](../CLAUDE.md#seed-to-company-pipeline) -- How the analyzer, interview engine, and applicator work
