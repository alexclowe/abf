# Seed-to-Company: From Business Plan to Running Agent Team

ABF's most powerful feature is its Seed-to-Company pipeline. Describe your business -- in a document, by pasting text, or through an interactive interview -- and ABF generates a complete AI agent team with roles, tools, knowledge base, workflows, and project structure.

This guide covers all three paths and explains what happens at each stage.

---

## Overview

The pipeline has 4 stages:

```
  Parse  -->  Analyze  -->  Review  -->  Apply
  (text)      (LLM)        (human)      (files)
```

1. **Parse** -- Extract plain text from your document (`.docx`, `.pdf`, `.txt`, `.md`)
2. **Analyze** -- An LLM reads your business description and designs the optimal agent team
3. **Review** -- You review the proposed plan: agents, teams, knowledge, workflows, and tool gaps
4. **Apply** -- ABF writes all project files and starts the agents

---

## Path A: From a Document (CLI)

If you have a business plan, pitch deck, or company description document:

```bash
abf init --seed ./my-business-plan.md
```

ABF accepts `.docx`, `.pdf`, `.txt`, and `.md` files. Here is what happens:

### Step 1: Parse

ABF reads the file and extracts plain text. For `.docx` it uses mammoth, for `.pdf` it uses pdf-parse. The text is normalized (extra whitespace collapsed, trimmed).

```
Seed document loaded (1,847 words)
```

### Step 2: Analyze

The extracted text is sent to an LLM (defaults to Anthropic Claude) along with a detailed system prompt that instructs the model to:

- Identify the business functions needed
- Design agents for each function with appropriate archetypes
- Group agents into teams with orchestrators
- Create knowledge files (company overview, brand voice, etc.)
- Design workflows for key business processes
- Identify tool gaps -- capabilities your business needs that ABF does not yet provide

```
Analyzing seed document with anthropic/claude-sonnet-4-6...
Company plan generated

  Company: CoachAI
  Agents: 7 (head-coach, scout, content-creator, community-manager,
              performance-analyst, support-agent, architect)
  Teams: 2 (coaching, operations)
  Knowledge files: 4
  Tool gaps: 2 (Video analysis platform, Payment processing integration)
```

### Step 3: Review (automatic in CLI)

In CLI mode, the plan is displayed for review. If you are satisfied, the pipeline continues to apply.

### Step 4: Apply

ABF writes all project files:

```
Creating project: coachai
Project created: /home/user/coachai

  7 agents across 2 teams:
    coaching: head-coach (orchestrator), scout, content-creator, community-manager
    operations: performance-analyst, support-agent, architect

  2 tool gaps identified (see knowledge/tool-gaps.md):
    * Video analysis platform (required)
    * Payment processing integration (important)

  Next steps:
    cd coachai
    abf status                  Verify agents loaded
    abf dev                     Start the runtime
```

### What gets generated

| Directory/File | Contents |
|---|---|
| `abf.config.yaml` | Project configuration with project name |
| `agents/*.agent.yaml` | One file per agent with name, role, provider, tools, triggers, behavioral bounds, KPIs, and charter |
| `agents/architect.agent.yaml` | Company Architect meta-agent (auto-injected) |
| `agents/builder.agent.yaml` | Builder agent for product construction (auto-injected, only when a build plan is generated) |
| `teams/*.team.yaml` | Team definitions with orchestrators and member lists |
| `knowledge/seed.md` | Your original document with frontmatter (company name, date, version) |
| `knowledge/company.md` | Company overview derived from the seed |
| `knowledge/brand-voice.md` | Brand voice guidelines |
| `knowledge/build-plan.md` | Adaptive build plan with phases, steps, agent assignments, and approval checkpoints (only when seed describes a product to build) |
| `knowledge/tool-gaps.md` | Tool gaps with priority levels (if any) |
| `memory/decisions.md` | Initial decision log |
| `workflows/*.workflow.yaml` | Multi-agent workflows (if the analyzer designs any) |

### The Company Architect

Every seed-generated project includes a special agent called the **Company Architect**. This meta-agent:

- Runs on a weekly cron schedule (Monday at 10am)
- Reads `knowledge/seed.md` and evaluates agent coverage vs. business needs
- Reports: coverage score, gaps, redundancies, recommendations, priority actions
- Cannot modify agents directly -- only recommends changes for human approval

The Architect ensures your agent team stays aligned with your business as it evolves.

### The Builder Agent

When the seed document describes a product that needs to be built (SaaS, marketplace, platform, web app), the analyzer generates an **adaptive build plan** and injects a **Builder** agent alongside the Architect. The Builder:

- Reads `knowledge/build-plan.md` on activation (5-minute heartbeat)
- Creates a structured plan-task from the build phases and steps
- For each step: requests human approval (for infrastructure, deployment, payments), then delegates to the assigned agent
- Uses `delegate-task` to send work to developer, marketer, and other agents -- the result is returned directly (synchronous delegation, no polling)
- Tracks progress across sessions using `plan-task` and `reschedule`

The build plan is adaptive -- the LLM generates it based on what your specific business needs:

| Business Type | Typical Build Phases |
|---|---|
| SaaS / Platform | Provision database, generate frontend, configure auth, set up payments, deploy |
| Agency / Services | Build landing page, set up email/CRM, launch marketing |
| Content Business | Configure CMS/social channels, create initial content, launch |
| E-Commerce | Provision backend, generate storefront, configure payments, deploy |

Every step that provisions infrastructure, deploys, or configures payments requires human approval before execution. The Builder cannot approve its own requests.

---

## Path B: From a Document (Dashboard)

The Dashboard setup wizard provides a visual version of the same pipeline.

### Steps

1. **Choose provider** -- Select Anthropic, OpenAI, or Ollama
2. **Enter API key** -- Configure your LLM credentials
3. **Select "I have a business plan or description"** -- Choose company type B or C
4. **Upload or paste** -- Either upload a `.docx`/`.pdf` file or paste text directly
5. **Review the plan** -- The Dashboard shows an interactive review:
   - Expandable agent rows with charter previews
   - Team composition diagram
   - Knowledge file previews
   - Tool gaps with colored priority badges (red = required, yellow = important, green = nice-to-have)
   - **Build plan** with expandable phases, step-by-step details, agent assignments, complexity badges, and approval checkpoints (only when a product needs building)
   - Workflow outlines
6. **Click "Create Project"** -- Files are written and agents are hot-loaded into the runtime

After creation, you are redirected to the Dashboard overview where your new agents are already running.

### API equivalent

You can also drive the pipeline programmatically through the REST API:

```bash
# 1. Upload and parse a document
curl -X POST http://localhost:3000/api/seed/upload \
  -H 'Content-Type: application/json' \
  -d '{"text": "Your business plan text here..."}'

# Response: { "text": "Cleaned text...", "wordCount": 842 }

# 2. Analyze the text
curl -X POST http://localhost:3000/api/seed/analyze \
  -H 'Content-Type: application/json' \
  -d '{"seedText": "Your business plan text here..."}'

# Response: CompanyPlan JSON with agents, teams, knowledge, toolGaps, etc.

# 3. Apply the plan (writes files and reloads agents)
curl -X POST http://localhost:3000/api/seed/apply \
  -H 'Content-Type: application/json' \
  -d '{"plan": { ... }}'

# Response: { "success": true, "filesWritten": 14, "agents": [...] }
```

For binary documents (.docx, .pdf), base64-encode the file content and pass the `format` field:

```bash
curl -X POST http://localhost:3000/api/seed/upload \
  -H 'Content-Type: application/json' \
  -d '{"text": "<base64-encoded-content>", "format": "docx"}'
```

---

## Path C: Interactive Interview (Dashboard)

If you do not have a document but have a business idea, ABF can interview you to build a seed document.

### How it works

1. **Choose provider** and **enter API key** in the setup wizard
2. **Select "Start a new company from an idea"**
3. **Answer 8-13 questions** -- The interview engine asks about:
   - Your company's vision and what problem it solves
   - Target customers and their pain points
   - Revenue model and pricing
   - Core product/service offering
   - **Product type** -- Does it need a web app, mobile app, or API built? (skipped for pure services)
   - **MVP features** -- The 3-5 most important features for launch
   - **Payment model** -- Subscriptions, one-time, credits (if applicable)
   - **Authentication needs** -- User accounts, social login, etc.
   - Competitive positioning
   - Key operations and business functions
   - Key metrics and KPIs
   - Brand voice and communication style
   - Governance and decision-making processes
4. **Review the generated seed document** -- The interview produces a comprehensive seed document (800-2000 words) including an "MVP Technical Requirements" section when a product needs to be built
5. **Review the company plan** -- Same review interface as Path B
6. **Create the project**

### Interview API

The interview is also available via API:

```bash
# Start an interview
curl -X POST http://localhost:3000/api/seed/interview/start \
  -H 'Content-Type: application/json' \
  -d '{"companyType": "new"}'

# Response:
# {
#   "sessionId": "sess_abc123",
#   "step": {
#     "question": "What problem does your company solve?",
#     "progress": "1 of 8",
#     "complete": false
#   }
# }

# Answer a question
curl -X POST http://localhost:3000/api/seed/interview/sess_abc123/respond \
  -H 'Content-Type: application/json' \
  -d '{"answer": "We help small businesses automate their marketing..."}'

# Response: next question or completed seed document

# Check session state
curl http://localhost:3000/api/seed/interview/sess_abc123
```

The interview forces completion at 15 questions maximum. Sessions expire after 1 hour of inactivity.

---

## Tool Gap Analysis

One of the most valuable outputs of the analyzer is the **tool gap analysis**. The LLM compares your business needs against ABF's 30+ built-in tools and identifies capabilities that are not yet available.

Each gap includes:

| Field | Description |
|---|---|
| `capability` | What the business needs (e.g., "Video analysis platform") |
| `mentionedIn` | Where in the seed document this need was identified |
| `suggestion` | How to address the gap (custom tool, third-party integration, etc.) |
| `priority` | `required` (blocks core functionality), `important` (significant feature), or `nice-to-have` |

Tool gaps are:
- Displayed in the CLI summary during `abf init --seed`
- Shown in the Dashboard plan review with colored priority badges
- Written to `knowledge/tool-gaps.md` so agents are aware of known limitations

---

## Updating Your Business Plan

As your business evolves, you can update the seed document and re-analyze:

```bash
curl -X POST http://localhost:3000/api/seed/reanalyze \
  -H 'Content-Type: application/json' \
  -d '{
    "originalSeedText": "Original business plan...",
    "updatedSeedText": "Updated business plan with new features...",
    "currentPlan": { ... }
  }'
```

The re-analyzer focuses on the delta between the original and updated documents. It:

- Preserves existing agents and their accumulated memory
- Adds new agents only when new business functions are identified
- Modifies existing agents when their responsibilities change
- Removes agents only when their function is explicitly eliminated
- Increments the `seedVersion` counter on the plan

This ensures your running agent team evolves with your business without losing accumulated context and memory.

---

## Tips for Better Results

### Writing a good seed document

The analyzer works best with documents that cover:

- **What the company does** -- Clear description of the product or service
- **Who it serves** -- Target customer and their problems
- **How it makes money** -- Revenue model and pricing
- **Key operations** -- Business functions that need to happen regularly
- **Metrics** -- What success looks like (KPIs, targets)
- **Communication style** -- Brand voice, formality level
- **Decision-making** -- What requires human approval vs. agent autonomy

If your business involves building a product (SaaS, platform, marketplace), also include:

- **Product type** -- Web app, mobile app, API, etc.
- **Key features for launch** -- The 3-5 most important features
- **Authentication needs** -- User accounts, social login, OAuth
- **Payment model** -- Subscriptions, one-time purchase, credits, free tier
- **Database needs** -- What data is stored and queried

This "MVP Technical Requirements" section gives the analyzer enough context to generate a good adaptive build plan. Without it, the analyzer will still generate an agent team, but may not produce a build plan.

A 500-2000 word document typically produces the best results. Very short documents (under 200 words) may produce generic agents. Very long documents (over 5000 words) may overwhelm the analyzer with details.

### Choosing between paths

| Situation | Recommended Path |
|---|---|
| You have a written business plan | Path A (CLI) or Path B (Dashboard) |
| You have a rough idea but no document | Path C (Interview) |
| You want to test ABF quickly | Template (`abf init --template solo-founder`) |
| You want full control over the review process | Path B (Dashboard -- visual plan review) |
| You are automating setup in CI/CD | API calls directly |

---

## What To Do After Generation

1. **Review agent charters** -- Open each `agents/*.agent.yaml` file and read the `charter` field. The LLM wrote these based on your business description. Edit them to add detail, correct assumptions, or adjust tone.

2. **Address tool gaps** -- Check `knowledge/tool-gaps.md`. For "required" gaps, you may need to write custom tools before those agents can function fully.

3. **Add knowledge** -- Drop additional Markdown files into `knowledge/` with company information, product details, competitive intelligence, or anything else your agents should know.

4. **Configure triggers** -- The analyzer sets default triggers (usually cron schedules), but you may want to adjust timing, add webhook triggers for external integrations, or set up message-based coordination.

5. **Test individual agents** -- Run each agent manually to verify it behaves as expected:
   ```bash
   abf run scout --task research_scan
   abf run compass --task daily_briefing
   ```

6. **Start the runtime** -- When satisfied:
   ```bash
   abf dev
   ```
