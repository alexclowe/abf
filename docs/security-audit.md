# ABF Security Audit Report

**Date**: 2026-03-01
**Auditor**: Claude Opus 4.6 (Security Auditor)
**Scope**: Full codebase audit of ABF (Agentic Business Framework)
**Commit**: `e696744` on branch `feat/cloud-proxy-plugin-registry`

---

## Executive Summary

ABF demonstrates a security-conscious architecture with documented security pillars and several properly implemented controls (behavioral bounds enforcement, input sanitization pipeline, timing-safe API key comparison, file-write sandboxing). However, this audit identified **4 Critical**, **7 High**, **8 Medium**, **5 Low**, and **4 Informational** findings. The most severe issues center around the credential vault's weak encryption key derivation, unsandboxed code execution, path traversal in CRUD routes, and the lack of mandatory API authentication.

**Overall Security Posture**: **Moderate** -- The framework has strong security design principles documented in its architecture, but implementation gaps leave several attack surfaces exposed. Addressing the Critical and High findings is essential before any production deployment.

---

## Top 5 Priority Actions

1. **Replace vault key derivation** with a proper KDF (Argon2id/scrypt) using a user-supplied passphrase or OS keychain. The current `SHA-256(hostname + username)` scheme provides negligible protection. *(Critical -- C-01)*

2. **Sandbox the `code-execute` tool** in an isolated container or Node.js `vm` isolate. It currently runs arbitrary agent-supplied JavaScript as a bare child process with full filesystem access. *(Critical -- C-02)*

3. **Fix path traversal in knowledge CRUD routes** (`PUT /api/knowledge/:filename`, `DELETE /api/knowledge/:filename`). The `filename` URL parameter is used directly in `join()` without sanitization. *(Critical -- C-03)*

4. **Make API authentication mandatory** or default-on. Currently, all API routes are fully unauthenticated unless the operator explicitly sets `ABF_API_KEY`. A default-open posture for a framework running autonomous agents is unacceptable. *(High -- H-01)*

5. **Fix XSS in OAuth callback pages**. The `redirectUrl` and `message` parameters are interpolated directly into HTML templates without escaping. *(High -- H-02)*

---

## Findings by Severity

### CRITICAL

#### C-01: Weak Vault Encryption Key Derivation

**Affected file**: `/home/alex/abf/packages/core/src/credentials/vault.ts` (line 28-31)

**Description**: The credential vault derives its AES-256-GCM encryption key using `SHA-256(hostname + ":" + username + ":abf-vault-v1")`. This is a deterministic function of publicly available system information. Any process running on the same machine (or any attacker who knows the hostname and username) can derive the key and decrypt all stored API keys.

```typescript
function deriveMachineKey(): Buffer {
    const seed = `${hostname()}:${userInfo().username}:abf-vault-v1`;
    return createHash('sha256').update(seed).digest();
}
```

**Risk**: An attacker with read access to `~/.abf/credentials.enc` (e.g., via a compromised tool, shared hosting, backup leak, or another user on the system) can trivially decrypt all stored provider API keys (Anthropic, OpenAI, Stripe, etc.).

**Recommended fix**:
- Use a proper KDF (Argon2id or scrypt) with a user-supplied passphrase stored in the OS keychain (via `keytar` or platform-specific APIs).
- As a fallback, use OS-level secret storage (macOS Keychain, Windows Credential Manager, Linux Secret Service).
- At minimum, add a high-entropy random salt stored alongside the vault and use PBKDF2 with 600,000+ iterations.
- Document the threat model clearly: the current scheme only protects against casual browsing of the file, not against a targeted attacker.

---

#### C-02: Unsandboxed Arbitrary Code Execution via `code-execute` Tool

**Affected file**: `/home/alex/abf/packages/core/src/tools/builtin/code-execute.ts` (line 74-83)

**Description**: The `code-execute` tool spawns a Node.js child process to run arbitrary JavaScript code supplied by the LLM agent. While the environment variables are partially restricted (only `PATH`, `NODE_PATH`, `HOME`), the process runs with the full privileges of the ABF runtime user, has full filesystem access, full network access, and can `require()` any installed package.

```typescript
const child = spawn('node', [tempFile], {
    cwd: ctx.projectRoot,
    env: {
        PATH: process.env['PATH'],
        NODE_PATH: process.env['NODE_PATH'],
        HOME: process.env['HOME'],
    },
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
});
```

**Risk**: An agent manipulated by prompt injection (or a malicious custom tool) can execute arbitrary system commands via `child_process`, read/write arbitrary files (including `~/.abf/credentials.enc`), exfiltrate credentials, install backdoors, or pivot to other systems on the network. This violates the framework's own "Sandboxed Execution" pillar.

**Recommended fix**:
- Run code in an isolated Node.js VM2/isolated-vm isolate with explicit API surface.
- Alternatively, execute inside a disposable Docker container with `--no-new-privileges`, read-only root filesystem, restricted network, and a bind-mounted outputs directory.
- Drop all capabilities, enforce seccomp profiles, and set resource limits (memory, CPU time).
- At minimum, add `--experimental-permission` flag (Node.js 22+) to restrict filesystem access to `outputs/` only.

---

#### C-03: Path Traversal in Knowledge CRUD Routes

**Affected file**: `/home/alex/abf/packages/core/src/runtime/gateway/crud.routes.ts` (lines 278-326)

**Description**: The `GET /api/knowledge/:filename`, `PUT /api/knowledge/:filename`, and `DELETE /api/knowledge/:filename` routes use the URL parameter `filename` directly in `join()` and file operations without path traversal sanitization:

```typescript
// GET - line 282
const content = await readFile(join(root, 'knowledge', filename), 'utf-8');

// PUT - line 311
await writeFile(join(knowledgeDir, filename), body.content, 'utf-8');

// DELETE - line 321
await unlink(join(root, 'knowledge', filename));
```

The `GET` route checks for `.md` extension but the `PUT` and `DELETE` routes do not. An attacker can supply `../../abf.config.yaml` or `../../.env` as the filename to read, overwrite, or delete arbitrary files within the project root and parent directories.

Note: The `POST /api/knowledge` route correctly uses `sanitizeName()`, but the `PUT` and `DELETE` routes bypass this.

**Risk**: Arbitrary file read, write, and deletion on the server. An attacker with API access can overwrite configuration files, inject malicious agent definitions, or delete critical system files.

**Recommended fix**:
- Apply `sanitizeName()` to the `filename` parameter in `PUT` and `DELETE` routes.
- Add a `resolve()` + `startsWith()` check to ensure the resolved path stays within the `knowledge/` directory.
- Apply the same pattern to all CRUD routes that accept user-supplied filenames (monitors, message templates, workflows).

---

#### C-04: Custom Tools Run In-Process with Full Vault Access

**Affected file**: `/home/alex/abf/packages/core/src/tools/custom-tool.ts` (lines 13-28)

**Description**: Custom tools (`.tool.js` files) are dynamically imported and executed in the same Node.js process as the ABF runtime. The `CustomToolContext` provides direct access to the credential vault (`ICredentialVault`), the project root path, and the datastore:

```typescript
export interface CustomToolContext {
    readonly projectRoot: string;
    readonly vault: ICredentialVault;
    readonly datastore?: IDatastore | undefined;
    readonly log: (msg: string) => void;
}
```

**Risk**: A malicious or compromised custom tool can call `vault.list()` and `vault.get()` to extract all stored credentials (API keys for Anthropic, OpenAI, Stripe, etc.), access the full filesystem via `projectRoot`, or exfiltrate data through the datastore. This directly contradicts the "Per-agent credentials" and "Sandboxed Execution" security pillars.

**Recommended fix**:
- Create a scoped vault proxy that only exposes credentials the tool is explicitly authorized to access (based on the agent's tool configuration).
- Remove the raw `vault` reference from `CustomToolContext` and replace it with a narrow API like `getCredential(provider: string): Promise<string | undefined>` that checks against a per-tool allowlist.
- Log all credential access from custom tools to the audit trail.

---

### HIGH

#### H-01: API Authentication Is Opt-In (Default: Open)

**Affected file**: `/home/alex/abf/packages/core/src/runtime/gateway/http.gateway.ts` (lines 118-145)

**Description**: The API authentication middleware only activates when the `ABF_API_KEY` environment variable is set. When unset, all API routes, including destructive operations (agent creation/deletion, config modification, workflow execution, credential management), are completely unauthenticated.

```typescript
app.use('/api/*', async (c, next) => {
    const requiredKey = process.env['ABF_API_KEY'];
    if (!requiredKey) return next(); // <-- bypasses all auth
    ...
});
```

**Risk**: Any network-adjacent attacker can perform all administrative operations: create/delete agents, modify configurations, execute workflows, access audit logs, and manage credentials. Given that ABF agents can take real-world actions (send emails, make API calls, write files), this is especially dangerous.

**Recommended fix**:
- Generate a random API key on first run and store it in the vault. Require it by default.
- Only allow unauthenticated access for the initial setup wizard flow (`/api/projects`, `/auth/*`), and only when no agents are configured yet.
- Print the generated key to the console on first start so the operator can use it.

---

#### H-02: Reflected XSS in OAuth Callback Pages

**Affected file**: `/home/alex/abf/packages/core/src/runtime/gateway/oauth.routes.ts` (lines 195-226)

**Description**: The `successPage()` and `errorPage()` functions interpolate parameters directly into inline HTML/JavaScript without escaping:

```typescript
function successPage(redirectUrl: string): string {
    return `...
<script>setTimeout(()=>window.location.href='${redirectUrl}',1500)</script>
...`;
}

function errorPage(message: string): string {
    return `...
<p>${message}</p>
...`;
}
```

The `redirectUrl` is partially controlled by user input (via `deps.dashboardPort` and the `provider` query parameter). The `message` parameter in `errorPage` includes error messages from external token exchange failures which may contain attacker-controlled content.

**Risk**: An attacker who controls the OAuth callback response (e.g., by MITM or malicious OAuth provider) can inject JavaScript into the callback page, potentially stealing session tokens or redirecting the user to a phishing site.

**Recommended fix**:
- HTML-encode all interpolated values using a proper escaping function.
- Use `encodeURIComponent()` for the redirect URL in the script tag.
- Consider using `Content-Security-Policy` headers to prevent inline script execution.
- Validate that `redirectUrl` is a relative path or matches expected origin patterns.

---

#### H-03: SQL Injection via Statement Prefix Bypass

**Affected files**:
- `/home/alex/abf/packages/core/src/tools/builtin/database-query.ts` (line 47)
- `/home/alex/abf/packages/core/src/tools/builtin/database-write.ts` (line 48)

**Description**: The SQL statement type validation uses a simple regex prefix check:

```typescript
// database-query
if (!/^\s*SELECT\s/i.test(sql)) { ... }

// database-write
if (!/^\s*(INSERT|UPDATE|DELETE)\s/i.test(sql)) { ... }
```

This can be bypassed with multi-statement queries. For example:
- `SELECT 1; DROP TABLE users; --` passes the SELECT check
- `DELETE FROM x; ALTER TABLE users ADD COLUMN backdoor TEXT; --` passes the DELETE check

Whether multi-statement execution works depends on the database driver configuration (better-sqlite3 allows it by default, pg does not by default), but the validation layer should not rely on driver behavior.

**Risk**: If the underlying database driver supports multi-statement queries (SQLite does), an LLM agent manipulated by prompt injection could execute DDL statements (DROP, ALTER, CREATE) or DML statements through a tool that is supposed to be read-only.

**Recommended fix**:
- Reject SQL containing semicolons (after stripping string literals).
- Use a SQL parser to validate that the statement is a single SELECT/INSERT/UPDATE/DELETE.
- Configure the database driver to reject multi-statement queries explicitly.
- Consider using an ORM or query builder instead of raw SQL to prevent injection entirely.

---

#### H-04: Dashboard SSE Token Exposed in URL Query Parameter

**Affected files**:
- `/home/alex/abf/packages/core/src/runtime/gateway/events.routes.ts` (line 17)
- `/home/alex/abf/packages/dashboard/src/lib/event-stream-provider.tsx` (line 33-34)

**Description**: Because the browser's `EventSource` API cannot send custom headers, the SSE endpoint accepts the API key as a query parameter:

```typescript
// Server
const token = c.req.query('token');
if (token !== apiKey && headerToken !== apiKey) { ... }

// Client
const url = apiKey
    ? `${BASE}/api/events?token=${encodeURIComponent(apiKey)}`
    : `${BASE}/api/events`;
```

**Risk**: The API key is exposed in browser history, server access logs, proxy logs, referrer headers, and any monitoring/logging infrastructure. This is a well-known weakness of query-parameter-based authentication.

**Recommended fix**:
- Use a short-lived, single-purpose SSE token (generated by a POST to `/api/events/token`) instead of the main API key.
- The SSE token should have a TTL of ~5 minutes and be scoped to read-only event streaming.
- Alternatively, use the `fetch()` API with `ReadableStream` instead of `EventSource` to support custom headers.

---

#### H-05: No Rate Limiting on Most API Endpoints

**Affected file**: `/home/alex/abf/packages/core/src/runtime/gateway/http.gateway.ts` (entire file)

**Description**: Rate limiting is only implemented on the `/auth/key/:provider` and `/auth/:provider` (DELETE) endpoints. All other endpoints, including resource-intensive ones like `/api/agents/:id/run` (triggers agent sessions), `/api/agents/:id/chat` (LLM calls), `/api/seed/analyze` (LLM analysis), and `/api/workflows/:name/run`, have no rate limiting.

**Risk**: An attacker can trigger unbounded agent sessions, consuming LLM API credits (which cost real money). They can also flood the system with requests, causing denial of service. Given that agent sessions make external API calls with real credentials, this could lead to significant financial impact.

**Recommended fix**:
- Implement global rate limiting middleware (e.g., `hono-rate-limit` or a sliding-window counter).
- Apply stricter limits to expensive endpoints (agent runs, chat, seed analysis).
- Implement per-IP and per-API-key rate limiting.
- Add cost-aware rate limiting that tracks aggregate LLM spend per time window.

---

#### H-06: Dashboard Proxy Bypasses API Authentication

**Affected file**: `/home/alex/abf/packages/core/src/runtime/gateway/http.gateway.ts` (lines 743-778)

**Description**: When `dashboardPort` is configured, the gateway proxies all unmatched requests to the dashboard. This catch-all proxy handler (`app.all('*', ...)`) runs after the auth middleware, but it proxies requests without re-checking authentication, and it forwards all request headers (except `host`) to the dashboard backend.

```typescript
app.all('*', async (c) => {
    const url = new URL(c.req.url);
    const target = `${dashboardOrigin}${url.pathname}${url.search}`;
    const proxyHeaders = new Headers(c.req.raw.headers);
    proxyHeaders.delete('host');
    ...
});
```

**Risk**: If the dashboard backend has its own API endpoints or server-side functionality, the proxy could expose them without authentication. Additionally, forwarding all request headers could leak sensitive information (Authorization headers, cookies) to the dashboard process.

**Recommended fix**:
- Only proxy requests to known dashboard paths (e.g., paths that don't start with `/api/`, `/auth/`, `/webhook/`).
- Strip sensitive headers (Authorization, Cookie) before proxying to the dashboard.
- If the dashboard is a static Next.js export, serve it from disk instead of proxying.

---

#### H-07: Seed Pipeline `apply.ts` Trusts LLM-Generated Filenames

**Affected file**: `/home/alex/abf/packages/core/src/seed/apply.ts` (lines 226-269)

**Description**: The `applyCompanyPlan()` function writes files using paths derived from the LLM-generated `CompanyPlan` object:

```typescript
for (const agent of agents) {
    const relativePath = `agents/${agent.name}.agent.yaml`;
    await writeProjectFile(projectRoot, relativePath, yamlContent);
}
// Similar for teams, knowledge, workflows
for (const [filename, content] of Object.entries(plan.knowledge)) {
    const relativePath = `knowledge/${filename}`;
    await writeProjectFile(projectRoot, relativePath, content);
}
```

If the LLM returns an agent name like `../../../etc/cron.d/backdoor` or a knowledge filename like `../agents/evil.agent.yaml`, the `join()` in `writeProjectFile()` will resolve outside the intended directory.

**Risk**: A manipulated LLM response (via prompt injection in the seed document) could write files to arbitrary locations on the filesystem, potentially installing backdoors or overwriting system configuration.

**Recommended fix**:
- Sanitize all names from the CompanyPlan before using them in file paths (use the existing `sanitizeName()` pattern).
- Validate that resolved paths stay within the project root using `resolve()` + `startsWith()`.
- Reject names containing path separators (`/`, `\`) or traversal sequences (`..`).

---

### MEDIUM

#### M-01: Auth Routes Bypass ABF_API_KEY Middleware by Design

**Affected file**: `/home/alex/abf/packages/core/src/runtime/gateway/auth.routes.ts` (lines 1-11, comment)

**Description**: The comment at the top of `auth.routes.ts` states: *"These routes are NOT behind the ABF_API_KEY middleware -- they handle their own security via rate limiting and input validation."* However, this is incorrect -- `http.gateway.ts` (lines 138-145) does apply the ABF_API_KEY middleware to `/auth/*` routes. This contradiction creates confusion and may lead to future regressions.

More importantly, the auth routes handle credential storage and deletion. The rate limit (5 requests per IP per minute) is per-provider, meaning an attacker can make 5 * N requests per minute across N providers.

**Risk**: Confusion about the security model could lead to accidental exposure. The rate limit is also trivially bypassable by using different source IPs or waiting for the 60-second window to reset.

**Recommended fix**:
- Remove the misleading comment from `auth.routes.ts`.
- Document the actual auth model clearly.
- Consider requiring the ABF_API_KEY for credential deletion even during initial setup.

---

#### M-02: In-Memory Data Stores Lack Size Bounds and Can Be Exhausted

**Affected files**:
- `/home/alex/abf/packages/core/src/runtime/bus/in-process.bus.ts` (line 84: 1000 messages per agent)
- `/home/alex/abf/packages/core/src/runtime/gateway/http.gateway.ts` (line 77: unbounded workflow runs)
- `/home/alex/abf/packages/core/src/runtime/gateway/chat.routes.ts` (lines 97-111: 1000 feedback items, 200 conversations)
- `/home/alex/abf/packages/core/src/seed/interview.ts` (line 88: unbounded sessions map)

**Description**: Several in-memory stores have inadequate or missing size limits:
- `InProcessBus` keeps 1000 messages per agent but there is no limit on the number of agents.
- `InterviewEngine.sessions` Map has no size limit or cleanup.
- `workflowRuns` Map in the gateway caps at 100 entries but evicts the oldest, which could be an in-progress run.
- `feedbackStore` and `conversationMeta` cap at 1000/200 entries respectively.
- `rateLimitState` in auth.routes.ts only prunes when exceeding 100 entries.

**Risk**: Memory exhaustion through sustained API abuse. An attacker can create unlimited interview sessions, bus agents, or feedback entries to consume server memory, leading to denial of service.

**Recommended fix**:
- Implement consistent size limits across all in-memory stores.
- Add TTL-based expiry for all session-like data.
- Consider using LRU caches with configurable maximum sizes.
- For production, move session data to Redis.

---

#### M-03: CORS Configuration Allows Arbitrary Origins via Environment Variable

**Affected file**: `/home/alex/abf/packages/core/src/runtime/gateway/http.gateway.ts` (lines 95-114)

**Description**: The CORS origin is configurable via `ABF_CORS_ORIGINS` environment variable. If misconfigured (e.g., set to `*` or overly broad patterns), it could allow cross-origin requests from malicious websites. Additionally, in cloud deployments, the auto-detected Render/Railway URLs are added to allowed origins, which may include staging or preview environments.

**Risk**: A malicious website could make authenticated cross-origin API requests if the CORS policy is overly permissive, potentially controlling agents, reading audit data, or modifying configurations through a user's authenticated browser session.

**Recommended fix**:
- Validate that `ABF_CORS_ORIGINS` contains proper URLs (not `*`).
- Log a warning if wildcard origins are detected.
- In production, only allow the specific dashboard domain.

---

#### M-04: SSE Endpoint Auth Uses Non-Constant-Time Comparison

**Affected file**: `/home/alex/abf/packages/core/src/runtime/gateway/events.routes.ts` (line 20)

**Description**: The SSE events endpoint uses direct string comparison (`token !== apiKey`) instead of the timing-safe comparison used elsewhere in the gateway:

```typescript
if (token !== apiKey && headerToken !== apiKey) {
    return c.json({ error: 'Unauthorized' }, 401);
}
```

Meanwhile, the main auth middleware in `http.gateway.ts` correctly uses `timingSafeEqual`.

**Risk**: Timing attacks could potentially be used to brute-force the API key character by character by measuring response times for the SSE endpoint.

**Recommended fix**:
- Use the same `isValidApiKey()` function from `http.gateway.ts` for SSE token validation.
- Extract the timing-safe comparison into a shared utility.

---

#### M-05: No CSRF Protection on State-Mutating POST Endpoints

**Affected file**: `/home/alex/abf/packages/core/src/runtime/gateway/http.gateway.ts` (entire API surface)

**Description**: None of the state-mutating endpoints (POST, PUT, DELETE) implement CSRF protection. While the API uses JSON Content-Type (which provides some implicit protection via CORS preflight), the absence of explicit CSRF tokens means that:
- Simple POST requests with `Content-Type: text/plain` could bypass CORS preflight.
- Browser extensions or locally running scripts could make requests without CORS restrictions.

**Risk**: An attacker could trick an authenticated operator into visiting a malicious page that triggers agent runs, approves queued actions, or modifies configurations.

**Recommended fix**:
- Enforce `Content-Type: application/json` on all mutating endpoints (reject `text/plain` and `application/x-www-form-urlencoded`).
- Consider adding a CSRF token for dashboard sessions.
- Add `SameSite=Strict` cookie attributes if session cookies are used in the future.

---

#### M-06: Prompt Injection Detection Has Limited Pattern Coverage

**Affected file**: `/home/alex/abf/packages/core/src/security/input-pipeline.ts` (lines 13-24)

**Description**: The injection detection relies on 10 regex patterns that cover common but basic prompt injection techniques:

```typescript
const INJECTION_PATTERNS: readonly RegExp[] = [
    /ignore\s+(previous|all|above)\s+(instructions?|prompts?)/i,
    /you\s+are\s+(now|a|an)\s+/i,
    /system\s*:\s*/i,
    // ... 7 more patterns
];
```

Modern prompt injection techniques use encoded text, Unicode homoglyphs, markdown formatting, multi-language instructions, or indirect injection (instructions embedded in tool outputs) that these patterns would not catch. The pipeline also only wraps content in `<external-content>` tags, which the LLM may not reliably respect.

**Risk**: Sophisticated prompt injection attacks will bypass the detection layer. The content isolation tags provide defense-in-depth but are not a reliable barrier against a determined attacker.

**Recommended fix**:
- Augment regex-based detection with an LLM classifier specifically trained for injection detection.
- Implement output validation that checks agent actions against expected behavior profiles.
- Add canary tokens to detect when external content is being treated as instructions.
- Consider using a separate, smaller model as an injection classifier (defense-in-depth).
- Document that the regex-based approach is a first layer, not a complete solution.

---

#### M-07: Behavioral Bounds Check Uses Tool Name, Not Tool Action

**Affected file**: `/home/alex/abf/packages/core/src/security/bounds-enforcer.ts` (lines 27-54)

**Description**: The bounds enforcer checks whether a tool's name is in the allowed/forbidden actions lists:

```typescript
if (bounds.forbiddenActions.includes(action)) { ... }
if (bounds.allowedActions.length > 0 && !bounds.allowedActions.includes(action)) { ... }
```

But the `action` parameter is the tool name (e.g., `"database-write"`), not the specific action being performed. A tool like `database-write` could perform `INSERT`, `UPDATE`, or `DELETE`, but the bounds check treats all three as the same action. This means you cannot forbid `DELETE` while allowing `INSERT`.

**Risk**: Overly coarse access control. An agent that should only be able to insert data could also delete data through the same tool.

**Recommended fix**:
- Extend the bounds check to support granular tool actions (e.g., `"database-write:delete"`, `"file-write:overwrite"`).
- Tools should declare their sub-actions, and the bounds enforcer should check at the sub-action level.

---

#### M-08: OpenRouter OAuth Returns API Key Directly in URL

**Affected file**: `/home/alex/abf/packages/core/src/runtime/gateway/oauth.routes.ts` (lines 126-143)

**Description**: The OpenRouter OAuth callback expects the API key to be passed directly as a `code` query parameter in the callback URL:

```typescript
if (provider === 'openrouter') {
    const code = c.req.query('code');
    if (!code) { ... }
    await deps.vault.set('openrouter', 'api_key', code);
}
```

This means the API key appears in the URL, which is logged in browser history, server logs, and potentially proxy logs. Additionally, the OpenRouter flow does not use the CSRF state parameter, making it vulnerable to CSRF attacks.

**Risk**: API key exposure through URL logging. The lack of state verification means an attacker could forge a callback URL to overwrite the stored OpenRouter key with their own (key injection attack).

**Recommended fix**:
- Validate the CSRF state parameter for the OpenRouter flow.
- If OpenRouter's API requires key-in-URL, ensure server logs are configured to redact query parameters.
- Document this as a known limitation of OpenRouter's authentication flow.

---

### LOW

#### L-01: Vault File Permissions Are Set But Not Verified on Read

**Affected file**: `/home/alex/abf/packages/core/src/credentials/vault.ts` (line 81)

**Description**: The vault file is written with `mode: 0o600` (owner read/write only), which is correct. However, file permissions are never verified on read. If another process or a misconfigured backup tool changes the permissions, the vault would silently operate with world-readable credentials.

**Recommended fix**:
- Check file permissions on load and warn if they are too permissive.
- Refuse to read the vault if permissions are weaker than `0o600`.

---

#### L-02: Error Messages Leak Internal Details

**Affected files**: Multiple gateway route files

**Description**: Error responses include raw error messages from internal operations:

```typescript
return c.json({ error: `Upload failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
```

These messages may contain file paths, stack traces, database connection details, or other implementation details.

**Recommended fix**:
- Return generic error messages to the client.
- Log detailed error information server-side.
- Use error codes that the client can use for troubleshooting without exposing internals.

---

#### L-03: Session Timeout Does Not Cancel LLM Provider Call

**Affected file**: `/home/alex/abf/packages/core/src/runtime/session-manager.ts` (lines 123-141)

**Description**: When a session times out via `Promise.race`, the timeout promise wins, but the actual LLM provider call and tool executions continue running in the background. The `abort()` method is a no-op (`// In v0.1, abort is a no-op`).

**Risk**: Wasted LLM API credits from sessions that have already been marked as timed out. In extreme cases, a timed-out session could complete tools with side effects (sending emails, writing files) after the session has been reported as failed.

**Recommended fix**:
- Pass an `AbortSignal` to provider chat calls and tool executions.
- Cancel in-flight operations when the session times out.

---

#### L-04: Config Endpoint Allows Arbitrary YAML Write

**Affected file**: `/home/alex/abf/packages/core/src/runtime/gateway/crud.routes.ts` (lines 572-581)

**Description**: The `PUT /api/config` endpoint writes the request body directly to `abf.config.yaml` without schema validation:

```typescript
app.put('/api/config', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const configPath = join(root, 'abf.config.yaml');
    await writeFile(configPath, stringify(body), 'utf-8');
    return c.json({ success: true });
});
```

**Risk**: An attacker could write a malformed config that crashes the runtime on next restart, or inject unexpected configuration values.

**Recommended fix**:
- Validate the config body against the configuration schema before writing.
- Reject unknown keys.
- Back up the previous config before overwriting.

---

#### L-05: Known Dependency Vulnerabilities (Dev Dependencies)

**Description**: `pnpm audit` reports 4 high-severity vulnerabilities in `minimatch` (ReDoS), used transitively through `@vitest/coverage-v8 > test-exclude > glob > minimatch` and `@vitest/coverage-v8 > test-exclude > minimatch`.

**Risk**: These are development/test dependencies and do not affect production deployments. However, a malicious glob pattern in test configuration could cause CPU exhaustion during CI runs.

**Recommended fix**:
- Update `minimatch` to `>=9.0.7` / `>=10.2.3` by updating `@vitest/coverage-v8` or adding a `pnpm.overrides` entry.

---

### INFORMATIONAL

#### I-01: No Security Headers on API Responses

**Description**: The API does not set security headers such as `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, or `Content-Security-Policy`. While these are primarily browser-security headers, they provide defense-in-depth for the dashboard.

**Recommended fix**: Add a security headers middleware for all responses.

---

#### I-02: SSE Connection Keep-Alive Has No Authentication Refresh

**Description**: SSE connections (`/api/events`, `/api/agents/:id/stream`, `/api/sessions/:id/stream`) are authenticated once on connection but never re-authenticated. A revoked API key would not terminate existing SSE connections.

**Recommended fix**: Implement periodic re-authentication or connection lifetime limits for SSE streams.

---

#### I-03: Audit Trail Uses In-Memory Store by Default

**Description**: The audit trail (`IAuditStore`) defaults to an in-memory implementation. In production, this means all audit data (including security events, session logs, and credential access) is lost on restart. The CLAUDE.md states audit data should be "Immutable. Retained 90 days."

**Recommended fix**: Document that production deployments must configure a persistent audit store (PostgreSQL). Consider warning on startup if the in-memory audit store is being used.

---

#### I-04: CI/CD Pipeline Does Not Include Security Scanning

**Affected file**: `/home/alex/abf/.github/workflows/ci.yml`

**Description**: The CI pipeline runs lint, typecheck, build, and test. It does not include:
- Dependency vulnerability scanning (`pnpm audit`)
- SAST (static application security testing)
- Secret scanning
- License compliance checks
- Container image scanning (if Docker is used)

**Recommended fix**:
- Add `pnpm audit --audit-level=high` as a CI step.
- Add a SAST tool (Semgrep, CodeQL) as a CI step.
- Enable GitHub's built-in secret scanning and Dependabot alerts.
- Add `actions/dependency-review-action` for PR dependency checks.

---

## Summary Matrix

| Severity | Count | Remediation Priority |
|----------|-------|---------------------|
| Critical | 4     | Immediate           |
| High     | 7     | Before production    |
| Medium   | 8     | Near-term            |
| Low      | 5     | Scheduled            |
| Info     | 4     | Best practice        |
| **Total**| **28**|                     |

---

## Methodology

This audit was conducted through manual source code review covering:
- All files in `packages/core/src/credentials/`
- All files in `packages/core/src/tools/` (builtin tools, custom tool, loader)
- All files in `packages/core/src/runtime/gateway/` (13 route files + gateway)
- All files in `packages/core/src/runtime/bus/` (in-process and Redis)
- All files in `packages/core/src/seed/` (parser, analyzer, apply, interview)
- All files in `packages/core/src/security/` (bounds enforcer, input pipeline)
- `packages/core/src/runtime/session-manager.ts`
- Dashboard components in `packages/dashboard/src/` (API client, event stream, markdown renderer)
- `.github/workflows/ci.yml`
- Dependency audit via `pnpm audit`

The review focused on the OWASP Top 10 2021 categories, with emphasis on:
- A01: Broken Access Control (auth bypass, path traversal, IDOR)
- A02: Cryptographic Failures (vault encryption, credential handling)
- A03: Injection (SQL injection, command injection, prompt injection, XSS)
- A04: Insecure Design (sandbox escapes, trust boundaries)
- A05: Security Misconfiguration (default-open auth, missing headers)
- A07: Identification and Authentication Failures (weak auth, token exposure)
- A09: Security Logging and Monitoring Failures (audit gaps)
- A10: Server-Side Request Forgery (proxy behavior)

---

*Report generated by Claude Opus 4.6 Security Auditor on 2026-03-01.*
