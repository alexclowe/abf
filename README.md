# ABF -- Agentic Business Framework

**The open-source framework for building companies that run on AI agents.**

<!-- badges -->
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)

---

## What is ABF?

ABF is a framework for building companies where AI agents *are* the employees. Not companies that bolt AI onto existing workflows -- companies where agents handle research, writing, customer support, finance, and operations autonomously. Agents have roles, tools, memory, behavioral bounds, and communicate through a shared message bus, just like a real team.

Think of it as WordPress for agentic businesses. Pick a template, configure your agents, and launch. A web dashboard lets non-technical operators manage everything visually. Developers get YAML-as-code agent definitions, a TypeScript SDK, CLI tooling, and full filesystem access. Every agent definition, memory file, and configuration is a plain file you can track in git.

ABF serves two users:

- **Operators** (non-technical): Interact entirely through a web Dashboard. Setup wizard, visual agent management, approval queues, metrics, one-click deployment. Never touch a config file.
- **Builders** (developers): Full filesystem access. YAML agent definitions, custom tools, MCP servers, TypeScript SDK. Use the Dashboard, CLI, and files together.

---

## Key Features

- **Multi-agent teams** -- Agents with roles, tools, memory, and triggers organized into teams with orchestrators. Agents communicate through a typed message bus.
- **Provider-agnostic LLM access** -- Anthropic, OpenAI, Google, Ollama, or any OpenAI-compatible endpoint. Mix providers per agent. Swap models with a config change.
- **Dashboard for operators** -- 11-page Next.js dashboard with setup wizard, agent management, workflow visualization, approval queues, metrics, KPI tracking, and logs.
- **YAML-as-code agent definitions** -- Every agent is a YAML file with an embedded charter. Git-trackable, diffable, reviewable.
- **Layered memory** -- Charter (identity), History (per-agent learnings, append-only), Decisions (team-wide), Knowledge (shared Markdown files), Session (ephemeral).
- **Inter-agent message bus** -- Typed messages (REQUEST, RESPONSE, ALERT, ESCALATION, STATUS, BROADCAST) with priority routing. Backends: in-process (default), Redis, BullMQ.
- **Security-first architecture** -- Behavioral bounds enforced by the runtime. Approval queues for sensitive actions. Full audit trail. Sandboxed tool execution.
- **Business database** -- Config-driven datastore (SQLite or PostgreSQL). Schema YAML files, numbered SQL migrations, query and write tools for agents.
- **Workflow orchestration** -- Multi-agent workflows defined in YAML. Sequential, parallel, and conditional steps with timeouts and failure handling.
- **External monitoring** -- Watch URLs for changes and trigger agents automatically. Configurable intervals, content hashing, event-based dispatch.
- **Knowledge base** -- Shared Markdown files in `knowledge/` injected into agent prompts. Searchable via the `knowledge-search` tool.
- **Role archetypes** -- 10 built-in archetypes (researcher, writer, orchestrator, analyst, customer-support, developer, marketer, finance, monitor, generalist) with sensible defaults.
- **3 starter templates** -- Solo Founder, SaaS Startup, and Marketing Agency. Full agent teams, ready to run.

---

## Quick Start

```bash
# Create a new project from a template
npx @abf/cli init --template solo-founder --name my-business
cd my-business

# Configure your LLM provider
abf auth anthropic   # or: openai, ollama

# Start the runtime
abf dev

# Dashboard opens at http://localhost:3001
# API available at http://localhost:3000
```

See the full [Quickstart Guide](docs/quickstart.md) for a detailed walkthrough.

---

## Architecture

ABF runs as a single Node.js process with five core components:

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

**Scheduler** fires cron and heartbeat triggers as activation events. **Dispatcher** receives activations and spawns work sessions. **Session Manager** loads agent context, calls the LLM, executes tools in a loop, writes memory, and logs results. **Bus** routes inter-agent messages and triggers message-based activations. **Gateway** serves the HTTP API, webhooks, and the Dashboard.

---

## Agent Definition Example

Every agent is defined in a single YAML file with an embedded charter:

```yaml
name: compass
display_name: Executive Assistant
role: Orchestrator
description: >
  Organizes the founder's day, routes research tasks to Scout
  and writing tasks to Scribe.
provider: anthropic
model: claude-sonnet-4-5
temperature: 0.4
team: founders
tools: [web-search]
triggers:
  - type: cron
    schedule: '0 9 * * 1-5'
    task: daily_briefing
  - type: manual
    task: daily_briefing
escalation_rules:
  - condition: requires_human_decision
    target: human
behavioral_bounds:
  allowed_actions: [read_data, write_draft, send_alert]
  forbidden_actions: [delete_data, modify_billing]
  max_cost_per_session: $2.00
  requires_approval: [send_client_email, publish_content]
kpis:
  - metric: tasks_delegated
    target: 100%
    review: daily
charter: |
  # Compass -- Executive Assistant

  You are Compass, the Executive Assistant and orchestrator
  for this founder's workspace.

  ## Your Purpose
  Keep the founder focused on what matters most. Each morning
  you deliver a concise daily briefing: what needs attention,
  what Scout has researched, what Scribe has drafted.
  ...
```

---

## Directory Structure

Every ABF project follows this layout:

```
my-business/
├── abf.config.yaml              # Global configuration
├── agents/                       # Agent definitions (*.agent.yaml)
│   ├── compass.agent.yaml
│   ├── scout.agent.yaml
│   └── scribe.agent.yaml
├── teams/                        # Team definitions (*.team.yaml)
│   └── founders.team.yaml
├── tools/                        # Custom tools + MCP configs
│   ├── mcp-servers.yaml
│   └── custom-tool.tool.ts
├── memory/                       # Persistent agent memory
│   ├── agents/{name}/charter.md, history.md
│   ├── decisions.md
│   └── knowledge/
├── knowledge/                    # Shared knowledge base (*.md)
│   ├── company.md
│   └── brand-voice.md
├── outputs/                      # Cross-agent session outputs
│   └── {agentName}/
├── datastore/                    # Business database
│   ├── schemas/                  # *.schema.yaml table definitions
│   └── migrations/               # Numbered *.sql migrations
├── workflows/                    # Multi-agent workflows (*.workflow.yaml)
├── monitors/                     # External URL monitors (*.monitor.yaml)
├── templates/messages/           # Message templates (*.template.yaml)
├── logs/                         # Audit trail
│   ├── bus/
│   ├── sessions/
│   └── escalations/
└── docker-compose.yml            # Docker deployment
```

---

## Templates

ABF ships with three starter templates. Each generates a complete project with agents, teams, memory files, knowledge base, and Docker configuration.

| Template | Command | Agents | Teams | Use Case |
|---|---|---|---|---|
| **Solo Founder** | `--template solo-founder` | 3 (compass, scout, scribe) | 1 | Individual founders needing an executive assistant, researcher, and writer |
| **SaaS Startup** | `--template saas` | 5 (atlas, scout, scribe, signal, herald) | 2 | Early-stage SaaS with product and go-to-market teams |
| **Marketing Agency** | `--template marketing-agency` | 4 (director, strategist, copywriter, analyst) | 1 | Marketing agencies with campaign planning, copywriting, and analytics |

---

## Dashboard

The ABF Dashboard is a Next.js application that provides a visual interface for operators. Pages include:

- **Overview** -- System status at a glance
- **Agents** -- View, configure, and trigger agents; send tasks to agent inboxes
- **Teams** -- Team composition and orchestrator relationships
- **Workflows** -- Visual workflow management
- **Approvals** -- Review and approve/reject queued agent actions
- **Escalations** -- Human-in-the-loop escalation handling
- **Metrics** -- Runtime metrics with auto-refresh
- **KPIs** -- Agent performance tracking
- **Providers** -- LLM provider configuration
- **Logs** -- Session and audit logs
- **Setup** -- Visual setup wizard for first-time configuration

The Dashboard connects to the Gateway API (default port 3000) and runs on port 3001 in development.

---

## CLI Commands

| Command | Description |
|---|---|
| `abf init` | Initialize a new ABF project (with `--template` and `--name` options) |
| `abf dev` | Start the runtime in development mode (with `--port` for gateway port) |
| `abf run <agent>` | Manually trigger an agent (with `--task` option) |
| `abf status` | Show agent and system status (with `--verbose` for details) |
| `abf auth [provider]` | Manage LLM provider credentials (`--list`, `--remove`) |
| `abf logs` | View agent session logs (`--agent`, `--lines`) |
| `abf setup` | Open the visual setup wizard in your browser |
| `abf migrate` | Run datastore schema and SQL migrations |
| `abf agent add` | Scaffold a new agent (`--name`, `--archetype`, `--team`) |
| `abf workflow add` | Scaffold a workflow from a template (`--template`, `--name`) |
| `abf deploy` | Generate cloud deployment config (`--target railway\|render\|fly`) |

---

## Security

ABF is built on six security pillars:

1. **Least Privilege** -- Agents start with zero permissions. Access is explicitly granted per-agent in the YAML definition.
2. **Sandboxed Execution** -- Every tool call runs in isolation. No shell access, no eval, no arbitrary code execution.
3. **Managed Tools** -- Agents cannot install tools at runtime. The tool surface is locked and operator-approved.
4. **Behavioral Bounds** -- Enforced by the runtime, not the LLM. Allowed/forbidden actions, cost limits, and approval requirements are checked before execution.
5. **Memory Integrity** -- Append-only history files with checksums. Anomaly detection and snapshot rollback.
6. **Audit Trail** -- Every session, tool call, message, memory write, and escalation is logged. Immutable retention.

Additional defenses include input source tagging, content isolation for external data, injection detection, and output validation against behavioral bounds.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js / TypeScript |
| Dashboard | React / Next.js |
| Default storage | Filesystem (Markdown files) |
| Production storage | PostgreSQL + pgvector |
| Message bus | In-process (default), Redis / BullMQ |
| LLM providers | Anthropic, OpenAI, Google, Ollama, any OpenAI-compatible |
| Build system | pnpm workspaces + Turborepo |
| API server | Hono |

---

## Deployment

ABF supports multiple deployment targets:

- **Local development**: `abf dev` -- filesystem storage, hot-reload
- **Docker**: `docker compose up` -- single container, production-ready
- **Railway**: `abf deploy --target railway` -- one-click deploy with Postgres + Redis
- **Render**: `abf deploy --target render`
- **Fly.io**: `abf deploy --target fly`

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy?repo=https://github.com/your-org/abf&branch=main)

See the [deployment guide](docs/deployment.md) for detailed instructions.

---

## Contributing

Contributions are welcome. To get started:

```bash
# Clone the repository
git clone https://github.com/your-org/abf.git
cd abf

# Install dependencies (requires pnpm 10+)
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

The project uses a monorepo structure with three packages:

- `packages/core` -- Runtime, providers, tools, memory, bus, schemas
- `packages/cli` -- CLI application and project templates
- `packages/dashboard` -- Next.js dashboard application

Please open an issue before starting work on large changes.

---

## License

MIT
