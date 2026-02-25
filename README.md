# ABF — Agentic Business Framework

An open-source framework for building companies that run on AI agents. Not companies that *use* AI — companies where agents **are** the employees. Think WordPress for agentic businesses: templates, customization, and a dashboard that lets anyone stand up and run an AI-powered company.

## Deploy in One Click

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy?repo=https://github.com/your-org/abf&branch=main)

Runs ABF with Postgres + Redis in ~2 minutes. See [deployment guide](docs/deployment.md) for other platforms.

## Two Users

- **Operators** (non-technical): Interact entirely through a web Dashboard. Setup wizard, visual agent management, one-click everything.
- **Builders** (developers): Full filesystem access. YAML agent definitions, custom tools, MCP servers, TypeScript SDK.

## Core Primitives

| Primitive | Description |
|-----------|-------------|
| **Agent** | Autonomous worker with role, tools, memory, triggers |
| **Team** | Group of agents under an orchestrator |
| **Memory** | Layered: Charter, History, Decisions, Knowledge, Session |
| **Message Bus** | Inter-agent communication (in-process, Redis, BullMQ) |
| **Tools** | Agent capabilities: ABF Registry, MCP Servers, Custom |
| **Triggers** | What activates agents: cron, event, message, webhook, manual |

## Quick Start

```bash
# Install
pnpm install

# Build
pnpm build

# Start the runtime (filesystem mode, hot-reload)
pnpm --filter @abf/cli dev
```

## Project Structure

```
my-business/
├── abf.config.yaml          # Global config
├── agents/                   # Agent definitions (YAML + charter)
├── teams/                    # Team definitions
├── tools/                    # Custom tools + MCP configs
├── memory/                   # Persistent agent memory
├── workflows/                # Multi-agent workflow definitions
├── logs/                     # Audit trail
└── templates/                # Business templates
```

## Tech Stack

- **Runtime**: Node.js / TypeScript
- **Dashboard**: React (Next.js)
- **Storage**: Filesystem (default) or PostgreSQL + pgvector
- **Message Bus**: In-process (default) or Redis / BullMQ
- **LLM**: Provider-agnostic (Anthropic, OpenAI, Google, Ollama, any OpenAI-compatible)

## Deployment

ABF runs as a persistent Node.js server. It supports Railway (recommended), Render, Fly.io, Docker, and any platform that runs long-lived processes.

See the full [deployment guide](docs/deployment.md) for step-by-step instructions.

## License

MIT
