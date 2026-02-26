# ABF Abstractions (All Implemented)

Patterns that emerged from designing multi-agent systems that were generalized into ABF framework features. All 10 abstractions have been implemented as of v0.3.

---

## 1. Company Brain (Framework Feature: Knowledge Base)

> **Status: Implemented** — `packages/core/src/knowledge/loader.ts`. Config: `knowledge_dir` (default: `'knowledge'`). Session manager injects knowledge files into prompt. `knowledge-search` tool searches both agent memory and project-level knowledge. Templates generate starter files.

**What CiteRank needs:** A shared knowledge base every agent can query — value prop, ICP, pricing, competitive landscape, brand voice, standing policies. Currently `decisions.md` but that's unstructured and unsearchable.

**ABF abstraction:**

```yaml
# abf.config.yaml
knowledge:
  base_dir: knowledge/        # Directory of markdown files
  search: true                # Enable semantic search via knowledge-search tool
  sync_on_write: true         # Re-embed when files change
  files:
    - company.md              # What the company does, value prop, stage
    - customers.md            # ICP, segments, personas
    - competitors.md          # Competitive landscape
    - brand.md                # Voice, tone, messaging guidelines
    - policies.md             # Standing rules all agents follow
```

**Why it's general:** Every ABF business needs shared context. A marketing agency's agents need to know client voice guidelines. A SaaS company's agents need to know the product roadmap. The structure is always the same: a searchable collection of markdown files that get injected into agent context.

**Framework work required:**
- `knowledge/` directory convention (like `memory/` and `agents/`)
- Template generators create starter knowledge files
- `knowledge-search` tool queries this directory specifically
- Session manager injects relevant knowledge snippets into agent context (not the entire knowledge base — too many tokens)

---

## 2. Communication Approval Queue (Framework Feature: Draft Mode)

> **Status: Implemented** — `packages/core/src/approval/store.ts`. `InMemoryApprovalStore` (Map-based, capped at 1000). `send-message` tool checks `requiresApproval` before sending. Gateway routes: `GET/POST /api/approvals`. Dashboard page at `/approvals`.

**What CiteRank needs:** 12 of 17 agents have `requires_approval: [send_client_email]`. Every outbound message is drafted, queued, and sent only after human approval. This is the #1 safety pattern.

**ABF abstraction:**

```yaml
# abf.config.yaml
approval_queue:
  enabled: true
  channels: [email, slack, discord]
  default_policy: require_approval   # all outbound comms need approval
  exceptions:
    - agent: radar
      action: internal_alert        # internal alerts skip approval
  dashboard_page: /approvals        # Operator reviews and approves here
```

**Current state:** ABF has `requiresApproval` on tools and `requires_approval` in behavioral bounds, but there's no approval queue UI. Escalations exist but they're "something went wrong" — approvals are "something is ready to go out."

**Why it's general:** Every ABF business sending external communications needs this. It's different from escalation (which is reactive). Approval is proactive: "I wrote this, please review before I send it."

**Framework work required:**
- Approval queue data model (pending items with agent, content, channel, recipient)
- Dashboard page: list of pending approvals, preview content, approve/reject/edit buttons
- API endpoint: `POST /api/approvals/:id/approve` and `POST /api/approvals/:id/reject`
- `send-message` tool checks approval policy before sending; if required, queues instead
- Notification to operator when items are pending

---

## 3. Business Database (Framework Feature: Structured Data Store)

> **Status: Implemented** — `packages/core/src/datastore/`. SQLite (better-sqlite3) and PostgreSQL (pg) backends. Schema YAML files in `datastore/schemas/`, SQL migrations in `datastore/migrations/`. `database-query` (SELECT only) and `database-write` (INSERT/UPDATE/DELETE) tools. `abf migrate` CLI command.

**What CiteRank needs:** A relational database for business data — customers, prospects, billing, feedback. This is separate from agent memory (which is append-only markdown).

**ABF abstraction:**

```yaml
# abf.config.yaml
datastore:
  backend: sqlite              # sqlite (dev) or postgres (prod)
  schema: tools/schema.sql     # Auto-applied on abf dev
  seed: tools/seed.sql         # Optional seed data
  migrations_dir: migrations/  # SQL migration files
```

**Why it's general:** Every ABF business has structured data that isn't agent memory. An e-commerce business has orders and products. A consulting firm has clients and projects. Agent memory (history.md, decisions.md) is the agent's journal. The datastore is the company's operating database.

**Framework work required:**
- `datastore` config section in `abf.config.yaml`
- Schema auto-creation on `abf dev` (run schema.sql if tables don't exist)
- Migration runner: `abf migrate` applies numbered migrations
- `database-query` and `database-write` tools connect to this datastore
- Templates include starter schemas appropriate to the business type

---

## 4. Agent Roles as Archetypes (Framework Feature: Role Templates)

> **Status: Implemented** — `packages/core/src/archetypes/registry.ts`. 10 built-in archetypes: researcher, writer, orchestrator, analyst, customer-support, developer, marketer, finance, monitor, generalist. Agent YAML `role_archetype` field merges defaults. `abf agent add --archetype <type>`.

**What CiteRank needs:** 17 agents, but they fall into ~8 archetypes that repeat across any business:

| Archetype | CiteRank Agents | Universal Pattern |
|-----------|----------------|-------------------|
| **Orchestrator** | Atlas | Coordinates teams, runs standups, resolves conflicts |
| **Researcher** | Scout, Hunter | Searches web, gathers intel, writes research reports |
| **Analyst** | Lens, Signal | Queries data, computes metrics, generates reports |
| **Strategist** | Sage | Synthesizes across teams, recommends direction |
| **Sales** | Vanguard | Manages pipeline, drafts outreach, tracks deals |
| **Communications** | Herald | Drafts customer-facing messages, manages brand voice |
| **Monitor** | Sentinel, Guardian, Radar | Watches for changes/anomalies, alerts on thresholds |
| **Operations** | Bridge, Anchor, Dispatch, Clerk | Manages processes, routes work, tracks milestones |
| **Writer** | Scribe | Produces content on demand for any team |

**ABF abstraction:**

```yaml
# When creating an agent, specify a role archetype
name: my-researcher
role_archetype: researcher     # Pre-configures temperature, behavioral bounds defaults, KPI types
display_name: Market Researcher
# ... archetype provides sensible defaults for everything below
```

**Why it's general:** A marketing agency also has an Orchestrator (Account Director), Researcher (Strategist), Writer (Copywriter), and Analyst. The archetypes provide sensible defaults: researchers get low temperature + web-search tool; writers get high temperature; monitors get read-only access.

**Framework work required:**
- Define 8-10 role archetypes with default configurations
- `abf agent add --archetype researcher --name scout` scaffolds with defaults
- Dashboard "Add Agent" wizard shows archetype picker
- Archetypes are suggestions, not constraints — everything is overridable

---

## 5. Workflow Patterns (Framework Feature: Workflow Templates)

> **Status: Implemented** — `packages/core/src/workflows/templates.ts`. 3 built-in templates: fan-out-synthesize, sequential-pipeline, event-triggered. `abf workflow add --template <name>`. Gateway route: `GET /api/workflow-templates`.

**What CiteRank needs:** 6 workflows, but they fall into 3 reusable patterns:

| Pattern | CiteRank Workflows | Structure |
|---------|-------------------|-----------|
| **Fan-out-then-synthesize** | Daily Standup, Weekly Report | Multiple agents produce data in parallel → one agent synthesizes |
| **Sequential pipeline** | Client Onboarding, Lead Pipeline, Content Production | Each step transforms output for the next |
| **Event-triggered response** | Churn Intervention | Triggered by a condition, rapid coordinated response |

**ABF abstraction:**

```yaml
# Workflow template library
name: fan-out-synthesize
display_name: Parallel Gather & Synthesize
description: Multiple agents produce data in parallel, then one agent synthesizes results.
parameters:
  gatherers:
    type: agent_list
    description: Agents that produce data in parallel
  synthesizer:
    type: agent
    description: Agent that synthesizes all outputs
  gather_task:
    type: string
    description: Task template for gatherer agents
  synthesize_task:
    type: string
    description: Task for the synthesizer
```

**Why it's general:** These three patterns cover ~80% of multi-agent workflows in any business. Pre-built workflow templates with slots for agents would dramatically speed up workflow creation.

**Framework work required:**
- Workflow template format (parameterized workflows)
- `abf workflow add --template fan-out-synthesize` interactive setup
- Dashboard workflow builder with template starting points
- Template library in `packages/core/src/workflows/templates/`

---

## 6. Agent Inbox (Framework Feature)

> **Status: Implemented** — `packages/core/src/inbox/store.ts`. `InMemoryInbox` with priority sorting (urgent > high > normal > low), 500 items per agent. Session manager drains inbox at session start. Gateway routes: `GET/POST /api/agents/:id/inbox`. Dashboard "Send Task to Inbox" form.

**What CiteRank needs:** Agents receive work from multiple sources — cron triggers, bus messages from other agents, webhook events, human requests. Currently these are all different trigger types. But the pattern that emerged: agents should have a unified inbox they drain on each heartbeat.

**ABF abstraction:**

```yaml
# Agent config
inbox:
  enabled: true
  drain_on: heartbeat          # Process inbox items each heartbeat
  max_items_per_session: 10    # Don't overload a single session
  priority_order: [escalation, human_request, agent_message, scheduled]
```

**Current state:** The message bus handles agent-to-agent messages, and pending messages are loaded in session context. But there's no concept of a prioritized inbox that includes human tasks, webhook payloads, and bus messages in one queue.

**Why it's general:** Every business has humans dropping ad-hoc tasks to agents. "Hey Scout, research this company for me." Currently that requires `abf run scout --task "..."` which is CLI-only. An inbox model lets the Dashboard show a "Send task to agent" UI and lets agents process human requests alongside scheduled work.

**Framework work required:**
- Inbox data model (items with source, priority, content, status)
- Dashboard UI: per-agent inbox view, "Add task" button
- Session manager drains inbox at start of session (step 1: Load Context)
- Priority ordering so escalations and human requests come first

---

## 7. Cross-Agent Memory (Framework Feature)

> **Status: Implemented** — `packages/core/src/memory/outputs.ts`. `OutputsManager` writes session outputs to `outputs/<agentName>/` as timestamped `.md` files. Session manager reads recent teammate outputs and injects into prompt. Config: `outputs_dir` (default: `'outputs'`).

**What CiteRank needs:** Sage needs to read Scout's research. Atlas needs to see what every agent produced. Herald needs Lens's reports. Currently agents can only share information via:
1. Bus messages (real-time only, not persistent)
2. `decisions.md` (shared but unstructured)
3. `file-write` + `file-read` (shared filesystem, but agents need to know where to look)

**ABF abstraction:**

```yaml
# Team config
shared_memory:
  - decisions.md             # Existing
  - team_outputs/            # NEW: agents can read each other's recent outputs
  access_policy: team_read   # Agents can read outputs from teammates, not other teams
```

**Why it's general:** Agent collaboration requires shared state beyond messaging. A marketing team's copywriter needs to read the strategist's brief. A product team's PM needs to see the researcher's findings. This is the "shared drive" for agent teams.

**Framework work required:**
- `outputs/` directory convention with per-agent subdirectories
- Team-scoped read access (agents can read teammates' outputs)
- Session manager includes recent teammate outputs in context (configurable)
- `knowledge-search` tool can search teammate outputs

---

## 8. Metrics Dashboard (Framework Feature: KPI Tracking)

> **Status: Implemented** — `packages/core/src/metrics/collector.ts`. `MetricsCollector` aggregates runtime stats. Gateway routes: `GET /api/metrics/runtime`, `GET /api/metrics/agents`, `GET /api/metrics/kpis`. Dashboard page at `/metrics` with auto-refresh.

**What CiteRank needs:** Guardian tracks agent costs, Lens tracks business metrics, Radar tracks system health. All three write to different tables but the dashboard needs to show them together: "How is the business doing?"

**ABF abstraction:**

Current KPI system tracks per-agent metrics but doesn't aggregate them into business-level dashboards. Need:

```yaml
# abf.config.yaml
dashboards:
  - name: Business Health
    refresh: 300               # seconds
    panels:
      - type: metric
        source: database       # Query business database
        query: "SELECT COUNT(*) as customers FROM clients WHERE status = 'active'"
        label: Active Customers
      - type: metric
        source: runtime        # Query agent runtime
        metric: total_daily_cost
        label: Daily Agent Spend
      - type: chart
        source: database
        query: "SELECT date, mrr FROM revenue_daily ORDER BY date DESC LIMIT 30"
        chart_type: line
        label: MRR Trend
```

**Why it's general:** Every ABF business needs an at-a-glance view of how things are going. Currently the dashboard shows agent status and session history — operational views. Business metrics require a configurable dashboard that queries both the runtime (agent stats) and the business database.

**Framework work required:**
- Dashboard configuration format in `abf.config.yaml`
- Dashboard page that renders configured panels
- Query runner that supports both runtime metrics and business database
- Pre-built panel types: metric (single number), chart (line/bar), table

---

## 9. Communication Router (Framework Feature: Outbound Channels)

> **Status: Implemented** — `packages/core/src/messaging/templates.ts`. `MessageTemplateRegistry` loads `*.template.yaml` from `templates/messages/`. Templates use `{{variable}}` syntax. `send-message` tool accepts `template` and `variables` parameters.

**What CiteRank needs:** Herald sends to customers. Vanguard sends outreach. Anchor sends retention messages. Bridge sends onboarding emails. All go through the same pattern: draft → approve → send via channel.

**Current state:** ABF has `MessagingRouter` with Slack, Email, Discord adapters. But the `send-message` tool is new (was a stub). The integration between tools → approval queue → messaging router needs to be a first-class framework feature.

**ABF abstraction:**

```yaml
# abf.config.yaml
messaging:
  channels:
    email:
      adapter: smtp
      config:
        host: smtp.gmail.com
        port: 587
        from: hello@citerank.com
    slack:
      adapter: slack
      config:
        webhook_url: $SLACK_WEBHOOK_URL
  templates_dir: templates/messages/  # Reusable message templates
  approval_required: true             # Global default
```

**Framework work required:**
- Message templates (markdown with `{{variables}}`)
- Template directory convention
- `send-message` tool resolves templates before sending
- Approval queue integration (draft → queue → approve → send)
- Delivery tracking (sent, delivered, failed)

---

## 10. Competitive Intelligence Feed (Framework Feature: External Monitoring)

> **Status: Implemented** — `packages/core/src/monitor/runner.ts`. `MonitorRunner` watches URLs, hashes content, triggers agents on change. Monitor definitions in `monitors/*.monitor.yaml`. Interval format: `30s`, `5m`, `1h`. Factory starts polling on `abf dev`.

**What CiteRank needs:** Sentinel monitors competitors continuously. This isn't a one-time research task — it's an ongoing feed of competitive changes that triggers alerts.

**ABF abstraction:**

```yaml
# monitor.config.yaml or agent config
monitors:
  - name: competitor-websites
    type: web-diff              # Detect changes to web pages
    urls:
      - https://profound.ai/pricing
      - https://peec.ai/features
    check_interval: 86400       # seconds (daily)
    on_change: notify           # Alert the monitoring agent
```

**Why it's general:** Many ABF businesses need ongoing monitoring — price changes, news mentions, regulatory updates, social media sentiment. A generalized monitoring framework (check URL → detect changes → notify agent) would serve many use cases.

**Framework work required:**
- Monitor definition format
- Lightweight change detection (fetch + hash comparison, or diff)
- Storage for previous snapshots
- Integration with triggers (monitor change → activate agent)
- This could also be an MCP server rather than built-in

---

## Priority Ranking

Impact vs. effort for framework generalization:

| # | Abstraction | Impact | Effort | Priority | Status |
|---|------------|--------|--------|----------|--------|
| 1 | **Communication Approval Queue** | Critical | Medium | P0 | Done |
| 2 | **Company Brain / Knowledge Base** | High | Low | P0 | Done |
| 3 | **Business Database** | High | Medium | P0 | Done |
| 4 | **Agent Roles / Archetypes** | High | Low | P1 | Done |
| 5 | **Cross-Agent Memory** | High | Medium | P1 | Done |
| 6 | **Agent Inbox** | Medium | Medium | P1 | Done |
| 7 | **Metrics Dashboard** | Medium | High | P2 | Done |
| 8 | **Communication Router** | Medium | Low | P2 | Done |
| 9 | **Workflow Templates** | Medium | Medium | P2 | Done |
| 10 | **External Monitoring** | Low | High | P3 | Done |
