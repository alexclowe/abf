# @abf/dashboard

The web dashboard for the [Agentic Business Framework (ABF)](https://github.com/alexclowe/abf) -- a visual interface for managing AI agent teams.

## What This Package Contains

A Next.js 15 application that provides:

- **Overview** -- System status, active agents, recent sessions
- **Agent Management** -- View, configure, and trigger agents; send tasks to inboxes
- **Team View** -- Team composition and orchestrator relationships
- **Workflow Visualization** -- Visual workflow management with execution state
- **Approval Queue** -- Review and approve/reject agent actions that require human authorization
- **Escalation Handling** -- Manage human-in-the-loop escalations
- **Metrics Dashboard** -- Runtime metrics with auto-refresh (every 5 seconds)
- **KPI Tracking** -- Per-agent performance tracking with target vs. actual gauges
- **Session Logs** -- Browse session logs and audit trail
- **Setup Wizard** -- 6-step onboarding: provider selection, API key, company type (interview / document / template), plan review, project creation

## How It Works

The Dashboard communicates with the ABF runtime through its REST API and SSE (Server-Sent Events) endpoint. In development, the Dashboard runs on port 3001 and proxies API requests to the Gateway on port 3000. In production, both are served from a single port.

## Development

```bash
# From the repository root
pnpm install
pnpm build

# Start the dashboard in development mode
cd packages/dashboard
pnpm dev
# Dashboard available at http://localhost:3001
```

The Dashboard requires a running ABF runtime (`abf dev` in another terminal) to connect to.

## Tech Stack

- Next.js 15 (App Router)
- React 19
- Tailwind CSS
- SWR for data fetching
- Lucide icons

## Documentation

- [Getting Started](https://github.com/alexclowe/abf/blob/main/docs/getting-started.md)
- [API Reference](https://github.com/alexclowe/abf/blob/main/docs/api-reference.md)

## License

MIT
