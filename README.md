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

## Documentation

### Start here

| | |
|---|---|
| **[Getting Started](docs/getting-started.md)** | Install ABF, create a project, run your first agent, and customize it. Takes 5 minutes. |
| **[Concepts](docs/concepts.md)** | Understand ABF's 6 primitives: Agents, Teams, Memory, Bus, Tools, and Triggers. |

### Build your business

| | |
|---|---|
| **[Seed-to-Company Guide](docs/guides/seed-to-company.md)** | Turn a business plan, pitch deck, or interview into a running agent team. |
| **[Security Guide](docs/security.md)** | Risks of autonomous agents, how ABF protects you, deployment checklist, and incident response. |

### Deploy and operate

| | |
|---|---|
| **[Self-Hosting Guide](docs/self-hosting.md)** | Deploy with Docker, Railway, Render, or Fly.io. Production configuration. |
| **[API Reference](docs/api-reference.md)** | All 45+ REST API endpoints with request/response shapes. |

### Contribute

| | |
|---|---|
| **[Contributing Guide](CONTRIBUTING.md)** | Developer setup, conventions, and how to add tools, archetypes, and templates. |
| **[Changelog](CHANGELOG.md)** | Release history. |
| **[Security Policy](SECURITY.md)** | Vulnerability reporting and disclosure process. |

---

## What You Can Build

ABF ships with 3 templates and can generate custom teams from any business description:

| Template | Agents | Use Case |
|---|---|---|
| **Solo Founder** | Compass (assistant), Scout (researcher), Scribe (writer) | One-person startup needing a virtual executive team |
| **SaaS Startup** | Atlas, Scout, Scribe, Signal, Herald | Early-stage SaaS with product and go-to-market teams |
| **Marketing Agency** | Director, Strategist, Copywriter, Analyst | Campaign planning, copywriting, and analytics |
| **Custom (Seed)** | AI-designed team | Any business: upload a plan or answer interview questions |

Have a business plan? Generate a custom team in one command:

```bash
abf init --seed ./my-business-plan.md
```

ABF accepts `.docx`, `.pdf`, `.txt`, and `.md` files. [Full Seed-to-Company guide](docs/guides/seed-to-company.md).

---

## How It Works

ABF is built on **6 primitives**: [Agents](docs/concepts.md) (autonomous workers with roles and tools), [Teams](docs/concepts.md) (agent groups with an orchestrator), [Memory](docs/concepts.md) (5-layer persistence from session to knowledge base), a [Message Bus](docs/concepts.md) (typed inter-agent communication), [Tools](docs/concepts.md) (30+ built-in, MCP servers, and custom `.tool.js`), and [Triggers](docs/concepts.md) (cron, event, message, webhook).

The runtime is a single Node.js process with five components:

```
  Scheduler ──> Dispatcher ──> Session Manager ──> Bus
                                    │                │
                                    v                v
                              Gateway (API)     Agents (YAML)
                              + Dashboard       + Memory (files)
                              + SSE events      + Providers (LLM)
```

**Scheduler** fires triggers. **Dispatcher** spawns work sessions. **Session Manager** runs an 8-step lifecycle: load context, build prompt, call LLM, execute tools, route messages, write memory, check escalations, log results. **Bus** routes inter-agent messages. **Gateway** serves the REST API, SSE events, webhooks, and Dashboard on a single port.

Read the [Concepts Guide](docs/concepts.md) for the full explanation.

---

## Security

Autonomous agents run with real credentials and take real actions. ABF is built for containment:

- **Behavioral bounds** enforced by the runtime (not the LLM) gate every action
- **Credential isolation** -- each tool only sees the API keys it needs ([ScopedVault](docs/security.md#2-credential-isolation))
- **Execution sandboxing** -- code runs without access to credentials or home directory
- **Approval queues** -- sensitive actions require human sign-off before executing
- **Prompt injection defense** -- source tagging, content isolation, and detection pipeline
- **Full audit trail** -- every session, tool call, message, and memory write is logged

No framework makes autonomous agents completely safe. The [Security Guide](docs/security.md) is transparent about what ABF protects against, what it cannot, and how to configure your deployment for safety. Required reading before going to production.

---

## Deployment

```bash
abf deploy --target railway    # or: render, fly
```

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy?repo=https://github.com/alexclowe/abf&branch=main&envs=ABF_VAULT_PASSWORD,ANTHROPIC_API_KEY&optionalEnvs=ANTHROPIC_API_KEY&ABF_VAULT_PASSWORDDesc=Encryption+password+for+credential+vault&ANTHROPIC_API_KEYDesc=Optional+Anthropic+API+key+(can+configure+later+via+dashboard))

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/alexclowe/abf)

Docker, Railway, Render, and Fly.io are all supported. See the [Self-Hosting Guide](docs/self-hosting.md) for production configuration including PostgreSQL, Redis, TLS, and API authentication.

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
