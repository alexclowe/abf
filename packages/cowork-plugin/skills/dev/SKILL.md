---
name: dev
description: Start the ABF development server. Launches the runtime (scheduler, dispatcher, session manager, bus, gateway) and the dashboard. Use when the user wants to start, run, or launch their ABF project.
disable-model-invocation: true
---

# Start ABF Development Server

Launch the ABF runtime and dashboard for local development.

## Steps

1. **Verify project** — Check that `abf.config.yaml` exists in the current directory.

2. **Check dependencies** — Ensure `node_modules` exists or run `pnpm install`.

3. **Start the server**:

```bash
npx abf dev
```

This starts:
- **Scheduler** — Evaluates cron triggers every 5 seconds
- **Dispatcher** — Manages agent sessions with concurrency control
- **Session Manager** — Executes agent work sessions (LLM calls + tool loops)
- **Message Bus** — Routes inter-agent messages
- **HTTP Gateway** — REST API on port 3000
- **Dashboard** — React UI on port 3001 (proxied through gateway)

4. **Show the user** what's available:
   - Dashboard: `http://localhost:3000`
   - API: `http://localhost:3000/api/agents`
   - Approvals: `http://localhost:3000/approvals`
   - Metrics: `http://localhost:3000/metrics`

5. **Useful API endpoints** to verify it's working:
   - `GET /api/agents` — List all agents
   - `GET /api/metrics/runtime` — Runtime metrics
   - `GET /api/escalations` — Pending escalations
   - `GET /api/approvals` — Pending approvals

## Troubleshooting

- **Port in use**: Change `gateway.port` in `abf.config.yaml`
- **No agents loaded**: Check `agents/` directory has `*.agent.yaml` files
- **Provider not configured**: Run `npx abf auth` to set up API keys
