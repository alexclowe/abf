# ABF Cloud Product Research

**Date:** March 2026
**Status:** Research / Pre-Launch Planning
**Author:** Product Research

---

## Executive Summary

ABF Cloud is the planned managed hosting offering for the ABF (Agentic Business Framework) open-source project. This document covers four critical product decisions: naming, unit economics, infrastructure selection, and competitive positioning.

**Key findings:**

1. **Naming:** "ABF Cloud" is the strongest candidate -- it follows the dominant OSS-to-cloud naming pattern (used by Supabase, Gitpod, n8n, Coolify, and others), avoids trademark conflicts, and keeps brand equity unified. The `.cloud` TLD is the recommended primary domain.

2. **Unit economics are tight but viable.** At the proposed Starter tier ($49/month), the margin is thin (~30-45%) for light users and negative for medium users who lean on Sonnet. The Builder ($149) and Scale ($399+) tiers have healthy margins. **Recommendation: raise Starter to $59/month or cap LLM sessions, and shift Sonnet-heavy workloads to Builder.**

3. **Infrastructure:** Start on **Railway** (MVP, existing integration, simple) with Neon (Postgres) and Upstash (Redis). Migrate to **Hetzner + Coolify** at ~500 users for 3-5x cost reduction. AWS/GCP reserved for enterprise tier or compliance requirements only.

4. **Competitive landscape:** The AI agent hosting market is fragmented. CrewAI Enterprise ($99-$120K/yr), Dify Cloud ($59/mo), LangGraph Platform ($25/mo+), and Lindy ($20-$50/mo) are the closest competitors. ABF's differentiation is the "whole company" abstraction (agents + teams + memory + dashboard) vs. single-agent or workflow-only platforms.

---

## 1. Product Naming

### How Comparable OSS-to-Cloud Products Name Themselves

| Company | OSS Project | Cloud Offering Name | Pattern |
|---------|-------------|-------------------|---------|
| Supabase | Supabase (Postgres toolkit) | Supabase (cloud is the default) | Same name, cloud is primary |
| Vercel | Next.js (framework) | Vercel (separate brand) | Company name IS the cloud |
| Railway | Railway (PaaS) | Railway (cloud-native from start) | Same name |
| Render | Render (PaaS) | Render (cloud-native from start) | Same name |
| Fly.io | Fly.io (PaaS) | Fly.io (cloud-native from start) | Same name |
| Gitpod | Gitpod (dev environments) | Gitpod Cloud | "[Brand] Cloud" |
| n8n | n8n (workflow automation) | n8n Cloud | "[Brand] Cloud" |
| Coolify | Coolify (self-hosted PaaS) | Coolify Cloud | "[Brand] Cloud" |
| PlanetScale | Vitess (MySQL) | PlanetScale (separate brand) | New brand over OSS tech |
| Neon | PostgreSQL (database) | Neon (separate brand) | New brand over OSS tech |
| Turso | libSQL/SQLite (database) | Turso (separate brand) | New brand over OSS tech |
| Dify | Dify (AI agent builder) | Dify Cloud / Dify Premium | "[Brand] Cloud" |
| CrewAI | CrewAI (agent framework) | CrewAI Enterprise | "[Brand] Enterprise" |

**Dominant pattern:** The vast majority use `[Brand] Cloud` or simply keep the same name (where cloud IS the product). Products that create a separate brand (PlanetScale, Neon, Turso) are wrapping a generic OSS project (PostgreSQL, Vitess, SQLite) -- they need a new brand because "PostgreSQL Cloud" means nothing. ABF already has a distinctive brand, so a new name is unnecessary and would dilute recognition.

### Name Candidates

| # | Name | Pros | Cons | Domain Likelihood |
|---|------|------|------|-------------------|
| 1 | **ABF Cloud** | Follows dominant pattern; instantly understood; brand continuity; "ABF Cloud" vs "ABF" creates clear self-hosted/cloud distinction | "ABF" is an acronym -- less memorable cold | `abf.cloud` likely available; `abfcloud.com` possibly available |
| 2 | **ABF Hosted** | Clear value prop (we host it for you); distinguishes from self-hosted | Sounds passive/utilitarian; "hosted" feels dated (2015 era) | `abfhosted.com` likely available |
| 3 | **ABF Platform** | Implies more than hosting (tools, marketplace, ecosystem) | Overused word; vague; conflicts with "ABF is already a platform" | `abfplatform.com` likely available |
| 4 | **LaunchABF** | Action-oriented; implies speed; good for marketing | Verb-first names are harder to reference ("I use LaunchABF" vs "I use ABF Cloud"); domain crowded | `launchabf.com` likely available |
| 5 | **AgentCloud** | Descriptive of what it does; broader appeal | Already taken -- agentcloud.dev is an existing open-source AI agent platform by RNA Digital; trademark risk | UNAVAILABLE -- agentcloud.dev, .io, .com all in use |
| 6 | **ABF Pro** | Short; implies premium tier | Conflicts with tier naming (Starter/Builder/Scale); "Pro" is overused | N/A (not a standalone product name) |
| 7 | **RunABF** | Action-oriented; clean | Sounds like a CLI command, not a product; "run" is generic | `runabf.com` likely available |
| 8 | **ABF Cloud** (with `useabf.com` marketing domain) | Best of both: technical name + marketing domain | Two domains to manage | `useabf.com` likely available as marketing landing page |

### Recommendation: ABF Cloud

**Primary name:** ABF Cloud
**Primary domain:** `abf.cloud`
**Marketing domain (optional):** `useabf.com` or `getabf.com`

**Rationale:**
- Follows the proven pattern used by n8n Cloud, Gitpod Cloud, Coolify Cloud, and Dify Cloud
- Zero ambiguity: "ABF" = the framework, "ABF Cloud" = the managed version
- The `.cloud` TLD is purpose-built for this use case and more available than `.com`
- Existing documentation and codebase already reference "ABF Cloud" (`isCloud` flag, `config.cloud` schema, cloud-boundary docs)
- No trademark conflicts (unlike "AgentCloud")
- Dashboard, CLI, and docs can use "ABF Cloud" naturally: "Deploy to ABF Cloud", "ABF Cloud Settings", etc.

---

## 2. Per-User Cost Analysis

### LLM API Pricing (as of March 2026)

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Use Case |
|-------|----------------------|----------------------|----------|
| **Claude Haiku 4.5** | $1.00 | $5.00 | Fast tasks, classification, simple Q&A |
| **Claude Sonnet 4.6** | $3.00 | $15.00 | Default workhorse, most agent sessions |
| **Claude Opus 4.6** | $5.00 | $25.00 | Complex reasoning (rare in ABF context) |
| **GPT-4o** | $2.50 | $10.00 | Alternative workhorse |
| **GPT-5** | $1.25 | $10.00 | Newer alternative, competitive pricing |
| **GPT-4o Mini** | $0.15 | $0.60 | Budget tasks, similar to Haiku |

### Token Usage Per Agent Session (estimated)

Based on industry data for AI agent production systems and ABF's session lifecycle (load context -> build prompt -> LLM call -> tool loop -> process outputs -> write memory):

| Component | Input Tokens | Output Tokens |
|-----------|-------------|---------------|
| System prompt (charter + bounds) | 800-1,200 | -- |
| Context (history + decisions + inbox) | 500-2,000 | -- |
| Knowledge base injection | 300-1,000 | -- |
| Teammate outputs | 200-500 | -- |
| Tool loop (avg 3 tool calls) | 1,500-3,000 | 500-1,500 |
| Final response + memory write | -- | 300-800 |
| **Total per session** | **3,300-7,700** | **800-2,300** |

**Working estimates:**
- Light session (Haiku, simple task): ~3,500 input + 800 output = 4,300 tokens
- Standard session (Sonnet, typical): ~5,000 input + 1,500 output = 6,500 tokens
- Heavy session (Sonnet, complex + tools): ~8,000 input + 2,500 output = 10,500 tokens

### Per-Session LLM Cost

| Session Type | Model | Input Cost | Output Cost | Total |
|-------------|-------|-----------|-------------|-------|
| Light | Haiku 4.5 | $0.0035 | $0.004 | **$0.008** |
| Standard | Sonnet 4.6 | $0.015 | $0.0225 | **$0.038** |
| Heavy | Sonnet 4.6 | $0.024 | $0.0375 | **$0.062** |
| Complex | Opus 4.6 | $0.040 | $0.0625 | **$0.103** |

### User Scenarios

#### Light User: 5 agents, 10 sessions/day, mostly Haiku

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| LLM (Haiku) | 300 sessions x $0.008 = **$2.40** | 10 sessions/day x 30 days |
| LLM (Sonnet, 10%) | 30 sessions x $0.038 = **$1.14** | Occasional complex tasks |
| **Total LLM** | **$3.54** | |
| Compute (Node.js runtime) | **$5-7** | Shared instance, low utilization |
| PostgreSQL + pgvector | **$4-7** | Neon Launch or Supabase Free/Pro share |
| Redis | **$0-2** | Upstash free tier covers this |
| Storage (memory, logs, outputs) | **$0.50** | < 1 GB |
| Bandwidth | **$0.50** | Minimal |
| Monitoring/logging | **$1** | Shared infrastructure |
| **Total per-user cost** | **$15-22/month** | |

#### Medium User: 10 agents, 50 sessions/day, Sonnet + Haiku mix

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| LLM (Haiku, 40%) | 600 sessions x $0.008 = **$4.80** | 20 sessions/day x 30 |
| LLM (Sonnet, 60%) | 900 sessions x $0.038 = **$34.20** | 30 sessions/day x 30 |
| **Total LLM** | **$39.00** | |
| Compute | **$10-15** | Dedicated small instance |
| PostgreSQL + pgvector | **$10-19** | Neon Launch ($19) or Supabase Pro share |
| Redis | **$3-5** | Upstash pay-as-you-go |
| Storage | **$2** | 2-5 GB |
| Bandwidth | **$1** | |
| Monitoring/logging | **$2** | |
| **Total per-user cost** | **$67-83/month** | |

#### Heavy User: 20 agents, 200 sessions/day, Sonnet-heavy

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| LLM (Haiku, 20%) | 1,200 sessions x $0.008 = **$9.60** | 40 sessions/day x 30 |
| LLM (Sonnet, 75%) | 4,500 sessions x $0.038 = **$171.00** | 150 sessions/day x 30 |
| LLM (Sonnet heavy, 5%) | 300 sessions x $0.062 = **$18.60** | 10 sessions/day x 30 |
| **Total LLM** | **$199.20** | |
| Compute | **$20-30** | Dedicated instance, higher CPU |
| PostgreSQL + pgvector | **$19-25** | Dedicated Neon or Supabase Pro |
| Redis | **$10-15** | Higher throughput |
| Storage | **$5** | 5-20 GB |
| Bandwidth | **$3** | |
| Monitoring/logging | **$3** | |
| **Total per-user cost** | **$259-280/month** | |

### Tier Viability Analysis

| Tier | Price | Target User | Est. Cost | Gross Margin | Viable? |
|------|-------|-------------|-----------|-------------|---------|
| **Starter $49** | $49/mo | Light | $15-22 | 55-69% | YES -- healthy margin |
| **Starter $49** | $49/mo | Medium (if miscategorized) | $67-83 | NEGATIVE | NO -- would lose money |
| **Builder $149** | $149/mo | Medium | $67-83 | 44-55% | YES -- good margin |
| **Builder $149** | $149/mo | Heavy (if miscategorized) | $259-280 | NEGATIVE | NO -- would lose money |
| **Scale $399** | $399/mo | Heavy | $259-280 | 30-35% | YES -- thin but acceptable |
| **Scale $599+** | $599/mo | Heavy | $259-280 | 53-57% | YES -- healthy margin |

### Pricing Recommendations

1. **Starter ($49/month):** Viable, but enforce soft limits:
   - Cap at 5 agents, 500 sessions/month (~17/day)
   - Default model: Haiku 4.5 (Sonnet available but counted at 3x against session cap)
   - If user consistently hits cap, nudge to Builder

2. **Builder ($149/month):** The core money-maker. Fits medium users well:
   - Up to 15 agents, 2,000 sessions/month (~67/day)
   - Full Sonnet access, Haiku for utility tasks
   - Dashboard usage meter with soft warnings at 80%

3. **Scale ($399/month):** Consider raising to $449 or $499 for margin safety:
   - Up to 30 agents, 8,000 sessions/month (~267/day)
   - Priority support, custom model routing
   - Overage billing: $0.05/session beyond cap

4. **Enterprise (custom):** For 50+ agents, dedicated infrastructure, SLAs, HIPAA:
   - Minimum $999/month
   - Dedicated compute, isolated database, custom model access
   - Annual contracts with committed usage

5. **Cost optimization levers:**
   - Prompt caching (90% input cost reduction for repeated context) -- ABF's charter+bounds are static per agent
   - Batch API for non-urgent cron tasks (50% discount)
   - Smart model routing: auto-downgrade to Haiku for simple tool-calling patterns
   - Session output caching across teammates (reduce redundant context loading)

### Break-Even Analysis

Assuming 30% blended gross margin target and $5,000/month fixed overhead (team, monitoring, support):

| Scenario | Avg Revenue/User | Avg Cost/User | Margin/User | Users to Break Even |
|----------|-----------------|---------------|------------|-------------------|
| All Starter | $49 | $18 | $31 | 162 users |
| 60/30/10 mix | $99 | $50 | $49 | 103 users |
| 40/40/20 mix | $139 | $72 | $67 | 75 users |

---

## 3. Infrastructure & Hosting Platform

### Platform Comparison

#### Railway

| Factor | Assessment |
|--------|-----------|
| **Cost (100 users)** | ~$2,000-3,000/mo (compute at $20/vCPU/mo + $10/GB RAM/mo) |
| **Cost (1,000 users)** | ~$15,000-25,000/mo |
| **Cost (10,000 users)** | ~$100,000-200,000/mo (likely need to negotiate) |
| **Multi-tenancy** | Per-project isolation possible; shared DB more cost-effective |
| **Auto-scaling** | Basic (replica scaling, no per-container autoscaling) |
| **Deployment complexity** | LOW -- ABF already has `abf deploy --target railway` |
| **Data residency** | US only (Oregon) |
| **Vendor lock-in** | LOW -- standard Docker containers |
| **ABF integration** | EXISTING -- deploy support built, Railway deploy button in repo |

#### Render

| Factor | Assessment |
|--------|-----------|
| **Cost (100 users)** | ~$2,500-4,000/mo (Standard at $25/service/mo minimum) |
| **Cost (1,000 users)** | ~$20,000-35,000/mo |
| **Cost (10,000 users)** | ~$150,000-300,000/mo |
| **Multi-tenancy** | Per-service isolation; shared DB possible |
| **Auto-scaling** | YES -- auto-scaling on Pro+ plans |
| **Deployment complexity** | LOW -- ABF already has `abf deploy --target render` |
| **Data residency** | US, EU (Frankfurt) |
| **Vendor lock-in** | LOW |
| **ABF integration** | EXISTING |

#### Fly.io

| Factor | Assessment |
|--------|-----------|
| **Cost (100 users)** | ~$800-2,000/mo (shared-cpu machines at ~$2-6/mo each) |
| **Cost (1,000 users)** | ~$6,000-15,000/mo |
| **Cost (10,000 users)** | ~$50,000-120,000/mo |
| **Multi-tenancy** | Excellent -- Machines API allows per-user isolation |
| **Auto-scaling** | YES -- scale to zero, auto-wake on request |
| **Deployment complexity** | LOW -- ABF already has `abf deploy --target fly` |
| **Data residency** | Global (35+ regions), EU available |
| **Vendor lock-in** | MEDIUM -- Machines API is Fly-specific |
| **ABF integration** | EXISTING |

#### AWS (ECS Fargate + RDS)

| Factor | Assessment |
|--------|-----------|
| **Cost (100 users)** | ~$1,500-3,000/mo (Fargate + RDS db.t4g.micro at ~$22/mo + ElastiCache at ~$12/mo) |
| **Cost (1,000 users)** | ~$8,000-15,000/mo (with reserved instances) |
| **Cost (10,000 users)** | ~$40,000-100,000/mo (reserved instances, Savings Plans) |
| **Multi-tenancy** | Full control -- ECS task definitions, VPC isolation |
| **Auto-scaling** | YES -- Fargate auto-scaling, RDS read replicas |
| **Deployment complexity** | HIGH -- requires Terraform/CDK, IAM, VPC setup |
| **Data residency** | Global (25+ regions), GovCloud for compliance |
| **Vendor lock-in** | HIGH -- deep AWS service integration |
| **ABF integration** | NONE -- would need to build |

#### GCP (Cloud Run + Cloud SQL)

| Factor | Assessment |
|--------|-----------|
| **Cost (100 users)** | ~$1,200-2,500/mo (Cloud Run at $0.000024/vCPU-sec + Cloud SQL) |
| **Cost (1,000 users)** | ~$7,000-14,000/mo |
| **Cost (10,000 users)** | ~$35,000-90,000/mo |
| **Multi-tenancy** | Good -- Cloud Run services are isolated |
| **Auto-scaling** | EXCELLENT -- true serverless, scale to zero |
| **Deployment complexity** | MEDIUM -- simpler than AWS, more than PaaS |
| **Data residency** | Global, EU available |
| **Vendor lock-in** | MEDIUM |
| **ABF integration** | NONE -- would need to build |

#### Hetzner + Coolify

| Factor | Assessment |
|--------|-----------|
| **Cost (100 users)** | ~$200-500/mo (CAX ARM instances at ~$4-8/mo + self-managed Postgres) |
| **Cost (1,000 users)** | ~$1,500-4,000/mo |
| **Cost (10,000 users)** | ~$10,000-30,000/mo |
| **Multi-tenancy** | Manual -- Docker containers on shared hosts via Coolify |
| **Auto-scaling** | LIMITED -- manual scaling, no auto-scale |
| **Deployment complexity** | MEDIUM -- Coolify simplifies, but still self-managed |
| **Data residency** | EU (Germany, Finland) -- excellent for GDPR |
| **Vendor lock-in** | NONE -- standard Linux servers |
| **ABF integration** | NONE -- would need to build Coolify deployment |

#### Cost Comparison at Scale (per month)

| Users | Railway | Render | Fly.io | AWS | GCP | Hetzner |
|-------|---------|--------|--------|-----|-----|---------|
| 100 | $2,500 | $3,000 | $1,500 | $2,000 | $1,800 | $350 |
| 1,000 | $20,000 | $25,000 | $10,000 | $12,000 | $10,000 | $2,500 |
| 10,000 | $150,000 | $200,000 | $80,000 | $70,000 | $60,000 | $20,000 |

*Note: These estimates assume shared multi-tenant architecture with database connection pooling. Per-user isolated instances would be 5-10x more expensive.*

### Recommended Phased Approach

#### Phase 1: MVP (0-200 users) -- Railway

**Why:** ABF already has Railway integration. Fastest time to market. Simple deployment, managed Postgres, no DevOps hire needed.

**Architecture:**
- 1 Railway project with shared ABF Cloud services
- Shared PostgreSQL (Railway managed or Neon)
- Upstash Redis (serverless, pay-per-use)
- ABF Cloud proxy service as a separate Railway service
- User isolation via database schemas (not separate instances)

**Monthly cost at 100 users:** ~$2,500 infra + LLM pass-through
**Timeline:** 2-4 weeks to deploy

#### Phase 2: Growth (200-2,000 users) -- Fly.io

**Why:** Fly.io's Machines API enables per-user process isolation at lower cost than Railway. Scale-to-zero reduces cost for inactive users. Global edge deployment possible.

**Architecture:**
- Fly Machine per user project (scale to zero when idle)
- Neon serverless PostgreSQL (scales to zero, pay-per-query)
- Upstash Redis (stays serverless)
- Shared proxy service on dedicated Fly machine

**Monthly cost at 1,000 users:** ~$10,000 infra + LLM pass-through
**Timeline:** 4-8 weeks migration

#### Phase 3: Scale (2,000+ users) -- Hetzner + Coolify (or AWS for enterprise)

**Why:** At 2,000+ users, PaaS markup becomes significant. Hetzner ARM instances are 5-10x cheaper than PaaS equivalents. Coolify provides deployment UX without vendor lock-in.

**Architecture (Hetzner path):**
- Hetzner CAX ARM instances running Coolify
- Self-managed PostgreSQL cluster (or Neon for simplicity)
- Self-managed Redis or Upstash
- Full control over multi-tenancy, scaling, and data residency

**Architecture (AWS path, enterprise):**
- ECS Fargate for compute
- RDS PostgreSQL with pgvector
- ElastiCache Redis
- Required for: HIPAA, SOC 2, enterprise contracts

**Monthly cost at 5,000 users (Hetzner):** ~$8,000 infra
**Monthly cost at 5,000 users (AWS):** ~$35,000 infra

### Infrastructure Decision Matrix

| Criterion | Weight | Railway | Fly.io | Hetzner | AWS |
|-----------|--------|---------|--------|---------|-----|
| Time to market | 25% | 10 | 7 | 5 | 3 |
| Cost at scale | 25% | 4 | 7 | 10 | 6 |
| Auto-scaling | 15% | 5 | 9 | 3 | 8 |
| Multi-tenancy | 15% | 5 | 8 | 6 | 9 |
| Data residency | 10% | 3 | 8 | 9 | 10 |
| ABF integration | 10% | 10 | 8 | 2 | 2 |
| **Weighted Score** | **100%** | **6.2** | **7.6** | **6.2** | **6.1** |

**Verdict:** Start on Railway for speed, plan for Fly.io migration at ~200 users, evaluate Hetzner at ~2,000 users.

---

## 4. Competitive Landscape

### Direct Competitors (AI Agent Hosting Platforms)

| Product | Type | Pricing | Agents | Key Differentiator | ABF Advantage |
|---------|------|---------|--------|-------------------|---------------|
| **CrewAI Enterprise** | Agent framework + cloud | $99/mo - $120K/yr | Multi-agent crews | Largest community (~70% market share for agentic workflows), SOC 2/HIPAA | ABF has full business abstraction (teams, memory, dashboard, seed-to-company); CrewAI is code-first |
| **Dify Cloud** | AI app builder + cloud | $59/mo (Pro) | Single/multi-agent | No-code builder, 260+ data sources, visual workflow | ABF focuses on autonomous agents, not chatbots; has business templates, team structure |
| **LangGraph Platform** | Agent orchestration + cloud | $25/mo + $0.001/node | Graph-based agents | LangChain ecosystem integration, observability via LangSmith | ABF is simpler (YAML, not code); includes dashboard for non-technical operators |
| **Lindy AI** | No-code agent platform | $20-$50/mo | Pre-built agent types | Consumer-friendly, pre-built automations (email, calendar) | ABF targets business operations (full company), not personal productivity |
| **Relevance AI** | Agent builder + cloud | $19-$599/mo | Custom agents | Sales/GTM focus, action-based billing | ABF is horizontal (any business type); Relevance is vertical (sales) |
| **n8n Cloud** | Workflow automation | $24-$800/mo | Workflow-based | 400+ integrations, execution-based billing | ABF agents are autonomous (cron/event triggered); n8n requires manual workflow design |
| **AgentGPT** | Autonomous agent runner | $40/mo (Pro) | Single autonomous agents | Browser-based, zero setup | ABF has persistent memory, teams, and business structure; AgentGPT is ephemeral |

### Indirect Competitors (Overlapping Value Props)

| Product | Overlap with ABF | Pricing | Why Users Might Choose ABF Instead |
|---------|-----------------|---------|-----------------------------------|
| **Zapier / Make** | Workflow automation | $20-$800/mo | ABF agents are autonomous, not rule-based triggers |
| **ChatGPT Teams** | AI-assisted work | $25-$30/seat/mo | ABF agents work autonomously, not on-demand chat |
| **Vercel + Supabase** | Full-stack deployment | $25-$75/mo combined | ABF includes AI agents as first-class primitives |
| **Railway / Render** | Infrastructure hosting | $5-$25/mo | ABF Cloud adds the agent runtime, dashboard, and tooling layer |

### Competitive Positioning Map

```
                    High Abstraction (business-level)
                              |
                              |
                    ABF Cloud o
                              |
          Dify o              |              o Lindy
                              |
    -------Code-First---------+--------No-Code/Low-Code--------
                              |
       CrewAI o               |         o Relevance AI
                              |
       LangGraph o            |
                              |
                    Low Abstraction (developer tools)
```

### Key Competitive Insights

1. **No one does "whole company" yet.** CrewAI comes closest with multi-agent crews, but lacks the business primitives (teams, KPIs, memory layers, seed-to-company pipeline) that ABF provides. This is ABF's unique wedge.

2. **Pricing anchors around $50-100/month** for starter tiers across the market. The proposed $49 Starter is competitive. The $149 Builder has no direct comparison -- most competitors jump from $50 to $500+ (enterprise).

3. **The "operator" user is underserved.** Most platforms target developers. ABF's dashboard-first approach for non-technical operators is a genuine differentiator. Dify and Lindy compete here but with simpler agent models.

4. **Template/seed advantage.** No competitor offers a "describe your business, get a running agent team" pipeline. This is ABF's strongest GTM hook for ABF Cloud -- the setup wizard experience is a conversion funnel that competitors cannot match.

5. **LLM cost is the elephant.** Every platform struggles with the same challenge: LLM API costs dominate unit economics. ABF Cloud's proposed model (baked into subscription, not usage-based add-ons) is simpler for operators but riskier for ABF. Smart model routing and prompt caching are essential for margin protection.

### Lessons from Competitors

| Lesson | Source | Application to ABF Cloud |
|--------|--------|--------------------------|
| Execution-based billing is transparent | n8n Cloud | Consider session-based billing as alternative to flat tiers |
| Free tier drives adoption | Dify, LangGraph, Lindy | Offer a free tier (1 agent, 50 sessions/month, Haiku only) |
| Enterprise needs self-hosted option | CrewAI, n8n | ABF already has this (the open-source framework itself) |
| Observability is a premium feature | LangSmith, AgentOps | Bundle basic observability in all tiers; advanced tracing in Scale |
| Action credits create confusion | Relevance AI | Avoid credit systems -- flat session caps are simpler |
| SOC 2 / HIPAA unlocks enterprise deals | CrewAI Enterprise | Plan for compliance certification at $10K+ MRR |

---

## Appendix A: LLM Pricing Reference Table (March 2026)

| Provider | Model | Input/1M | Output/1M | Context | Notes |
|----------|-------|----------|-----------|---------|-------|
| Anthropic | Haiku 4.5 | $1.00 | $5.00 | 200K | Fast, cheap, good for utility |
| Anthropic | Sonnet 4.6 | $3.00 | $15.00 | 200K | Primary workhorse |
| Anthropic | Opus 4.6 | $5.00 | $25.00 | 1M | Complex reasoning |
| OpenAI | GPT-4o Mini | $0.15 | $0.60 | 128K | Budget alternative to Haiku |
| OpenAI | GPT-4o | $2.50 | $10.00 | 128K | Legacy workhorse |
| OpenAI | GPT-5 | $1.25 | $10.00 | 128K | New workhorse, competitive |
| OpenAI | GPT-5.2 | $1.75 | $14.00 | 128K | Flagship |

## Appendix B: Infrastructure Pricing Reference (March 2026)

| Service | Provider | Config | Monthly Cost |
|---------|----------|--------|-------------|
| Compute | Railway | Per vCPU | $20/vCPU + $10/GB RAM |
| Compute | Render | Standard (1 CPU, 2GB) | $25/mo |
| Compute | Fly.io | shared-cpu-1x, 1GB | ~$5.70/mo |
| Compute | Fly.io | performance-1x, 8GB | ~$61/mo |
| Compute | AWS Fargate | 1 vCPU, 2GB (x86) | ~$40/mo |
| Compute | AWS Fargate | 1 vCPU, 2GB (ARM) | ~$32/mo |
| Compute | GCP Cloud Run | 1 vCPU, 2GB | ~$35/mo (always-on) |
| Compute | Hetzner | CAX11 (2 vCPU ARM, 4GB) | ~$4-5/mo |
| Database | Supabase | Pro (8GB storage) | $25/mo |
| Database | Neon | Launch (autoscale) | $19/mo |
| Database | AWS RDS | db.t4g.micro (2 vCPU, 1GB) | ~$22/mo |
| Redis | Upstash | Pay-as-you-go | $0.20/100K commands (max $120/mo) |
| Redis | AWS ElastiCache | cache.t4g.micro | ~$12/mo |

## Appendix C: Domain Research Notes

The following domains should be checked for availability via a registrar:

**Priority (check first):**
- `abf.cloud` -- primary product domain
- `abfcloud.com` -- SEO/redirect
- `useabf.com` -- marketing landing page
- `getabf.com` -- alternative marketing domain

**Secondary:**
- `abf.dev` -- developer docs
- `abf.ai` -- if pivoting to AI-forward branding
- `abfplatform.com` -- if "Platform" naming wins

**Confirmed unavailable:**
- `agentcloud.dev` -- taken by RNA Digital's AgentCloud project
- `agentcloud.io` -- taken (lead generation company)
- `agentcloud.com` -- taken
