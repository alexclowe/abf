# ABF Security Guide

This document explains how ABF protects your business when running autonomous AI agents, what risks remain, and how to configure your deployment for safety. It is written for both technical and non-technical readers.

**Key principle**: ABF assumes that agents will encounter adversarial input and that any agent with tools can take harmful actions. The framework is designed for containment and recovery, not for preventing all possible misuse.

---

## Table of Contents

- [The Risk of Autonomous Agents](#the-risk-of-autonomous-agents)
- [How ABF Protects You](#how-abf-protects-you)
  - [1. Behavioral Bounds](#1-behavioral-bounds)
  - [2. Credential Isolation](#2-credential-isolation)
  - [3. Execution Sandboxing](#3-execution-sandboxing)
  - [4. Managed Tool Surface](#4-managed-tool-surface)
  - [5. Prompt Injection Defense](#5-prompt-injection-defense)
  - [6. Memory Integrity](#6-memory-integrity)
  - [7. Approval Queues](#7-approval-queues)
  - [8. Audit Trail](#8-audit-trail)
  - [9. Session Limits](#9-session-limits)
- [What ABF Cannot Protect Against](#what-abf-cannot-protect-against)
- [Deployment Security Checklist](#deployment-security-checklist)
- [Configuring Agent Permissions](#configuring-agent-permissions)
- [Network and API Security](#network-and-api-security)
- [Custom Tool Security](#custom-tool-security)
- [Incident Response](#incident-response)
- [Reporting Vulnerabilities](#reporting-vulnerabilities)

---

## The Risk of Autonomous Agents

Running AI agents autonomously on the internet is fundamentally different from using AI as a chat assistant. Understanding the risks helps you make informed decisions about what to automate and what to keep under human control.

### What makes autonomous agents risky

**Agents act on your behalf.** When an agent sends an email, publishes content, queries a database, or calls an API, it does so with your credentials and your authority. A mistake or manipulation has the same consequences as if you did it yourself.

**LLMs can be manipulated.** Large language models follow instructions, but they cannot reliably distinguish between legitimate instructions (your charter and system prompts) and adversarial instructions embedded in external content. This is called *prompt injection*. An agent that reads a webpage, email, or API response may encounter content specifically designed to change its behavior.

**Actions compound.** A single incorrect action may be harmless. But an autonomous agent running on a schedule, executing multi-step workflows, and communicating with other agents can amplify a small error into a significant problem before a human notices.

**Cost accumulates.** LLM API calls cost money. An agent stuck in a loop, or one that has been manipulated into making excessive requests, can run up costs quickly.

### The honest assessment

No software framework can make autonomous agents completely safe. ABF provides multiple layers of defense that significantly reduce risk, but they do not eliminate it. The controls described in this document are designed to:

1. **Limit the blast radius** when something goes wrong
2. **Detect anomalies** early so you can intervene
3. **Make recovery straightforward** through audit logs and memory snapshots
4. **Give you granular control** over what each agent can and cannot do

The right approach is defense in depth: use all available controls, start with conservative permissions, and expand agent autonomy gradually as you build confidence.

---

## How ABF Protects You

ABF is built on nine security mechanisms that work together. No single mechanism is sufficient on its own.

### 1. Behavioral Bounds

**What it does**: Every agent has a set of rules that the runtime enforces *before* any action is executed. The LLM cannot override these rules.

**How it works**: Each agent YAML file contains a `behavioral_bounds` section:

```yaml
behavioral_bounds:
  allowed_actions: [read_data, write_report, send_alert]
  forbidden_actions: [delete_data, modify_billing, access_credentials]
  max_cost_per_session: $2.00
  max_external_requests: 50
  requires_approval: [publish_content, send_client_email]
```

Before every tool call, the runtime checks the action against these bounds. If the action is forbidden, it is blocked regardless of what the LLM requested. If the action requires approval, it is queued for human review. If the cost limit is exceeded, the session ends.

**Why it matters**: The LLM is the "brain" that decides what to do, but the runtime is the "body" that actually does it. Behavioral bounds ensure the body refuses to carry out actions that violate your policies, even if the brain has been tricked.

**For operators**: Review your agents' behavioral bounds in the Dashboard under each agent's configuration page. Tighten them to match what the agent actually needs to do. An agent that only reads data should not have write permissions.

### 2. Credential Isolation

**What it does**: Each agent and tool only has access to the credentials it needs. API keys are never stored in plain text and are never visible to the LLM.

**How it works**:

- **Encrypted vault**: All credentials are stored in an AES-256-GCM encrypted vault. The vault is decrypted at runtime and credentials are injected into tool calls only when needed.
- **Scoped access**: Custom tools receive a `ScopedVault` that only exposes credentials for the providers their tools actually use. A tool that only needs web search credentials cannot read your Stripe API key.
- **Environment separation**: The `code-execute` tool runs child processes without access to your home directory or the credential vault file.
- **No LLM exposure**: Credentials are never included in prompts or LLM responses. They are injected at the tool execution layer, below the LLM.

**For operators**: Use the Dashboard's Settings page to manage credentials. Use `abf auth --list` to see what is configured. Rotate API keys periodically. In production, set `ABF_VAULT_PASSWORD` to a strong password.

### 3. Execution Sandboxing

**What it does**: When agents execute code or call external services, the execution environment is restricted to prevent unauthorized access.

**How it works**:

- **Code execution**: The `code-execute` tool runs JavaScript in a child process with restricted environment variables. The child process cannot access your home directory, the credential vault, or (on Node.js 22+) the network or unauthorized filesystem paths. Output is capped at 10 MB to prevent memory exhaustion.
- **Node.js 22 permission model**: On Node.js 22 and later, ABF uses the built-in `--experimental-permission` flag to enforce filesystem and network restrictions at the OS level. The child process can only read from the project directory and write to the outputs and sandbox directories.
- **Temp file security**: Temporary files created during code execution are written with owner-only permissions (mode 0600).

**For operators**: Use Node.js 22 or later in production for the strongest sandboxing. Check your Node version with `node --version`. The runtime logs a warning if running on an older version.

### 4. Managed Tool Surface

**What it does**: Agents cannot install, enable, or disable tools at runtime. The set of tools available to each agent is fixed at startup by the operator.

**How it works**: Each agent's YAML file lists its tools explicitly:

```yaml
tools: [web-search, knowledge-search, file-write]
```

The runtime only provides these tools to the agent during sessions. Even if the LLM requests a tool that is not in the agent's list, the request is ignored. There is no mechanism for an agent to modify its own tool list.

**Why it matters**: In many agent frameworks, agents can "decide" to use new tools or install packages. This creates an unbounded attack surface. ABF's managed tool approach means you know exactly what capabilities each agent has, and that set cannot change without your intervention.

**For operators**: Review each agent's tool list. Remove tools the agent does not need. The fewer tools an agent has, the smaller the blast radius if something goes wrong.

### 5. Prompt Injection Defense

**What it does**: ABF treats all external content as untrusted data, not as instructions, and runs a detection pipeline to identify manipulation attempts.

**How it works**:

1. **Source tagging**: Every piece of input is tagged with its source (user, agent, webhook, web, email, system). External sources are treated with higher suspicion.
2. **Content isolation**: External content (from web searches, API calls, emails) is wrapped in delimiters and explicitly marked as data in the system prompt. The LLM is instructed to treat this content as information to process, not as instructions to follow.
3. **Injection detection**: A classifier scans external content for patterns that look like instructions (e.g., "ignore previous instructions", "you are now", role-play prompts). Detected patterns are logged as security events.
4. **Output validation**: After the LLM decides on an action, it is validated against the agent's behavioral bounds before execution. Even if an injection succeeds in influencing the LLM's decision, the action is still subject to bounds enforcement.

**Limitations**: Prompt injection defense is not foolproof. Sophisticated attacks can evade pattern-based detection. This is why ABF uses defense in depth -- even if injection bypasses the detection layer, behavioral bounds and approval queues provide additional barriers.

**For operators**: Monitor the Escalations and Logs pages in the Dashboard for injection detection alerts. If you see frequent alerts from a particular data source, consider adding that source to a blocklist or reducing the agent's permissions.

### 6. Memory Integrity

**What it does**: Protects agent memory from corruption and poisoning attacks.

**How it works**:

- **Append-only history**: Agent history files are append-only. New learnings are added at the end; existing entries are never modified or deleted during normal operation.
- **Windowed context**: The session manager limits how much history is loaded into each session (default: 4,000 characters of recent history). This prevents a poisoned old entry from dominating the agent's context.
- **Memory compaction**: When history grows too long, a summarization pass condenses older entries into a summary. The original entries are preserved for audit purposes.
- **File-based storage**: In the default filesystem mode, memory is stored as plain Markdown files that you can inspect, version control, and restore from backups.

**For operators**: Periodically review your agents' history files at `memory/agents/<name>/history.md`. If you notice unusual entries, you can manually edit or restore from a backup. Consider version-controlling the `memory/` directory.

### 7. Approval Queues

**What it does**: Sensitive actions are queued for human review instead of being executed immediately.

![Inline Approval Flow](images/approval-flow.png)

**How it works**: When an agent's behavioral bounds include `requires_approval` for an action, the runtime intercepts the tool call and places it in an approval queue. The agent receives a message saying the action has been queued, and the session continues with other work.

You review and approve or reject pending actions through:
- **Inline in agent chat** -- Approval cards appear directly in the conversation with Approve/Reject buttons and expandable details showing exactly what the agent wants to do
- The **Approvals** page in the Dashboard for a full queue view
- The `GET /api/approvals` API endpoint

**For operators**: Start with `requires_approval` on high-impact actions like `publish_content`, `send_client_email`, `database-write`, and `social-publish`. As you build confidence in an agent's judgment, you can selectively remove approval requirements.

### 8. Audit Trail

**What it does**: Every action, decision, and event in the system is logged immutably.

**What is logged**:
- Session start and end (agent, trigger, duration, cost, status)
- Every tool call (tool name, arguments, result, cost)
- Every message sent between agents
- Every memory write
- Every escalation and approval decision
- Security events (injection detection, bounds violations, credential access)

**Retention**: Action logs are retained for 90 days. Security events, escalations, and memory writes are retained indefinitely.

**For operators**: Access logs through the Dashboard's Logs page, the CLI (`abf logs`), or the `logs/` directory in your project. Set up log forwarding to your monitoring system for production deployments.

### 9. Session Limits

**What it does**: Prevents runaway sessions from consuming excessive resources.

**How it works**:

- **Timeout**: Every session has a configurable timeout (default: 5 minutes). When the timeout fires, the session is aborted and the underlying LLM API call is cancelled immediately.
- **Cost cap**: The `max_cost_per_session` behavioral bound stops a session when estimated API costs exceed the limit.
- **Tool loop limit**: Each session has a maximum number of tool call rounds (default: 10). This prevents infinite loops where the LLM keeps calling tools without producing a final response.
- **Abort propagation**: When a session times out or is manually aborted, the cancellation signal propagates all the way to the LLM provider SDK, stopping any in-flight API calls and preventing further token consumption.

**For operators**: Set `max_cost_per_session` conservatively, especially during initial deployment. You can always increase it later. Monitor the Metrics page for sessions that frequently hit cost or timeout limits -- this may indicate a problem with the agent's configuration.

---

## What ABF Cannot Protect Against

Transparency about limitations is more useful than false confidence. These are risks that ABF's controls reduce but do not eliminate:

### Sophisticated prompt injection

ABF's injection detection uses pattern matching and content isolation. A sufficiently creative attacker who controls content that your agents read (a webpage, an email, an API response) may be able to craft input that evades detection. The behavioral bounds provide a second line of defense, but if the manipulated action falls within the agent's allowed actions, it will be executed.

**Mitigation**: Use `requires_approval` for any action that has external consequences (sending emails, publishing content, writing to databases). Limit what external sources your agents read.

### Logic errors in agent behavior

An agent may take a technically permitted action that is strategically wrong. For example, a content-writing agent might publish a factually incorrect article. ABF enforces *permissions*, not *judgment*. The quality of agent output depends on the LLM, the charter, and the knowledge base you provide.

**Mitigation**: Start with human-in-the-loop approval for all content that reaches the outside world. Use the approval queue and review agent outputs before they are published or sent.

### Compromised LLM provider

If your LLM provider is compromised or serves malicious responses, agents will act on those responses. ABF cannot verify the integrity of LLM outputs beyond behavioral bounds checking.

**Mitigation**: Use reputable LLM providers. Monitor agent behavior for anomalies. Consider running critical agents with a local model (Ollama) for maximum control.

### Custom tool vulnerabilities

Custom tools (`.tool.js` files you write) run in-process with access to your Node.js environment. A bug or vulnerability in a custom tool can access the filesystem, network, or other resources beyond what ABF's built-in sandboxing covers.

**Mitigation**: Review custom tools carefully. Treat them as production code. Do not install untrusted third-party tool packages. See the [Custom Tool Security](#custom-tool-security) section below.

### Data exfiltration through allowed channels

If an agent has permission to send emails and read your database, it could theoretically email your database contents to an external address. ABF's behavioral bounds control *what actions* are allowed but do not inspect the *content* of those actions at a semantic level.

**Mitigation**: Apply the principle of least privilege. An agent that reads your database should not also have email-sending capabilities unless it genuinely needs both. Use separate agents with narrow tool sets rather than one agent with broad access.

### Denial-of-service through API costs

An agent that has permission to make web searches or LLM calls can accumulate costs. While `max_cost_per_session` limits per-session spending, an agent on a frequent cron schedule could still generate significant costs over time.

**Mitigation**: Set cost limits per session. Review cron schedules -- agents do not need to run every minute in most cases. Monitor the Metrics page for cost trends. Set up billing alerts with your LLM provider.

---

## Deployment Security Checklist

### For local development

- [ ] Use `abf auth` to store credentials (not environment variables in dotfiles)
- [ ] Review agent YAML files before running `abf dev`
- [ ] Set reasonable `max_cost_per_session` limits (e.g., $0.50)

### For production deployments

**Authentication and access**:
- [ ] Set `ABF_API_KEY` to a strong random string (32+ characters) -- this protects all API endpoints
- [ ] Set `ABF_CORS_ORIGINS` to your actual domain(s) only
- [ ] Set `NODE_ENV=production`
- [ ] Place the Gateway behind a reverse proxy with TLS (HTTPS)
- [ ] Do not expose the Gateway port directly to the internet without authentication

**Credentials**:
- [ ] Set `ABF_VAULT_PASSWORD` to a strong password and store it securely
- [ ] Use environment variables for LLM API keys (not config files)
- [ ] Rotate LLM API keys periodically
- [ ] Review what credentials each agent's tools need (principle of least privilege)

**Agent configuration**:
- [ ] Review all agent `behavioral_bounds` -- are they as restrictive as possible?
- [ ] Set `requires_approval` for actions with external consequences
- [ ] Set `forbidden_actions` for anything the agent should never do
- [ ] Set `max_cost_per_session` to a conservative limit
- [ ] Review escalation rules -- do they route to a channel you monitor?
- [ ] Review cron schedules -- are frequencies appropriate for production?

**Infrastructure**:
- [ ] Use PostgreSQL for persistent memory (not filesystem) in multi-instance deployments
- [ ] Use Redis for the message bus in multi-instance deployments
- [ ] Configure the process manager to restart on failure
- [ ] Set up log collection and monitoring
- [ ] Back up the database, memory directory, and credential vault regularly

**Monitoring**:
- [ ] Check the Dashboard's Metrics page regularly
- [ ] Set up alerts for escalations (via Slack, email, or Discord messaging plugins)
- [ ] Monitor LLM provider billing dashboards for unexpected cost spikes
- [ ] Review audit logs for security events (injection detection, bounds violations)

---

## Configuring Agent Permissions

The most important security decision you make is what each agent is allowed to do. Follow these guidelines:

### Start restrictive, expand gradually

Begin with the minimum permissions an agent needs to function. Run it for a few days, review its behavior in the logs, and then expand permissions if needed. It is much easier to grant additional access than to recover from an agent that had too much access.

### Separate concerns across agents

Instead of one powerful agent, use multiple specialized agents with narrow tool sets:

| Pattern | Example |
|---|---|
| **Reader + Writer** | One agent reads and analyzes data; a separate agent writes reports based on the analysis |
| **Internal + External** | One agent handles internal knowledge; a separate agent interacts with external APIs |
| **Drafter + Publisher** | One agent drafts content; a separate agent (with approval queue) publishes it |

### Use approval queues as training wheels

When deploying a new agent, set `requires_approval` on all its outward-facing actions. Review the approval queue for a week. Once you are confident the agent makes good decisions, selectively remove approval requirements for low-risk actions.

### Review the built-in archetypes

ABF's 10 built-in archetypes come with pre-configured behavioral bounds tuned for their role. Use these as starting points and tighten them further for your specific use case.

---

## Network and API Security

### API authentication

Set the `ABF_API_KEY` environment variable to require bearer token authentication on all Gateway API endpoints:

```bash
export ABF_API_KEY="your-strong-random-key-here"
```

All API requests must then include:
```
Authorization: Bearer your-strong-random-key-here
```

The `/health` endpoint is the only route that does not require authentication, so it can be used for platform health checks.

### CORS

In production, restrict CORS to your actual dashboard domain:

```bash
export ABF_CORS_ORIGINS="https://dashboard.yourdomain.com"
```

The default (allowing `localhost` origins) is only appropriate for local development.

### TLS

ABF's Gateway serves HTTP, not HTTPS. In production, place it behind a reverse proxy (nginx, Caddy, or your cloud platform's load balancer) that terminates TLS. Never expose the Gateway directly to the internet over plain HTTP.

### Rate limiting

The Gateway applies rate limiting to authentication endpoints (5 requests per 15 minutes per IP) and general API endpoints. This prevents brute-force attacks against API keys and credential management routes.

---

## Custom Tool Security

Custom tools (`.tool.js` files in your project's `tools/` directory) run **in-process** in the same Node.js process as the ABF runtime. This gives them significant access:

**What custom tools CAN access**:
- A scoped credential vault (only providers mapped to the agent's tool list)
- The project filesystem
- The business database (if configured)
- Network requests (they run in the main process, not sandboxed)

**What custom tools CANNOT access**:
- Credentials for providers not in their agent's tool list (blocked by ScopedVault)
- The full credential vault (only the scoped subset)

### Guidelines for writing custom tools

1. **Review all dependencies.** Custom tools can `require()` any Node.js package. Audit what packages your tools use and keep them minimal.
2. **Do not store credentials in code.** Use the `ctx.vault` to access credentials. Never hardcode API keys in `.tool.js` files.
3. **Validate input.** Tool arguments come from the LLM, which may have been influenced by adversarial content. Validate and sanitize all inputs.
4. **Limit scope.** Each tool should do one thing. Do not create a "swiss army knife" tool that can read files, make API calls, and write to databases.
5. **Log actions.** Use `ctx.log()` to record what the tool does. This feeds into the audit trail.

### If distributing tools to others

Treat custom tool packages with the same security rigor as any npm package:
- Audit the source code
- Pin dependency versions
- Document what the tool does and what credentials it needs
- Do not include credentials or secrets in the distribution

---

## Incident Response

If you suspect an agent has been compromised or is behaving unexpectedly:

### Immediate actions

1. **Stop the runtime**: Press `Ctrl+C` or stop the Docker container. This halts all agent activity immediately.
2. **Review logs**: Check `logs/sessions/` and the Dashboard's Logs page for the last few sessions. Look for unusual tool calls, unexpected outputs, or injection detection alerts.
3. **Check the approval queue**: Look for any pending actions that should not have been queued.
4. **Review memory**: Check the agent's `memory/agents/<name>/history.md` for unusual entries that may indicate memory poisoning.

### Recovery

1. **Revoke compromised credentials**: If an agent's credentials may have been exposed, rotate them immediately via `abf auth <provider>` or your provider's dashboard.
2. **Restore memory**: If memory has been poisoned, restore from a backup or manually remove the problematic entries.
3. **Tighten bounds**: Before restarting, review and tighten the agent's behavioral bounds. Add `requires_approval` for any actions that were part of the incident.
4. **Restart with monitoring**: Restart the runtime and closely monitor the agent's behavior through the Dashboard for the next several sessions.

### Post-incident

1. Review the audit trail to understand the full scope of the incident.
2. Determine the root cause (prompt injection, misconfiguration, tool vulnerability, etc.).
3. Update agent configurations to prevent recurrence.
4. If the incident exploited an ABF vulnerability, report it per the process below.

---

## Reporting Vulnerabilities

**Do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities through:

- **Email**: security@abf.dev
- **GitHub Security Advisories**: Use the "Report a vulnerability" button in the Security tab

Include: affected component, reproduction steps, potential impact, and any proof-of-concept code.

| Severity | Acknowledgement | Patch Target |
|---|---|---|
| Critical | 24 hours | 7 days |
| High | 48 hours | 14 days |
| Medium | 48 hours | 30 days |
| Low | 5 business days | Next release |

See [SECURITY.md](../SECURITY.md) for the full disclosure policy.
