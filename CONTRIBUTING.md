# Contributing to ABF

Thank you for your interest in contributing. ABF is an open-source framework and welcomes contributions of all kinds: bug fixes, new features, documentation improvements, and new templates or archetypes.

## Prerequisites

- **Node.js** 20 or later
- **pnpm** 10 or later (`npm install -g pnpm`)

## Setup

```bash
git clone https://github.com/alexclowe/abf.git
cd abf
pnpm install
pnpm build
pnpm test
```

All packages are built in dependency order by Turborepo. If you see type errors after pulling, run `pnpm build` again to regenerate declaration files.

## Project Structure

This is a pnpm monorepo managed with Turborepo.

```
packages/
  core/        # Runtime, providers, tools, memory, bus, seed pipeline
  cli/         # `abf` CLI — commands: init, dev, run, status, auth, logs, migrate
  dashboard/   # Next.js 15 dashboard — operator UI and REST API routes
```

All packages are written in TypeScript and share `tsconfig.base.json` at the repo root.

## Development

Start all packages in watch mode:

```bash
pnpm dev
```

This runs `tsc --watch` for `core` and `cli`, and `next dev` for `dashboard`. Changes to `core` will require `dashboard` to pick up the new types — a restart of the dashboard dev server is sometimes needed.

To work on a single package:

```bash
cd packages/core && pnpm dev
cd packages/cli && pnpm dev
cd packages/dashboard && pnpm dev
```

## Code Style

ABF uses [Biome](https://biomejs.dev) for formatting and linting.

- **Indentation**: tabs
- **Quotes**: single quotes
- **Semicolons**: always
- **Line width**: 100 characters

Check and fix:

```bash
pnpm lint          # Check only
pnpm lint:fix      # Auto-fix
```

Biome is configured in `biome.json` at the repo root. Do not use Prettier or ESLint — they are not installed.

## Testing

Tests use [Vitest](https://vitest.dev). All test files live alongside their source files as `*.test.ts`.

```bash
pnpm test                   # Run all tests
pnpm test --filter core     # Run tests in a specific package
```

Tests must pass before a PR is merged. Do not decrease coverage on files you modify.

When adding a new module, add a corresponding `*.test.ts` file in the same directory. Test the public interface, not implementation details.

## Key Conventions

**Files are the API.** Agent definitions, team definitions, templates, and memory are YAML and Markdown files. Any new persistent concept should be file-backed before any database-backed alternative is added.

**snake_case YAML, camelCase TypeScript.** YAML files use `snake_case` for all keys. TypeScript interfaces use `camelCase`. The loaders in `packages/core/src/` handle the transformation.

**Result<T, E> pattern.** Functions that can fail return `{ ok: true, value: T } | { ok: false, error: E }`. Do not throw from library code. Throw only in CLI entry points where the error will be caught and formatted for the user.

**Conditional feature registration.** Before registering a feature that requires an optional dependency (e.g., `ioredis`, `pg`, `better-sqlite3`), check that the dependency is importable. Wrap the import in a try/catch and skip registration if it fails. This keeps the core bundle lean for users who do not need the feature.

**No runtime tool installation.** Agents declare their tools in YAML. The tool surface is fixed at startup. Do not add any mechanism for agents to install or enable tools dynamically.

## How To Add Things

### A new agent archetype

1. Open `packages/core/src/archetypes/archetypes.ts`.
2. Add a new entry to the `ARCHETYPES` map. The key is the archetype slug.
3. Provide: `temperature`, `tools` (array of tool slugs), `behavioral_bounds`, and `charterTemplate` (Markdown string with `{{name}}` placeholder).
4. Add a test in `archetypes.test.ts` verifying the archetype loads and merges correctly.

### A new built-in tool

1. Create `packages/core/src/tools/<tool-slug>.tool.ts`.
2. Export a function matching the `ToolHandler` type.
3. Export a `definition` object matching `ToolDefinition` (name, description, JSON Schema parameters).
4. Register the tool in `packages/core/src/tools/registry.ts`.
5. Add a test covering the handler's main paths.

### A custom tool (for use in a project)

Custom tools live in the project directory, not in the framework repo.

1. Create `tools/<tool-slug>.tool.yaml` — declare `name`, `description`, and `parameters` (JSON Schema).
2. Create `tools/<tool-slug>.tool.js` — export a default async function `handler(params, context)`.
3. Reference the tool slug in an agent's `tools` array.
4. Run `abf dev` — the tool loader picks up `.tool.yaml` files automatically.

Custom tools run in-process. See [SECURITY.md](./SECURITY.md) for the implications.

### A new business template

1. Create a new directory under `templates/<template-slug>/`.
2. Add `abf.config.yaml`, at least one agent YAML, a team YAML, and starter knowledge files.
3. Export the template from `packages/core/src/templates/index.ts`.
4. Add an entry to the template registry with `name`, `description`, and `slug`.
5. The CLI (`abf init --template <slug>`) and dashboard setup wizard will pick it up automatically.

## Pull Request Process

1. Fork the repository and create a branch from `main`: `git checkout -b feat/your-feature`.
2. Make your changes. Keep commits focused — one logical change per commit.
3. Run `pnpm lint:fix` and `pnpm test` and ensure both pass.
4. Open a PR against `main`. Use a descriptive title and explain the motivation in the body.
5. A maintainer will review within a few business days. Address feedback and push additional commits to the same branch.
6. Once approved, the PR will be squash-merged.

For large changes (new primitives, breaking changes, new pipeline stages), open an issue or a draft PR first to discuss the approach before investing significant implementation time.

## Commit Message Style

Use the imperative mood and a short summary line (72 characters or fewer):

```
feat: add redis-cache built-in tool
fix: prevent duplicate cron registration on reload
refactor: extract approval store into standalone module
test: add archetype merge coverage for orchestrator
docs: document custom tool security implications
```

No ticket numbers are required for open-source contributions.
