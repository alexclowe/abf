# ABF Plugin for Claude Cowork

Build and run AI-powered companies from Claude. This plugin brings the [Agentic Business Framework (ABF)](https://github.com/alexclowe/abf) into Claude Code and Cowork, letting you design agent teams, analyze business plans, and manage ABF projects without leaving your conversation.

## What is ABF?

ABF is a framework where AI agents ARE the employees. Each agent has a role, tools, memory, triggers, and behavioral bounds. Agents are organized into teams with orchestrators, communicate via a message bus, and are defined in YAML files that are git-trackable and human-readable.

## Installation

### From a marketplace

```
/plugin install abf
```

### Local development

```bash
claude --plugin-dir ./packages/cowork-plugin
```

## Skills (Slash Commands)

| Command | Description |
|---------|-------------|
| `/abf:init [name]` | Initialize a new ABF project with directory structure and config |
| `/abf:seed [text]` | Analyze a business plan and design a complete agent team |
| `/abf:agent-add [name]` | Add a new agent to the project |
| `/abf:status` | Show project overview — agents, teams, workflows, issues |
| `/abf:run <agent>` | Trigger an agent session via the runtime API |
| `/abf:dev` | Start the ABF development server |
| `/abf:workflow-add [name]` | Create a multi-agent workflow |
| `/abf:deploy [--target]` | Generate deployment configuration |

## Sub-agents

Claude automatically delegates to these specialized agents when appropriate:

| Agent | Purpose |
|-------|---------|
| **business-architect** | Designs complete agent teams from business documents. Runs on Opus for maximum capability. |
| **agent-designer** | Fine-tunes individual agent configs with detailed charters and behavioral bounds. |
| **seed-reviewer** | Reviews business plans for completeness before analysis. |

## Auto-loaded Knowledge

The **abf-conventions** skill is automatically loaded by Claude when you're working with ABF files. It teaches Claude the YAML schemas, naming conventions, security rules, and common patterns so it produces correct ABF configurations without you having to explain the format.

## Hooks

- **PostToolUse (Write|Edit)**: Validates `*.agent.yaml` files after creation or modification. Checks for required fields, kebab-case naming, valid archetypes, and temperature ranges.

## Example Workflow

```
You: /abf:init my-coaching-business

You: /abf:seed
     I'm building an AI-powered fitness coaching platform. We offer
     personalized workout plans, nutrition guidance, and progress tracking.
     Revenue is $29/month subscription. Target market is busy professionals
     aged 25-45 who want to stay fit but don't have time for a gym.

Claude: [Uses business-architect agent to design a 6-agent team]
        Created:
        - agents/atlas.agent.yaml (Orchestrator)
        - agents/coach.agent.yaml (Fitness Coach)
        - agents/nutritionist.agent.yaml (Nutrition Advisor)
        - agents/writer.agent.yaml (Content Creator)
        - agents/scout.agent.yaml (Market Researcher)
        - agents/architect.agent.yaml (Company Architect)
        - teams/coaching.team.yaml
        - knowledge/company.md
        - knowledge/brand-voice.md
        - knowledge/fitness-methodology.md

You: /abf:agent-add sales-rep --archetype marketer --team coaching

You: /abf:dev
```

## Project Structure Created

```
my-coaching-business/
├── abf.config.yaml          # Global configuration
├── agents/                   # Agent YAML definitions
│   ├── atlas.agent.yaml
│   ├── coach.agent.yaml
│   └── ...
├── teams/                    # Team definitions
│   └── coaching.team.yaml
├── knowledge/                # Shared knowledge base
│   ├── company.md
│   └── brand-voice.md
├── workflows/                # Multi-agent workflows
├── memory/                   # Agent memory (append-only)
├── outputs/                  # Session outputs
├── tools/                    # Custom tools + MCP configs
├── datastore/                # Business database
├── monitors/                 # External URL monitors
├── templates/messages/       # Message templates
├── logs/                     # Audit trail
└── interfaces/               # Plugin configs (Slack, email)
```

## Requirements

- Claude Code v1.0.33+
- Node.js 20+ (for running the ABF runtime)
- An LLM provider API key (Anthropic, OpenAI, or Ollama for local)

## License

MIT
