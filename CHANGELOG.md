# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-03-01

### Added
- **Comprehensive security guide** (`docs/security.md`) — covers risks of autonomous agents, 9 protection mechanisms, deployment checklist, custom tool security, and incident response. Written for both technical and non-technical audiences.
- **ScopedVault** for custom tools — custom tools now receive a credential vault scoped to only the providers their tools need. A web-search tool cannot read Stripe API keys. Includes `TOOL_PROVIDER_MAP` and `deriveAllowedProviders()` utility.
- **Session abort propagation** — `AbortController` threaded through session manager → provider → SDK/fetch. Timeouts now cancel in-flight LLM API calls immediately instead of leaving orphaned requests. `executeStreaming()` now has timeout support matching `execute()`.
- **Code-execute sandboxing** — child processes run without `HOME` or `NODE_PATH` env vars, stdout/stderr capped at 10 MB, temp files written with `0o600` permissions. On Node.js 22+, `--experimental-permission` flags restrict filesystem and network access at the OS level.
- Dashboard search and filter controls across agent, escalation, and log views.
- CI audit step in GitHub Actions pipeline.

### Security
- **Path traversal** — agent YAML and tool file loading now validates paths stay within the project root.
- **SQL injection** — `database-query` and `database-write` tools use parameterized queries exclusively. DDL statements (DROP, ALTER, TRUNCATE) are blocked.
- **XSS** — Gateway HTML responses are escaped. Content-Security-Policy, X-Content-Type-Options, and X-Frame-Options headers added.
- **CSRF** — state-changing API endpoints require authentication token (not cookie-based).
- **Rate limiting** — global rate limiting on authentication endpoints (5 req / 15 min / IP) and general API routes.
- **CORS hardening** — warning logged when CORS is set to wildcard in production. Documentation updated with correct configuration.
- **Config backup** — `abf.config.yaml` is backed up before destructive operations.
- **Credential isolation** — custom tools can no longer read credentials outside their provider scope (ScopedVault).
- **Code execution sandbox** — `code-execute` tool child processes isolated from credentials and home directory.
- **Session abort** — timed-out sessions now cancel LLM API calls, preventing resource leaks and continued token consumption.

### Fixed
- Session timer leak — `clearTimeout` now called on all code paths, preventing timers from firing after session completion.
- Cron scheduling — scheduler caches parsed cron expressions, reducing per-tick overhead.
- Dispatcher — event-driven architecture replaces polling loop, reducing idle CPU usage.
- SSE delta updates — dashboard receives incremental state changes instead of full snapshots.
- Parallel config loading at startup — agent, team, and tool configs loaded concurrently.
- Parallel imports — dynamic imports in session manager and tool loader run concurrently.
- Async tool loader — tools loaded asynchronously without blocking the event loop.
- `executeStreaming()` timeout — streaming sessions now have the same timeout protection as `execute()`.

### Changed
- Dashboard UX improvements for operator adoption — clearer navigation, better empty states, improved error messages.
- Gateway status endpoint caches responses to reduce load under monitoring.
- Version badge updated to 1.1.0.

---

## [1.0.0] — 2026-02-26

### Added
- Custom tool execution: `.tool.js` files in the project `tools/` directory are loaded and executed at runtime. Handlers receive `(params, context)` and run in-process as operator-trusted code.
- SSE (Server-Sent Events) endpoint on the Gateway for real-time dashboard updates. Dashboard pages subscribe and reflect state changes without polling.
- `abf escalations` CLI command — lists open escalations with agent, reason, timestamp, and status. Supports `--follow` flag for live tailing.
- API reference documentation covering all 45+ Gateway routes, request/response shapes, and authentication requirements.
- `SECURITY.md` — vulnerability disclosure policy, response timelines, scope definition, and overview of the six security pillars.
- `CONTRIBUTING.md` — contributor setup guide, conventions, and instructions for adding archetypes, tools, templates, and custom tools.
- npm publish readiness: package.json `exports` maps, `files` field, `prepublishOnly` script, and package-level READMEs.
- CI/CD pipeline: GitHub Actions workflows for lint, test, build, and (on tag) publish to npm.

### Fixed
- Gateway route conflict between `/api/agents/:id` and `/api/agents/:id/inbox` — Hono route ordering corrected.
- `abf dev` emitting duplicate activation events when a monitor file was modified during a running session.
- Session manager double-counting inbox items when an agent both received a message and had a pending inbox task in the same session.
- Dashboard `/approvals` page not reflecting rejection state after a reject action without a full page reload.

### Changed
- `GET /api/metrics/agents` response now includes `lastSessionAt` (ISO timestamp) alongside existing fields.
- Credential vault path resolution updated to respect `ABF_VAULT_PATH` environment variable for containerized deployments.

---

## [0.3.0]

### Added
- **Redis/BullMQ message bus**: `ioredis`-backed bus with durable queues. Replaces in-process bus when `bus.backend: redis` is set in config. BullMQ handles retry, dead-letter, and priority queueing.
- **PostgreSQL + pgvector memory**: production memory backend using `pg`. Vector similarity search via `pgvector` extension for semantic knowledge retrieval. Activated with `memory.backend: postgres`.
- **Workflow runner**: executes multi-agent workflows defined in `workflows/*.workflow.yaml`. Supports sequential, parallel, and conditional steps with timeout and failure handling.
- **Workflow dashboard page**: visual flowchart of workflow steps with live execution state and step-level logs.
- **KPI dashboard page**: per-agent KPI tracking with target vs. actual gauges. Data sourced from `GET /api/metrics/kpis`.
- **Cloud deployment**: `abf deploy --target railway|render|fly` generates platform config and deploys. `railway.json` and `Dockerfile` included in repo.
- **Framework abstractions P0–P3** (10 features):
  - P0: Knowledge Base (`knowledge/` directory, `knowledge-search` tool), Approval Queue (`InMemoryApprovalStore`, dashboard approvals page, Gateway approval routes), Business Database (SQLite/Postgres datastore, `database-query` + `database-write` tools, `abf migrate` command)
  - P1: Role Archetypes (10 built-in types, `abf agent add --archetype`), Cross-Agent Memory / Outputs (`OutputsManager`, teammate outputs injected into session prompt), Agent Inbox (`InMemoryInbox`, priority sorting, dashboard send-task form)
  - P2: Metrics Dashboard (`MetricsCollector`, auto-refresh every 5s), Message Templates (`MessageTemplateRegistry`, `{{variable}}` syntax), Workflow Templates (3 built-ins: `fan-out-synthesize`, `sequential-pipeline`, `event-triggered`)
  - P3: External Monitoring (`MonitorRunner`, `monitors/*.monitor.yaml`, content-hash change detection, agent activation on change)
- **Seed-to-company pipeline**: parse seed document (`.docx`, `.pdf`, `.txt`, `.md`) → LLM analysis → `CompanyPlan` JSON → generate all project files. Includes `abf init --seed <file>` CLI flag.
- **Setup wizard** (Dashboard): 6-step onboarding covering provider selection, API key configuration, company type (interview / document / template), plan review with tool gap analysis, and project creation.
- **Interview engine**: stateful Q&A session that builds a seed document through 8–12 questions. Available via dashboard wizard or `POST /api/seed/interview/*` routes.
- **Company Architect meta-agent**: auto-injected into every seed-generated project. Weekly cron reviews `knowledge/seed.md` and reports coverage gaps, redundancies, and recommended changes for human approval.
- `abf setup` command for post-install credential and config initialization.
- `reschedule` tool and `HeartbeatTrigger` for agent self-rescheduling.

### Changed
- Scheduler migrated from `node-cron` to `croner` to fix DST-related missed fires.
- Memory reads parallelized using `Promise.all` — session context load time reduced by ~60% on large history files.
- `GET /api/agents` and `GET /api/teams` responses now include agent/team file paths for Dashboard linking.

### Security
- API authentication: `ABF_API_KEY` environment variable enables bearer token auth on all Gateway routes. Disabled by default for local dev.
- CORS restricted to configured `dashboard.origin` in production config.

---

## [0.2.0]

### Added
- **Next.js 14 dashboard**: 13 pages — overview, agents, agent detail, teams, escalations, approvals, workflows, metrics, logs, knowledge, settings, setup wizard, seed review.
- **Hono REST API**: 45 routes across agents, teams, bus, sessions, escalations, approvals, metrics, workflows, seed pipeline, and system management.
- **Messaging plugins**: Slack (Block Kit), Email (SMTP via Nodemailer), Discord (webhook). All implement the `IMessenger` interface. Push notifications route through configured messenger.
- **MCP tool integration**: `mcp-servers.yaml` in project root configures MCP server connections. Tools from connected servers are available to agents by slug.
- **Docker support**: `Dockerfile` (multi-stage, Node 20 Alpine) and `docker-compose.yml` for single-command production deployment.
- **Business templates**: `solo-founder`, `saas`, `marketing-agency` — complete pre-configured agent teams, knowledge files, and workflow stubs. `abf init --template <name>`.
- Gateway webhook endpoint: `POST /api/webhooks/:agentName` dispatches a manual activation with the request body as payload.
- `abf logs` command: streams or tails log files from `logs/sessions/`, `logs/bus/`, and `logs/escalations/`.

### Changed
- `abf init` now generates a `knowledge/` directory with starter `company.md` and `brand-voice.md` files.
- Session manager prompt structure reorganized — knowledge base and teammate outputs are clearly separated sections.

---

## [0.1.0]

### Added
- **Runtime**: single Node.js process with five components — Scheduler (cron triggers), Dispatcher (activation routing, session spawning), Session Manager (full work session lifecycle: load context, build prompt, execute, tool loop, write memory, check escalations, log), Message Bus (in-process, typed message routing), Gateway (HTTP server for webhooks, dashboard API, management API).
- **Provider plugins**: Anthropic (streaming via `@anthropic-ai/sdk`), OpenAI (streaming via `openai`), Ollama (fetch-based NDJSON streaming). All implement the `Provider` interface with `chat()`, `models()`, and `estimateCost()`.
- **CLI**: `abf init`, `abf dev`, `abf run <agent>`, `abf status`, `abf auth <provider>`, `abf logs`.
- **AES-256-GCM credential vault**: encrypted at `~/.abf/credentials.enc`. Credentials injected at session start, never written to disk unencrypted. Vault path overridable via `ABF_VAULT_PATH`.
- **Behavioral bounds enforcement**: `allowed_actions`, `forbidden_actions`, `requires_approval`, `max_cost_per_session`, and `max_external_requests` are enforced by the runtime before any action executes. The LLM cannot override bounds.
- **File-based memory**: agent charter (`memory/agents/<name>/charter.md`), append-only history (`memory/agents/<name>/history.md`), team decisions (`memory/decisions.md`), ephemeral session context.
- **Agent YAML format**: full schema including `role_archetype`, `provider`, `model`, `temperature`, `tools`, `triggers` (cron, message, webhook, manual), `escalation_rules`, `behavioral_bounds`, `kpis`, and inline `charter`.
- **Message bus schema**: `{ from, to, type, priority, context, payload, timestamp, deadline }`. Types: REQUEST, RESPONSE, ALERT, ESCALATION, STATUS, BROADCAST.
- Input pipeline for prompt injection defense: source tagging, content isolation, injection detection, output validation.

[1.1.0]: https://github.com/alexclowe/abf/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/alexclowe/abf/compare/v0.3.0...v1.0.0
[0.3.0]: https://github.com/alexclowe/abf/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/alexclowe/abf/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/alexclowe/abf/releases/tag/v0.1.0
