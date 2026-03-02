# ABF Documentation Structure Proposal

**Date**: 2026-03-01

---

## 1. Proposed Information Architecture

The documentation follows the Diataxis framework with four top-level sections, plus standard OSS pages. Content is organized for two audiences: **Operators** (non-technical, dashboard-first) and **Builders** (developers, CLI + files).

### Site Map

```
docs/
├── index                           # Landing / overview
│
├── getting-started/
│   ├── installation                # Install CLI, prerequisites
│   ├── quickstart                  # Template project in 5 minutes
│   ├── seed-to-company             # Flagship feature walkthrough
│   └── dashboard-tour              # Visual tour for operators
│
├── concepts/
│   ├── overview                    # ABF mental model, 6 primitives
│   ├── agents                      # What agents are, how they work
│   ├── teams                       # Team composition, orchestrators
│   ├── memory                      # Memory layers explained
│   ├── message-bus                 # Inter-agent communication
│   ├── tools                       # Tool system (builtin, MCP, custom)
│   ├── triggers                    # What activates agents
│   ├── security                    # Security model explained
│   └── architecture                # Runtime internals deep-dive
│
├── guides/
│   ├── seed-to-company             # Full seed pipeline walkthrough
│   ├── writing-agents              # Create and customize agents
│   ├── building-teams              # Team composition patterns
│   ├── custom-tools                # Writing .tool.js handlers
│   ├── mcp-integration             # Connecting MCP servers
│   ├── workflows                   # Multi-agent workflow authoring
│   ├── knowledge-base              # Setting up shared knowledge
│   ├── business-database           # Datastore, schemas, migrations
│   ├── monitoring                  # External URL monitoring
│   ├── message-templates           # Template-based agent messaging
│   ├── approvals                   # Approval queue for operators
│   └── security-hardening          # Production security checklist
│
├── self-hosting/
│   ├── overview                    # Deployment options summary
│   ├── docker                      # Docker and docker-compose
│   ├── railway                     # Railway one-click deploy
│   ├── render                      # Render deployment
│   ├── fly-io                      # Fly.io deployment
│   └── production-checklist        # Hardening, backups, monitoring
│
├── reference/
│   ├── configuration               # abf.config.yaml full reference
│   ├── agent-yaml                  # Agent definition schema
│   ├── team-yaml                   # Team definition schema
│   ├── workflow-yaml               # Workflow definition schema
│   ├── monitor-yaml                # Monitor definition schema
│   ├── cli                         # CLI commands reference
│   ├── tools/
│   │   ├── index                   # Tool catalog overview
│   │   ├── web-search              # Per-tool pages
│   │   ├── database-query          # ...
│   │   └── ...                     # One page per tool
│   ├── api/
│   │   ├── overview                # Authentication, CORS, conventions
│   │   ├── agents                  # Agent endpoints
│   │   ├── sessions                # Session endpoints
│   │   ├── teams                   # Team endpoints
│   │   ├── escalations             # Escalation endpoints
│   │   ├── approvals               # Approval endpoints
│   │   ├── workflows               # Workflow endpoints
│   │   ├── metrics                 # Metrics endpoints
│   │   ├── messages                # Message bus endpoints
│   │   ├── seed-pipeline           # Seed pipeline endpoints
│   │   ├── auth                    # Auth management endpoints
│   │   ├── events-sse              # SSE real-time endpoint
│   │   └── webhooks                # Webhook endpoint
│   ├── archetypes                  # 10 built-in role archetypes
│   ├── templates                   # Business template catalog
│   └── environment-variables       # All env vars reference
│
├── contributing/
│   ├── setup                       # Dev environment setup
│   ├── conventions                 # Code style, patterns
│   ├── adding-tools                # How to add a built-in tool
│   ├── adding-archetypes           # How to add an archetype
│   └── adding-templates            # How to add a business template
│
└── meta/
    ├── changelog                   # Release history
    ├── security                    # Vulnerability disclosure
    ├── roadmap                     # What's next
    └── faq                         # Frequently asked questions
```

### Page Count Estimate

| Section | Pages | Priority |
|---|---|---|
| Getting Started | 4 | P0 |
| Concepts | 9 | P0 (overview), P1 (rest) |
| Guides | 12 | P0 (seed, agents), P1 (rest) |
| Self-Hosting | 6 | P1 |
| Reference | 20+ | P0 (config, CLI), P1 (rest) |
| Contributing | 5 | P2 (already mostly exists) |
| Meta | 4 | P2 (already mostly exists) |
| **Total** | **~60 pages** | |

---

## 2. Documentation Framework Recommendation

### Comparison Matrix

| Framework | Next.js Native | Search | MDX Support | Customizable | OSS | Maintenance |
|---|---|---|---|---|---|---|
| **Fumadocs** | Yes (App Router) | Built-in (Orama) | Yes | High | Yes | Active |
| **Nextra** | Yes (Pages Router) | Built-in (Flexsearch) | Yes | Medium | Yes | Active |
| **Starlight** | No (Astro) | Built-in (Pagefind) | Yes | High | Yes | Active |
| **Docusaurus** | No (React) | Algolia plugin | Yes | High | Yes | Active (Meta) |
| **Mintlify** | No (hosted) | Built-in | Yes | Low | No | N/A (SaaS) |

### Recommendation: Fumadocs

**Primary choice: Fumadocs** for these reasons:

1. **Next.js native** -- ABF's dashboard is already Next.js 15. Fumadocs uses the App Router, matching ABF's tech stack. Developers contributing to docs use the same framework they already know.

2. **Zero-config search** -- Ships with Orama (local, fast, no external service). No Algolia account needed.

3. **Flexibility** -- Unlike Nextra (which is opinionated), Fumadocs can be added to an existing Next.js project or stand alone. ABF could eventually embed docs into the dashboard.

4. **MDX + TypeScript** -- First-class MDX support. Type-safe content collections. Custom components are easy.

5. **Active development** -- Regular releases, responsive maintainer, growing adoption.

**Alternative: Starlight** if the team prefers maximum simplicity and does not need Next.js integration. Starlight (Astro) has the best out-of-box experience for pure documentation sites.

**Not recommended**: Mintlify (proprietary, paid), Docusaurus (not Next.js, heavier), Nextra (Pages Router, less flexible).

### Implementation Plan

Phase 1 (immediate, no framework needed):
- Write all docs as Markdown files in `docs/`
- GitHub renders them natively
- Link from README.md

Phase 2 (when docs reach ~20 pages):
- Add `packages/docs` or `apps/docs` with Fumadocs
- Migrate existing Markdown files
- Deploy to Vercel or as part of an ABF marketing site

---

## 3. Content Plan

### Phase 1: Core Content (P0)

| Page | Source Material | Effort | Notes |
|---|---|---|---|
| `getting-started.md` | Rewrite of `quickstart.md` | 2h | Fix version, ports, add troubleshooting |
| `concepts.md` | Extract from `CLAUDE.md` | 3h | 6 primitives explained for newcomers |
| `guides/seed-to-company.md` | `CLAUDE.md` seed section + code | 3h | All 3 paths: template, document, interview |
| `self-hosting.md` | Expand `deployment.md` | 2h | Add Docker details, env var reference |
| Package READMEs (x3) | `package.json` + source code | 2h | Brief install/usage for npm consumers |
| README.md improvement | Existing + new content | 2h | Quick demo, "Why ABF?", better structure |

### Phase 2: Reference Material (P1)

| Page | Source Material | Effort |
|---|---|---|
| `reference/configuration.md` | `config.schema.ts` | 2h |
| `reference/agent-yaml.md` | `agent.schema.ts` | 2h |
| `reference/cli.md` | CLI command source files | 2h |
| `reference/tools/index.md` | `tools/builtin/` directory | 3h |
| `reference/archetypes.md` | `archetypes.ts` | 1h |
| `reference/environment-variables.md` | Code grep + deployment.md | 1h |

### Phase 3: Guides (P1-P2)

| Page | Effort | Priority |
|---|---|---|
| `guides/writing-agents.md` | 2h | P1 |
| `guides/custom-tools.md` | 2h | P1 |
| `guides/workflows.md` | 2h | P1 |
| `guides/mcp-integration.md` | 2h | P2 |
| `guides/knowledge-base.md` | 1h | P2 |
| `guides/business-database.md` | 2h | P2 |
| `guides/security-hardening.md` | 2h | P2 |

---

## 4. Style Guide Recommendations

### Audience Awareness

Every page should declare its audience at the top using a callout:

```markdown
> **Audience**: Builders (developers). Operators can accomplish this through the Dashboard setup wizard instead.
```

When a task can be done via both Dashboard and CLI, show both paths. Dashboard first (for operators), CLI second (for builders).

### Tone

- **Direct and concise** -- ABF docs should read like Stripe's: professional, no fluff, every sentence earns its place.
- **Second person** -- "You" not "the user" or "one."
- **Present tense** -- "ABF loads agents from the `agents/` directory" not "ABF will load."
- **Imperative for instructions** -- "Run `abf dev`" not "You should run."

### Code Examples

- Every concept should have a code example within 3 paragraphs of its introduction.
- Use real file paths and real commands from the codebase. Never fabricate.
- Show expected output when the output is meaningful (command results, API responses).
- Use YAML for agent/team/config examples. Use TypeScript for SDK/tool examples. Use `bash` for CLI.
- Annotate code blocks with comments explaining non-obvious lines.

### Structure

- **One idea per heading** -- Do not combine unrelated topics under a single heading.
- **Progressive disclosure** -- Start with the simplest case. Add complexity only when the reader asks for it (via links or expandable sections).
- **Link liberally** -- Every mention of a concept, tool, or config key should link to its reference page.
- **Front-load the answer** -- Put the most important information first. Details and caveats come after.

### Formatting Conventions

- **Bold** for UI elements: "Click **Create Project**"
- **Code** for file names, commands, config keys, tool names: "`abf.config.yaml`", "`abf dev`", "`web-search`"
- **Callouts** for warnings, tips, and audience notes
- **Tables** for structured comparisons and reference data
- **Diagrams** as ASCII art (for Markdown compatibility) or Mermaid (if docs framework supports it)

### File Naming

- Lowercase, hyphenated: `seed-to-company.md`, `agent-yaml.md`
- No numbering in file names (ordering handled by docs framework sidebar config)
- Guides prefixed with their section: `guides/custom-tools.md`, `reference/configuration.md`

---

## 5. Migration Path

### From Current State to Docs Site

1. **Now**: Write docs as Markdown in `docs/`. Users browse on GitHub.
2. **~20 pages**: Add Fumadocs. Move content into MDX. Deploy docs site.
3. **~40 pages**: Add search, versioning, API playground.
4. **~60 pages**: Add i18n, community contributions, interactive examples.

### Preserving Existing Content

- `docs/quickstart.md` becomes `docs/getting-started.md` (rewritten, not deleted)
- `docs/deployment.md` content moves into `docs/self-hosting/` (split by platform)
- `docs/api-reference.md` content moves into `docs/reference/api/` (split by domain)
- `CONTRIBUTING.md` stays at root (GitHub convention) but also linked from docs
- `CHANGELOG.md` stays at root (GitHub convention) but also linked from docs
- `SECURITY.md` stays at root (GitHub convention) but also linked from docs
- `CLAUDE.md` stays at root (AI assistant context) -- not user-facing docs
