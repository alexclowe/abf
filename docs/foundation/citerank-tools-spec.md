> **Deprecation Notice**: CiteRank has been superseded by PickleCoachAI as ABF's reference implementation. PickleCoachAI is generated automatically via the Seed-to-Company pipeline (not hand-built), which better demonstrates ABF's capabilities. This document is preserved for historical reference. The tools described here (web-search, knowledge-search, send-message, database-query, database-write, browse, reschedule) are all implemented as built-in ABF tools available to any agent.

---

# CiteRank Tools Spec

**Status:** Superseded
**Author:** Alex + Claude
**Date:** 2026-02-25

---

## Context

CiteRank is ABF's reference implementation — a 14-agent, 4-team AI citation tracking business. It monitors how brands are cited in AI search engine responses (ChatGPT, Perplexity, Gemini, Claude) and turns that data into actionable intelligence for clients.

Today, every ABF agent references `web-search` which returns `[]`. CiteRank can't function without real tools. This spec defines the **10 tools** needed to make CiteRank operational, their interfaces (conforming to the existing `ITool` contract), and implementation approach for each.

---

## CiteRank Agent Roster & Tool Requirements

### Product Team

| Agent | Role | Tools Needed |
|-------|------|-------------|
| **Atlas** | Product Orchestrator — coordinates all teams, runs daily standups, sets priorities | `database-query`, `send-message` |
| **Scout** | Citation Monitor — queries AI search engines for brand mentions, records citations | `web-search`, `web-fetch`, `database-query`, `database-write` |
| **Lens** | Analytics Engine — analyzes citation data, computes trends, generates reports | `database-query`, `file-write`, `data-transform` |
| **Sage** | Strategic Insights — synthesizes patterns across data, produces recommendations | `database-query`, `knowledge-search` |

### GTM Team

| Agent | Role | Tools Needed |
|-------|------|-------------|
| **Sentinel** | Market Watch — monitors competitor citation performance, market trends | `web-search`, `web-fetch`, `database-query`, `database-write` |
| **Vanguard** | Sales Outreach — identifies prospects, drafts outreach, manages pipeline | `web-search`, `database-query`, `database-write`, `send-message` |
| **Hunter** | Lead Gen — finds companies that would benefit from citation tracking | `web-search`, `web-fetch`, `database-query`, `database-write` |
| **Herald** | Customer Comms — sends client reports, weekly digests, alert notifications | `database-query`, `file-read`, `send-message` |

### CS Team

| Agent | Role | Tools Needed |
|-------|------|-------------|
| **Signal** | Feedback Analyst — ingests customer feedback, identifies themes, flags churn risk | `database-query`, `database-write`, `data-transform` |
| **Bridge** | Onboarding — guides new clients through setup, tracks activation milestones | `database-query`, `database-write`, `send-message` |
| **Anchor** | Retention — monitors usage patterns, identifies at-risk accounts, triggers interventions | `database-query`, `send-message` |
| **Dispatch** | Support Router — triages incoming requests, routes to right agent or human | `database-query`, `database-write`, `send-message` |

### Finance Team

| Agent | Role | Tools Needed |
|-------|------|-------------|
| **Guardian** | Compliance & Cost — monitors agent spend, flags anomalies, enforces budgets | `database-query`, `file-read` |
| **Ledger** | Billing — tracks usage per client, generates invoices, reconciles payments | `database-query`, `database-write`, `file-write`, `send-message` |

### Shared Services (available to all agents)

| Service | Purpose | Tools Needed |
|---------|---------|-------------|
| **Scribe** | Writing — any agent can delegate writing tasks via bus message | `web-search`, `file-write` |
| **Radar** | Monitoring — watches for system health issues, data pipeline failures | `database-query`, `file-read` |
| **Clerk** | Admin — scheduling, reminders, housekeeping | `database-query`, `database-write` |

---

## Tool Definitions

### 1. `web-search`

**What it replaces:** The current stub that returns `[]`.

**Purpose:** General web search. Used by Scout to find citation contexts, by Sentinel for competitive intel, by Hunter for lead research.

**Implementation:** Brave Search API (generous free tier: 2,000 queries/month; $5/1K queries after). Tavily is the fallback option (better for AI-structured results but pricier).

```typescript
// Tool Definition
{
  id: 'web-search',
  name: 'web-search',
  description: 'Search the web and return structured results with titles, URLs, and snippets.',
  source: 'registry',
  parameters: [
    { name: 'query', type: 'string', description: 'Search query', required: true },
    { name: 'count', type: 'number', description: 'Number of results (default 10, max 20)', required: false },
    { name: 'freshness', type: 'string', description: 'Recency filter: day, week, month, or omit for all time', required: false },
  ],
  estimatedCost: 1, // $0.01 per call
  timeout: 10_000,
}

// Return shape
{
  results: [
    {
      title: string,
      url: string,
      snippet: string,
      published?: string, // ISO date if available
    }
  ],
  totalEstimated: number,
  query: string,
}
```

**Implementation notes:**
- Wrap the Brave Search API (`@anthropic-ai/brave-search` or raw HTTP to `https://api.search.brave.com/res/v1/web/search`)
- API key stored in credential vault under `brave-search`
- Enforce `count` ceiling of 20 to control cost
- Rate limit: queue requests, max 1/second to stay within free tier

---

### 2. `web-fetch`

**Purpose:** Fetch a URL and extract readable content. Scout uses this to load AI search engine result pages and extract citation text. Sentinel/Hunter use it for competitor and prospect research.

**Implementation:** `fetch()` + Mozilla Readability (via `@mozilla/readability` + `linkedom` for DOM parsing). No headless browser — keeps it fast and cheap.

```typescript
{
  id: 'web-fetch',
  name: 'web-fetch',
  description: 'Fetch a URL and extract its main text content. Returns cleaned, readable text (not raw HTML). Use for reading articles, documentation, or any web page.',
  source: 'registry',
  parameters: [
    { name: 'url', type: 'string', description: 'URL to fetch', required: true },
    { name: 'max_length', type: 'number', description: 'Max characters to return (default 5000)', required: false },
    { name: 'extract_links', type: 'boolean', description: 'Include links found on the page (default false)', required: false },
  ],
  estimatedCost: 0,
  timeout: 15_000,
}

// Return shape
{
  url: string,
  title: string,
  content: string,     // Cleaned text, truncated to max_length
  byline?: string,
  publishedDate?: string,
  links?: { text: string, href: string }[],
  fetchedAt: string,   // ISO timestamp
}
```

**Implementation notes:**
- Use Node `fetch()` (built-in since Node 18)
- Parse HTML with `linkedom`, extract with `@mozilla/readability`
- Respect `robots.txt` — check before fetching (cache parsed robots.txt per domain for 1 hour)
- User-Agent: `ABF/0.1 (https://github.com/your-org/abf)`
- If Readability fails (SPAs, JS-rendered content), return raw text stripped of HTML tags
- For AI search engine scraping specifically: Scout will need to hit API endpoints where available (Perplexity has an API, ChatGPT does via share links) rather than scraping rendered pages

---

### 3. `database-query`

**Purpose:** Read structured data. This is the most-used tool across CiteRank — every agent needs to look things up. Citations, clients, campaigns, metrics, billing records.

**Implementation:** SQLite for dev (zero config, single file), Postgres for production (already supported in memory store). Uses a shared schema.

```typescript
{
  id: 'database-query',
  name: 'database-query',
  description: 'Run a read-only SQL query against the business database. Returns rows as JSON objects. Use SELECT statements only — writes are blocked.',
  source: 'registry',
  parameters: [
    { name: 'sql', type: 'string', description: 'SQL SELECT query', required: true },
    { name: 'params', type: 'array', description: 'Parameterized query values (use ? placeholders)', required: false },
    { name: 'limit', type: 'number', description: 'Max rows to return (default 100, max 1000)', required: false },
  ],
  estimatedCost: 0,
  timeout: 10_000,
}

// Return shape
{
  rows: Record<string, unknown>[],
  rowCount: number,
  truncated: boolean,  // true if limit was hit
  queryTimeMs: number,
}
```

**Implementation notes:**
- **CRITICAL SECURITY:** Parse and validate SQL before execution. Only allow SELECT statements. Block DROP, DELETE, UPDATE, INSERT, ALTER, CREATE, TRUNCATE. Use a simple AST check (e.g., `node-sql-parser`) — don't rely on regex.
- Parameterized queries only — never string-interpolate agent-provided values
- Dev backend: `better-sqlite3` (synchronous, fast, zero-setup)
- Prod backend: Reuse the Postgres connection pool from `PostgresMemoryStore`
- Enforce row limit to prevent agents from pulling entire tables
- Read-only connection (Postgres: `SET default_transaction_read_only = on`)

---

### 4. `database-write`

**Purpose:** Insert or update business data. Scout writes citation records. Signal writes feedback entries. Vanguard updates pipeline stages. Ledger records billing events.

**Implementation:** Same backend as `database-query` but allows INSERT, UPDATE, UPSERT. Separated from query for behavioral bounds enforcement — most agents get `database-query` but only specific agents get `database-write`.

```typescript
{
  id: 'database-write',
  name: 'database-write',
  description: 'Write data to the business database. Supports INSERT and UPDATE operations. Returns affected row count. Cannot DROP or ALTER tables.',
  source: 'registry',
  parameters: [
    { name: 'sql', type: 'string', description: 'SQL INSERT, UPDATE, or UPSERT statement', required: true },
    { name: 'params', type: 'array', description: 'Parameterized query values (use ? placeholders)', required: false },
  ],
  estimatedCost: 0,
  timeout: 10_000,
  requiresApproval: false, // per-agent approval handled via behavioral_bounds
}

// Return shape
{
  affectedRows: number,
  lastInsertId?: number,
  queryTimeMs: number,
}
```

**Implementation notes:**
- Allow only INSERT, UPDATE, UPSERT (ON CONFLICT). Block DELETE, DROP, ALTER, CREATE, TRUNCATE.
- DELETE is intentionally excluded — agents should never delete business data. If cleanup is needed, use a soft-delete pattern (set `deleted_at` timestamp via UPDATE).
- All writes logged in audit trail with agent ID, SQL, and params
- Transaction support: wrap in implicit transaction, rollback on error

---

### 5. `file-write`

**Purpose:** Generate output files — reports, invoices, exports. Lens writes analytics reports. Ledger writes invoices. Scribe writes content drafts.

**Implementation:** Sandboxed filesystem writes to a per-agent output directory.

```typescript
{
  id: 'file-write',
  name: 'file-write',
  description: 'Write content to a file. Files are saved to the outputs directory. Supports text formats: .md, .txt, .csv, .json, .html. Returns the file path.',
  source: 'registry',
  parameters: [
    { name: 'filename', type: 'string', description: 'Filename with extension (e.g. "weekly-report.md")', required: true },
    { name: 'content', type: 'string', description: 'File content to write', required: true },
    { name: 'append', type: 'boolean', description: 'Append to existing file instead of overwriting (default false)', required: false },
  ],
  estimatedCost: 0,
  timeout: 5_000,
}

// Return shape
{
  path: string,        // Relative path from project root
  bytesWritten: number,
  created: boolean,    // true if new file, false if overwrite/append
}
```

**Implementation notes:**
- Write to `outputs/{agentName}/` directory (created on first write)
- Filename sanitization: strip path traversal (`..`, `/`), limit to alphanumeric + `-_.`
- Allowed extensions whitelist: `.md`, `.txt`, `.csv`, `.json`, `.html`, `.xml`
- No binary file support in v0.1 (PDF generation is a future tool)
- Max file size: 1MB per write
- Append mode useful for Lens adding to running analytics logs

---

### 6. `file-read`

**Purpose:** Read files from the project. Herald reads generated reports to include in client emails. Guardian reads logs. Radar checks system health files.

```typescript
{
  id: 'file-read',
  name: 'file-read',
  description: 'Read a file from the project directory. Returns file content as text. Can read outputs, memory files, and config files.',
  source: 'registry',
  parameters: [
    { name: 'path', type: 'string', description: 'Relative path from project root (e.g. "outputs/lens/weekly-report.md")', required: true },
    { name: 'max_length', type: 'number', description: 'Max characters to return (default 10000)', required: false },
    { name: 'offset', type: 'number', description: 'Character offset to start reading from (default 0)', required: false },
  ],
  estimatedCost: 0,
  timeout: 5_000,
}

// Return shape
{
  path: string,
  content: string,
  totalLength: number,
  truncated: boolean,
}
```

**Implementation notes:**
- Path must resolve within project root — block path traversal
- Cannot read: `abf.config.yaml` (may contain secrets), anything in `.abf/` (credential vault), `node_modules/`
- Can read: `outputs/`, `memory/`, `logs/`, agent YAML files, team files

---

### 7. `data-transform`

**Purpose:** Compute aggregations, statistics, and transformations on data without writing SQL. Lens uses this for citation trend analysis. Signal uses it for feedback sentiment aggregation. Designed for when an agent has data (from `database-query` or another source) and needs to compute something.

```typescript
{
  id: 'data-transform',
  name: 'data-transform',
  description: 'Perform computations on data: aggregate, group, sort, compute statistics, or transform arrays of objects. Input is a JSON array of records. Use for analytics that are easier to express as operations than SQL.',
  source: 'registry',
  parameters: [
    { name: 'data', type: 'array', description: 'Array of JSON objects to transform', required: true },
    { name: 'operations', type: 'array', description: 'Ordered list of operations to apply', required: true },
  ],
  estimatedCost: 0,
  timeout: 10_000,
}

// Operations schema (each operation is an object):
// { op: 'filter', field: string, operator: 'eq'|'gt'|'lt'|'gte'|'lte'|'contains'|'in', value: any }
// { op: 'group_by', field: string, aggregations: [{ field: string, fn: 'count'|'sum'|'avg'|'min'|'max', as: string }] }
// { op: 'sort', field: string, order: 'asc'|'desc' }
// { op: 'limit', count: number }
// { op: 'select', fields: string[] }
// { op: 'compute', field: string, expression: 'pct_change'|'rolling_avg'|'rank', window?: number }

// Return shape
{
  result: Record<string, unknown>[],
  rowCount: number,
  operationsApplied: number,
}
```

**Implementation notes:**
- Pure JavaScript — no external dependencies. Implement each operation as a simple array method chain.
- `compute` operations are limited to safe, pre-defined functions (no eval, no arbitrary expressions)
- Input data capped at 10,000 records to prevent memory issues
- This is intentionally limited. It covers 80% of what agents need. Complex analytics should be done in SQL via `database-query`.

---

### 8. `knowledge-search`

**Purpose:** Semantic search over agent memory and the company knowledge base. Sage uses this to find relevant historical insights. Atlas uses it to recall past decisions.

```typescript
{
  id: 'knowledge-search',
  name: 'knowledge-search',
  description: 'Semantic search over agent memory (history, decisions) and the shared knowledge base. Returns the most relevant passages ranked by similarity.',
  source: 'registry',
  parameters: [
    { name: 'query', type: 'string', description: 'Natural language search query', required: true },
    { name: 'scope', type: 'string', description: 'Where to search: "all", "decisions", "history:{agentName}", "knowledge"', required: false },
    { name: 'limit', type: 'number', description: 'Max results to return (default 5)', required: false },
    { name: 'time_range', type: 'string', description: 'Filter by recency: "today", "week", "month", "all" (default "all")', required: false },
  ],
  estimatedCost: 1, // embedding API call
  timeout: 10_000,
}

// Return shape
{
  results: [
    {
      content: string,        // The matched passage
      source: string,         // e.g. "history:scout", "decisions", "knowledge/clients.md"
      similarity: number,     // 0-1 cosine similarity
      timestamp?: string,     // When this was written
    }
  ],
  query: string,
  totalSearched: number,
}
```

**Implementation notes:**
- **Dev backend (filesystem):** Use a lightweight embedding model (Ollama + `nomic-embed-text` or OpenAI `text-embedding-3-small`). On first search, embed all memory files and cache embeddings as `.embeddings.json` alongside each memory file. Incremental: re-embed only when memory file changes (compare checksums).
- **Prod backend (Postgres):** Use the existing `pgvector` column. Embed on write (in the memory store's append method). Search via `SELECT ... ORDER BY embedding <=> $1 LIMIT $2`.
- Chunk memory files by paragraph (double newline split) before embedding
- Cache the embedding model client — don't re-initialize per call
- This is the tool that makes the existing pgvector investment pay off

---

### 9. `send-message`

**Purpose:** Send messages to humans via configured channels (email, Slack, Discord). Herald sends client reports. Bridge sends onboarding emails. Ledger sends invoices. Anchor sends retention alerts.

This is different from the internal message bus (agent-to-agent). This is outbound communication to external humans.

```typescript
{
  id: 'send-message',
  name: 'send-message',
  description: 'Send a message to a human via email, Slack, or other configured channel. Used for client communications, alerts, and reports. Messages that match requires_approval in behavioral_bounds will be queued for human review.',
  source: 'registry',
  parameters: [
    { name: 'channel', type: 'string', description: 'Delivery channel: "email", "slack", "discord"', required: true },
    { name: 'to', type: 'string', description: 'Recipient: email address, Slack channel/user ID, or Discord channel ID', required: true },
    { name: 'subject', type: 'string', description: 'Message subject (required for email, optional for others)', required: false },
    { name: 'body', type: 'string', description: 'Message body (supports markdown)', required: true },
    { name: 'attachments', type: 'array', description: 'File paths to attach (from outputs/ directory)', required: false },
  ],
  estimatedCost: 0,
  timeout: 15_000,
  requiresApproval: true, // Default to human approval; agents can override via behavioral_bounds
}

// Return shape
{
  sent: boolean,
  messageId?: string,
  channel: string,
  queuedForApproval: boolean,  // true if requires_approval triggered
}
```

**Implementation notes:**
- Delegates to the existing `MessagingRouter` (Slack, Email, Discord adapters already exist)
- **Default: requires approval.** Every outbound message goes to the escalation queue unless the agent's `behavioral_bounds` explicitly lists the action as allowed. This is a safety-first design — you don't want Scout accidentally emailing a client.
- Attachment paths validated against `outputs/` directory only
- Markdown→HTML conversion for email bodies (use `marked`)
- Rate limiting: max 10 messages per agent per session

---

### 10. `reschedule` (existing — no changes)

Already implemented. Agents call this to request re-execution after a delay. Used by heartbeat triggers. No changes needed for CiteRank.

---

## CiteRank Database Schema

The `database-query` and `database-write` tools need a schema to operate against. This is the CiteRank business data model.

```sql
-- Clients being monitored
CREATE TABLE clients (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  domain        TEXT,
  plan          TEXT DEFAULT 'starter',     -- starter, pro, enterprise
  status        TEXT DEFAULT 'active',      -- active, churned, onboarding
  onboarded_at  TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Brands/queries to monitor per client
CREATE TABLE monitored_queries (
  id            SERIAL PRIMARY KEY,
  client_id     INTEGER REFERENCES clients(id),
  query         TEXT NOT NULL,              -- "best CRM software", "top project management tools"
  category      TEXT,                       -- product category
  priority      TEXT DEFAULT 'normal',      -- high, normal, low
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Individual citation observations
CREATE TABLE citations (
  id            SERIAL PRIMARY KEY,
  query_id      INTEGER REFERENCES monitored_queries(id),
  client_id     INTEGER REFERENCES clients(id),
  engine        TEXT NOT NULL,              -- chatgpt, perplexity, gemini, claude, copilot
  query_text    TEXT NOT NULL,              -- The exact query sent to the engine
  cited         BOOLEAN NOT NULL,           -- Was the client's brand mentioned?
  position      INTEGER,                    -- Position in response (1 = first mentioned, null if not cited)
  context       TEXT,                       -- The surrounding text where citation appeared
  competitors   JSONB,                      -- Other brands mentioned in same response
  response_url  TEXT,                       -- Share link or permalink if available
  observed_at   TIMESTAMP DEFAULT NOW()
);

-- Aggregated citation scores (computed by Lens)
CREATE TABLE citation_scores (
  id            SERIAL PRIMARY KEY,
  client_id     INTEGER REFERENCES clients(id),
  engine        TEXT NOT NULL,
  period        TEXT NOT NULL,              -- 'daily', 'weekly', 'monthly'
  period_start  DATE NOT NULL,
  total_queries INTEGER NOT NULL,
  times_cited   INTEGER NOT NULL,
  avg_position  REAL,
  citation_rate REAL,                       -- times_cited / total_queries
  trend         TEXT,                       -- 'up', 'down', 'stable'
  computed_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE(client_id, engine, period, period_start)
);

-- Sales pipeline (Vanguard + Hunter)
CREATE TABLE prospects (
  id            SERIAL PRIMARY KEY,
  company       TEXT NOT NULL,
  domain        TEXT,
  contact_name  TEXT,
  contact_email TEXT,
  stage         TEXT DEFAULT 'identified',  -- identified, researched, contacted, replied, qualified, closed
  source        TEXT,                       -- how the lead was found
  notes         TEXT,
  last_contact  TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Customer feedback (Signal)
CREATE TABLE feedback (
  id            SERIAL PRIMARY KEY,
  client_id     INTEGER REFERENCES clients(id),
  channel       TEXT,                       -- email, slack, support, nps
  content       TEXT NOT NULL,
  sentiment     TEXT,                       -- positive, neutral, negative
  themes        JSONB,                      -- ['accuracy', 'speed', 'coverage']
  churn_signal  BOOLEAN DEFAULT false,
  resolved      BOOLEAN DEFAULT false,
  received_at   TIMESTAMP DEFAULT NOW()
);

-- Billing events (Ledger)
CREATE TABLE billing_events (
  id            SERIAL PRIMARY KEY,
  client_id     INTEGER REFERENCES clients(id),
  event_type    TEXT NOT NULL,              -- invoice, payment, refund, upgrade, downgrade
  amount_cents  INTEGER,
  description   TEXT,
  invoice_path  TEXT,                       -- path to generated invoice file
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Agent cost tracking (Guardian)
CREATE TABLE agent_costs (
  id            SERIAL PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  tool_calls    INTEGER,
  cost_cents    INTEGER,
  recorded_at   TIMESTAMP DEFAULT NOW()
);
```

**Schema management:**
- Dev: SQLite with these tables auto-created on `abf dev` (via a migration in `tools/schema.sql`)
- Prod: Postgres migration run via `abf migrate` CLI command
- Seed data: `tools/seed.sql` with 2-3 sample clients and monitored queries so CiteRank has something to work with immediately

---

## Implementation Plan

### Phase 1: Foundation (tools that unblock everything)

| Tool | Effort | Dependencies |
|------|--------|-------------|
| `web-search` | 2-3 hours | Brave Search API key |
| `web-fetch` | 2-3 hours | `@mozilla/readability`, `linkedom` |
| `database-query` | 3-4 hours | `better-sqlite3`, `node-sql-parser` |
| `database-write` | 1-2 hours | Same as database-query (shared connection) |
| `file-write` | 1-2 hours | None (Node fs) |
| `file-read` | 1 hour | None (Node fs) |

**After Phase 1:** Scout can search the web, fetch pages, and write citation records to the database. Lens can query citation data and write reports. The core CiteRank loop works.

### Phase 2: Intelligence layer

| Tool | Effort | Dependencies |
|------|--------|-------------|
| `data-transform` | 3-4 hours | None (pure JS) |
| `knowledge-search` | 4-6 hours | Embedding model (OpenAI or Ollama), pgvector for prod |
| `send-message` | 2-3 hours | Existing MessagingRouter |

**After Phase 2:** Lens can compute trends. Sage can search historical insights. Herald can email clients. The full business loop closes.

### Phase 3: CiteRank schema + agents

| Work | Effort |
|------|--------|
| Schema + migrations + seed data | 3-4 hours |
| 14 agent YAML definitions + charters | 6-8 hours |
| 4 team definitions | 1-2 hours |
| 2-3 workflows (onboarding, daily-monitoring, weekly-report) | 2-3 hours |
| CiteRank template for `abf init --template citerank` | 2-3 hours |

**Total estimate:** ~30-40 hours of implementation across all three phases.

---

## Architecture Decisions

### Why built-in tools instead of MCP servers?

MCP is the right answer long-term, but for CiteRank's reference implementation:

1. **Zero setup friction.** `abf init --template citerank && abf dev` should just work. MCP servers require separate processes, configuration, and potentially different runtimes (Python vs Node).
2. **Tighter sandbox integration.** Built-in tools go through `BasicToolSandbox` with cost tracking, timeouts, and behavioral bounds. MCP tools bypass some of this.
3. **Reference quality.** These tools serve as the canonical "how to build an ABF tool" examples for the builder audience.
4. **MCP later.** Once built-in tools prove the interfaces, wrapping them as MCP servers is trivial — the parameter schemas are already JSON Schema compatible.

### Why SQLite for dev instead of just Postgres?

Operators (non-technical users) should be able to run CiteRank locally with zero infrastructure. SQLite means no database server, no connection strings, no Docker dependency for dev mode. The query/write tools abstract the backend — agents write the same SQL either way.

### Why separate `database-query` and `database-write`?

Behavioral bounds enforcement. Most agents should be able to read data but not modify it. By splitting read and write into separate tool IDs, operators control access via the existing `tools:` array in agent YAML. Atlas gets `database-query` only. Scout gets both. Guardian gets `database-query` only. This is the principle of least privilege applied at the tool level — no new runtime machinery needed.

### Why `send-message` defaults to requiring approval?

Outbound communication is the highest-risk action an agent can take. A bug in Scout's charter shouldn't be able to send emails to clients. The `requiresApproval: true` default means every outbound message creates an escalation unless explicitly allowed. Operators can relax this per-agent by adding `send_client_email` to `behavioral_bounds.allowed_actions`.

---

## Open Questions

| Question | Owner | Impact |
|----------|-------|--------|
| Which AI search engines have usable APIs vs. requiring scraping? Perplexity has an API. ChatGPT share links are parseable. Gemini? | Engineering | Determines Scout's monitoring strategy |
| Should `database-write` support DELETE for admin agents (Guardian cleanup tasks)? | Product | Security model decision |
| Do we need a `browser-automate` tool (Playwright) for AI engines without APIs? | Engineering | Significant complexity increase; could defer to v0.2 |
| What embedding model for `knowledge-search` in dev mode (Ollama)? `nomic-embed-text` is fastest, `mxbai-embed-large` is most accurate. | Engineering | Affects dev setup requirements |
| Should CiteRank ship as a separate package (`packages/citerank`) or as a template in the CLI? | Architecture | Affects monorepo structure |
