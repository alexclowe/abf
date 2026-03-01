# @abf/cli

The command-line interface for the [Agentic Business Framework (ABF)](https://github.com/alexclowe/abf) -- an open-source framework for building companies that run on AI agents.

## Installation

```bash
npm install -g @abf/cli
```

Or use without installing:

```bash
npx @abf/cli init --template solo-founder --name my-business
```

## Quick Start

```bash
# Create a new project from a template
abf init --template solo-founder --name my-business
cd my-business

# Configure your LLM provider
abf auth anthropic

# Start the runtime (API + Dashboard on port 3000)
abf dev
```

## Commands

| Command | Description |
|---|---|
| `abf init` | Create a new project (`--template`, `--name`, `--seed`) |
| `abf dev` | Start the runtime in development mode (`--port`) |
| `abf run <agent>` | Manually trigger an agent (`--task`) |
| `abf status` | Show agent and system status (`--verbose`) |
| `abf auth [provider]` | Manage LLM credentials (`--list`, `--remove`) |
| `abf logs` | View session logs (`--agent`, `--lines`) |
| `abf escalations` | List open escalations (`--follow`) |
| `abf setup` | Open the setup wizard in your browser |
| `abf migrate` | Run datastore schema and SQL migrations |
| `abf agent add` | Scaffold a new agent (`--name`, `--archetype`, `--team`) |
| `abf workflow add` | Scaffold a workflow (`--template`, `--name`) |
| `abf deploy` | Generate deployment config (`--target railway\|render\|fly`) |

## Templates

| Template | Agents | Description |
|---|---|---|
| `solo-founder` | 3 | Executive assistant, researcher, writer |
| `saas` | 5 | Product + go-to-market teams |
| `marketing-agency` | 4 | Director, strategist, copywriter, analyst |

## Seed-to-Company Pipeline

Generate a custom agent team from a business plan:

```bash
abf init --seed ./my-business-plan.md
```

Accepts `.docx`, `.pdf`, `.txt`, and `.md` files. The pipeline parses the document, analyzes it with an LLM, and generates agents, teams, knowledge files, and workflows tailored to your business.

## Documentation

- [Getting Started](https://github.com/alexclowe/abf/blob/main/docs/getting-started.md)
- [Core Concepts](https://github.com/alexclowe/abf/blob/main/docs/concepts.md)
- [Seed-to-Company Guide](https://github.com/alexclowe/abf/blob/main/docs/guides/seed-to-company.md)
- [Self-Hosting Guide](https://github.com/alexclowe/abf/blob/main/docs/self-hosting.md)

## License

MIT
