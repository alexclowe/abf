# Core Concepts

ABF is built on 6 primitives. Every feature in the framework -- from the seed-to-company pipeline to the dashboard to deployment -- maps back to these building blocks. Understanding them is the key to understanding ABF.

---

## The Big Picture

An ABF project is a directory of plain files (YAML, Markdown, JSON) that define a company's AI agent workforce. The ABF runtime reads these files, creates agents, and runs them on a schedule or in response to events.

```
                     +---------+
                     | Trigger |  (cron, event, message, webhook, manual)
                     +----+----+
                          |
                          v
  +-------+        +------+------+        +-----+
  | Agent  | <---> | Session Mgr | <----> | Bus |
  +-------+        +------+------+        +-----+
       |                  |                   |
       v                  v                   v
   +-------+         +--------+         +---------+
   | Tools  |         | Memory |         | Other   |
   +-------+         +--------+         | Agents  |
                                        +---------+
```

A **Trigger** fires, activating an **Agent**. The runtime's Session Manager loads the agent's **Memory** (charter, history, decisions, knowledge), calls the LLM, and enters a **Tool** loop. During execution, the agent can send **Messages** through the **Bus** to other agents. After the session, the agent's learnings are written back to memory.

---

## 1. Agent

An agent is an autonomous AI worker with a defined role, capabilities, and boundaries. Each agent is a single YAML file in the `agents/` directory.

### What makes an agent

| Property | Purpose |
|---|---|
| `name` | Unique identifier (used in file paths, API calls, messages) |
| `role` | Human-readable job title |
| `charter` | Markdown document defining the agent's identity, purpose, and instructions. This is the core of what makes the agent behave the way it does. |
| `provider` + `model` | Which LLM powers this agent (e.g., `anthropic` + `claude-sonnet-4-6`) |
| `tools` | List of tool slugs the agent can use |
| `triggers` | What activates the agent (see Triggers below) |
| `behavioral_bounds` | Hard limits enforced by the runtime, not the LLM |
| `kpis` | Performance metrics the agent tracks |

### Example

```yaml
# agents/scout.agent.yaml
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
  - type: manual
    task: research_scan
behavioral_bounds:
  allowed_actions: [read_data, write_report, send_alert]
  forbidden_actions: [delete_data, modify_billing]
  max_cost_per_session: $1.00
charter: |
  # Scout -- Research Analyst
  You are Scout, the Research Analyst for this founder's team.
  Your purpose is to find, verify, and synthesize information
  that helps the founder make better decisions.
```

### Role archetypes

ABF includes 10 built-in archetypes that provide sensible defaults for common roles: `researcher`, `writer`, `orchestrator`, `analyst`, `customer-support`, `developer`, `marketer`, `finance`, `monitor`, and `generalist`. When you set `role_archetype` in the YAML, the archetype's defaults (temperature, tools, behavioral bounds, charter template) are merged with your explicit values. Your values always win.

```bash
abf agent add --name analyst --archetype analyst --team founders
```

### Behavioral bounds

Behavioral bounds are the most important security mechanism in ABF. Unlike guardrails in the LLM prompt (which can be jailbroken), behavioral bounds are enforced by the runtime before any action executes:

```yaml
behavioral_bounds:
  allowed_actions: [read_data, write_draft, send_alert]
  forbidden_actions: [delete_data, modify_billing, access_credentials]
  max_cost_per_session: $2.00
  max_external_requests: 50
  requires_approval: [publish_content, send_client_email]
```

If an agent tries to perform a forbidden action, the runtime blocks it. If an action requires approval, it is queued in the approval store for a human to review through the Dashboard or API.

---

## 2. Team

A team is a group of agents under an orchestrator. Teams map to business functions: product development, go-to-market, customer support, finance.

### What makes a team

| Property | Purpose |
|---|---|
| `name` | Unique identifier |
| `orchestrator` | The agent that coordinates the team |
| `agents` | List of member agents |
| `shared_memory` | Memory files accessible to all team members |
| `escalation_policy` | Default escalation behavior for the team |

### Example

```yaml
# teams/founders.team.yaml
name: founders
display_name: Founder's Team
description: Core team for solo founder operations.
orchestrator: compass
agents: [compass, scout, scribe]
shared_memory: [decisions.md]
escalation_policy:
  default_target: human
  timeout_minutes: 30
```

### How teams work

The orchestrator agent coordinates work across team members. It can send messages to other agents through the bus, delegate tasks, and synthesize results. In the Solo Founder template, Compass is the orchestrator -- it delegates research to Scout and writing to Scribe, then compiles their outputs into briefings for the founder.

Team members share access to the `memory/decisions.md` file and can read each other's outputs from the `outputs/` directory. This gives agents awareness of what their teammates have produced without requiring direct message exchanges.

---

## 3. Memory

Memory gives agents context and continuity. ABF uses a 5-layer memory system, each layer serving a different purpose.

### The 5 layers

```
+------------------+  Immutable   Identity and purpose
|    Charter       |  Read-only   Loaded every session
+------------------+
|    History       |  Append      Per-agent learnings over time
+------------------+
|    Decisions     |  Append      Team-wide / company-wide decisions
+------------------+
|    Knowledge     |  Editable    Shared Markdown files (company.md, etc.)
+------------------+
|    Session       |  Ephemeral   Current conversation context
+------------------+
```

**Charter** -- The agent's identity document. Defines who the agent is, what it does, and how it should behave. Loaded at the start of every session. Stored at `memory/agents/{name}/charter.md`.

**History** -- Append-only log of what the agent has learned across sessions. Each session can append learnings, but nothing is ever deleted. This gives agents long-term memory that accumulates over time. Stored at `memory/agents/{name}/history.md`.

**Decisions** -- Team-wide and company-wide decisions that all agents should know about. When a team makes a significant decision, it is recorded here and injected into every team member's prompt. Stored at `memory/decisions.md`.

**Knowledge** -- Shared Markdown files in the `knowledge/` directory. These contain company information, brand voice guidelines, product roadmaps, and any other reference material. All knowledge files are injected into every agent's prompt. Agents can search the knowledge base using the `knowledge-search` tool.

**Session** -- Ephemeral context that exists only for the duration of a single agent session. Includes the trigger payload, inbox items, pending messages, and the conversation history with the LLM.

### Cross-agent outputs

In addition to the 5 memory layers, ABF provides a cross-agent output system. After each session, the agent's output is written to `outputs/{agentName}/` as a timestamped Markdown file. When an agent starts a session, it can read recent outputs from its teammates. This gives agents awareness of what others have produced without requiring synchronous communication.

### Storage backends

By default, memory is stored as files on the filesystem (Markdown files). For production deployments, ABF supports PostgreSQL with pgvector for vector similarity search, enabling semantic knowledge retrieval. Configure the backend in `abf.config.yaml`:

```yaml
storage:
  backend: postgres
  connection_string: postgresql://user:pass@host:5432/abf
```

---

## 4. Message Bus

The message bus enables inter-agent communication. Agents send typed messages to each other through the bus, and the bus can trigger activations on receiving agents.

### Message schema

Every message on the bus follows this structure:

```
{
  from:      "scout"              # Sending agent
  to:        "compass"            # Receiving agent (or "*" for broadcast)
  type:      "RESPONSE"           # Message type
  priority:  "normal"             # Routing priority
  context:   "research_results"   # What this message is about
  payload:   { ... }              # Arbitrary data
  timestamp: "2026-03-01T..."     # When sent
  deadline:  "2026-03-01T..."     # Optional: when this becomes stale
}
```

### Message types

| Type | Purpose | Example |
|---|---|---|
| `REQUEST` | Ask another agent to do something | Compass asks Scout to research a topic |
| `RESPONSE` | Reply to a request | Scout returns research results to Compass |
| `ALERT` | Notify about something important | Monitor detects a pricing change |
| `ESCALATION` | Escalate to a human or orchestrator | Agent hits a cost limit |
| `STATUS` | Report current state | Agent reports task completion |
| `BROADCAST` | Send to all agents | Company-wide announcement |

### Message-based triggers

When an agent has a `message` trigger, incoming messages from the specified sender automatically activate the agent:

```yaml
triggers:
  - type: message
    from: compass
    task: on_demand_research
```

This means Compass can delegate work to Scout simply by sending a message through the bus.

### Backends

The bus supports two backends:

- **In-process** (default) -- Messages are routed in memory. Suitable for development and single-server deployments. No external dependencies.
- **Redis / BullMQ** -- Durable message queues with retry, dead-letter, and priority routing. Required for production deployments where message durability matters.

Configure in `abf.config.yaml`:

```yaml
bus:
  backend: redis
  url: redis://localhost:6379
```

---

## 5. Tools

Tools are the capabilities available to agents. An agent can only use the tools explicitly listed in its YAML definition. Agents cannot install or enable tools at runtime -- the tool surface is locked by the operator.

### Three sources of tools

**Built-in tools** -- 30+ tools shipped with ABF. These include web search, database query/write, file read/write, knowledge search, email send, message sending, and more. Each tool has a defined input schema (JSON Schema) and a handler function.

**MCP servers** -- ABF supports the Model Context Protocol (MCP) standard. Configure external MCP servers in `tools/mcp-servers.yaml`, and their tools become available to agents by slug.

**Custom tools** -- Operator-written JavaScript handlers for project-specific capabilities. Create a `tools/my-tool.tool.yaml` (definition with JSON Schema parameters) and `tools/my-tool.tool.js` (handler function), and reference the tool slug in agent YAML.

### How tools execute

When an LLM requests a tool call during a session:

1. The runtime checks the tool is in the agent's allowed tool list
2. The runtime validates the call against behavioral bounds
3. If the tool requires approval, the call is queued (not executed)
4. Otherwise, the handler executes with the provided parameters
5. The result is returned to the LLM for the next iteration of the tool loop

### Example: Custom tool

```yaml
# tools/calculate-roi.tool.yaml
name: calculate-roi
description: Calculate return on investment for a marketing campaign.
parameters:
  type: object
  properties:
    investment:
      type: number
      description: Total investment amount in dollars
    revenue:
      type: number
      description: Total revenue generated in dollars
  required: [investment, revenue]
```

```javascript
// tools/calculate-roi.tool.js
export default async function handler(params, context) {
  const roi = ((params.revenue - params.investment) / params.investment) * 100;
  return { roi: roi.toFixed(2) + '%', profit: params.revenue - params.investment };
}
```

Then reference it in an agent:

```yaml
tools: [calculate-roi, web-search, knowledge-search]
```

---

## 6. Triggers

Triggers define what activates an agent. An agent does nothing until a trigger fires.

### Trigger types

| Type | How It Works | Example |
|---|---|---|
| `cron` | Fires on a schedule (cron syntax) | `'0 9 * * 1-5'` = weekdays at 9am |
| `event` | Fires when a named event occurs | Monitor detects a URL change |
| `message` | Fires when a message arrives from a specific agent | Compass sends a task to Scout |
| `webhook` | Fires when an HTTP request hits the webhook endpoint | External service posts data |
| `manual` | Fires when a human triggers it via CLI or Dashboard | `abf run scout --task research_scan` |

### Example: Multiple triggers

An agent can have multiple triggers, each activating a different task:

```yaml
triggers:
  - type: cron
    schedule: '0 9 * * 1-5'       # Weekday mornings
    task: daily_briefing

  - type: message
    from: compass                   # When Compass sends a message
    task: on_demand_research

  - type: webhook
    task: process_webhook

  - type: manual                    # CLI: abf run scout --task research_scan
    task: research_scan
```

### Heartbeat triggers

Agents can reschedule themselves using the `reschedule` tool. This creates a one-shot heartbeat trigger that fires after a specified delay. Useful for agents that need to check back on something later or implement polling patterns.

---

## How They Work Together

Here is a concrete example of all 6 primitives working together in the Solo Founder template:

1. **Trigger**: It is 9:00 AM on Monday. A `cron` trigger fires for Compass.

2. **Agent**: Compass (orchestrator) activates. The runtime loads its charter, history, decisions, and knowledge.

3. **Memory**: Compass reads its charter ("You are the Executive Assistant"), recent history ("Last week the founder asked to prioritize marketing"), decisions.md, and all knowledge files.

4. **Tools**: Compass uses `send-message` to delegate a research task to Scout.

5. **Bus**: The message `{ from: "compass", to: "scout", type: "REQUEST", payload: { task: "research competitor pricing" } }` is placed on the bus.

6. **Trigger**: Scout has a `message` trigger from Compass. The bus activates Scout.

7. **Agent**: Scout activates. It loads its own memory plus Compass's message as context.

8. **Tools**: Scout uses `web-search` to find competitor pricing data, then `file-write` to save results.

9. **Memory**: Scout appends learnings to `memory/agents/scout/history.md`. Output is written to `outputs/scout/2026-03-01T09-05-00.md`.

10. **Bus**: Scout sends a `RESPONSE` message back to Compass with the results.

11. The cycle continues: Compass reads Scout's results and Scribe's latest drafts (from `outputs/`), compiles a daily briefing, and writes it to its own output file for the founder to read.

---

## Next Steps

Now that you understand the building blocks:

- [Getting Started](getting-started.md) -- Create and run your first project
- [Seed-to-Company Guide](guides/seed-to-company.md) -- Generate a custom agent team from a business plan
- [API Reference](api-reference.md) -- All REST endpoints for programmatic control
- [Self-Hosting Guide](self-hosting.md) -- Deploy to production
