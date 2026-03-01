# @abf/core

The runtime engine for the [Agentic Business Framework (ABF)](https://github.com/alexclowe/abf) -- an open-source framework for building companies that run on AI agents.

## What This Package Contains

`@abf/core` is the foundation of ABF. It includes:

- **Runtime** -- Scheduler, Dispatcher, Session Manager, Message Bus, and HTTP Gateway (Hono)
- **Providers** -- LLM provider adapters for Anthropic, OpenAI, Google, and Ollama
- **Tools** -- 30+ built-in tools (web search, database, file I/O, messaging, and more)
- **Memory** -- File-based and PostgreSQL+pgvector memory backends
- **Schemas** -- Zod schemas for agent YAML, team YAML, config, workflows, monitors, and more
- **Seed Pipeline** -- Document parser, LLM analyzer, interview engine, and project generator
- **Archetypes** -- 10 built-in role archetypes with default configurations

## Installation

```bash
npm install @abf/core
# or
pnpm add @abf/core
```

> Most users should use the `@abf/cli` package instead, which provides the `abf` command-line interface and uses `@abf/core` internally.

## Usage

```typescript
import { createRuntime } from '@abf/core';

// Create and start the runtime from a project directory
const runtime = await createRuntime({
  projectRoot: './my-business',
  // Options are loaded from abf.config.yaml by default
});

await runtime.start();
```

## Key Exports

| Export | Description |
|---|---|
| `createRuntime` | Factory function that wires all runtime components |
| `Runtime` | The main runtime class |
| `ToolRegistry` | In-memory tool registry |
| `configYamlSchema` | Zod schema for `abf.config.yaml` |
| `agentYamlSchema` | Zod schema for `*.agent.yaml` |
| `extractText` | Seed document parser (docx, pdf, txt, md) |
| `analyzeSeedDoc` | LLM-powered seed document analyzer |
| `applyCompanyPlan` | Writes CompanyPlan to project files |
| `InterviewEngine` | Stateful Q&A interview for building seed docs |
| `ARCHETYPES` | Built-in role archetype definitions |

## Related Packages

- [`@abf/cli`](https://github.com/alexclowe/abf/tree/main/packages/cli) -- Command-line interface
- [`@abf/dashboard`](https://github.com/alexclowe/abf/tree/main/packages/dashboard) -- Next.js dashboard

## Documentation

- [Getting Started](https://github.com/alexclowe/abf/blob/main/docs/getting-started.md)
- [Core Concepts](https://github.com/alexclowe/abf/blob/main/docs/concepts.md)
- [API Reference](https://github.com/alexclowe/abf/blob/main/docs/api-reference.md)

## License

MIT
