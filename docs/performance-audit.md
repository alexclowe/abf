# ABF Performance Audit

**Date**: 2026-03-01
**Auditor**: Performance Engineering (Claude Opus 4.6)
**Scope**: Full runtime, memory, bus, gateway, dashboard, scheduler, tools, build pipeline
**Codebase commit**: `e696744` (feat/cloud-proxy-plugin-registry)

---

## Executive Summary -- Top 5 Performance Wins

| # | Finding | Impact | Effort | Est. Improvement |
|---|---------|--------|--------|------------------|
| 1 | **SSE snapshot broadcasts full agent configs+state every 2s to every client** | Critical | Low | 60-80% reduction in SSE bandwidth; eliminates redundant serialization |
| 2 | **Session timeout timer leaks on every session** | Critical | Low | Prevents Node.js timer accumulation and eventual OOM in long-running processes |
| 3 | **Filesystem memory store re-reads entire history file after every append** | High | Low | Eliminates doubled I/O on every agent session write |
| 4 | **Knowledge files re-loaded from disk on every session start** | High | Medium | Eliminates repeated disk I/O for unchanged files across all agent sessions |
| 5 | **Dispatcher dispatchAndWait uses 250ms busy-poll loop** | High | Medium | Replaces CPU-burning spin loop with event-driven completion notification |

---

## Critical Findings

### C1. Session Timeout Timer Never Cleared

**Files**: `/home/alex/abf/packages/core/src/runtime/session-manager.ts` (lines 124-135)

**Description**: The `execute()` method creates a `setTimeout` that rejects a promise after `sessionTimeoutMs`. However, when the session completes normally (before the timeout), the timer is never cleared. This means every successful session leaves a dangling timer in the Node.js event loop. Over hours of operation with many sessions, this accumulates thousands of orphaned timers, increasing memory usage and keeping the event loop busy.

```typescript
// Current: timer is never cleared on normal completion
const timeoutPromise = new Promise<never>((_, reject) =>
  setTimeout(
    () => reject(new ABFErrorClass('SESSION_TIMEOUT', ...)),
    this.deps.sessionTimeoutMs,
  ),
);
```

**Impact**: Memory leak proportional to session count. In a production deployment running 100+ sessions/hour with a 5-minute timeout, this creates around 100 orphaned timers per hour. After 24h, around 2400 timers consuming memory and event loop resources.

**Fix**: Store the timer reference and clear it when the session completes:
```typescript
let timeoutId: ReturnType<typeof setTimeout>;
const timeoutPromise = new Promise<never>((_, reject) => {
  timeoutId = setTimeout(
    () => reject(new ABFErrorClass('SESSION_TIMEOUT', ...)),
    this.deps.sessionTimeoutMs,
  );
});

try {
  const result = await Promise.race([this.runSession(...), timeoutPromise]);
  clearTimeout(timeoutId!);
  return result;
} catch (e) {
  clearTimeout(timeoutId!);
  // ... error handling
}
```

---

### C2. SSE Snapshot Over-Broadcasting

**Files**:
- `/home/alex/abf/packages/core/src/runtime/gateway/events.routes.ts` (lines 25-37)
- `/home/alex/abf/packages/core/src/runtime/gateway/http.gateway.ts` (lines 195-238)

**Description**: The `/api/events` SSE endpoint rebuilds and sends a complete snapshot of ALL runtime state every 2 seconds to EVERY connected client. This snapshot includes:
- Full agent configs (including charters, which can be multi-KB each)
- All agent states
- All active sessions
- All escalations (up to 1000)

For a 14-agent deployment like CiteRank, each snapshot could be 50-100KB of JSON. With 5 dashboard tabs open, that is 250-500KB/s of continuous bandwidth, plus the CPU cost of serialization.

**Impact**: Linear scaling problem. With N agents and M dashboard clients, bandwidth = O(N * M) every 2 seconds. The `buildSnapshot()` function also calls `getActiveSessions()` and `getEscalations()` which clone arrays on every invocation.

**Fix**: Implement delta-based SSE:
1. Compute a hash of the snapshot and only send when it changes.
2. Send differential updates (only changed fields) rather than full snapshots.
3. Increase the interval to 5s for idle state (2s only when sessions are active).
4. Truncate agent charters from the snapshot payload (clients can fetch on demand).

---

### C3. Filesystem Memory: Double-Read on Append

**Files**: `/home/alex/abf/packages/core/src/memory/filesystem.store.ts` (lines 45-71)

**Description**: The `append()` method writes to the history file, then immediately re-reads the entire file to compute a checksum:

```typescript
await appendFile(filePath, entry, 'utf-8');
// Re-reads the ENTIRE file we just wrote to
const fullContent = await readFile(filePath, 'utf-8');
const checksum = computeChecksum(fullContent);
await writeFile(`${filePath}.checksum`, checksum, 'utf-8');
```

For an agent with a 500KB history file, every session completion triggers: 1 append + 1 full read + 1 checksum write = 3 I/O operations where only 1 is necessary. The history file grows without bound (it is only compacted asynchronously by the MemoryCompactor, which itself has issues -- see H3).

**Impact**: I/O cost scales linearly with history file size. After 100 sessions, each append reads around 100KB. After 1000 sessions, each append reads 1MB+.

**Fix**: Maintain a running checksum in memory. On append, update the checksum incrementally instead of re-reading the entire file. Alternatively, compute the checksum only from the appended content and store per-entry checksums.

---

## High-Impact Findings

### H1. Knowledge Files Re-Loaded on Every Session

**Files**:
- `/home/alex/abf/packages/core/src/knowledge/loader.ts` (lines 14-37)
- `/home/alex/abf/packages/core/src/runtime/session-manager.ts` (lines 204-209, 422-429)

**Description**: Both `runSession()` and `executeStreaming()` call `loadKnowledgeFiles()` which reads every `.md` file from the knowledge directory on every single session start. Knowledge files rarely change during runtime -- they are typically set up once at project initialization.

The `loadKnowledgeFiles()` function is also sequential: it reads files one at a time in a for loop rather than using `Promise.all()`:

```typescript
for (const file of files) {
  const content = await readFile(join(dir, file), 'utf-8');
  // ...
}
```

**Impact**: For a project with 10 knowledge files averaging 5KB each, every session start performs 11 filesystem operations (1 readdir + 10 reads). With 14 agents running sessions hourly, that is 154 unnecessary disk reads per hour.

**Fix**:
1. Cache knowledge files in memory with a file-watcher (`fs.watch`) for invalidation.
2. Parallelize the reads with `Promise.all()` (partially done in `FilesystemMemoryStore.loadContext` but not in `loadKnowledgeFiles`).
3. Load knowledge once at startup and inject via the session manager constructor.

---

### H2. Dispatcher dispatchAndWait Busy-Polling

**Files**: `/home/alex/abf/packages/core/src/runtime/dispatcher.ts` (lines 111-134)

**Description**: The `dispatchAndWait()` method, used by the WorkflowRunner for every workflow step, polls for completion every 250ms in a busy loop:

```typescript
while (Date.now() < deadline) {
  const result = this.completedSessions.get(sessionId);
  if (result) return Ok(result);
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
}
```

For a workflow step that takes 30 seconds, this runs around 120 iterations of Map lookups and timer allocations. For parallel workflow waves, each concurrent step spins its own poll loop.

**Impact**: CPU waste proportional to session duration multiplied by concurrent workflow steps. In a 5-step sequential workflow averaging 30s per step, this creates around 600 poll iterations and timer allocations.

**Fix**: Replace with a promise-based completion mechanism:
```typescript
private readonly completionWaiters = new Map<string, (result: SessionResult) => void>();

async dispatchAndWait(activation, timeoutMs) {
  const dispatchResult = await this.dispatch(activation);
  if (!dispatchResult.ok) return ...;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(...), timeoutMs);
    this.completionWaiters.set(sessionId, (result) => {
      clearTimeout(timer);
      resolve(Ok(result));
    });
  });
}
```

---

### H3. MemoryCompactor Loads Full Context Twice

**Files**: `/home/alex/abf/packages/core/src/memory/compactor.ts` (lines 38-83)

**Description**: The compactor calls `memoryStore.loadContext(agentId)` in `shouldCompact()`, and if compaction is needed, calls `memoryStore.loadContext(agentId)` again in `compact()`. Each `loadContext()` reads charter + history + decisions + all knowledge files. The compactor is triggered fire-and-forget after every session:

```typescript
void this.deps.compactor.shouldCompact(activation.agentId).then((needed) => {
  if (needed) void this.deps.compactor!.compact(activation.agentId);
});
```

This means every session that triggers compaction reads the full agent context twice.

**Impact**: Doubled I/O on compaction events. For the filesystem backend with large history files, this can mean reading 1MB+ of data twice. Additionally, the compactor calls `provider.models()` which may make an API call to the LLM provider.

**Fix**: Combine `shouldCompact` and `compact` into a single method that loads context once:
```typescript
async compactIfNeeded(agentId: AgentId): Promise<void> {
  if (!this.config.enabled) return;
  const result = await this.memoryStore.loadContext(agentId);
  if (!result.ok) return;
  // Check threshold using already-loaded data
  // Compact if needed using the same loaded data
}
```

---

### H4. Unbounded History Growth (Filesystem Backend)

**Files**:
- `/home/alex/abf/packages/core/src/memory/filesystem.store.ts` (lines 45-71)
- `/home/alex/abf/packages/core/src/memory/compactor.ts` (lines 52-83)

**Description**: The filesystem memory store's `append()` method grows the history file indefinitely. The MemoryCompactor is supposed to prevent unbounded growth, but it has a critical limitation: the comment on line 79-82 of `compactor.ts` admits it cannot actually truncate the history file:

```typescript
// We can't directly truncate the history file via the store interface,
// but we store the summary and the session manager will include it in prompts.
// The full compaction (file rewrite) would need a new store method.
void recentContent; // kept for future file-level compaction
```

This means the compactor summarizes old entries but never removes them. The history file grows forever, making every subsequent `loadContext()` and `append()` slower.

**Impact**: Unbounded growth. An agent running 10 sessions/day for 30 days accumulates around 300 history entries. At around 500 bytes per entry, the file reaches 150KB. The `buildPrompt()` method joins ALL history entries into the system prompt, consuming LLM context window tokens unnecessarily.

**Fix**: Add a `rewrite(agentId, layer, content)` method to `IMemoryStore` that replaces the file contents. The compactor should call this to rewrite the history file with only recent entries after summarization.

---

### H5. Audit Store Query Scans All Files Sequentially

**Files**: `/home/alex/abf/packages/core/src/security/audit.ts` (lines 36-78)

**Description**: The `query()` method reads every `.jsonl` file in the audit directory, parses every line of every file, and filters in memory. There is no index, no date-range file selection, and no caching. It also dynamically imports `readdir` inside the method.

```typescript
const files = await readdir(this.dir);
const jsonlFiles = files.filter(f => f.endsWith('.jsonl') && f !== 'security.jsonl');
for (const file of jsonlFiles.sort()) {
  const content = await readFile(join(this.dir, file), 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  for (const line of lines) {
    const entry = JSON.parse(line) as AuditEntry;
    // ... filter in memory
  }
}
```

**Impact**: O(total_audit_entries) for every query. After 30 days of operation with around 100 entries/day, a single query parses 3000+ JSON objects. The `/api/audit` dashboard endpoint calls this on every page load.

**Fix**:
1. Use the `since` filter to skip files by date (filenames are `YYYY-MM-DD.jsonl`, so file selection can eliminate irrelevant days).
2. Read files in reverse order and stop at the limit.
3. Cache the most recent entries in memory for dashboard queries.

---

### H6. Agent Config Loading Is Sequential

**Files**: `/home/alex/abf/packages/core/src/config/loader.ts` (lines 111-131)

**Description**: `loadAgentConfigs()` loads agent YAML files one at a time in a sequential loop:

```typescript
for (const file of files) {
  const result = await loadAgentConfig(join(dir, file));
  if (!result.ok) return result;
  configs.push(result.value);
}
```

Each `loadAgentConfig` performs: readFile + parseYaml + zodValidation. For 14 agents, this is 14 sequential filesystem reads.

**Impact**: Startup latency scales linearly with agent count. Each read takes around 1-5ms, so 14 agents add around 14-70ms to startup. The same pattern exists in `loadTeamConfigs()` and `loadWorkflowConfigs()`.

**Fix**: Use `Promise.all()` for parallel loading. On validation error, collect all errors and report them together rather than failing on the first one:
```typescript
const results = await Promise.all(
  files.map(file => loadAgentConfig(join(dir, file)))
);
```

---

### H7. Scheduler Creates New Cron Instance on Every 5s Tick

**Files**: `/home/alex/abf/packages/core/src/runtime/scheduler.ts` (lines 111-124)

**Description**: The `matchesCron()` method instantiates a new `Cron` object every time it is called:

```typescript
private matchesCron(expression: string, now: Date): boolean {
  const cron = new Cron(expression, { timezone: 'UTC' });
  const windowStart = new Date(now.getTime() - this.intervalMs);
  const nextInWindow = cron.nextRun(windowStart);
  // ...
}
```

This is called every 5 seconds for every trigger of every agent. For 14 agents with 2 triggers each, that is 28 Cron instantiations every 5 seconds = around 336 allocations per minute, each involving regex compilation and timezone calculations.

**Impact**: Unnecessary CPU and GC pressure. While individual Cron construction is fast (around 0.1ms), the aggregate effect matters for a long-running process.

**Fix**: Pre-compute and cache `Cron` instances when agents are registered:
```typescript
private readonly cronInstances = new Map<string, Cron>();

registerAgent(agent: AgentConfig): void {
  this.agents.set(agent.id, agent);
  for (const trigger of agent.triggers) {
    if (trigger.type === 'cron') {
      this.cronInstances.set(
        `${agent.id}:${trigger.schedule}`,
        new Cron(trigger.schedule, { timezone: 'UTC' })
      );
    }
  }
}
```

---

## Medium-Impact Findings

### M1. Factory Startup: 15+ Sequential Dynamic Imports

**Files**: `/home/alex/abf/packages/core/src/runtime/factory.ts`

**Description**: The `createRuntime()` function contains 15+ `await import(...)` calls executed sequentially:

```typescript
const { loadMessagingRouter } = await import('../messaging/loader.js');    // line 92
const { createDatastore, ... } = await import('../datastore/index.js');    // line 101
const { MessageTemplateRegistry } = await import('../messaging/templates.js'); // line 127
const { InMemoryTaskPlanStore } = await import('../planning/store.js');    // line 132
const { OutputsManager } = await import('../memory/outputs.js');           // line 189
const { InMemoryInbox } = await import('../inbox/store.js');               // line 193
const { MemoryCompactor } = await import('../memory/compactor.js');        // line 197
const { SessionEventBus } = await import('./session-events.js');           // line 205
// ... and more
```

While dynamic imports reduce initial bundle size, they add cold-start latency when executed sequentially. Each `import()` involves module resolution, file reading, and parsing.

**Impact**: Adds around 50-200ms to cold start depending on filesystem speed. In a Docker/cloud container cold start scenario, this compounds with other initialization.

**Fix**: Group independent dynamic imports into `Promise.all()` blocks:
```typescript
const [
  { loadMessagingRouter },
  { MessageTemplateRegistry },
  { InMemoryTaskPlanStore },
  { OutputsManager },
  { InMemoryInbox },
  { MemoryCompactor },
  { SessionEventBus },
] = await Promise.all([
  import('../messaging/loader.js'),
  import('../messaging/templates.js'),
  import('../planning/store.js'),
  import('../memory/outputs.js'),
  import('../inbox/store.js'),
  import('../memory/compactor.js'),
  import('./session-events.js'),
]);
```

---

### M2. InProcessBus: Unbounded Pending Queue

**Files**: `/home/alex/abf/packages/core/src/runtime/bus/in-process.bus.ts` (lines 81-87)

**Description**: The in-process bus keeps a history array per agent, capped at 1000 messages via `splice()`. However, the splice approach is O(N) because it shifts array elements:

```typescript
if (history.length > 1000) history.splice(0, history.length - 1000);
```

More importantly, the pending messages queue (`this.pending`) is only cleared when `getPending()` is called. If an agent never calls `getPending()` (e.g., an agent without message triggers), its pending queue grows unboundedly.

**Impact**: Memory leak for agents that receive messages but never consume them. Each `BusMessage` is around 200-500 bytes, so 10,000 unconsumed messages = around 2-5MB per affected agent.

**Fix**: Cap the pending queue similarly to history:
```typescript
if (pending.length > 1000) pending.splice(0, pending.length - 1000);
```

---

### M3. Redis Bus: getPending Is Not Atomic

**Files**: `/home/alex/abf/packages/core/src/runtime/bus/redis.bus.ts` (lines 175-180)

**Description**: The `getPending()` method uses two separate Redis commands (LRANGE + DEL) without a transaction:

```typescript
const items: string[] = await this.commands.lrange(key, 0, -1);
if (items.length > 0) await this.commands.del(key);
```

Between LRANGE and DEL, new messages could be published to the pending list and immediately deleted without being consumed.

**Impact**: Message loss under concurrent load. If agent A publishes to agent B while B is draining pending, the new message may be lost.

**Fix**: Use a MULTI/EXEC transaction for atomic drain:
```typescript
async getPending(agentId: AgentId): Promise<readonly BusMessage[]> {
  const key = pendingKey(agentId);
  const results = await this.commands
    .multi()
    .lrange(key, 0, -1)
    .del(key)
    .exec();
  // Extract items from the LRANGE result
}
```

---

### M4. Tool Arguments Parsed Twice

**Files**: `/home/alex/abf/packages/core/src/runtime/session-manager.ts`

**Description**: In both `runSession()` and `executeStreaming()`, tool call arguments are parsed from JSON twice:

```typescript
// Streaming path: parsed for the event emission
emitChunk({
  toolArguments: JSON.parse(tc.arguments) as Record<string, unknown>,
});

// Parsed again for the ToolCall object
const call: ToolCall = {
  arguments: JSON.parse(tc.arguments) as Record<string, unknown>,
};
```

The same pattern exists in `runSession()`.

**Impact**: Double JSON parsing per tool call. For complex tool arguments (e.g., database queries with large payloads), this wastes CPU. With 5-10 tool calls per session, the waste multiplies.

**Fix**: Parse once and reuse:
```typescript
const parsedArgs = JSON.parse(tc.arguments) as Record<string, unknown>;
emitChunk({ toolArguments: parsedArgs });
const call: ToolCall = { arguments: parsedArgs, ... };
```

---

### M5. OutputsManager.readTeamRecent Is Sequential and Unbounded

**Files**: `/home/alex/abf/packages/core/src/memory/outputs.ts` (lines 61-79)

**Description**: `readTeamRecent()` lists all agent directories, then sequentially calls `readRecent()` for each one. `readRecent()` itself reads files sequentially:

```typescript
for (const agent of agents) {
  if (agent === excludeAgent) continue;
  const recent = await this.readRecent(agent, limit);  // sequential per agent
  allEntries.push(...recent);
}
```

Each `readRecent()` internally reads files sequentially in a for loop (line 43-49). For 14 agents, this could mean 14 * 3 = 42 sequential file reads.

**Impact**: Latency for every session scales with team size. With 14 agents and 3 outputs each, 42 sequential reads add around 42-210ms per session start.

**Fix**: Parallelize both levels:
```typescript
const agentResults = await Promise.all(
  agents.filter(a => a !== excludeAgent)
    .map(agent => this.readRecent(agent, limit))
);
```
Also parallelize within `readRecent()`.

---

### M6. Workflow Runner Linear Agent Lookup

**Files**: `/home/alex/abf/packages/core/src/runtime/workflow-runner.ts` (line 84)

**Description**: The workflow runner finds agents by name using a full scan of the agents map:

```typescript
const agent = [...this.agentsMap.values()].find((a) => a.name === step.agent);
```

This creates a new array from the map values on every step, then performs a linear search.

**Impact**: O(N) per workflow step where N = number of agents. For a 10-step workflow with 14 agents, this creates 10 arrays and performs 10 * around 7 average comparisons.

**Fix**: Build a name-to-agent index:
```typescript
private nameIndex: Map<string, AgentConfig> | null = null;

private getAgentByName(name: string): AgentConfig | undefined {
  if (!this.nameIndex) {
    this.nameIndex = new Map();
    for (const agent of this.agentsMap.values()) {
      this.nameIndex.set(agent.name, agent);
    }
  }
  return this.nameIndex.get(name);
}
```

---

### M7. buildPrompt Includes All History Without Windowing

**Files**: `/home/alex/abf/packages/core/src/runtime/session-manager.ts` (lines 853-956)

**Description**: The `buildPrompt()` method joins ALL history entries into the system prompt:

```typescript
memory.history.length > 0
  ? `Recent History:\n${memory.history.map((h) => h.content).join('\n---\n')}`
  : '',
```

For the filesystem backend, `loadContext()` returns the entire history file as a single entry. This means the full, unbounded history goes into every LLM prompt.

For the Postgres backend, history is limited to 20 entries (LIMIT 20), but those entries are the raw session outputs which can each be several KB.

**Impact**: Token waste and cost scaling. If each history entry averages 500 tokens and there are 20 entries, that is 10,000 tokens of history in every prompt. At Anthropic pricing (around $3/M input tokens for Sonnet), 100 sessions/day costs around $3/day in unnecessary history tokens alone.

**Fix**:
1. Apply a character/token budget to history inclusion (e.g., max 4000 chars).
2. Use the memory compactor summary instead of raw history when available.
3. Truncate individual history entries before joining.
4. The filesystem store should split by `---` delimiter and return only the N most recent entries.

---

### M8. Dashboard SSE Fallback: Triple Polling

**Files**: `/home/alex/abf/packages/dashboard/src/app/page.tsx` (lines 20-23)

**Description**: The overview page sets up SWR polling with 3-second intervals as a fallback when SSE data is not yet available:

```typescript
const { data: swrStatus } = useSWR(!sseHasStatus ? 'status' : null,
  () => api.status(), { refreshInterval: 3000 });
const { data: swrAgents } = useSWR(!sseHasAgents ? 'agents' : null,
  () => api.agents.list(), { refreshInterval: 3000 });
const { data: swrSessions } = useSWR(!sseHasSessions ? 'sessions' : null,
  () => api.sessions.active(), { refreshInterval: 3000 });
```

During the window between page load and SSE connection establishment (or if SSE fails permanently), this fires 3 HTTP requests every 3 seconds. The `api.status()` endpoint also queries the vault for each provider, adding async overhead per poll.

**Impact**: During SSE connection failures, each dashboard tab generates 60 HTTP requests per minute. The `/api/status` endpoint calls `vault.get()` three times per request.

**Fix**:
1. Increase fallback polling interval to 10-15s.
2. Cache the provider connection status server-side (it rarely changes).
3. Set SWR `dedupingInterval` to prevent duplicate requests across components.

---

### M9. api/status Endpoint Checks Vault on Every Request

**Files**: `/home/alex/abf/packages/core/src/runtime/gateway/http.gateway.ts` (lines 253-283)

**Description**: The `/api/status` endpoint loops through providers and calls `vault.get()` for each one on every request:

```typescript
for (const slug of ['anthropic', 'openai', 'ollama'] as const) {
  const key = await deps.vault.get(slug, 'api_key');
  if (key) { providerConnected = true; ... break; }
}
```

**Impact**: 1-3 vault reads per status request. With SWR polling at 3s intervals, this is around 20-60 vault reads per minute per dashboard tab.

**Fix**: Cache the provider connection status with a short TTL (30s-60s), similar to the existing `providerCache` pattern already used for the `/api/providers` endpoint.

---

### M10. Postgres loadContext Loads ALL Knowledge Rows

**Files**: `/home/alex/abf/packages/core/src/memory/postgres.store.ts` (lines 212-214)

**Description**: The `loadContext()` method loads ALL knowledge rows without any filtering or pagination:

```typescript
this.pool.query<{ key: string; content: string }>(
  `SELECT key, content FROM abf_knowledge`,
),
```

If the knowledge table grows large (e.g., 100+ entries from multiple agents writing knowledge), every session start fetches the entire table.

**Impact**: Query time and memory usage scale linearly with knowledge table size.

**Fix**: Filter by relevance. Consider adding an `agent_id` column to scope knowledge, or at minimum add a LIMIT clause.

---

## Low-Impact Findings

### L1. Tool Loader Uses Sync Filesystem APIs

**Files**: `/home/alex/abf/packages/core/src/tools/loader.ts` (lines 7-8, 148-153)

**Description**: The `loadToolConfigs()` function uses synchronous `readdirSync` and `readFileSync` while the rest of the codebase uses async APIs. The `existsSync` call for co-located `.tool.js` files is also synchronous.

```typescript
files = readdirSync(toolsDir).filter(f => f.endsWith('.tool.yaml'));
raw = parse(readFileSync(filePath, 'utf8'));
```

**Impact**: Blocks the event loop during startup for the duration of all tool file reads. Minor for small tool directories, but blocks all concurrent I/O.

**Fix**: Switch to async APIs: `readdir`, `readFile`, `access` (instead of `existsSync`).

---

### L2. Scheduler Date Object Creation on Every Tick

**Files**: `/home/alex/abf/packages/core/src/runtime/scheduler.ts` (lines 111-124)

**Description**: In addition to creating a new `Cron` instance (H7), `matchesCron()` creates a new `Date` object for `windowStart` on every call:

```typescript
const windowStart = new Date(now.getTime() - this.intervalMs);
```

**Impact**: Minor GC pressure. Around 28 Date allocations per 5-second tick.

**Fix**: Would be resolved by the Cron caching fix in H7.

---

### L3. Monitor Runner Dynamic Import Inside Hot Path

**Files**: `/home/alex/abf/packages/core/src/monitor/runner.ts` (line 109)

**Description**: The `check()` method dynamically imports `createActivationId` inside the callback, which runs on every monitor interval:

```typescript
const { createActivationId } = await import('../util/id.js');
```

While Node.js caches dynamic imports, the async overhead of resolving the cached module is unnecessary in a hot path.

**Impact**: Minimal after first call (cached), but adds unnecessary microtask scheduling.

**Fix**: Move the import to the top of the file as a static import.

---

### L4. InMemoryApprovalStore Linear Scan for Listing

**Files**: `/home/alex/abf/packages/core/src/approval/store.ts` (lines 44-57)

**Description**: The `list()` method copies all entries, filters, then reverses:

```typescript
let entries = [...this.store.values()];
if (filter?.status) entries = entries.filter(e => e.status === filter.status);
if (filter?.agentId) entries = entries.filter(e => e.agentId === filter.agentId);
return entries.reverse();
```

**Impact**: O(N) for every list call where N = total approval entries (max 1000). Creates a new array on every call.

**Fix**: Maintain secondary indexes by status and agentId. Or iterate in reverse order without copying/reversing.

---

### L5. InMemoryInbox: Consumed Items Never Removed

**Files**: `/home/alex/abf/packages/core/src/inbox/store.ts` (lines 43-59)

**Description**: Both `peek()` and `drain()` filter consumed items from the full array on every call. Consumed items are never removed from the backing array, so the filter set grows over time.

**Impact**: O(N) where N = total items ever pushed (up to 500 per agent). Consumed items accumulate and slow down filtering.

**Fix**: Remove consumed items from the array, or use a separate consumed vs. unconsumed data structure.

---

### L6. Dashboard: lucide-react Bundle Size

**Files**: `/home/alex/abf/packages/dashboard/package.json`, various page components

**Description**: The dashboard imports icons from `lucide-react` using named imports. While Next.js handles tree shaking, the `icon-map.ts` file may import and re-export all icons, potentially increasing bundle size.

**Impact**: Minor bundle size increase. Lucide-react is around 200KB unparsed, but tree shaking should reduce this.

**Fix**: Verify that only used icons are included in the production bundle.

---

### L7. Chat Routes: Feedback Store O(N) Eviction

**Files**: `/home/alex/abf/packages/core/src/runtime/gateway/chat.routes.ts` (lines 371-382)

**Description**: The feedback store evicts the oldest entry by iterating through all entries to find the minimum timestamp:

```typescript
if (feedbackStore.size >= MAX_FEEDBACK) {
  let oldestKey: string | undefined;
  let oldestTime = Number.POSITIVE_INFINITY;
  for (const [key, val] of feedbackStore) { ... }
  if (oldestKey) feedbackStore.delete(oldestKey);
}
```

The same O(N) eviction pattern exists in `conversationMeta` (lines 121-129).

**Impact**: O(1000) iterations on every feedback submission when at capacity. Minor but unnecessary.

**Fix**: Use Map insertion order and delete the first key:
```typescript
if (feedbackStore.size >= MAX_FEEDBACK) {
  const firstKey = feedbackStore.keys().next().value;
  if (firstKey) feedbackStore.delete(firstKey);
}
```
Note: The dispatcher `completedSessions` already uses this pattern correctly (line 186-189 of dispatcher.ts).

---

### L8. Build: Source Maps Always Generated for Core

**Files**: `/home/alex/abf/packages/core/tsup.config.ts`

**Description**: Source maps are always generated (`sourcemap: true`). For a library package, source maps in production add to the npm package size and disk usage.

**Impact**: Larger package size on npm publish. Source maps for the core package could add around 50-100KB.

**Fix**: Conditionally generate source maps or exclude from published files.

---

### L9. turbo.json: Tests Depend on Build

**Files**: `/home/alex/abf/turbo.json` (line 14)

**Description**: The `test` task depends on `build`, meaning tests cannot run until the full build completes. Since vitest can run TypeScript directly, this dependency may be unnecessary for local development.

**Impact**: Slower test feedback loop. Running `pnpm test` requires a full build first.

**Fix**: Remove the `build` dependency from `test` if vitest handles TypeScript directly, or add a `test:unit` task without the build dependency.

---

### L10. Dashboard Proxy: All Non-API Requests Proxied

**Files**: `/home/alex/abf/packages/core/src/runtime/gateway/http.gateway.ts` (lines 743-778)

**Description**: When a `dashboardPort` is configured, ALL non-matched requests are proxied to the Next.js dev server. Each proxied request strips and reconstructs headers.

**Impact**: During development, every asset request goes through Node.js fetch proxying, adding latency. Not an issue in production (standalone Next.js serves directly).

**Fix**: Development-only behavior, acceptable as-is. For optimization in staging, consider a reverse proxy.

---

## Build and Development Performance

### B1. Single Entry Point Bundle (tsup)

**Files**: `/home/alex/abf/packages/core/tsup.config.ts`

**Description**: The core package bundles everything through a single entry point (`src/index.ts`). Importing any part of `@abf/core` pulls in the entire dependency graph. For consumers that only need types or specific utilities, this is wasteful.

**Impact**: Larger bundle size for consumers. The core package includes heavy dependencies (playwright-core, sharp, satori, stripe, pg) that are only needed by specific tools.

**Fix**: Add multiple entry points:
```typescript
entry: {
  index: 'src/index.ts',
  types: 'src/types/index.ts',
  runtime: 'src/runtime/index.ts',
  tools: 'src/tools/index.ts',
},
```

---

### B2. Heavy Dependencies in Core Package

**Files**: `/home/alex/abf/packages/core/package.json`

**Description**: The core package includes 25 production dependencies, several of which are heavy:
- `playwright-core` (around 15MB) -- only used by the `browse` tool
- `sharp` (around 10MB) -- only used by `image-render`
- `satori` (around 5MB) -- only used by `image-render`
- `stripe` (around 5MB) -- only used by `stripe-billing`
- `@resvg/resvg-js` (around 5MB) -- only used by `image-render`
- `mammoth` -- only used by seed document parser
- `pdf-parse` -- only used by seed document parser

**Impact**: Around 40MB+ of dependencies that are rarely all needed. Increases install time, Docker image size, and cold start time.

**Fix**: Make heavy tool dependencies optional/peer dependencies. Use dynamic imports with graceful fallback when the dependency is not installed. The tool can return a helpful error message like "Install playwright-core to use the browse tool."

---

## Postgres-Specific Findings

### P1. No Connection Pool Monitoring

**Files**: `/home/alex/abf/packages/core/src/memory/postgres.store.ts`

**Description**: The Postgres store creates a connection pool with default size 10 but provides no monitoring of pool utilization, wait times, or errors.

**Impact**: Difficult to diagnose connection exhaustion or slow query issues in production.

**Fix**: Attach event listeners to the pool for `connect`, `acquire`, `error`, and `remove` events. Log pool stats periodically.

---

### P2. Missing Index on abf_decisions.team_id

**Files**: `/home/alex/abf/packages/core/src/memory/postgres.store.ts` (line 62-69)

**Description**: The `abf_decisions` table has a `team_id` column used in WHERE clauses (`WHERE team_id = $1`) but no index on it.

**Impact**: Sequential scan on team_id queries. Minor at small scale, but grows with decision count.

**Fix**: Add `CREATE INDEX IF NOT EXISTS idx_abf_decisions_team ON abf_decisions(team_id)`.

---

### P3. No LIMIT on Knowledge Query

**Files**: `/home/alex/abf/packages/core/src/memory/postgres.store.ts` (lines 212-214)

**Description**: As noted in M10, the knowledge query has no LIMIT. Additionally, the decisions query (LIMIT 10) and history query (LIMIT 20) use hard-coded limits rather than configurable values.

**Impact**: Knowledge table reads grow linearly with data.

**Fix**: Add configurable limits and consider pagination for knowledge.

---

## Summary Metrics

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Session Manager | 1 | 2 | 2 | 0 |
| Memory/Storage | 1 | 2 | 1 | 0 |
| Gateway/SSE | 1 | 1 | 2 | 2 |
| Scheduler | 0 | 1 | 0 | 1 |
| Bus | 0 | 0 | 2 | 0 |
| Dispatcher | 0 | 1 | 0 | 0 |
| Tools | 0 | 0 | 0 | 1 |
| Dashboard | 0 | 0 | 1 | 1 |
| Build/Config | 0 | 1 | 1 | 2 |
| Postgres | 0 | 0 | 1 | 0 |
| **Total** | **3** | **8** | **10** | **7** |

## Recommended Priority Order

1. **C1** (timer leak) -- 15 min fix, prevents production OOM
2. **C3** (double read on append) -- 30 min fix, eliminates unnecessary I/O
3. **H1** (knowledge caching) -- 1 hour fix, major reduction in per-session I/O
4. **C2** (SSE delta) -- 2 hour fix, major bandwidth and CPU reduction
5. **H7** (cron caching) -- 30 min fix, eliminates per-tick allocations
6. **H2** (dispatch polling) -- 1 hour fix, eliminates CPU spin loops
7. **M4** (double JSON parse) -- 15 min fix, easy win
8. **M1** (parallel imports) -- 30 min fix, faster cold start
9. **H4** (unbounded history) -- 2 hour fix, prevents context window bloat
10. **H5** (audit query optimization) -- 1 hour fix, faster dashboard loads
