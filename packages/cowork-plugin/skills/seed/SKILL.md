---
name: seed
description: Analyze a business plan, idea document, or seed text and design a complete AI agent team to run the business. Use when the user has a business document, plan, pitch deck text, or business idea they want to turn into an ABF agent team.
argument-hint: "[paste text or file path]"
context: fork
agent: business-architect
---

# Seed-to-Company Analysis

You have been given a business document or idea to analyze. Your job is to design a complete ABF agent team to operate this business.

## Input

The user's business document or idea:

$ARGUMENTS

## Analysis Process

1. **Extract company info**: name, description, mission, target customer, revenue model, industry, stage (idea/pre-launch/launched/growing/established)

2. **Design the agent team** (typically 4-8 agents). For each agent, define:
   - `name` (snake_case, e.g., `content-writer`)
   - `display_name` (human-readable)
   - `role` (job title)
   - `role_archetype` (one of: researcher, writer, orchestrator, analyst, customer-support, developer, marketer, finance, monitor, generalist)
   - `description` (what this agent does)
   - `charter` (detailed identity prompt — who they are, responsibilities, working style)
   - `provider` and `model` (default: anthropic / claude-sonnet-4-6)
   - `temperature` (0.1-0.7 depending on role)
   - `tools` (from ABF built-in tools — see reference below)
   - `triggers` (cron, manual, message, webhook, heartbeat)
   - `behavioral_bounds` (allowed/forbidden actions, cost limits, approval requirements)
   - `kpis` (metrics to track)

3. **Always include a Company Architect agent** — meta-agent that reviews the seed doc weekly and evaluates agent coverage vs business needs.

4. **Structure teams** — Group agents into 1-3 teams. Every team needs an orchestrator.

5. **Identify knowledge files** — What company knowledge should be documented (company overview, brand voice, product details, processes).

6. **Identify tool gaps** — Capabilities mentioned in the doc that don't map to built-in ABF tools.

7. **Suggest workflows** — Multi-agent coordination patterns (e.g., content pipeline, customer onboarding).

## Output Format

After analysis, generate the actual YAML files:

1. One `*.agent.yaml` file per agent in `agents/`
2. One `*.team.yaml` file per team in `teams/`
3. Knowledge markdown files in `knowledge/`
4. A summary of tool gaps (if any) in `knowledge/tool-gaps.md`
5. Workflow YAML files in `workflows/` (if applicable)

## Available ABF Tools

- web-search, web-fetch, browse — Web access
- knowledge-search — Search company knowledge base and agent memory
- send-message — Inter-agent and external messaging (Slack, Discord, dashboard)
- email-send — Send emails via Resend or SMTP
- database-query (SELECT only), database-write (INSERT/UPDATE/DELETE) — Business database
- file-read, file-write — Project filesystem access
- data-transform — JSON/CSV transformation
- image-render — HTML/CSS to PNG/JPEG
- social-publish — Social media via Buffer
- stripe-billing — Stripe payments
- github-ci — GitHub repos and CI/CD
- calendar — Events and scheduling
- privacy-ops — GDPR/CCPA compliance
- plan-task — Task decomposition
- ask-human — Request human input inline
- app-generate — Generate UI with v0
- app-deploy — Deploy to Vercel
- backend-provision — Provision Supabase backends
- code-generate — Generate code via Claude Code headless
- reschedule — Self-reschedule for future activation

## Role Archetypes (provide default tools and temperature)

- researcher: temp 0.3, tools [web-search, knowledge-search]
- writer: temp 0.7, tools [knowledge-search, image-render]
- orchestrator: temp 0.2, tools [send-message, knowledge-search]
- analyst: temp 0.2, tools [database-query, knowledge-search]
- customer-support: temp 0.4, tools [send-message, knowledge-search, database-query, email-send, privacy-ops]
- developer: temp 0.3, tools [knowledge-search, github-ci, app-generate, app-deploy, backend-provision, code-generate]
- marketer: temp 0.6, tools [web-search, knowledge-search, send-message, email-send, image-render, social-publish]
- finance: temp 0.1, tools [database-query, knowledge-search, stripe-billing, privacy-ops]
- monitor: temp 0.1, tools [web-search, knowledge-search, send-message]
- generalist: temp 0.4, tools [knowledge-search]

## Agent YAML Format

```yaml
name: scout
display_name: Research & Analytics
role: Market Researcher
description: Monitors market trends and competitor activity.
role_archetype: researcher
provider: anthropic
model: claude-sonnet-4-6
temperature: 0.3
team: product
reports_to: atlas
tools: [web-search, knowledge-search, database-query]
triggers:
  - type: cron
    schedule: '0 */4 * * *'
    task: market_scan
  - type: message
    from: atlas
    task: on_demand_research
  - type: manual
    task: manual_research
escalation_rules:
  - condition: api_costs > budget_threshold
    target: human
    message: Research budget exceeded
behavioral_bounds:
  allowed_actions: [read_data, write_report, search_web]
  forbidden_actions: [delete_data, modify_billing, send_client_email]
  max_cost_per_session: "$2.00"
  requires_approval: [publish_content]
kpis:
  - metric: research_reports_produced
    target: "5 per week"
    review: weekly
charter: |
  # Scout — Market Researcher
  You are Scout, the market research specialist...
```

## Team YAML Format

```yaml
name: product
display_name: Product Team
description: Handles product strategy, research, and development.
orchestrator: atlas
members: [scout, builder, writer]
```
