# ABF Documentation Audit Report

**Date**: 2026-03-01
**Scope**: Complete documentation review of the ABF (Agentic Business Framework) repository

---

## 1. Current State Assessment

### What Exists

ABF has 8 documentation files spread across the repository:

| File | Purpose | Lines | Last Updated |
|---|---|---|---|
| `README.md` | Landing page, overview | 338 | Recent |
| `CLAUDE.md` | Internal dev guide / architecture reference | 373 | Recent |
| `CONTRIBUTING.md` | Contributor setup and conventions | 156 | v1.0 |
| `CHANGELOG.md` | Release history | 99 | v1.0 |
| `SECURITY.md` | Vulnerability disclosure policy | 72 | v1.0 |
| `docs/quickstart.md` | Getting started guide | 543 | v0.3+ |
| `docs/deployment.md` | Cloud deployment instructions | 138 | v0.3+ |
| `docs/api-reference.md` | REST API reference (45+ routes) | 1195 | v1.0 |

Additional files exist but serve different purposes:
- `docs/foundation/` -- 7 files including design docs (`.docx`), internal specs, and the CiteRank reference design. These are internal planning documents, not user-facing docs.
- `docs/plans/` -- 1 template planning doc. Internal.
- `docs/skills/` -- 5 Claude Code skill files. Not user-facing docs.
- `docs/analysis-openclaw-vs-abf-agent-autonomy.md` -- Competitive analysis. Internal.

### What Is Missing

The following documentation gaps are significant, listed by severity:

**Critical gaps (blocking adoption)**:
1. **No conceptual overview** -- New users have no standalone page explaining ABF's 6 core primitives (Agent, Team, Memory, Bus, Tools, Triggers). `CLAUDE.md` contains this information but is an internal dev guide, not a user-facing document.
2. **No seed-to-company guide** -- ABF's flagship feature (turning a business plan into a running agent company) has no dedicated documentation. The quickstart mentions it briefly, but there is no walkthrough covering all three paths (template, seed document, interview).
3. **No configuration reference** -- `abf.config.yaml` has 10+ top-level keys with nested options. There is no reference documenting all config keys, their types, and defaults.
4. **No package READMEs** -- `packages/core/`, `packages/cli/`, and `packages/dashboard/` have no README files. npm packages published without READMEs are significantly harder to discover and trust.

**High-priority gaps (hurting usability)**:
5. **No tools reference** -- ABF ships 30+ built-in tools. There is no documentation listing them, describing their parameters, or explaining which archetypes use which tools.
6. **No agent YAML reference** -- The agent definition format is shown by example in `CLAUDE.md` and `README.md` but there is no complete field-by-field reference.
7. **No self-hosting guide** -- `docs/deployment.md` covers Railway/Render/Fly/Docker but does not cover bare-metal self-hosting, environment variable configuration beyond the basics, or production hardening.
8. **No workflow authoring guide** -- Workflows are a key feature but have no guide showing how to write them from scratch.

**Medium-priority gaps (limiting depth)**:
9. **No architecture deep-dive** -- The runtime architecture (Scheduler, Dispatcher, Session Manager, Bus, Gateway) is described at a high level but has no detailed explanation of the work session lifecycle, how tools execute, or how memory flows.
10. **No custom tools guide** -- `.tool.js` custom tool authoring is mentioned in CONTRIBUTING.md but has no dedicated guide with examples.
11. **No MCP integration guide** -- MCP server configuration is mentioned but not documented.
12. **No security guide** -- `SECURITY.md` covers vulnerability disclosure but not how operators should configure and use ABF's security features (behavioral bounds, approval queues, audit trails).
13. **No migration/upgrade guide** -- No documentation for upgrading between ABF versions.

**Low-priority gaps (nice to have)**:
14. **No FAQ/Troubleshooting page**
15. **No comparison page** (ABF vs CrewAI vs LangChain vs AutoGen)
16. **No video walkthroughs or interactive examples**
17. **No docs site** -- All docs are raw Markdown files browsed on GitHub. No search, no navigation, no syntax highlighting.

### What Is Outdated

1. **Version numbers in quickstart** -- `docs/quickstart.md` line 31 says "You should see output like: `0.1.0`" but the project is at v1.0.0.
2. **Port inconsistency** -- Quickstart says Dashboard runs on port 3001, Gateway on port 3000. The README says "single URL for everything" on port 3000. The dashboard's `package.json` has `next dev -p 3001`. This needs clarification on the actual architecture (are they separate or unified?).
3. **GitHub URLs** -- Several files reference `your-org/abf` instead of `alexclowe/abf` (CONTRIBUTING.md line 14, CHANGELOG.md lines 96-99).
4. **pnpm version** -- CONTRIBUTING.md says "pnpm 9 or later" but `package.json` requires `pnpm >= 10.0.0`.
5. **`CLAUDE.md` dual purpose** -- `CLAUDE.md` serves as both the AI coding assistant context and the internal architecture reference. This is confusing for users who find it on GitHub.

---

## 2. Gap Analysis vs. Best Practices

### Diataxis Framework Assessment

The Diataxis framework (used by LangChain, Django, Ubuntu, and others) identifies four documentation types. Here is how ABF scores:

| Type | Purpose | ABF Coverage | Grade |
|---|---|---|---|
| **Tutorials** | Learning-oriented, step-by-step | Quickstart exists but dated. No other tutorials. | C |
| **How-to Guides** | Task-oriented, problem-solving | Deployment guide exists. Seed pipeline, workflows, custom tools: missing. | D |
| **Reference** | Complete technical description | API reference is excellent. Config, agent YAML, tools: missing. | C+ |
| **Explanation** | Conceptual understanding | No standalone concepts page. Architecture in README is surface-level. | D |

### Comparison to Gold-Standard Projects

| Practice | Stripe | Supabase | Next.js | CrewAI | ABF |
|---|---|---|---|---|---|
| Dedicated docs site with search | Yes | Yes | Yes | Yes | No |
| Quick start < 5 min | Yes | Yes | Yes | Yes | Partial |
| Concepts/mental model page | Yes | Yes | Yes | Yes | No |
| API reference | Yes | Yes | Yes | Yes | Yes |
| Configuration reference | Yes | Yes | Yes | Yes | No |
| Self-hosting guide | N/A | Yes | N/A | N/A | Partial |
| Multiple audience paths | Yes | Yes | Yes | No | No |
| Interactive code examples | Yes | No | Yes | No | No |
| Versioned docs | Yes | Yes | Yes | No | No |
| Changelog | Yes | Yes | Yes | Yes | Yes |
| Contributing guide | Yes | Yes | Yes | Yes | Yes |
| Security policy | Yes | Yes | Yes | No | Yes |

### Key Patterns from Research

1. **Stripe**: Three-column layout (nav, content, code). Executable code samples. Auto-injected API keys. Language switcher. Every concept has a quickstart + reference pair.

2. **Supabase**: Clear split between Guides and Reference. Self-hosting has its own section. Service-specific config pages. Community deployment options documented.

3. **Next.js**: Progressive disclosure -- basic usage first, then advanced patterns. "App Router" vs "Pages Router" toggle lets users pick their context. Every page has "Good to know" callouts.

4. **LangChain**: Explicit Diataxis adoption. Tutorials, How-to Guides, Concepts (Explanation), and API Reference are top-level navigation items. Style guide enforced.

5. **CrewAI** (closest competitor): Quickstart, Core Concepts (Agents, Tasks, Crews, Tools), How-to Guides, API Reference. CLI reference page. Knowledge base docs. Template docs.

---

## 3. Quality Assessment

### README.md -- Grade: B+

**Strengths**: Clear value proposition. Good architecture ASCII diagram. Template comparison table. Badge images. CLI command table. Deployment buttons.

**Weaknesses**: No "30-second demo" (install + run in one code block). Feature list is long but flat -- no visual hierarchy. Links to `docs/quickstart.md` which users may not find on GitHub. No "Why ABF?" section explaining differentiation. Missing a "What people are building" or example use cases section.

### docs/quickstart.md -- Grade: B

**Strengths**: Step-by-step structure. Covers template and seed paths. Shows expected output. Includes agent customization.

**Weaknesses**: Version number is outdated (shows 0.1.0). Port confusion (3000 vs 3001). Sections 10 and 10b are oddly numbered. "Next steps" section is more of a reference dump than guided progression. No troubleshooting section. References `CLAUDE.md` as documentation (confusing for users).

### docs/api-reference.md -- Grade: A-

**Strengths**: Comprehensive coverage of all 45+ routes. Consistent format (auth, request, response, fields). Response shapes with field tables. Error codes documented.

**Weaknesses**: No runnable examples (curl commands only in seed section). No pagination documentation. No rate limiting documentation beyond auth routes. Long single-file format -- would benefit from being split by domain.

### docs/deployment.md -- Grade: B-

**Strengths**: Covers all three cloud targets. Docker included. Environment variables table. Clear Railway steps.

**Weaknesses**: Uses `your-org/abf` in URLs. No Kubernetes or bare-metal instructions. No production hardening checklist. No monitoring/observability guidance. No backup/restore instructions for memory and datastore.

### CONTRIBUTING.md -- Grade: B+

**Strengths**: Clear prerequisites. Good "How to add things" sections (archetype, tool, template). Code style documented. Commit message format. PR process.

**Weaknesses**: Wrong pnpm version (says 9, should be 10). Uses `your-org/abf` in clone URL. No architecture overview for new contributors. No "where to start" for first-time contributors. No issue label guide.

### CHANGELOG.md -- Grade: A-

**Strengths**: Follows Keep a Changelog format. Semantic versioning. Good categorization (Added, Changed, Fixed, Security). Detailed entries.

**Weaknesses**: Uses `your-org/abf` in comparison links. No dates on pre-1.0 releases. Could link to PRs/commits for traceability.

---

## 4. Prioritized Recommendations

### P0 -- Do Now (blocks adoption)

1. **Create `docs/concepts.md`** -- Standalone explanation of the 6 core primitives with diagrams. This is the single most important missing document.
2. **Create `docs/guides/seed-to-company.md`** -- Walkthrough of ABF's flagship feature covering all three paths.
3. **Update `docs/quickstart.md`** -- Fix version number, port confusion, section numbering. Add troubleshooting.
4. **Create package READMEs** -- `packages/core/README.md`, `packages/cli/README.md`, `packages/dashboard/README.md`.
5. **Fix `your-org/abf` references** -- Replace with `alexclowe/abf` in CONTRIBUTING.md, CHANGELOG.md, deployment.md.

### P1 -- Do Soon (hurts usability)

6. **Improve `README.md`** -- Add 30-second quick demo block, "Why ABF?" section, visual hierarchy to features.
7. **Create `docs/self-hosting.md`** -- Complete self-hosting guide covering Docker, Railway, Render, Fly, bare-metal.
8. **Create `docs/reference/configuration.md`** -- Full `abf.config.yaml` reference from the Zod schema.
9. **Create `docs/reference/agent-yaml.md`** -- Complete agent definition reference.
10. **Create `docs/reference/tools.md`** -- Built-in tools catalog.

### P2 -- Do Next (adds depth)

11. **Choose and set up a docs framework** -- Fumadocs (Next.js-native) or Starlight (Astro) for a proper docs site with search.
12. **Create `docs/guides/custom-tools.md`** -- How to write `.tool.js` custom tools.
13. **Create `docs/guides/workflows.md`** -- How to author multi-agent workflows.
14. **Create `docs/guides/security.md`** -- Operator guide to ABF security features.
15. **Split `docs/api-reference.md`** -- Break into per-domain pages for the docs site.

### P3 -- Do Eventually (polish)

16. **Create FAQ / Troubleshooting page**
17. **Create comparison page** (ABF vs CrewAI vs LangChain)
18. **Add runnable examples to API reference**
19. **Create architecture deep-dive**
20. **Add "What people are building" showcase**

---

## 5. Estimated Effort

| Priority | Items | Estimated Hours | Notes |
|---|---|---|---|
| P0 | 5 items | 12-16 hours | Core content creation |
| P1 | 5 items | 10-14 hours | Reference extraction + improvements |
| P2 | 5 items | 16-24 hours | Includes docs framework setup |
| P3 | 5 items | 8-12 hours | Polish and extras |
| **Total** | **20 items** | **46-66 hours** | |

---

## 6. Summary

ABF has a solid foundation: the README is well-written, the API reference is comprehensive, and the CONTRIBUTING guide is above average. However, the documentation has significant gaps in conceptual content, how-to guides, and reference material that prevent new users from understanding and adopting the framework effectively.

The most critical issue is the lack of a conceptual overview -- users arriving at the project have no way to understand ABF's mental model without reading `CLAUDE.md`, which is an internal dev guide not designed for that purpose.

The second critical issue is that ABF's most powerful and differentiating feature -- the seed-to-company pipeline -- has no dedicated documentation.

Addressing the P0 items alone would significantly improve the new user experience and unblock adoption.
