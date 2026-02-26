# ABF API Reference

The ABF runtime exposes a REST API via the HTTP Gateway (Hono). All endpoints run on the configured gateway port (default: `3000`).

---

## 1. Authentication

When the `ABF_API_KEY` environment variable is set, all `/api/*`, `/webhook/*`, and `/auth/*` routes require authentication.

Pass the key in the `Authorization` header:

```
Authorization: Bearer <ABF_API_KEY>
```

For the SSE events endpoint (`/api/events`), the `EventSource` browser API cannot send custom headers. Pass the key as a query parameter instead:

```
GET /api/events?token=<ABF_API_KEY>
```

When `ABF_API_KEY` is not set, all routes are unauthenticated (useful for local development).

CORS is restricted to origins configured via `ABF_CORS_ORIGINS` (comma-separated). Defaults to `http://localhost:3000` and `http://localhost:3001`.

---

## 2. System

### GET /health

Returns the current health of the runtime. Does not require authentication (no auth middleware is applied).

**Auth**: None

**Response**:
```json
{
  "status": "ok",
  "agents": 5,
  "activeSessions": 1,
  "uptime": 3600.42
}
```

| Field | Type | Description |
|---|---|---|
| `status` | `"ok"` | Always `"ok"` if the process is running |
| `agents` | number | Number of loaded agents |
| `activeSessions` | number | Number of currently running sessions |
| `uptime` | number | Process uptime in seconds |

---

### GET /api/status

Returns runtime version and status.

**Auth**: Required (when `ABF_API_KEY` is set)

**Response**:
```json
{
  "version": "1.0.0",
  "uptime": 3600.42,
  "name": "ABF Runtime",
  "agents": 5,
  "activeSessions": 1,
  "configured": true
}
```

| Field | Type | Description |
|---|---|---|
| `version` | string | ABF runtime version |
| `uptime` | number | Process uptime in seconds |
| `name` | string | Always `"ABF Runtime"` |
| `agents` | number | Number of loaded agents |
| `activeSessions` | number | Number of currently running sessions |
| `configured` | boolean | `true` if at least one agent is loaded |

---

## 3. Agents

### GET /api/agents

Returns all loaded agents with their current runtime state.

**Auth**: Required (when `ABF_API_KEY` is set)

**Response**: Array of objects:
```json
[
  {
    "config": { AgentConfig },
    "state": { AgentState } | null
  }
]
```

`AgentConfig` fields:

| Field | Type |
|---|---|
| `id` | string (AgentId) |
| `name` | string |
| `displayName` | string |
| `role` | string |
| `description` | string |
| `roleArchetype` | string or undefined |
| `provider` | string |
| `model` | string |
| `temperature` | number or undefined |
| `team` | string (TeamId) or undefined |
| `reportsTo` | string (AgentId) or undefined |
| `tools` | string[] |
| `triggers` | TriggerConfig[] |
| `escalationRules` | EscalationRule[] |
| `behavioralBounds` | BehavioralBounds |
| `kpis` | KPIDefinition[] |
| `charter` | string |

`AgentState` fields:

| Field | Type |
|---|---|
| `id` | string (AgentId) |
| `status` | `"idle"` \| `"active"` \| `"waiting"` \| `"error"` \| `"disabled"` |
| `lastActive` | ISO timestamp or undefined |
| `currentSessionCost` | number (USD cents) |
| `totalCost` | number (USD cents) |
| `sessionsCompleted` | number |
| `errorCount` | number |

---

### GET /api/agents/:id

Returns a single agent with its config, runtime state, and full memory context.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `id` — the agent's ID

**Response**:
```json
{
  "config": { AgentConfig },
  "state": { AgentState } | null,
  "memory": { AgentMemoryContext } | null
}
```

`AgentMemoryContext` fields:

| Field | Type |
|---|---|
| `charter` | string |
| `history` | MemoryEntry[] |
| `decisions` | MemoryEntry[] |
| `knowledge` | Record&lt;string, string&gt; — filename to content |
| `pendingMessages` | number |

Returns `404` if the agent ID is not found.

---

### POST /api/agents/:id/run

Manually trigger an agent to run a session.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `id` — the agent's ID

**Request body**:

| Field | Type | Required | Description |
|---|---|---|---|
| `task` | string | No | Task name passed to the trigger. Defaults to `"manual"` |
| `payload` | object | No | Arbitrary key-value data injected into the activation context |

**Response** (HTTP 202):
```json
{ "sessionId": "ses_abc123" }
```

Returns `404` if the agent is not found. Returns `400` if the dispatcher rejects the activation (e.g., agent already at concurrency limit).

---

### GET /api/agents/:id/memory

Returns only the memory context for an agent without the full config and state.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `id` — the agent's ID

**Response**: `AgentMemoryContext` object (same shape as the `memory` field in `GET /api/agents/:id`)

Returns `404` if the agent ID is not found. Returns `500` if the memory store fails to load.

---

### GET /api/agents/:id/inbox

Returns pending inbox items for an agent without consuming them.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `id` — the agent's ID

**Response**: Array of `InboxItem` objects:

| Field | Type |
|---|---|
| `id` | string |
| `agentId` | string (AgentId) |
| `source` | `"human"` \| `"webhook"` \| `"bus"` \| `"agent"` |
| `priority` | `"low"` \| `"normal"` \| `"high"` \| `"urgent"` |
| `subject` | string |
| `body` | string |
| `from` | string or undefined |
| `createdAt` | ISO timestamp |
| `consumed` | boolean |

Only available when the inbox component is configured. Returns an empty array otherwise.

---

### POST /api/agents/:id/inbox

Push a task into an agent's inbox.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `id` — the agent's ID

**Request body**:

| Field | Type | Required | Description |
|---|---|---|---|
| `subject` | string | Yes | Short title for the task |
| `body` | string | Yes | Full task description |
| `priority` | `"low"` \| `"normal"` \| `"high"` \| `"urgent"` | No | Defaults to `"normal"` |
| `from` | string | No | Sender identifier |

**Response**:
```json
{ "id": "inbox_xyz", "queued": true }
```

Only available when the inbox component is configured.

---

## 4. Sessions

### GET /api/sessions

Returns all currently active (in-progress) sessions.

**Auth**: Required (when `ABF_API_KEY` is set)

**Response**: Array of `WorkSession` objects:

| Field | Type |
|---|---|
| `context.sessionId` | string (SessionId) |
| `context.agentId` | string (AgentId) |
| `context.activation` | Activation object |
| `context.startedAt` | ISO timestamp |
| `status` | `"completed"` \| `"failed"` \| `"escalated"` \| `"timeout"` |
| `toolCalls` | ToolCall[] |
| `toolResults` | ToolResult[] |
| `messagesEmitted` | BusMessage[] |
| `escalations` | Escalation[] |
| `tokenUsage` | TokenUsage |
| `cost` | number (USD cents) |

---

### GET /api/sessions/:id

Returns the result of a completed session by session ID.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `id` — the session ID

**Response**: `SessionResult` object:

| Field | Type |
|---|---|
| `sessionId` | string (SessionId) |
| `agentId` | string (AgentId) |
| `status` | `"completed"` \| `"failed"` \| `"escalated"` \| `"timeout"` |
| `startedAt` | ISO timestamp |
| `completedAt` | ISO timestamp |
| `toolCalls` | ToolCall[] |
| `toolResults` | ToolResult[] |
| `messagesEmitted` | BusMessage[] |
| `escalations` | Escalation[] |
| `kpiReports` | KPIReport[] |
| `tokenUsage` | TokenUsage |
| `cost` | number (USD cents) |
| `memoryUpdates` | string[] |
| `outputText` | string or undefined |
| `rescheduleIn` | number (seconds) or undefined |
| `error` | string or undefined |

Returns `404` if the session ID is not found in the completed session store.

---

## 5. Teams

### GET /api/teams

Returns all team configurations loaded from the `teams/` directory.

**Auth**: Required (when `ABF_API_KEY` is set)

**Response**: Array of team config objects. Returns `[]` if the teams directory cannot be read.

Team config fields (from `*.team.yaml`):

| Field | Type |
|---|---|
| `name` | string |
| `display_name` | string |
| `description` | string |
| `orchestrator` | string (agent name) |
| `agents` | string[] |
| `shared_memory` | string[] |
| `escalation_policy` | object |

---

## 6. Escalations

### GET /api/escalations

Returns all escalations (both resolved and unresolved).

**Auth**: Required (when `ABF_API_KEY` is set)

**Response**: Array of `EscalationItem` objects:

| Field | Type |
|---|---|
| `id` | string |
| `agentId` | string (AgentId) |
| `sessionId` | string (SessionId) |
| `type` | `"cost"` \| `"error"` \| `"approval"` \| `"bounds"` \| `"custom"` |
| `message` | string |
| `target` | `"human"` \| agent ID |
| `timestamp` | ISO timestamp |
| `resolved` | boolean |

---

### POST /api/escalations/:id/resolve

Mark an escalation as resolved.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `id` — the escalation ID

**Response**:
```json
{ "resolved": true }
```

Returns `404` if the escalation ID is not found.

---

## 7. Approvals

The approval endpoints are only available when the `approvalStore` component is configured.

### GET /api/approvals

List approval requests, optionally filtered.

**Auth**: Required (when `ABF_API_KEY` is set)

**Query parameters**:

| Parameter | Values | Description |
|---|---|---|
| `status` | `pending` \| `approved` \| `rejected` | Filter by approval status |
| `agentId` | string | Filter by originating agent ID |

**Response**: Array of `ApprovalRequest` objects:

| Field | Type |
|---|---|
| `id` | string |
| `agentId` | string (AgentId) |
| `sessionId` | string (SessionId) |
| `toolId` | string (ToolId) |
| `toolName` | string |
| `arguments` | Record&lt;string, unknown&gt; |
| `createdAt` | ISO timestamp |
| `status` | `"pending"` \| `"approved"` \| `"rejected"` |
| `resolvedAt` | ISO timestamp or undefined |
| `resolvedBy` | string or undefined |

---

### GET /api/approvals/:id

Get a single approval request by ID.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `id` — the approval request ID

**Response**: Single `ApprovalRequest` object (same shape as above)

Returns `404` if the approval ID is not found.

---

### POST /api/approvals/:id/approve

Approve a pending approval request.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `id` — the approval request ID

**Request body**: None

**Response**:
```json
{ "approved": true }
```

Returns `404` if the approval ID is not found or is already resolved.

---

### POST /api/approvals/:id/reject

Reject a pending approval request.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `id` — the approval request ID

**Request body**: None

**Response**:
```json
{ "rejected": true }
```

Returns `404` if the approval ID is not found or is already resolved.

---

## 8. Workflows

Workflow endpoints require the `workflowRunner` and `workflowsDir` dependencies to be configured. `GET /api/workflows` returns `[]` when not configured.

### GET /api/workflows

List all workflow definitions from the `workflows/` directory.

**Auth**: Required (when `ABF_API_KEY` is set)

**Response**: Array of `WorkflowDefinition` objects:

| Field | Type |
|---|---|
| `id` | string (WorkflowId) |
| `name` | string |
| `displayName` | string |
| `description` | string or undefined |
| `steps` | WorkflowStep[] |
| `timeout` | number or undefined |
| `onFailure` | `"stop"` \| `"continue"` \| `"retry"` |

---

### GET /api/workflows/runs/:runId

Get the result of a workflow run by run ID.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `runId` — the run ID returned by `POST /api/workflows/:name/run`

**Response**: `WorkflowRun` object:

| Field | Type |
|---|---|
| `id` | string |
| `workflowName` | string |
| `status` | `"pending"` \| `"running"` \| `"completed"` \| `"failed"` \| `"timeout"` |
| `input` | Record&lt;string, unknown&gt; |
| `startedAt` | string (ISO timestamp) |
| `completedAt` | string or undefined |
| `steps` | WorkflowStepResult[] |

`WorkflowStepResult` fields:

| Field | Type |
|---|---|
| `stepId` | string |
| `agentName` | string |
| `sessionId` | string |
| `status` | WorkflowRunStatus |
| `startedAt` | string |
| `completedAt` | string or undefined |
| `error` | string or undefined |

Returns `404` if the run ID is not found. The gateway stores up to the most recent 100 runs in memory.

---

### GET /api/workflows/:name

Get a single workflow definition by name.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `name` — the workflow's `name` field from its YAML definition

**Response**: Single `WorkflowDefinition` object

Returns `404` if the workflow is not found or workflows are not configured. Returns `500` if the workflows directory cannot be read.

---

### POST /api/workflows/:name/run

Trigger a workflow run asynchronously.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `name` — the workflow name

**Request body**:

| Field | Type | Required | Description |
|---|---|---|---|
| `input` | object | No | Key-value data passed as input to the workflow |

**Response** (HTTP 202):
```json
{ "runId": "abc123xyz" }
```

The workflow executes in the background. Poll `GET /api/workflows/runs/:runId` for status.

Returns `404` if the workflow is not found. Returns `501` if workflows are not configured.

---

## 9. Metrics

Metrics endpoints require the `metricsCollector` component to be configured.

### GET /api/metrics/runtime

Returns aggregated runtime statistics.

**Auth**: Required (when `ABF_API_KEY` is set)

**Response**: `RuntimeMetrics` object:

| Field | Type |
|---|---|
| `activeSessions` | number |
| `totalEscalations` | number |
| `resolvedEscalations` | number |
| `agentCount` | number |
| `sessionHistory` | SessionSnapshot[] |

`SessionSnapshot`:

| Field | Type |
|---|---|
| `agentId` | string |
| `sessionId` | string |
| `startedAt` | string |

---

### GET /api/metrics/agents

Returns per-agent runtime state for all loaded agents.

**Auth**: Required (when `ABF_API_KEY` is set)

**Response**: Array of `AgentState` objects (same shape as the `state` field in the agents endpoints).

---

### GET /api/metrics/kpis

Returns KPI report history.

**Auth**: Required (when `ABF_API_KEY` is set)

**Query parameters**:

| Parameter | Description |
|---|---|
| `agentId` | Filter to a specific agent's KPI history |

**Response**: Array of `KPIReport` objects:

| Field | Type |
|---|---|
| `metric` | string |
| `value` | string |
| `target` | string |
| `met` | boolean |
| `timestamp` | ISO timestamp |

---

## 10. KPIs

### GET /api/kpis

Returns the raw KPI report history from the dispatcher. Unlike `/api/metrics/kpis`, this endpoint does not require the metrics collector to be configured.

**Auth**: Required (when `ABF_API_KEY` is set)

**Query parameters**:

| Parameter | Description |
|---|---|
| `agentId` | Filter to a specific agent |
| `metric` | Case-insensitive substring match on the metric name |
| `limit` | Maximum number of reports to return (default: 200). Returns the most recent N records |

**Response**: Array of `KPIReport` objects (same shape as `/api/metrics/kpis`)

---

## 11. Messages

### GET /api/messages/:agentId

Returns pending and recent message history for an agent from the message bus.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `agentId` — the agent's ID

**Response**:
```json
{
  "pending": [ BusMessage ],
  "history": [ BusMessage ]
}
```

History is limited to the 50 most recent messages.

`BusMessage` fields:

| Field | Type |
|---|---|
| `id` | string (MessageId) |
| `from` | string (AgentId) |
| `to` | string (AgentId) or `"*"` (broadcast) |
| `type` | `"REQUEST"` \| `"RESPONSE"` \| `"ALERT"` \| `"ESCALATION"` \| `"STATUS"` \| `"BROADCAST"` |
| `priority` | `"low"` \| `"normal"` \| `"high"` \| `"critical"` |
| `context` | string |
| `payload` | Record&lt;string, unknown&gt; |
| `timestamp` | ISO timestamp |
| `deadline` | ISO timestamp or undefined |
| `replyTo` | string (MessageId) or undefined |

---

## 12. Providers and Archetypes

### GET /api/providers

Returns all registered LLM providers with their available models. Results are cached for 1 hour.

**Auth**: Required (when `ABF_API_KEY` is set)

**Response**: Array of provider status objects:

| Field | Type |
|---|---|
| `id` | string |
| `name` | string |
| `slug` | string |
| `authType` | `"oauth"` \| `"api_key"` \| `"local"` |
| `models` | ModelInfo[] — empty array if the provider is unreachable |

---

### GET /api/archetypes

Returns all built-in role archetypes and their default settings.

**Auth**: Required (when `ABF_API_KEY` is set)

**Response**: Array of archetype objects:

| Field | Type |
|---|---|
| `name` | string — archetype slug (e.g., `"researcher"`, `"writer"`) |
| `temperature` | number |
| `tools` | string[] |
| `allowedActions` | string[] |
| `forbiddenActions` | string[] |

The 10 built-in archetypes are: `researcher`, `writer`, `orchestrator`, `analyst`, `customer-support`, `developer`, `marketer`, `finance`, `monitor`, `generalist`.

---

### GET /api/workflow-templates

Returns all built-in workflow templates.

**Auth**: Required (when `ABF_API_KEY` is set)

**Response**: Array of workflow template summary objects:

| Field | Type |
|---|---|
| `name` | string |
| `displayName` | string |
| `description` | string |
| `pattern` | string |
| `stepsCount` | number |

The 3 built-in templates are: `fan-out-synthesize`, `sequential-pipeline`, `event-triggered`.

---

## 13. Seed Pipeline

The seed pipeline converts a business description into a running agent team. These endpoints require the `scheduler` dependency to be present.

### POST /api/seed/upload

Parse a document into plain text for use with `/api/seed/analyze`.

**Auth**: Required (when `ABF_API_KEY` is set)

**Request body**:

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | Yes | Raw text (for `.txt`/`.md`) or base64-encoded binary (for `.docx`/`.pdf`) |
| `format` | `"docx"` \| `"pdf"` \| `"txt"` \| `"md"` | No | If `docx` or `pdf`, `text` is treated as base64. Otherwise treated as plain text |

**Response**:
```json
{
  "text": "Extracted plain text content...",
  "wordCount": 842
}
```

Returns `400` if `text` is missing. Returns `500` on parse failure.

---

### POST /api/seed/analyze

Analyze a seed document text via LLM and return a structured `CompanyPlan`.

**Auth**: Required (when `ABF_API_KEY` is set)

**Request body**:

| Field | Type | Required | Description |
|---|---|---|---|
| `seedText` | string | Yes | Plain text of the business description or plan |
| `provider` | string | No | LLM provider slug. Defaults to `"anthropic"` |
| `model` | string | No | Model name. Defaults to `"claude-sonnet-4-5"` |

**Response**: `CompanyPlan` object:

| Field | Type |
|---|---|
| `company` | CompanyInfo — `{ name, description, mission?, targetCustomer?, revenueModel?, industry?, stage? }` |
| `agents` | AgentPlan[] |
| `teams` | TeamPlan[] — `{ name, displayName, description, orchestrator, members[] }` |
| `knowledge` | Record&lt;string, string&gt; — filename to Markdown content |
| `workflows` | WorkflowPlan[] |
| `escalationRules` | EscalationRule[] — `{ condition, target, description }` |
| `toolGaps` | ToolGap[] — `{ capability, mentionedIn, suggestion, priority }` |
| `generatedAt` | ISO timestamp string |
| `seedVersion` | number |
| `seedText` | string |

Returns `400` if `seedText` is missing. Returns `500` if the LLM call or JSON parsing fails.

---

### POST /api/seed/apply

Write the files from a `CompanyPlan` to disk and hot-reload the agents into the live runtime.

**Auth**: Required (when `ABF_API_KEY` is set)

**Request body**:

| Field | Type | Required | Description |
|---|---|---|---|
| `plan` | CompanyPlan | Yes | The plan returned by `/api/seed/analyze` |
| `provider` | string | No | LLM provider for generating agent charters. Defaults to `"anthropic"` |
| `model` | string | No | Model name. Defaults to `"claude-sonnet-4-5"` |

**Response**:
```json
{
  "success": true,
  "filesWritten": 14,
  "agents": [
    { "id": "scout", "name": "scout", "displayName": "Research Analyst", "role": "Researcher" }
  ]
}
```

| Field | Type |
|---|---|
| `success` | boolean |
| `filesWritten` | number |
| `agents` | Array of `{ id, name, displayName, role }` for all agents after reload |

Returns `400` if `plan` is missing. Returns `500` if file writing or agent reloading fails.

---

### POST /api/seed/interview/start

Start an interactive interview session that builds a seed document through Q&A.

**Auth**: Required (when `ABF_API_KEY` is set)

**Request body**:

| Field | Type | Required | Description |
|---|---|---|---|
| `companyType` | `"new"` \| `"existing"` | Yes | Whether this is a new idea or an existing company |
| `provider` | string | No | LLM provider. Defaults to `"anthropic"` |
| `model` | string | No | Model name. Defaults to `"claude-sonnet-4-5"` |

**Response**:
```json
{
  "sessionId": "sess_abc123",
  "step": {
    "question": "What problem does your company solve?",
    "progress": "1 of 8",
    "complete": false,
    "seedText": null
  }
}
```

| Field | Type |
|---|---|
| `sessionId` | string — use in subsequent `/respond` calls |
| `step` | InterviewStep object |

`InterviewStep` fields:

| Field | Type |
|---|---|
| `question` | string or null — null when complete |
| `progress` | string — e.g., `"3 of 8"` |
| `complete` | boolean |
| `seedText` | string or undefined — only present when `complete` is `true` |

---

### POST /api/seed/interview/:sessionId/respond

Submit an answer to the current interview question.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `sessionId` — from the `/start` response

**Request body**:

| Field | Type | Required | Description |
|---|---|---|---|
| `answer` | string | Yes | The user's answer to the current question |

**Response**: `InterviewStep` object (same shape as in `/start`)

Returns `400` if `answer` is missing or if no interview engine has been initialized. Returns `404` if the session ID is not found.

---

### GET /api/seed/interview/:sessionId

Get the current state of an interview session.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `sessionId` — the session ID

**Response**: `InterviewSession` object:

| Field | Type |
|---|---|
| `id` | string |
| `status` | `"active"` \| `"completed"` \| `"abandoned"` |
| `companyType` | `"new"` \| `"existing"` |
| `answers` | InterviewAnswer[] — `{ question, answer, timestamp }` |
| `seedText` | string or undefined — populated when complete |
| `createdAt` | string (ISO timestamp) |
| `updatedAt` | string (ISO timestamp) |

Returns `404` if the session is not found or no interview engine exists.

---

### POST /api/seed/reanalyze

Re-analyze an updated seed document against an existing `CompanyPlan`. Produces an updated plan that reflects only the changes, incrementing `seedVersion`.

**Auth**: Required (when `ABF_API_KEY` is set)

**Request body**:

| Field | Type | Required | Description |
|---|---|---|---|
| `originalSeedText` | string | Yes | The original seed document text |
| `updatedSeedText` | string | Yes | The revised seed document text |
| `currentPlan` | CompanyPlan | Yes | The previously generated plan to update |
| `provider` | string | No | LLM provider. Defaults to `"anthropic"` |
| `model` | string | No | Model name. Defaults to `"claude-sonnet-4-5"` |

**Response**: Updated `CompanyPlan` object (same shape as `/api/seed/analyze`) with `seedVersion` incremented.

Returns `400` if any required field is missing. Returns `500` on LLM or parse failure.

---

## 14. Auth Management

These routes manage provider API keys stored in the encrypted credential vault. Rate-limited to 5 attempts per IP per provider per minute. Requires the `vault` dependency to be configured.

### POST /auth/key/:provider

Validate and store an API key for a provider.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `provider` — one of `anthropic`, `openai`, `brave-search`

**Request body**:

| Field | Type | Required | Description |
|---|---|---|---|
| `key` | string | Yes | The API key to validate and store |

Validation checks the key prefix (`sk-ant-` for Anthropic, `sk-` for OpenAI, `BSA` for Brave Search) and makes a live network call to the provider to confirm the key is valid.

**Response** on success:
```json
{ "connected": true }
```

**Response** on failure (HTTP 200):
```json
{ "connected": false, "error": "Invalid API key" }
```

Returns `400` for unknown provider or missing key. Returns `429` when rate limit is exceeded.

---

### GET /auth/status

Returns connection status for all providers including Ollama auto-detection.

**Auth**: Required (when `ABF_API_KEY` is set)

**Response**: Object keyed by provider slug:

```json
{
  "anthropic": { "connected": true },
  "openai": { "connected": false },
  "brave-search": { "connected": false, "optional": true, "description": "Enables the web-search tool for agents" },
  "ollama": { "connected": true, "models": ["llama3.2", "mistral"], "local": true }
}
```

A provider is `connected` if its key is stored in the vault or its corresponding environment variable is set (e.g., `ANTHROPIC_API_KEY`). Ollama is detected by probing `http://localhost:11434/api/tags` with a 2-second timeout.

---

### DELETE /auth/:provider

Remove a stored provider API key from the vault.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path parameter**: `provider` — one of `anthropic`, `openai`, `brave-search`

**Response**:
```json
{ "disconnected": true }
```

Returns `400` for unknown provider. Returns `429` when rate limit is exceeded.

---

### GET /auth/ollama/detect

Probe Ollama directly with a 3-second timeout and return available model details.

**Auth**: Required (when `ABF_API_KEY` is set)

**Response** when detected:
```json
{
  "detected": true,
  "models": [
    { "name": "llama3.2", "size": 2000000000 }
  ],
  "baseUrl": "http://localhost:11434"
}
```

**Response** when not detected:
```json
{ "detected": false }
```

---

### GET /auth/providers

List available provider configurations (for display in the Dashboard setup wizard).

**Auth**: Required (when `ABF_API_KEY` is set)

**Response**: Array of provider config objects:

| Field | Type |
|---|---|
| `id` | string — provider slug |
| `displayName` | string |
| `keyPrefix` | string — expected key prefix (for client-side validation) |
| `deepLink` | string — URL to create an API key at the provider's console |
| `optional` | boolean |
| `description` | string or undefined |

---

## 15. Setup

### POST /api/projects

Initialize a project from a built-in template. Generates agent YAML, team YAML, and knowledge files, then hot-reloads agents into the live runtime. Requires the `scheduler` dependency.

**Auth**: Required (when `ABF_API_KEY` is set)

**Request body**:

| Field | Type | Required | Description |
|---|---|---|---|
| `projectName` | string | Yes | Alphanumeric name (hyphens and underscores allowed) |
| `template` | string | No | One of `solo-founder`, `saas`, `marketing-agency`, `custom`. Defaults to `"custom"` |
| `provider` | string | No | LLM provider for generated agents. Defaults to `"anthropic"` |

**Response**:
```json
{
  "success": true,
  "template": "saas",
  "agents": [
    { "id": "atlas", "name": "atlas", "displayName": "Product Orchestrator", "role": "Orchestrator" }
  ],
  "newAgents": 5
}
```

| Field | Type |
|---|---|
| `success` | boolean |
| `template` | string — the template used |
| `agents` | Array of `{ id, name, displayName, role }` for all currently loaded agents |
| `newAgents` | number — count of newly registered agents in this call |

Returns `400` if `projectName` is missing, contains invalid characters, or `template` is not a valid value. Returns `500` if file writing or agent loading fails.

---

## 16. Webhooks

### POST /webhook/*

Receives webhook events from external services and passes them to the configured webhook handler.

**Auth**: Required (when `ABF_API_KEY` is set)

**Path**: Any path under `/webhook/`. The path after `/webhook/` is extracted and passed to the handler (e.g., `/webhook/github/push` → `"github/push"`).

**Request body**: Any JSON body.

**Response**: The return value of the `onWebhook` handler, or:
```json
{ "received": true }
```

If no `onWebhook` handler is configured, always returns `{ "received": true }`.

---

## 17. Events (SSE)

### GET /api/events

A Server-Sent Events (SSE) endpoint that streams real-time runtime snapshots every 2 seconds. Used by the Dashboard to replace per-page polling.

**Auth**: Because `EventSource` cannot send custom headers, pass the API key as a query parameter when `ABF_API_KEY` is set:

```
GET /api/events?token=<ABF_API_KEY>
```

The standard `Authorization: Bearer <key>` header is also accepted (for non-browser clients).

**Event format**:

```
event: snapshot
id: 42
data: { ... }
```

Each `snapshot` event's `data` is a JSON object:

| Field | Type |
|---|---|
| `status.version` | string |
| `status.uptime` | number |
| `status.agents` | number |
| `runtime` | RuntimeMetrics object (or simplified fallback with `activeSessions`, `agentCount`, `totalEscalations`, `resolvedEscalations`) |
| `agents` | AgentState[] — per-agent states (or `[]` if metrics collector is not configured) |
| `escalations` | EscalationItem[] — all current escalations |

The stream continues until the client disconnects. Returns `401` if authentication fails.

---

## 18. Audit

### GET /api/audit

Query the audit trail for security and operational events.

**Auth**: Required (when `ABF_API_KEY` is set)

**Query parameters**:

| Parameter | Description |
|---|---|
| `agentId` | Filter to a specific agent |
| `since` | ISO timestamp — return only entries at or after this time |
| `limit` | Maximum number of entries to return (default: 100) |

**Response**: Array of `AuditEntry` objects:

| Field | Type |
|---|---|
| `timestamp` | ISO timestamp |
| `eventType` | One of: `session_start`, `session_end`, `tool_call`, `tool_result`, `message_sent`, `message_received`, `memory_read`, `memory_write`, `escalation`, `bounds_check`, `injection_detected`, `credential_access`, `config_change` |
| `agentId` | string (AgentId) |
| `sessionId` | string (SessionId) or undefined |
| `details` | Record&lt;string, unknown&gt; — event-specific details |
| `severity` | `"info"` \| `"warn"` \| `"error"` \| `"security"` |

Returns `500` if the audit store query fails.
