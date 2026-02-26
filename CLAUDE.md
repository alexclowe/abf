# ABF — Agentic Business Framework

## What This Is
ABF is an open-source framework for building companies that run on AI agents. Not companies that use AI — companies where agents ARE the employees. Think Wordpress for agentic businesses: templates, customization, and a dashboard that lets anyone (technical or not) stand up and run an AI-powered company.

## Two Users
- **Operators** (non-technical): Interact entirely through a web Dashboard. Setup wizard, visual agent management, one-click everything. Never touch a config file.
- **Builders** (developers): Full filesystem access. YAML agent definitions, custom tools, MCP servers, TypeScript SDK. Dashboard + CLI + files.

## Core Abstractions (6 primitives)
1. **Agent** — Autonomous worker with role, tools, memory, triggers. Defined in YAML + Markdown charter.
2. **Team** — Group of agents under an orchestrator. Maps to business functions (Product, GTM, CS, Finance).
3. **Memory** — Layered: Charter (identity), History (per-agent learnings, append-only), Decisions (team/company-wide), Knowledge (structured store), Session (ephemeral).
4. **Message Bus** — Inter-agent communication. Schema: `{ from, to, type, priority, context, payload, timestamp, deadline }`. Types: REQUEST, RESPONSE, ALERT, ESCALATION, STATUS, BROADCAST. Backends: in-process (default), Redis, BullMQ.
5. **Tools** — Agent capabilities. Three sources: ABF Registry (curated), MCP Servers (open standard), Custom (TypeScript functions). Agents CANNOT install tools at runtime.
6. **Triggers** — What activates agents: cron, event, message, webhook, manual.

## Tech Stack
- Runtime: Node.js / TypeScript
- Dashboard: React (Next.js)
- Default storage: filesystem (Markdown files)
- Production storage: PostgreSQL + pgvector
- Message bus: in-process → Redis/BullMQ
- LLM: Provider-agnostic (Anthropic, OpenAI, Google, Ollama, any OpenAI-compatible)

## Directory Structure
```
my-business/
├── abf.config.yaml              # Global config
├── agents/                       # Agent definitions (YAML + charter)
│   ├── scout.agent.yaml
│   └── ...
├── teams/                        # Team definitions
│   └── product.team.yaml
├── tools/                        # Custom tools + MCP configs
│   ├── mcp-servers.yaml
│   └── custom-tool.tool.ts
├── memory/                       # Persistent agent memory
│   ├── agents/{name}/charter.md, history.md
│   ├── decisions.md
│   └── knowledge/
├── knowledge/                    # Shared knowledge base (Markdown files)
│   ├── company.md
│   └── brand-voice.md
├── outputs/                      # Cross-agent session outputs
│   └── {agentName}/             # Timestamped .md files per agent
├── datastore/                    # Business database
│   ├── schemas/                 # *.schema.yaml table definitions
│   └── migrations/              # Numbered *.sql migrations
├── workflows/                    # Multi-agent workflow definitions
│   └── onboarding.workflow.yaml
├── monitors/                     # External URL monitors
│   └── *.monitor.yaml
├── templates/messages/           # Message templates (*.template.yaml)
├── logs/                         # Audit trail
│   ├── bus/, sessions/, escalations/
├── interfaces/                   # Plugin configs (cli, dashboard, slack)
└── templates/                    # Business templates
```

## Agent Definition Format
```yaml
name: scout
display_name: Research & Analytics
role: Citation Monitor
description: Monitors AI search engine citations for client brands.
provider: anthropic
model: claude-sonnet-4-5
temperature: 0.3
team: product
reports_to: atlas
tools: [llm-orchestration, database, redis-cache, web-search]
triggers:
  - type: cron
    schedule: '0 */2 * * *'
    task: run_monitoring_cycle
  - type: message
    from: atlas
    task: on_demand_scan
escalation_rules:
  - condition: api_costs > budget_threshold
    target: human
behavioral_bounds:
  allowed_actions: [read_data, write_report, send_alert]
  forbidden_actions: [delete_data, modify_billing]
  max_cost_per_session: $2.00
  requires_approval: [publish_content, send_client_email]
kpis:
  - metric: monitoring_coverage
    target: 100%
    review: daily
charter: |
  # Scout — Citation Monitor
  You are Scout, the Citation Monitor...
```

## Runtime Architecture
Single Node.js process with 5 components:
1. **Scheduler** — Cron triggers → activation events
2. **Dispatcher** — Receives activations, spawns work sessions
3. **Session Manager** — Loads context → calls LLM → executes tools → writes memory → logs
4. **Bus** — Routes inter-agent messages, triggers message-based activations
5. **Gateway** — HTTP server: webhooks, Dashboard API, REST management API

### Work Session Lifecycle
1. Load Context (charter + history + decisions + trigger payload)
2. Build Prompt (system prompt with date, KPIs, pending messages)
3. Execute (send to LLM provider)
4. Tool Loop (execute tool calls in sandbox, return results, repeat)
5. Process Outputs (route messages to bus)
6. Write Memory (append learnings to history)
7. Check Escalations (route to human or orchestrator if triggered)
8. Report (update KPIs, log cost, close session)

## Provider Interface
```typescript
interface Provider {
  name: string;
  slug: string;
  auth: 'oauth' | 'api_key' | 'local';
  chat(req: ChatRequest): AsyncIterable<ChatChunk>;
  models(): Promise<ModelInfo[]>;
  estimateCost(model: string, tokens: number): number;
}
```

## Model Access (3 modes)
- **OAuth**: Sign in with Claude/ChatGPT/Gemini. Uses existing subscription.
- **API Key**: Direct API access. Stored encrypted.
- **Local (Ollama)**: One-click install. Fully offline. No internet required.
- **Hybrid**: Mix cloud + local per agent.

## Security Architecture (CRITICAL — security-first framework)

### Core Assumption
Any agent reading external content WILL receive adversarial input. Any agent with tools CAN take harmful actions. Any agent with memory CAN be poisoned. Design for containment and recovery.

### Two Threat Supply Chains
1. **Untrusted Code** (tools/plugins): Malicious tools can exfiltrate credentials or backdoor behavior.
2. **Untrusted Instructions** (prompt injection): Malicious content in emails/web/APIs can steer agent behavior.

### Three Security Boundaries
1. **Identity**: Per-agent credentials. Scoped OAuth tokens. Never shared across agents.
2. **Execution**: Sandboxed tool invocation. No shell, no eval, no arbitrary code.
3. **Persistence**: Memory integrity via checksums, anomaly detection, snapshot rollback.

### Six Security Pillars
1. **Least Privilege** — Agents start with zero permissions. Access explicitly granted per-agent.
2. **OAuth-Only** — No raw credentials stored. Scoped tokens. Auto-rotation. One-click revocation.
3. **Sandboxed Execution** — Every tool call in isolation (container/isolate). Sandbox destroyed after.
4. **Managed Tools** — Locked tool surface. Operator-approved only. No runtime installation.
5. **Memory Integrity** — Append-only history. Checksums. Anomaly detection. Snapshot rollback.
6. **Containment First** — Assume compromise. Isolate blast radius. Rapid rebuild.

### Input Pipeline (prompt injection defense)
1. Source Tagging — all input tagged (email/web/api/user/agent/system)
2. Content Isolation — external content in delimiters, treated as data not instructions
3. Injection Detection — classifier flags instruction-like patterns in external content
4. Output Validation — agent actions validated against behavioral_bounds before execution

### Behavioral Bounds (enforced by runtime, not LLM)
```yaml
behavioral_bounds:
  allowed_actions: [read_analytics, write_draft, send_to_review]
  forbidden_actions: [delete_data, modify_billing, access_credentials]
  max_cost_per_session: $2.00
  max_external_requests: 50
  requires_approval: [publish_content, send_client_email]
```

### Credential Architecture
- Per-agent OAuth tokens with minimum scopes
- Encrypted vault (AES-256-GCM), injected at runtime into sandbox only
- Automatic rotation (default: 24h for high-privilege)
- One-click revocation from Dashboard
- All credential use logged in audit trail

### Audit Trail
Everything logged: sessions, tool calls, messages, memory writes, escalations, security events. Immutable. Retained 90 days (actions) / indefinite (security events, escalations, memory writes).

## Business Templates
Templates are complete pre-configured agent teams: SaaS, Marketing Agency, E-Commerce, Content Studio, Consulting, Solo Founder, Custom. `abf init --template saas` generates full project.

## Workflows
Multi-agent coordination defined in YAML. Sequential, parallel, conditional steps. Timeouts and failure handling. Dashboard shows visual flowchart.

## Interfaces (all plugins implementing ABFInterface)
- **Dashboard** (React): Primary for operators. Agent management, escalations, workflows, security.
- **CLI** (abf): For builders. `abf status`, `abf logs`, `abf run`, `abf escalations`.
- **Messaging**: Slack, Discord, WhatsApp, email. Push notifications + operator responses.

## Deployment
- **Local dev**: `abf dev` — filesystem only, hot-reload
- **Docker**: `docker compose up` — single container, production-ready
- **Cloud**: `abf deploy --target railway` — one-click
- **ABF Cloud**: Managed hosting (future)

## Reference Implementation: CiteRank
14 agents across 4 teams (Product, GTM, CS, Finance) running an AI citation tracking business. Agents: atlas, scout, lens, sage, sentinel, vanguard, hunter, herald, signal, bridge, anchor, dispatch, guardian, ledger. Plus 3 shared services: scribe, radar, clerk.

## Build Phases
1. **v0.1 Foundation**: Runtime (scheduler, dispatcher, sessions, bus), agent definitions, file memory, provider plugins (Anthropic/OpenAI/Ollama), CLI, basic Dashboard, 1 template
2. **v0.2 Usability**: Setup wizard, full Dashboard, messaging plugins, MCP integration, more templates, Docker deploy
3. **v0.3 Scale**: Redis/BullMQ bus, Postgres memory, visual workflow builder, KPI dashboards, cloud deploy
4. **v1.0 Platform**: ABF Cloud, agent marketplace, workflow marketplace, mobile app, enterprise features

## P0 Framework Features (Completed)

### Knowledge Base
- `knowledge/` directory at project root with `*.md` files
- Session manager loads knowledge files and injects into prompt ("Knowledge Base" section)
- `knowledge-search` tool searches both agent memory and project-level knowledge
- Templates generate starter files: `company.md`, `brand-voice.md`
- Config: `knowledge_dir` (default: `'knowledge'`)

### Approval Queue
- Tools with `requiresApproval` queue instead of executing directly
- `InMemoryApprovalStore` (Map-based, capped at 1000 entries)
- `send-message` tool checks approval store before sending
- Gateway routes: `GET /api/approvals`, `GET /api/approvals/:id`, `POST /api/approvals/:id/approve`, `POST /api/approvals/:id/reject`
- Dashboard page at `/approvals` with filter, approve/reject buttons
- Types: `ApprovalRequest`, `ApprovalStatus`, `IApprovalStore`

### Business Database (Datastore)
- Config-driven database: `sqlite` (better-sqlite3) or `postgres` (pg)
- Schema YAML files in `datastore/schemas/` — `*.schema.yaml` with name + columns
- SQL migrations in `datastore/migrations/` — numbered `*.sql` files, tracked in `_migrations` table
- `database-query` tool (SELECT only) and `database-write` tool (INSERT/UPDATE/DELETE — no DROP/ALTER)
- `abf migrate` CLI command: loads config, creates datastore, applies schemas + migrations
- Factory auto-initializes datastore on `abf dev` if configured
- Config: `datastore.backend`, `datastore.connection_string`, `datastore.sqlite_path`, `datastore.schemas_dir`, `datastore.migrations_dir`

## P1 Framework Features (Completed)

### Role Archetypes
- 10 built-in archetypes: researcher, writer, orchestrator, analyst, customer-support, developer, marketer, finance, monitor, generalist
- Agent YAML `role_archetype` field merges defaults (explicit values win): temperature, tools, behavioral bounds, charter template
- `abf agent add --name <name> --archetype <type> --team <team>` scaffolds new agents
- Gateway route: `GET /api/archetypes` lists all archetypes
- Charter templates use `{{name}}` placeholder, auto-expanded

### Cross-Agent Memory (Outputs)
- `OutputsManager` writes session outputs to `outputs/<agentName>/` as timestamped `.md` files
- Session manager reads recent teammate outputs and injects into prompt ("Recent Teammate Outputs" section)
- Output written automatically after each session in step 6
- Config: `outputs_dir` (default: `'outputs'`)

### Agent Inbox
- `InMemoryInbox` — priority-sorted (urgent > high > normal > low), 500 items per agent cap
- Session manager drains inbox at session start, includes in prompt
- Gateway routes: `GET /api/agents/:id/inbox` (peek), `POST /api/agents/:id/inbox` (push task)
- Dashboard "Send Task to Inbox" form on agent detail page
- Types: `InboxItem`, `IInbox`, `InboxItemPriority`, `InboxItemSource`

## P2 Framework Features (Completed)

### Metrics Dashboard
- `MetricsCollector` aggregates runtime stats from dispatcher (active sessions, escalations, agent states)
- Gateway routes: `GET /api/metrics/runtime`, `GET /api/metrics/agents`, `GET /api/metrics/kpis`
- Dashboard page at `/metrics` with gauge cards and agent states table
- Auto-refreshes every 5 seconds

### Communication Router (Message Templates)
- `MessageTemplateRegistry` loads `*.template.yaml` from `templates/messages/`
- Templates use `{{variable}}` syntax, resolved at send time
- `send-message` tool accepts `template` and `variables` parameters
- Schema: `{ name, description?, channel, subject?, body, variables[] }`

### Workflow Templates
- 3 built-in templates: `fan-out-synthesize`, `sequential-pipeline`, `event-triggered`
- `abf workflow add --template <name>` scaffolds a workflow YAML
- Gateway route: `GET /api/workflow-templates`
- Templates export `BUILTIN_WORKFLOW_TEMPLATES`, `getWorkflowTemplate()`

## P3 Framework Features (Completed)

### External Monitoring
- `MonitorRunner` watches external URLs, hashes content, triggers agents on change
- Monitor definitions in `monitors/*.monitor.yaml` — name, url, interval, agent, task
- Interval format: `30s`, `5m`, `1h` (parsed to milliseconds)
- On content change: dispatches activation with `trigger.type: 'event'`, `event: 'monitor:<name>'`
- Payload includes `previousHash`, `currentHash`, `statusCode`
- Factory creates runner, loads from `monitors/` dir, starts polling on `abf dev`
- Types: `MonitorDefinition`, `MonitorSnapshot`
- Schema: `monitorYamlSchema`, `transformMonitorYaml()`

## Seed-to-Company Pipeline

The core differentiator: start a company from just an idea or a business plan document.

### Architecture
- `packages/core/src/seed/` — 6 modules: types, prompts, parser, analyzer, interview, apply
- Pipeline: Parse → Analyze (LLM) → Review (dashboard) → Apply (generate files)
- Intermediate representation: `CompanyPlan` (JSON) — agents, teams, knowledge, workflows, tool gaps, escalation rules

### Parser (`parser.ts`)
- `extractText(input, format?)` — accepts file path, Buffer, or raw text
- Formats: `.docx` (mammoth), `.pdf` (pdf-parse v2), `.txt`, `.md`
- Auto-detects file paths vs raw content via heuristic (< 1024 chars, no newlines, has extension)
- Normalizes whitespace (collapses 3+ newlines to 2, trims)

### Analyzer (`analyzer.ts`)
- `analyzeSeedDoc(registry, options)` — sends seed text to LLM with `ANALYZER_SYSTEM_PROMPT`, returns `CompanyPlan`
- `reanalyzeSeedDoc(registry, options)` — for seed versioning: compares original vs updated seed, increments `seedVersion`
- Retries on JSON parse failure (up to `maxRetries`, default 2) — sends malformed response back to LLM for correction
- Strips markdown code fences from LLM output before parsing
- Validates required shape: company (name, description), non-empty agents[], non-empty teams[]

### Interview Engine (`interview.ts`)
- `InterviewEngine` class — stateful conversation engine for building seed docs through Q&A
- `start(companyType)` → `{ sessionId, step }` — kicks off interview, returns first question
- `respond(sessionId, answer)` → `InterviewStep` — processes answer, returns next question or completed seed doc
- 8-12 questions covering vision, customer, revenue, operations, KPIs, brand voice, governance
- Forces completion at MAX_QUESTIONS (15) with increased maxTokens (8192) for seed doc generation
- Session expiry: 1 hour. States: active, completed, abandoned

### Apply (`apply.ts`)
- `applyCompanyPlan(plan, projectRoot, provider, model)` → writes all project files
- Generates: agent YAML, team YAML, knowledge files, workflow YAML, `knowledge/seed.md` (with frontmatter), `memory/decisions.md`
- `generateArchitectAgent()` — meta-agent injected automatically: weekly cron (Monday 10am), reviews seed doc for coverage gaps
- Creates 14 project directories (agents/, teams/, knowledge/, workflows/, memory/, outputs/, logs/, tools/, etc.)
- camelCase `AgentPlan` → snake_case YAML (matching ABF agent schema)

### Prompts (`prompts.ts`)
- `ANALYZER_SYSTEM_PROMPT` — detailed instructions for producing CompanyPlan JSON from seed text
- `INTERVIEW_SYSTEM_PROMPT` — interview flow with question arc and JSON response format
- `REANALYZE_SYSTEM_PROMPT` — delta-focused re-analysis of updated seed docs

### Gateway Routes (`seed.routes.ts`)
- `POST /api/seed/upload` — parse document (text or base64 binary), returns extracted text + word count
- `POST /api/seed/analyze` — LLM analysis → CompanyPlan JSON
- `POST /api/seed/apply` — write files + reload agents into runtime (scheduler + dispatcher)
- `POST /api/seed/interview/start` — begin interview session
- `POST /api/seed/interview/:sessionId/respond` — answer question
- `GET /api/seed/interview/:sessionId` — get session state
- `POST /api/seed/reanalyze` — re-analyze updated seed doc against existing plan

### Dashboard Setup Wizard (6 steps)
- Step 1: Choose AI provider (Anthropic, OpenAI, Ollama)
- Step 2: API key configuration
- Step 3: Company type (A: new idea/interview, B: has document, C: existing company, D: template)
- Step 4: Depends on choice: A=InterviewChat, B/C=SeedDocumentInput (paste/upload), D=template selection
- Step 5: Seed flow: PlanReview (agents, teams, knowledge, tool gaps, workflows). Template flow: project name + create
- Step 6: Seed flow: CreatingStep (apply + results with file count, agent list)
- Components: InterviewChat (chat UI), SeedDocumentInput (paste/upload tabs), PlanReview (expandable agent rows with charter preview, tool gaps with priority badges), CreatingStep (progress animation)

### CLI `--seed` Flag
- `abf init --seed ./plan.md` — parse, analyze, apply in one command
- Auto-detects provider from vault/env vars (Anthropic > OpenAI)
- Shows plan summary: company name, agents, teams, knowledge files, tool gaps
- Generates `abf.config.yaml` + `knowledge/tool-gaps.md` (if gaps exist)
- Derives project name from company name if `--name` not provided

### Company Architect (Meta-Agent)
- Auto-injected by `applyCompanyPlan()` into first team
- Weekly self-assessment: reads `knowledge/seed.md`, evaluates agent coverage vs business needs
- Reports: coverage score, gaps, redundancies, recommendations, priority actions
- Cannot modify agents directly — only recommends changes for human approval
- Tools: `knowledge-search`, `web-search`

### Tool Gap Analysis
- Analyzer compares seed doc capabilities against available ABF tools
- `ToolGap`: capability, mentionedIn, suggestion, priority (required/important/nice-to-have)
- Surfaced in CLI summary, dashboard PlanReview (colored priority badges), and `knowledge/tool-gaps.md`

## Key Design Decisions
- Files are the underlying API (YAML, Markdown, JSON) — git-trackable, inspectable
- Dashboard generates and manages files — operators never see them
- Convention over configuration — strong defaults, 5-minute setup
- Provider agnostic — swap models with a config change, mix per agent
- Security is the foundation, not a feature — all controls ON by default
- Progressive complexity — start with template, customize as needed
