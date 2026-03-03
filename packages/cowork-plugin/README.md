# ABF Plugin for Claude Cowork

Turn a business idea into a team of AI agents that run in Claude. No server, no dashboard, no deployment — just Claude as your business operating system.

## What This Does

ABF (Agentic Business Framework) designs teams of AI agents that help solo founders run businesses. This plugin makes Cowork the runtime: agents are native Claude sub-agents with persistent memory, the orchestrator delegates work across the team, and automation runs via `claude --agent` + cron.

## How It Works

```
You: "I'm building a fitness coaching platform for busy professionals"

Claude → business-architect agent → designs your team:

.claude/agents/
├── atlas.md          # Orchestrator — coordinates everything
├── scout.md          # Researcher — market analysis, competitors
├── writer.md         # Content creator — blog posts, emails
├── analyst.md        # Data analyst — metrics, reporting
├── coach-ai.md       # Domain expert — coaching methodology
└── architect.md      # Meta-agent — weekly business review

knowledge/
├── company.md        # Your business context
└── brand-voice.md    # How your brand communicates
```

Then just talk to Claude. It delegates to the right agent automatically.

## Installation

```bash
# Local development
claude --plugin-dir ./packages/cowork-plugin

# Or install from registry (future)
/plugin install abf
```

## Skills (Slash Commands)

| Command | Description |
|---------|-------------|
| `/abf:init [name]` | Initialize a new project with an orchestrator agent |
| `/abf:seed [text]` | Analyze a business plan → generate full agent team |
| `/abf:agent-add [name]` | Add a new agent to the team |
| `/abf:status` | Show team roster, knowledge files, issues |
| `/abf:run <agent>` | Run a specific agent with a task |
| `/abf:dev` | Show how to use agents (interactive, headless, cron) |
| `/abf:workflow-add [name]` | Create a multi-agent workflow script |
| `/abf:deploy [--target]` | Set up automation (cron, GitHub Actions) |

## Sub-agents

| Agent | Model | Purpose |
|-------|-------|---------|
| **business-architect** | Opus | Designs complete agent teams from business docs |
| **agent-designer** | Sonnet | Fine-tunes individual agent configs |
| **seed-reviewer** | Sonnet | Reviews business plans for completeness |

## Example: Full Workflow

```
# 1. Start a project
/abf:init my-coaching-biz

# 2. Feed it your business plan
/abf:seed
I'm building an AI-powered fitness coaching platform. We offer
personalized workout plans, nutrition guidance, and progress tracking.
$29/month subscription. Target: busy professionals aged 25-45.

# 3. Claude generates your agent team (6 agents, knowledge files, AGENTS.md)

# 4. Start using it — just talk
"What are our competitors charging?"          → Scout handles it
"Draft a launch email"                        → Writer handles it
"What should I focus on this week?"           → Atlas coordinates all agents

# 5. Automate recurring tasks
/abf:deploy --target cron
```

## Three Ways to Use Your Agents

### 1. Interactive (Cowork)
Just talk to Claude. It reads your `.claude/agents/` definitions and delegates automatically.

### 2. Direct (CLI)
```bash
claude --agent atlas                              # Interactive with orchestrator
claude --agent scout --message "Research X"        # Direct to specialist
```

### 3. Automated (Headless)
```bash
# In crontab:
0 9 * * * claude --agent atlas --message "Daily standup" --headless
0 10 * * 1 claude --agent atlas --message "Weekly review" --headless
```

## Agent Memory

Agents with `memory: project` accumulate knowledge over time in `.claude/agent-memory/<name>/`. The more you use them, the better they get at understanding your business.

## Project Structure

```
my-business/
├── .claude/
│   ├── agents/                 # Your AI team
│   │   ├── atlas.md            # Orchestrator
│   │   ├── scout.md            # Researcher
│   │   ├── writer.md           # Content creator
│   │   └── ...
│   └── agent-memory/           # Persistent learnings (auto-managed)
│       ├── atlas/
│       ├── scout/
│       └── ...
├── knowledge/                  # Shared business context
│   ├── company.md
│   └── brand-voice.md
├── data/                       # Reports, outputs, exports
├── scripts/                    # Workflow scripts
├── logs/                       # Automation logs
├── AGENTS.md                   # Team guide + automation setup
├── CLAUDE.md                   # Project instructions
└── .gitignore
```

## Why Cowork as the Runtime?

Traditional multi-agent frameworks require you to run a server, manage a scheduler, configure a message bus, and build a dashboard. For a solo founder, that's overhead. Cowork already has:

- **Sub-agents** → Your AI employees
- **Persistent memory** → Agents learn over time
- **`Agent()` tool** → Orchestrator delegates to specialists
- **`claude --agent`** → Headless execution for automation
- **Background tasks** → Parallel agent execution
- **Git worktrees** → Isolated agent workspaces

ABF's job is to design the right team and encode the business knowledge. Cowork's job is to run it.

## License

MIT
