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
├── knowledge/                    # Shared knowledge base (*.md files)
│   ├── company.md
│   ├── brand-voice.md
│   └── seed.md                  # Original seed document (if created from seed)
├── outputs/                      # Cross-agent session outputs
│   └── {agentName}/
├── datastore/                    # Business database
│   ├── schemas/
│   └── migrations/
├── workflows/                    # Multi-agent workflow definitions
│   └── onboarding.workflow.yaml
├── monitors/                     # External URL monitors
│   └── *.monitor.yaml
├── templates/messages/           # Message templates
├── logs/                         # Audit trail
│   ├── bus/, sessions/, escalations/
├── interfaces/                   # Plugin configs (cli, dashboard, slack)
└── templates/                    # Business templates
```

## Agent Definition Format
```yaml
name: scout
display_name: Research Analyst
role: Researcher
description: Researches market trends, competitor activity, and industry news.
provider: anthropic
model: claude-sonnet-4-5
temperature: 0.3
team: founders
reports_to: compass
tools: [web-search, knowledge-search, browse]
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
  # Scout — Research Analyst
  You are Scout, the Research Analyst...
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

## Seed-to-Company Pipeline
Three ways to create a project:
1. **Template** — `abf init --template solo-founder` for pre-built teams
2. **Seed document** — `abf init --seed ./plan.md` to generate agents from a business plan
3. **Interactive interview** — Dashboard wizard asks 8-12 questions, generates a seed doc, then analyzes it

Pipeline: Parse (docx/pdf/txt/md) → Analyze (LLM → CompanyPlan JSON) → Review (dashboard) → Apply (YAML files + knowledge + workflows)

The analyzer produces: agents with charters, teams with orchestrators, knowledge base files, workflows, escalation rules, and tool gap analysis. A Company Architect meta-agent is auto-injected to run weekly coverage assessments against the seed document.

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

## Reference Implementation: PickleCoachAI
Generated from a seed document via the Seed-to-Company pipeline. PickleCoachAI is a digital pickleball coaching platform with AI agents handling coaching, content creation, community management, performance analytics, and customer support. The agent team was designed entirely by ABF's analyzer — not hand-built — demonstrating that any business described in a seed document can be turned into a running agent team.

## Build Phases
1. **v0.1 Foundation**: Runtime (scheduler, dispatcher, sessions, bus), agent definitions, file memory, provider plugins (Anthropic/OpenAI/Ollama), CLI, basic Dashboard, 1 template
2. **v0.2 Usability**: Setup wizard, full Dashboard, messaging plugins, MCP integration, more templates, Docker deploy
3. **v0.3 Scale**: Redis/BullMQ bus, Postgres memory, visual workflow builder, KPI dashboards, cloud deploy
4. **v1.0 Platform**: ABF Cloud, agent marketplace, workflow marketplace, mobile app, enterprise features
5. **v0.4 Seed-to-Company**: Seed document parser (docx/pdf/txt/md), LLM-powered business analyzer, interactive interview engine, Company Architect meta-agent, tool gap analysis, seed versioning, 6-step dashboard setup wizard

## Key Design Decisions
- Files are the underlying API (YAML, Markdown, JSON) — git-trackable, inspectable
- Dashboard generates and manages files — operators never see them
- Convention over configuration — strong defaults, 5-minute setup
- Provider agnostic — swap models with a config change, mix per agent
- Security is the foundation, not a feature — all controls ON by default
- Progressive complexity — start with template, customize as needed
