# ABF -- Agentic Business Framework

**Build companies that run on AI agents.** Not companies that use AI -- companies where agents ARE the employees.

<!-- badges -->
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)
![v1.1.0](https://img.shields.io/badge/version-1.1.0-brightgreen.svg)

```bash
npx @abf/cli init --template solo-founder --name my-business
cd my-business
abf auth anthropic
abf dev
# Open http://localhost:3000
```

Three agents are now running: an executive assistant, a researcher, and a content writer -- coordinating through a message bus, sharing memory, and reporting to you through a web dashboard. That took under 2 minutes.

---

## Why ABF?

Most AI agent frameworks are developer tools. ABF is a business-building framework. The difference:

- **Describe your business, get an agent team.** ABF's Seed-to-Company pipeline reads your business plan (or interviews you about your idea) and generates a complete agent team -- roles, tools, knowledge base, workflows, and project structure. No configuration required.
- **Two users, one framework.** Operators manage agents through a visual Dashboard. Builders work in YAML, TypeScript, and the CLI. Both see the same system.
- **Files are the API.** Every agent definition, memory file, and configuration is a plain file (YAML, Markdown, JSON). Version control, code review, and diffing work out of the box.
- **Security is structural, not optional.** Behavioral bounds are enforced by the runtime, not the LLM. Agents cannot bypass their permissions. Approval queues gate sensitive actions. Everything is audited.

---

## What You Can Build

ABF ships with 3 templates and can generate custom teams from any business description:

| Template | Agents | Use Case |
|---|---|---|
| **Solo Founder** | Compass (assistant), Scout (researcher), Scribe (writer) | One-person startup needing a virtual executive team |
| **SaaS Startup** | Atlas, Scout, Scribe, Signal, Herald | Early-stage SaaS with product and go-to-market teams |
| **Marketing Agency** | Director, Strategist, Copywriter, Analyst | Campaign planning, copywriting, and analytics |
| **Custom (Seed)** | AI-designed team | Any business: upload a plan or answer interview questions |

---

## Core Concepts

ABF is built on 6 primitives:

```
  Agent          Team           Memory          Bus            Tools          Triggers
  ------         ------         ------          ------         ------         ------
  Role +         Group of       Charter +       Inter-agent    Builtin +      Cron,
  charter +      agents with    history +       typed          MCP +          event,
  tools +        orchestrator   decisions +     messages       custom         message,
  bounds                        knowledge                      (.tool.js)     webhook
```

- **Agent** -- Autonomous worker defined in YAML. Has a role, tools, memory, triggers, and behavioral bounds.
- **Team** -- Group of agents under an orchestrator. Maps to business functions.
- **Memory** -- 5 layers: Charter (identity), History (learnings), Decisions (team-wide), Knowledge (shared Markdown files), Session (ephemeral).
- **Message Bus** -- Typed messages (REQUEST, RESPONSE, ALERT, ESCALATION, STATUS, BROADCAST) with priority routing. Scales from in-process to Redis/BullMQ.
- **Tools** -- 30+ built-in tools, MCP server integration, and custom `.tool.js` handlers.
- **Triggers** -- What activates agents: cron schedules, events, messages from other agents, webhooks, or manual invocation.

Read the full [Concepts Guide](docs/concepts.md) for a detailed explanation of each primitive.

---

## Architecture

ABF runs as a single Node.js process with five components:

```
                        +------------------+
                        |    Scheduler     |  Cron + heartbeat triggers
                        +--------+---------+
                                 |
                                 v
+-----------+           +--------+---------+           +-----------+
|           |           |                  |           |           |
|  Agents   +---------->+   Dispatcher     +---------->+   Bus     |
|  (YAML)   |           |                  |           | (messages)|
|           |           +--------+---------+           |           |
+-----------+                    |                     +-----+-----+
                                 v                           |
+-----------+           +--------+---------+                 |
|           |           |                  |                 |
|  Memory   +<----------+ Session Manager  +<----------------+
|  (files)  |           |                  |
|           |           +--------+---------+
+-----------+                    |
                                 v
+-----------+           +--------+---------+
|           |           |                  |
|Providers  +<----------+    Gateway       +-------> HTTP API + Dashboard
|(LLM APIs) |           |    (Hono)        |
|           |           +------------------+
+-----------+
```

**Scheduler** fires cron and heartbeat triggers. **Dispatcher** spawns work sessions. **Session Manager** loads context, calls the LLM, executes tools, writes memory, and logs results. **Bus** routes inter-agent messages. **Gateway** serves the REST API, SSE events, webhooks, and the Dashboard -- all on a single port.

---

## Getting Started

### From a Template

```bash
# Install the CLI
npm install -g @abf/cli

# Create a project (solo-founder, saas, or marketing-agency)
abf init --template solo-founder --name my-business
cd my-business

# Add your LLM provider credentials
abf auth anthropic   # or: openai, ollama

# Start the runtime
abf dev

# Open http://localhost:3000 for the Dashboard
```

### From a Business Plan

Have a business plan, pitch deck, or company description? ABF generates a custom agent team from it:

```bash
abf init --seed ./my-business-plan.md
```

ABF accepts `.docx`, `.pdf`, `.txt`, and `.md` files. It parses the document, analyzes it with an LLM, and generates agents, teams, knowledge files, and workflows tailored to your specific business. [Full guide](docs/guides/seed-to-company.md).

### From the Dashboard

Run `abf setup` to open the setup wizard in your browser. It walks you through provider configuration, lets you choose between starting from an idea (interactive interview), uploading a business plan, or picking a template -- all visually.

---

## Agent Definition

Every agent is a single YAML file:

```yaml
name: scout
display_name: Research Analyst
role: Researcher
description: Conducts market research and competitive analysis.
provider: anthropic
model: claude-sonnet-4-6
temperature: 0.3
team: founders
reports_to: compass
tools: [web-search, knowledge-search, file-write]
triggers:
  - type: cron
    schedule: '0 */4 * * *'
    task: research_scan
  - type: message
    from: compass
    task: on_demand_research
  - type: manual
    task: research_scan
escalation_rules:
  - condition: requires_human_decision
    target: human
behavioral_bounds:
  allowed_actions: [read_data, write_report, send_alert]
  forbidden_actions: [delete_data, modify_billing]
  max_cost_per_session: $1.00
  requires_approval: [publish_content]
kpis:
  - metric: research_quality
    target: 90%
    review: weekly
charter: |
  # Scout -- Research Analyst
  You are Scout, the Research Analyst for this team.
  ...
```

---

## Project Structure

```
my-business/
+-- abf.config.yaml              # Global configuration
+-- agents/                       # Agent definitions (*.agent.yaml)
+-- teams/                        # Team definitions (*.team.yaml)
+-- tools/                        # Custom tools + MCP configs
+-- memory/                       # Persistent agent memory
|   +-- agents/{name}/            # Per-agent charter.md + history.md
|   +-- decisions.md              # Team-wide decision log
+-- knowledge/                    # Shared knowledge base (*.md)
+-- outputs/                      # Cross-agent session outputs
+-- datastore/                    # Business database (schemas + migrations)
+-- workflows/                    # Multi-agent workflows (*.workflow.yaml)
+-- monitors/                     # External URL monitors (*.monitor.yaml)
+-- templates/messages/           # Message templates
+-- logs/                         # Audit trail
+-- docker-compose.yml            # Docker deployment
```

---

## Dashboard

The Dashboard is a Next.js application served on port 3000 alongside the API:

- **Overview** -- System status, active agents, recent sessions
- **Agents** -- View, configure, trigger agents, send tasks to inboxes
- **Teams** -- Team composition and orchestrator relationships
- **Workflows** -- Visual workflow management
- **Approvals** -- Review and approve/reject queued agent actions
- **Escalations** -- Human-in-the-loop escalation handling
- **Metrics** -- Runtime metrics with auto-refresh
- **KPIs** -- Agent performance tracking
- **Logs** -- Session and audit logs
- **Setup** -- 6-step wizard: provider, API key, company type, seed/template, plan review, create

---

## CLI Reference

| Command | Description |
|---|---|
| `abf init` | Create a new project (`--template`, `--name`, `--seed`) |
| `abf dev` | Start the runtime (`--port` to change gateway port) |
| `abf run <agent>` | Manually trigger an agent (`--task` for specific task) |
| `abf status` | Show agent and system status (`--verbose`) |
| `abf auth [provider]` | Manage LLM credentials (`--list`, `--remove`) |
| `abf logs` | View session logs (`--agent`, `--lines`) |
| `abf escalations` | List open escalations (`--follow` for live tailing) |
| `abf setup` | Open the setup wizard in your browser |
| `abf migrate` | Run datastore schema and SQL migrations |
| `abf agent add` | Scaffold a new agent (`--name`, `--archetype`, `--team`) |
| `abf workflow add` | Scaffold a workflow (`--template`, `--name`) |
| `abf deploy` | Generate deployment config (`--target railway\|render\|fly`) |

---

## Security

ABF is built on six security pillars:

1. **Least Privilege** -- Agents start with zero permissions. Access is explicitly granted per-agent.
2. **Sandboxed Execution** -- Tool calls run in isolation. No shell, no eval.
3. **Managed Tools** -- Agents cannot install tools at runtime. Operator-approved only.
4. **Behavioral Bounds** -- Enforced by the runtime, not the LLM. Cost limits, action restrictions, and approval requirements are checked before execution.
5. **Memory Integrity** -- Append-only history with checksums and anomaly detection.
6. **Audit Trail** -- Every session, tool call, message, and memory write is logged immutably.

Additional defenses: input source tagging, content isolation for external data, prompt injection detection, and output validation against behavioral bounds. Read the full [Security Guide](docs/security.md) for deployment checklists, risk assessment, and incident response. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js / TypeScript |
| Dashboard | React / Next.js 15 |
| Default storage | Filesystem (Markdown files) |
| Production storage | PostgreSQL + pgvector |
| Message bus | In-process (default), Redis / BullMQ |
| LLM providers | Anthropic, OpenAI, Google, Ollama, any OpenAI-compatible |
| Build system | pnpm workspaces + Turborepo |
| API server | Hono |

---

## Deployment

- **Local**: `abf dev` -- filesystem storage, hot-reload
- **Docker**: `docker compose up` -- single container, production-ready
- **Railway**: `abf deploy --target railway` -- one-click with Postgres + Redis
- **Render**: `abf deploy --target render`
- **Fly.io**: `abf deploy --target fly`

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy?repo=https://github.com/alexclowe/abf&branch=main&envs=ABF_VAULT_PASSWORD,ANTHROPIC_API_KEY&optionalEnvs=ANTHROPIC_API_KEY&ABF_VAULT_PASSWORDDesc=Encryption+password+for+credential+vault&ANTHROPIC_API_KEYDesc=Optional+Anthropic+API+key+(can+configure+later+via+dashboard))

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/alexclowe/abf)

See the [Self-Hosting Guide](docs/self-hosting.md) for detailed instructions.

---

## Documentation

| Document | Description |
|---|---|
| [Getting Started](docs/getting-started.md) | Install, create a project, run your first agent |
| [Concepts](docs/concepts.md) | The 6 core primitives explained |
| [Seed-to-Company Guide](docs/guides/seed-to-company.md) | Turn a business plan into a running agent team |
| [Self-Hosting Guide](docs/self-hosting.md) | Deploy with Docker, Railway, Render, or Fly.io |
| [API Reference](docs/api-reference.md) | All 45+ REST API endpoints |
| [Security Guide](docs/security.md) | Risks, protections, deployment checklist, incident response |
| [Contributing](CONTRIBUTING.md) | Developer setup and contribution guide |
| [Changelog](CHANGELOG.md) | Release history |
| [Security Policy](SECURITY.md) | Vulnerability disclosure policy |

---

## Contributing

```bash
git clone https://github.com/alexclowe/abf.git
cd abf
pnpm install    # requires pnpm 10+
pnpm build
pnpm test
```

The monorepo has three packages: `packages/core` (runtime, providers, tools), `packages/cli` (CLI and templates), and `packages/dashboard` (Next.js dashboard). See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and guidelines.

---

## License

MIT
