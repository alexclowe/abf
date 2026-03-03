---
name: init
description: Initialize a new ABF (Agentic Business Framework) project. Creates the directory structure, config file, and starter agents for an AI-powered business. Use when the user wants to start a new ABF project, create an agentic business, or set up a new company with AI agents.
argument-hint: "[project-name]"
---

# Initialize ABF Project

You are setting up a new ABF (Agentic Business Framework) project. ABF is a framework where AI agents ARE the employees — each agent has a role, tools, memory, triggers, and behavioral bounds.

## Steps

1. **Ask the user** what kind of business they want to build. Offer these paths:
   - **From an idea**: Describe the business and you'll design the agent team (use `/abf:seed` after init)
   - **From a template**: Choose from: `solo-founder`, `saas`, `marketing-agency`, `e-commerce`, `content-studio`, `consulting`
   - **Custom**: Start with a blank project and add agents manually

2. **Create the project directory** named `$ARGUMENTS` (or ask for a name):

```bash
mkdir -p $ARGUMENTS && cd $ARGUMENTS
```

3. **Create `abf.config.yaml`** with this structure:

```yaml
name: <project-name>
version: 0.1.0

storage:
  backend: filesystem
  basePath: .

bus:
  backend: in-process

security:
  injectionDetection: true
  boundsEnforcement: true
  auditLogging: true
  credentialRotationHours: 24
  maxSessionCostDefault: "$2.00"

gateway:
  enabled: true
  host: 0.0.0.0
  port: 3000

runtime:
  maxConcurrentSessions: 10
  sessionTimeoutMs: 300000
  healthCheckIntervalMs: 30000

logging:
  level: info
  format: pretty

agentsDir: agents
teamsDir: teams
toolsDir: tools
memoryDir: memory
logsDir: logs
knowledgeDir: knowledge
outputsDir: outputs
```

4. **Create the standard directory structure**:

```
<project>/
├── abf.config.yaml
├── agents/
├── teams/
├── tools/
├── memory/
│   └── agents/
├── knowledge/
│   ├── company.md
│   └── brand-voice.md
├── outputs/
├── datastore/
│   ├── schemas/
│   └── migrations/
├── workflows/
├── monitors/
├── templates/
│   └── messages/
├── logs/
│   ├── bus/
│   ├── sessions/
│   └── escalations/
└── interfaces/
```

5. **Create starter knowledge files**:
   - `knowledge/company.md` — Company overview (ask user for details or leave as template)
   - `knowledge/brand-voice.md` — Brand voice guidelines

6. **Tell the user** what's next:
   - Add agents: `/abf:agent-add`
   - Analyze a business plan: `/abf:seed`
   - Start the runtime: `/abf:dev`

## Important

- Always use `abf.config.yaml` as the config filename (not `.json`, not `.yml`)
- Agent files go in `agents/` with the naming pattern `<name>.agent.yaml`
- Team files go in `teams/` with the pattern `<name>.team.yaml`
- All YAML files use snake_case for field names
