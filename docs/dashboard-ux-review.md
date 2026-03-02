# ABF Dashboard UX Review

**Date**: 2026-03-01
**Reviewer**: Claude Opus 4.6 (frontend architecture review)
**Scope**: All pages and components in `packages/dashboard/src/`
**Framework version**: Post-v1.0, branch `feat/cloud-proxy-plugin-registry`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Dashboard Audit](#2-current-dashboard-audit)
3. [Setup Wizard Deep Dive](#3-setup-wizard-deep-dive)
4. [Cloud vs Self-Hosted UI Strategy](#4-cloud-vs-self-hosted-ui-strategy)
5. [Prioritized Recommendations](#5-prioritized-recommendations)

---

## 1. Executive Summary

The ABF Dashboard is a dark-themed, Tailwind CSS-powered Next.js application with 20+ pages covering agent management, team orchestration, workflows, monitoring, and a 6-step setup wizard. It has solid foundational architecture: SSE-backed real-time updates, proper ARIA roles on tabs and alerts, skip-to-content link, mobile-responsive sidebar, and consistent visual language.

However, the dashboard currently leans heavily toward the **builder persona**. Non-technical operators will encounter multiple friction points: unexplained jargon, technical form fields presented without guidance, and empty states that reference CLI commands. The setup wizard -- the most critical flow for operators -- is well-structured but has several UX gaps that could lose users mid-flow.

**Overall Assessment**:
- **Builder utility**: Strong. Provides real value beyond CLI/files with visual workflow graphs, agent chat, approval queues, and real-time metrics.
- **Operator friendliness**: Needs significant work. The current UI assumes familiarity with concepts like "orchestrators," "behavioral bounds," "cron expressions," and "message bus backends."
- **Information architecture**: Good foundation, but the sidebar has too many items (15 links) with no grouping or progressive disclosure.
- **Visual design**: Clean and consistent. The dark slate/sky color system works well. Typography hierarchy is clear.

---

## 2. Current Dashboard Audit

### 2.1 Layout & Navigation

**Files**: `src/components/LayoutShell.tsx`, `src/components/Sidebar.tsx`

**Strengths**:
- Mobile-responsive: hamburger menu, slide-in sidebar, backdrop overlay -- all working correctly.
- Skip-to-content link for keyboard accessibility.
- Active state highlighting on nav items with `sky-400` color.
- Dynamic navigation via API (`/api/navigation`) with static fallback -- future-proof for cloud-customized nav.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| High | **15 sidebar links without grouping** | Operators face a flat list: Overview, Agents, Teams, Workflows, Knowledge, Monitors, Templates, Approvals, Escalations, Channels, Metrics, KPIs, Billing, Settings, Logs. No visual grouping. Cognitive overload for new users. |
| High | **"Setup" link buried at bottom** | The setup wizard link is styled as a barely-visible text link at the very bottom of the sidebar (text-xs text-slate-500). For the most critical onboarding flow, this is nearly invisible. |
| Medium | **No breadcrumbs** | Sub-pages (e.g., `/agents/scout/edit`) rely on manual back-links. No consistent breadcrumb pattern. |
| Medium | **"ABF Dashboard" branding lacks context** | The sidebar header shows "ABF Dashboard" but never shows the company/project name. After setup, operators should see "My Company Name" as the header. |
| Low | **No favicon or app icon** | The layout metadata sets title but has no icon. |

**Recommendation**: Group sidebar items into sections:
- **Core**: Overview, Agents, Teams, Workflows
- **Operations**: Approvals, Escalations, Channels
- **Intelligence**: Knowledge, Monitors, KPIs, Metrics
- **System**: Settings, Billing, Logs

Add section headers as small, muted labels between groups.

---

### 2.2 Overview / Home Page

**File**: `src/app/page.tsx`

**Strengths**:
- Onboarding checklist (`OnboardingChecklist.tsx`) provides guided first-run experience with progress bar.
- Agent cards with inline "Run" action and task input -- direct, actionable UI.
- Real-time data via SSE with SWR fallback.
- Footer stats (agent count, active sessions, cost today) provide quick health check.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| Critical | **Empty state references CLI** | When no agents are loaded, the message says "Run `abf dev` in your project directory." This is meaningless to operators who interact only through the dashboard. Should say something like "Set up your first agents using the Setup Wizard" with a link. |
| High | **Onboarding checklist defaults to hidden** | `dismissed` initializes to `true` and only shows if localStorage does NOT have the key set to 'true'. This means on first visit, before `useEffect` runs, it flickers. More critically, the logic is inverted: if `localStorage.getItem(STORAGE_KEY)` returns null (first visit), `stored === 'true'` is false, so `setDismissed(false)` -- this is correct but causes a flash of no-checklist on initial render. |
| High | **"Run" button UX is confusing** | Clicking "Run" expands a text input, then you click "Run" again to submit. The two-click pattern with the same button label is unintuitive. The first click should be labeled "Run" and the second "Send Task" or "Go". |
| Medium | **"Cost today: $0.00" is hardcoded** | Footer shows `Cost today: $0.00` as a static string, not computed from actual data. Misleading. |
| Medium | **No link to agent detail** | Agent cards on the overview page have no click-through to the agent detail page. Only the "Run" button is interactive. Operators cannot navigate to see more about an agent from here. |

---

### 2.3 Agents List

**File**: `src/app/agents/page.tsx`

**Strengths**:
- Clean list with status badges, role, team, session count, and cost.
- "+ New Agent" CTA is prominent.
- Good empty state with "Create your first agent" link.
- Error state with `role="alert"`.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| Medium | **No search or filter** | With 14+ agents (as in the CiteRank reference impl), scrolling through a flat list is inefficient. Needs at minimum a search box and team filter. |
| Medium | **Cost display may confuse operators** | Shows "Cost: $0.0000" -- four decimal places feels overly technical. Two decimal places is standard for currency. |
| Low | **No sorting** | Cannot sort by name, status, sessions, or cost. |

---

### 2.4 Agent Detail

**File**: `src/app/agents/[id]/page.tsx`

**Strengths**:
- Tabbed interface (Overview, Memory, Sessions) with proper ARIA roles (`role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, `role="tabpanel"`).
- Edit and Run Agent buttons prominently placed.
- Inline task submission with Enter key support.
- Behavioral bounds displayed with color-coded allowed/forbidden actions.
- Inbox feature for sending tasks to agents.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| High | **Technical jargon without tooltips** | "Provider," "Temperature," "Reports to," "Behavioral Bounds," "Triggers" -- none of these have explanatory tooltips or help text. An operator seeing "Temperature: 0.3" has no idea what it means. |
| High | **No link to Chat** | The agent detail page has "Run Agent" (fire-and-forget task) but no visible link to the chat interface at `/agents/[id]/chat`. The chat page is one of the most operator-friendly features but is completely undiscoverable. |
| Medium | **Sessions tab is nearly empty** | The sessions tab shows just "Session history is available when the agent has completed sessions" with a count. No links to actual session details, no history list. |
| Medium | **Memory tab shows raw charter as monospace** | The charter is displayed as `<pre>` text. For operators, this should be rendered as formatted Markdown. |
| Low | **"Send Task to Inbox" has no explanation** | The inbox form labels ("Subject," "Task body") don't explain what happens when you send a task. Does the agent process it immediately? On next scheduled run? |

---

### 2.5 Agent Chat

**File**: `src/app/agents/[id]/chat/page.tsx`

**Strengths**:
- Full-featured chat UI with streaming responses, suggested prompts by agent role, file attachments (drag-and-drop, paste), voice input, slash commands, @mentions.
- Export conversation to Markdown.
- Regenerate last response.
- Tool call badges with expandable output.
- Feedback buttons (thumbs up/down) on assistant messages.
- Markdown rendering for assistant messages via `MarkdownContent` component.
- Conversation sidebar for history.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| High | **Undiscoverable** | No link from agent list, agent detail, or overview. Users must know the URL pattern `/agents/[id]/chat`. This is the most approachable feature for operators and should be front-and-center. |
| Medium | **Full-page layout conflicts with sidebar** | Chat uses `h-screen` which conflicts with the main layout's `pt-14 md:pt-0` padding. On mobile, the chat header may be hidden behind the app header bar. |
| Medium | **Conversation history sidebar is v1 placeholder** | Clicking a conversation just clears the current chat. The sidebar comment says "full reload with message history is v2." This creates a confusing pattern where clicking history items loses current conversation. |
| Low | **API key exposed in client env** | `NEXT_PUBLIC_ABF_API_KEY` is set as a public env variable. While functional, this is visible in browser source. Acceptable for local dev but should be documented. |

---

### 2.6 Agent Form (Create/Edit)

**Files**: `src/components/AgentForm.tsx`, `src/app/agents/new/page.tsx`, `src/app/agents/[id]/edit/page.tsx`

**Strengths**:
- Tabbed form (Basic / Advanced) reduces initial overwhelm.
- Quick-start archetype buttons pre-fill tools, temperature, and behavioral bounds.
- "Generate with AI" charter creation is excellent for operators.
- CronBuilder component with presets ("Every 15 minutes," "Daily at 9 AM") is operator-friendly.
- ActionMultiSelect for behavioral bounds.
- Delete confirmation with two-step flow.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| High | **"Name" field requires kebab-case with no guidance** | The "Name" field expects a machine identifier like "scout" but only has a placeholder. No validation message explains the format requirements. Operators might enter "My Research Agent" which will break. |
| High | **Tools field is a raw comma-separated text input** | `src/components/AgentForm.tsx` line 471-479: Tools are entered as "web-search, database, llm-orchestration". Operators don't know available tool names. This should be a multi-select or at least an autocomplete. |
| Medium | **Model field is a freetext input** | The Model field (line 416-420) accepts any string. Should be a dropdown populated from the provider's available models. |
| Medium | **"Behavioral Bounds" is developer jargon** | For operators, "What this agent is allowed to do" and "What this agent must never do" would be clearer. |
| Medium | **No form validation before submit** | Required fields (Name, Display Name, Role) rely on HTML `required` attribute but the form uses `type="button"` onClick handlers, not native form submission, so browser validation may not fire. The custom `handleSubmit` only validates in AgentForm but the error message is generic. |
| Low | **Charter textarea placeholder is raw markdown** | Shows `# Agent Name -- Role\nYou are Agent Name, the...` which may confuse non-technical users. |

---

### 2.7 Agent Templates

**File**: `src/app/agents/new/templates/page.tsx`

**Strengths**:
- Grid layout with archetype cards showing tool count and temperature.
- "Use This Template" CTA links to pre-filled create form.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| Medium | **No descriptions for archetypes** | Cards show name, tool count, and temperature, but no natural-language description of what each archetype does. "Researcher" -- researches what? How? |
| Medium | **"Temp 0.3" is unexplained** | Temperature value shown without context. Should be hidden for operators or shown as "Creativity: Low / Medium / High." |
| Low | **Linked from agent create page but not easily discoverable** | The link "Browse Templates" is on the create page but operators might not find it. |

---

### 2.8 Teams

**Files**: `src/app/teams/page.tsx`, `src/app/teams/[id]/page.tsx`, `src/app/teams/new/page.tsx`

**Strengths**:
- Clean card layout with orchestrator and member list.
- Inline editing on team detail page.
- Members link to individual agent pages.
- Delete confirmation with destructive action warning.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| High | **"Orchestrator" is unexplained** | Non-technical users don't know what an orchestrator agent is. Needs help text: "The orchestrator coordinates other agents on this team." |
| High | **Members field is comma-separated text** | For teams, members should be a multi-select from available agents, not a freetext field requiring exact agent names. The "Available: agent1, agent2" hint helps but is insufficient. |
| Medium | **Goals have no explanation** | The "Goals" section on the create page has no context for what team goals do in the system. |

---

### 2.9 Workflows

**Files**: `src/app/workflows/page.tsx`, `src/app/workflows/new/page.tsx`

**Strengths**:
- Visual workflow graph (`WorkflowGraph` component) shows parallel execution waves.
- "Quick Start from Template" with pre-built workflow patterns.
- Step dependency visualization.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| High | **Workflow creation is extremely technical** | Step IDs, agent names, comma-separated dependencies -- this is a developer-oriented form. Operators need a visual drag-and-drop workflow builder. |
| Medium | **"On Failure: stop/continue/retry" without explanation** | The `onFailure` dropdown options are listed without context about what each option means in practice. |
| Medium | **Timeout in milliseconds** | `Timeout (ms, optional)` with placeholder "300000" is developer-hostile. Should show human-readable time (e.g., "5 minutes") with a dropdown or slider. |
| Medium | **No visual feedback for running workflows** | The "Run" button shows "Starting..." momentarily but there's no way to monitor workflow progress or see results. |

---

### 2.10 Knowledge Base

**File**: `src/app/knowledge/page.tsx`

**Strengths**:
- Split-pane layout with file list and editor.
- Inline file creation, deletion with confirmation.
- Unsaved changes indicator ("(unsaved)").
- File size display.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| Medium | **No Markdown preview** | The editor is a raw textarea. Operators writing brand guidelines or SOPs would benefit from a side-by-side Markdown preview. |
| Medium | **No drag-and-drop file upload** | Knowledge files can only be created one by one via the "New File" button. Operators should be able to drag-and-drop files to upload. |
| Low | **Delete button only visible on hover** | The trash icon appears on hover only. On touch devices, this pattern fails completely. |

---

### 2.11 Approvals

**File**: `src/app/approvals/page.tsx`

**Strengths**:
- Filter tabs (Pending, Approved, Rejected, All).
- Approve/Reject buttons are clear and color-coded.
- Shows tool arguments as formatted JSON.
- Resolved-by attribution and timestamp.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| Medium | **Arguments shown as raw JSON** | `JSON.stringify(item.arguments, null, 2)` in a `<pre>` block. Operators see `{"to": "user@example.com", "subject": "Welcome"}` instead of a human-readable format. Should render as a key-value table. |
| Medium | **No notification/badge for pending count** | Pending approvals are the highest-priority operator action item, but there's no badge count on the sidebar nav item. |
| Low | **No bulk actions** | Cannot approve/reject multiple items at once. |

---

### 2.12 Escalations

**File**: `src/app/escalations/page.tsx`

**Strengths**:
- Clear separation of Open vs Resolved escalations.
- Yellow border for open escalations creates visual urgency.
- Resolve button is accessible and clear.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| Medium | **No notification/badge** | Like approvals, escalations need a sidebar badge showing count of open items. |
| Medium | **No detail view or response capability** | Operators can only "Resolve" an escalation but cannot add a note or response. Real escalations often need context or instructions back to the agent. |
| Low | **"Target: human" is raw text** | The escalation target field shows raw values like "human" which should be rendered as "Requires human attention." |

---

### 2.13 Channels

**File**: `src/app/channels/page.tsx`

**Strengths**:
- Card-based layout with connection status badges.
- Supports both token-based and OAuth connection flows.
- Google Workspace integration with multi-service badges.
- Routing rules table.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| Medium | **"Restart runtime to activate" is confusing** | After connecting a channel, the status message says "Connected! Restart runtime to activate." Operators don't know how to restart the runtime. The system should either auto-restart or provide a button. |
| Medium | **No way to create routing rules from the UI** | Routing rules table is display-only. Rules can only be configured through YAML files. |
| Low | **Telegram icon uses generic `Send`** | Should use a Telegram-specific icon or at least label it more clearly. |

---

### 2.14 Monitors

**File**: `src/app/monitors/page.tsx`

**Strengths**:
- Full CRUD with inline form panel.
- Responsive table with hidden columns on smaller screens.
- Interval presets (30s, 1m, 5m, 15m, 1h).

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| Medium | **"Agent" field is freetext** | Should be a dropdown of available agents. |
| Medium | **No monitor status/health display** | No indication of whether monitors are actually running, when they last checked, or if they've detected changes. |
| Low | **"Method: POST" without body config** | If POST is selected, there's no way to configure the request body. |

---

### 2.15 Message Templates

**File**: `src/app/message-templates/page.tsx`

**Strengths**:
- Channel-specific badges with color coding.
- Variable display with `{{variable}}` syntax.
- Body preview in monospace.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| Low | **No template preview/test** | Cannot preview how a template renders with sample data. |
| Low | **Variables field is comma-separated text** | Should auto-detect variables from the body text's `{{...}}` patterns. |

---

### 2.16 Metrics

**File**: `src/app/metrics/page.tsx`

**Strengths**:
- Gauge cards with color-coded values.
- Agent states table with status badges.
- Real-time updates via SSE.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| High | **Grid assumes 4 columns always** | `grid-cols-4` is hardcoded with no responsive breakpoints. On mobile, four columns will be cramped and unreadable. Should be `grid-cols-2 md:grid-cols-4`. |
| Medium | **No historical data or charts** | Shows only current snapshot. No trends, no time-series charts. Operators need to see whether things are improving or degrading. |
| Low | **"Total Cost" column shows cents as dollars** | `${(costCents / 100).toFixed(2)}` -- correct conversion but the column header doesn't indicate currency. |

---

### 2.17 KPIs

**File**: `src/app/kpis/page.tsx`

**Strengths**:
- Agent filter dropdown.
- Met/missed status badges with color coding.
- Good empty state with icon and explanatory text.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| Medium | **Reversed data order** | `[...kpis].reverse()` reverses the array to show newest first, but there's no way to sort or change order. |
| Low | **No KPI trend visualization** | A simple sparkline or trend arrow would help operators understand direction. |

---

### 2.18 Billing

**File**: `src/app/billing/page.tsx`

**Strengths**:
- Clean balance cards with lifetime usage.
- Usage breakdown by agent.
- Recent usage table with per-request detail.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| Medium | **"Add Credits" is manual and unguarded** | The top-up form accepts any amount with no confirmation. In a real billing system this would need payment integration. Currently it's a placeholder that could confuse operators. |
| Medium | **Error handling for billing-not-enabled is good** | When billing isn't enabled, shows a clear message with the env var needed. However, this is CLI-speak for operators. Should say "Billing is available on ABF Cloud" with an upgrade link. |
| Low | **No spending alerts or limits** | No way to set budget alerts or spending caps from the billing page. |

---

### 2.19 Settings

**Files**: `src/app/settings/page.tsx`, `src/app/settings/providers/page.tsx`

**Settings Page Strengths**:
- Infrastructure settings hidden behind "Advanced" toggle -- progressive disclosure.
- Session timeout shows human-readable conversion ("5 minutes").
- Save feedback with success/restart-needed message.

**Settings Page Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| High | **No link to Providers page** | The main Settings page manages infrastructure config but the Providers page (`/settings/providers`) is completely disconnected. No link between them. Providers should be a tab or section within Settings. |
| Medium | **"Connection String" is visible in plaintext** | PostgreSQL connection strings contain passwords. Should be a password-type input. |
| Medium | **"Session Timeout (ms)" is developer-centric** | While the helper text converts to minutes, the input still accepts milliseconds. Should accept a human-readable format or use a slider. |

**Providers Page Strengths**:
- Excellent provider card design with connect/disconnect flow.
- Modal for API key entry with key format validation hint.
- Security note explaining how keys are stored.
- Ollama zero-config card with model listing.

**Providers Page Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| Medium | **Not linked from sidebar** | Providers page is only reachable from the onboarding checklist. Should be accessible from Settings. |

---

### 2.20 Logs

**File**: `src/app/logs/page.tsx`

**Strengths**:
- Severity-based color coding (info/warn/error/security).
- Agent ID filter.
- Timestamp formatting.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| Medium | **Details column truncated with no expand** | `JSON.stringify(entry.details)` is truncated via `max-w-xs truncate`. No way to see full details. Needs expandable rows or a detail panel. |
| Medium | **No severity filter** | Can filter by agent but not by severity. Operators looking for errors must scan visually. |
| Low | **No pagination** | Hardcoded `limit: 100`. No load-more or pagination controls. |

---

### 2.21 Session Detail

**File**: `src/app/sessions/[id]/page.tsx`

**Strengths**:
- Clean stats grid (status, duration, cost, tokens).
- Tool call details with arguments and results.
- Error display.

**Issues**:

| Severity | Issue | Detail |
|----------|-------|--------|
| High | **Not linked from anywhere in the UI** | Session detail pages exist but there are no links to them from agent detail, metrics, or logs. The sessions tab on agent detail doesn't list individual sessions. |
| Medium | **Stats grid uses `grid-cols-4` without responsive breakpoints** | Same as Metrics page -- will break on mobile. |
| Low | **No back navigation** | No breadcrumb or back link to return to the agent or session list. |

---

## 3. Setup Wizard Deep Dive

**File**: `src/app/setup/page.tsx` (~1300 lines, single file)

### Overall Assessment

The setup wizard is well-structured with a clear 6-step flow, progress bar, and appropriate branching based on user choices. The four company-type options (A-D) are well-labeled with icons and descriptions. However, several issues could lose non-technical users.

### Step-by-Step Analysis

#### Step 1: Provider Selection

**What works**:
- "Easiest" label for ABF Cloud creates clear hierarchy.
- Three self-hosted options with concise descriptions.
- Ollama correctly disabled on cloud hosting.

**Issues**:
| Severity | Issue |
|----------|-------|
| Medium | "Bring Your Own Key" heading assumes users know what API keys are. For operators, "Use your own AI account" would be clearer. |
| Low | No visual indicator of pricing differences between providers. |

#### Step 2: API Key Configuration

**What works**:
- ABF Cloud shows token input with feature list.
- Self-hosted shows key input with "Get your key" link.
- Ollama shows "No API key needed" with port reminder.
- Cloud-hosted env-var instructions are clear.

**Issues**:
| Severity | Issue |
|----------|-------|
| High | **No key validation feedback before moving to Step 3**. The key is entered but not validated until Step 6 (when `CreatingStep` calls `api.auth.connectKey`). If the key is wrong, the user discovers this only after completing the entire wizard. Should validate on "Next" click. |
| Medium | **"Stored encrypted locally. Never sent to ABF servers." is important but easy to miss**. This privacy assurance should be more prominent, perhaps in a callout box. |

#### Step 3: Company Type

**What works**:
- Four clear options with letter labels (A-D), icons, titles, and descriptions.
- Auto-skip when provider already connected via env var, with green "Connected via environment variable" banner.

**Issues**:
| Severity | Issue |
|----------|-------|
| Medium | **Options are wordy and could be shorter**. "Start a new company from an idea" vs "New idea" -- the title + description is sufficient, but the title alone could be punchier. |
| Low | **"What brings you to ABF?" heading is vague**. "How would you like to get started?" is more action-oriented. |

#### Step 4A: Interview Chat (New Idea)

**What works**:
- Chat-style Q&A interface is approachable.
- Progress indicator shows interview state.
- Smooth auto-scroll to latest message.

**Issues**:
| Severity | Issue |
|----------|-------|
| High | **No way to go back or edit previous answers**. Once an answer is submitted, it's locked. Users who make a mistake must start over. |
| Medium | **Text input for long business descriptions is inadequate**. A single-line `<input>` with Enter-to-submit means users cannot write multi-paragraph answers. Should use a `<textarea>`. |
| Medium | **No indication of how many questions remain**. The `progress` field from the API is displayed but may not always show "Question 3 of 8"-style text. |

#### Step 4B/C: Seed Document Input

**What works**:
- Tab interface for Paste vs Upload.
- File upload supports .txt, .md, .docx, .pdf.
- Upload area with drag-and-drop visual, file name display after upload.
- Preview of extracted text with truncation.

**Issues**:
| Severity | Issue |
|----------|-------|
| Medium | **Drag-and-drop not supported on the upload zone**. The upload zone uses `onClick` to trigger file input but does not have `onDragOver`/`onDrop` handlers. Misleading since it looks like a drop zone. |
| Low | **Word count not shown**. The API returns word count but it's not displayed to the user. |

#### Step 4D: Template Selection

**What works**:
- Grid of template cards with clear names and descriptions.

**Issues**:
| Severity | Issue |
|----------|-------|
| Low | **Only 4 templates**. The "Custom" template (empty project) doesn't explain what "from scratch" means for an operator. |

#### Step 5: Plan Review

**What works**:
- Expandable agent rows showing charter preview, tools, behavioral bounds.
- Company overview with industry, stage, revenue model.
- Team cards with orchestrator and members.
- Knowledge files list.
- Tool gaps with color-coded priority badges (required/important/nice-to-have).
- Workflow and escalation rule summaries.
- Ability to remove agents from the plan.

**Issues**:
| Severity | Issue |
|----------|-------|
| High | **No ability to edit agents in the plan**. Users can remove agents but cannot modify names, roles, tools, or charters before creating. The only recourse is to remove and accept the plan as-is, or go back and re-analyze. |
| Medium | **"Tool Gaps" may alarm operators**. Seeing "required" tool gaps with red badges might make users think the system is broken. Should include reassurance text: "Your agents will work without these tools. These are suggestions for future enhancement." |
| Medium | **"Create Company" button text is misleading**. It writes files to disk, not creates a legal entity. "Set Up My Agents" or "Apply This Plan" would be more accurate. |

#### Step 6: Creating Step

**What works**:
- Animated spinner with company name.
- Success state with agent list and files written.
- "Go to Dashboard" CTA.

**Issues**:
| Severity | Issue |
|----------|-------|
| High | **Error recovery is unclear**. The error state says "You can try again or go back to review the plan" but provides no buttons. The only option is to manually navigate back. Should provide "Try Again" and "Go Back" buttons. |
| Medium | **"Files Written" list is developer-oriented**. Showing `agents/scout.agent.yaml` means nothing to operators. Replace with a summary: "14 agents configured, 4 teams created, 3 knowledge files added." |

### Setup Wizard Summary Table

| Step | Operator Friendliness | Builder Utility | Verdict |
|------|----------------------|-----------------|---------|
| 1. Provider | Good | Good | Minor copy tweaks |
| 2. API Key | Fair | Good | Add key validation |
| 3. Company Type | Good | Good | Solid |
| 4. Input | Fair | Good | Textarea for interview, edit answers |
| 5. Review | Fair | Excellent | Add editing, soften tool gaps |
| 6. Create | Fair | Good | Fix error recovery, humanize output |

---

## 4. Cloud vs Self-Hosted UI Strategy

### Recommendation: Option C (Hybrid)

**Same core dashboard + cloud shell wrapper.**

#### Rationale

Option A (conditional features via `isCloud` flag) is the simplest but leads to accumulated complexity as cloud features grow. The dashboard would be riddled with `{isCloud && <BillingPanel />}` conditionals, making the code harder to maintain and test.

Option B (separate dashboard) maximizes cloud UX but doubles maintenance. Every agent management improvement must be implemented twice. Bug fixes, new features, design changes -- all duplicated work.

Option C gives the best of both:

1. **Shared core**: Agent management, team management, workflows, knowledge, approvals, escalations, chat, metrics, KPIs, logs, session detail -- all shared. These pages work identically for cloud and self-hosted users.

2. **Cloud shell**: A thin wrapper (could be a Next.js layout or a separate package) that:
   - Adds cloud-specific pages: Billing (real payment integration), Usage, Team/Org Management, Plan/Tier Selection, Onboarding with ABF Cloud token flow.
   - Modifies navigation: Hides "Settings > Infrastructure" (users don't manage their own storage/bus), adds "Account," hides local-only features like Ollama.
   - Injects cloud context: `isCloud` flag for components that need small behavior differences (e.g., error messages that say "Go to Settings" vs "Set ENV_VAR").
   - Adds cloud branding/theming if desired.

3. **Extension points**: The dashboard already has an API-driven navigation system (`/api/navigation`). The cloud shell can provide its own navigation API response, adding/removing items without touching core dashboard code.

#### Implementation Architecture

```
packages/
  dashboard/              # Open-source core (this repo)
    src/app/              # All shared pages
    src/components/       # All shared components
    src/lib/              # Shared utilities

  dashboard-cloud/        # Proprietary cloud shell (cloud repo)
    src/app/
      layout.tsx          # Wraps core layout with cloud context
      billing/            # Cloud billing pages
      account/            # Cloud account management
      usage/              # Cloud usage dashboard
    src/components/
      CloudProvider.tsx   # Provides isCloud context
      CloudNav.tsx        # Cloud-modified navigation
```

#### Effort vs. Benefit

| Approach | Initial Effort | Ongoing Maintenance | UX Quality | Flexibility |
|----------|---------------|-------------------|------------|-------------|
| A: isCloud flags | Low | High (grows with features) | Medium | Low |
| B: Separate app | High | Very High (2x work) | High | High |
| **C: Hybrid shell** | **Medium** | **Low** | **High** | **High** |

#### Prerequisites in This Repo

1. **Stable `isCloud` context** (already partially implemented via `BuiltinToolContext.isCloud`).
2. **Dashboard extension points**: The API-driven nav is already in place. Need to add a layout slot or provider pattern for cloud shell injection.
3. **Published `@abf/dashboard` package**: Cloud repo imports shared components. Already planned for npm publish.
4. **Component exports**: Key components (AgentForm, OnboardingChecklist, etc.) should be exported from a barrel file for cloud repo consumption.

---

## 5. Prioritized Recommendations

### Critical (Blocking Adoption)

| # | Issue | Page | Fix |
|---|-------|------|-----|
| C1 | Empty state references CLI commands | Overview (`page.tsx`) | Replace "Run `abf dev`" with "Set up your agents using the Setup Wizard" + link to `/setup` |
| C2 | Agent chat is undiscoverable | Agent detail, Agent list | Add "Chat" button/link on agent detail page header and agent list cards |
| C3 | Setup wizard error recovery has no buttons | Setup step 6 (`CreatingStep`) | Add "Try Again" and "Go Back to Review" buttons in error state |
| C4 | API key not validated until end of wizard | Setup step 2 | Validate key on "Next" click with loading spinner and error feedback |

### High (Hurts Usability)

| # | Issue | Page | Fix |
|---|-------|------|-----|
| H1 | 15 sidebar links without grouping | Sidebar | Add section headers: Core, Operations, Intelligence, System |
| H2 | Technical jargon without explanation | Agent detail, Agent form | Add tooltip icons with explanatory text for Provider, Temperature, Orchestrator, Behavioral Bounds, Triggers |
| H3 | Tools field is raw comma-separated text | AgentForm | Replace with multi-select dropdown populated from `/api/tools` or hardcoded known tools |
| H4 | Setup wizard interview uses single-line input | Setup step 4A | Change to `<textarea>` with Shift+Enter for newlines |
| H5 | No ability to edit agents in plan review | Setup step 5 | Add inline edit for agent name, role, and tool list in expandable row |
| H6 | Team members field is comma-separated text | Team create/edit | Replace with multi-select checkbox list from available agents |
| H7 | Metrics grid breaks on mobile | Metrics | Change `grid-cols-4` to `grid-cols-2 md:grid-cols-4` |
| H8 | Session detail pages not linked from anywhere | Agent detail, Metrics | Add session list on agent detail "Sessions" tab with links to `/sessions/[id]` |
| H9 | "Run" button double-click pattern on Overview | Overview | First click: label "Run", expand input. Input submit button: label "Send" (different from "Run") |
| H10 | Sidebar "Setup" link barely visible | Sidebar | Move setup to a more prominent position for new users, or auto-redirect on first visit |
| H11 | Pending approvals/escalations lack sidebar badge | Sidebar | Add numeric badge on Approvals and Escalations nav items showing pending count |

### Medium (Polish)

| # | Issue | Page | Fix |
|---|-------|------|-----|
| M1 | No search/filter on agents list | Agents list | Add search input and team filter dropdown |
| M2 | Memory tab shows raw charter text | Agent detail | Render charter as Markdown using existing `MarkdownContent` component |
| M3 | Knowledge editor has no Markdown preview | Knowledge | Add split-pane or toggle for Markdown preview |
| M4 | Log details truncated with no expand | Logs | Add expandable row or click-to-detail |
| M5 | No severity filter on logs | Logs | Add severity filter buttons similar to Approvals filter |
| M6 | Approval arguments shown as raw JSON | Approvals | Render as key-value table for common tool arguments |
| M7 | "Behavioral Bounds" is developer jargon | AgentForm | Rename to "Permissions" or "What this agent can do" |
| M8 | Model field is freetext | AgentForm | Make it a dropdown populated per provider |
| M9 | Workflow timeout in milliseconds | Workflow create | Show human-readable time or use minute-based input |
| M10 | "Restart runtime to activate" with no button | Channels | Add "Restart" button or auto-restart |
| M11 | No project/company name in sidebar header | Sidebar | Fetch and display company name from config |
| M12 | "Cost today: $0.00" is hardcoded | Overview | Calculate from actual billing/usage data or remove |
| M13 | Agent cards on overview have no click-through | Overview | Make agent name/card clickable to navigate to agent detail |
| M14 | Monitor "Agent" field is freetext | Monitors | Replace with dropdown of available agents |
| M15 | Settings page has no link to Providers | Settings | Add "Provider Management" link or tab within Settings |
| M16 | Providers page not in sidebar | Sidebar | Add under Settings or as sub-nav item |
| M17 | Tool gaps may alarm operators | Setup step 5 | Add reassurance text: "These are suggestions for future enhancement. Your agents will work without them." |

### Low (Nice-to-Have)

| # | Issue | Page | Fix |
|---|-------|------|-----|
| L1 | No sorting on agent list | Agents | Add sortable column headers |
| L2 | No pagination on logs | Logs | Add load-more or pagination |
| L3 | No bulk approve/reject | Approvals | Add checkbox selection + bulk action buttons |
| L4 | No KPI trend visualization | KPIs | Add sparkline or trend arrows |
| L5 | No historical metrics/charts | Metrics | Add time-series chart for sessions and costs |
| L6 | Delete on knowledge files requires hover | Knowledge | Always show delete icon (or use swipe on mobile) |
| L7 | No favicon | Layout | Add ABF favicon |
| L8 | Template message variables not auto-detected | Message Templates | Parse `{{...}}` from body and auto-populate variables field |
| L9 | Monitor health/status not shown | Monitors | Show last check time and change detection count |
| L10 | No breadcrumbs | All sub-pages | Add consistent breadcrumb component |
| L11 | Conversation history sidebar is placeholder | Agent chat | Implement persistent conversation storage in v2 |
| L12 | "Files Written" list is developer-oriented | Setup step 6 | Replace with summary: "14 agents, 4 teams, 3 knowledge files" |

---

## Appendix: File Reference

| Component | Path |
|-----------|------|
| Root Layout | `packages/dashboard/src/app/layout.tsx` |
| Layout Shell | `packages/dashboard/src/components/LayoutShell.tsx` |
| Sidebar | `packages/dashboard/src/components/Sidebar.tsx` |
| Overview | `packages/dashboard/src/app/page.tsx` |
| Onboarding Checklist | `packages/dashboard/src/components/OnboardingChecklist.tsx` |
| Setup Wizard | `packages/dashboard/src/app/setup/page.tsx` |
| Agents List | `packages/dashboard/src/app/agents/page.tsx` |
| Agent Detail | `packages/dashboard/src/app/agents/[id]/page.tsx` |
| Agent Edit | `packages/dashboard/src/app/agents/[id]/edit/page.tsx` |
| Agent Chat | `packages/dashboard/src/app/agents/[id]/chat/page.tsx` |
| Agent Form | `packages/dashboard/src/components/AgentForm.tsx` |
| Agent Templates | `packages/dashboard/src/app/agents/new/templates/page.tsx` |
| Chat Input | `packages/dashboard/src/components/ChatInput.tsx` |
| Chat Message | `packages/dashboard/src/components/ChatMessage.tsx` |
| Cron Builder | `packages/dashboard/src/components/CronBuilder.tsx` |
| Teams List | `packages/dashboard/src/app/teams/page.tsx` |
| Team Detail | `packages/dashboard/src/app/teams/[id]/page.tsx` |
| Team Create | `packages/dashboard/src/app/teams/new/page.tsx` |
| Workflows List | `packages/dashboard/src/app/workflows/page.tsx` |
| Workflow Create | `packages/dashboard/src/app/workflows/new/page.tsx` |
| Knowledge Base | `packages/dashboard/src/app/knowledge/page.tsx` |
| Approvals | `packages/dashboard/src/app/approvals/page.tsx` |
| Escalations | `packages/dashboard/src/app/escalations/page.tsx` |
| Channels | `packages/dashboard/src/app/channels/page.tsx` |
| Monitors | `packages/dashboard/src/app/monitors/page.tsx` |
| Message Templates | `packages/dashboard/src/app/message-templates/page.tsx` |
| Metrics | `packages/dashboard/src/app/metrics/page.tsx` |
| KPIs | `packages/dashboard/src/app/kpis/page.tsx` |
| Billing | `packages/dashboard/src/app/billing/page.tsx` |
| Settings | `packages/dashboard/src/app/settings/page.tsx` |
| Providers | `packages/dashboard/src/app/settings/providers/page.tsx` |
| Logs | `packages/dashboard/src/app/logs/page.tsx` |
| Session Detail | `packages/dashboard/src/app/sessions/[id]/page.tsx` |
| API Client | `packages/dashboard/src/lib/api.ts` |
| Types | `packages/dashboard/src/lib/types.ts` |
| Event Stream | `packages/dashboard/src/lib/use-event-stream.ts` |
| Icon Map | `packages/dashboard/src/lib/icon-map.ts` |
| Slash Commands | `packages/dashboard/src/lib/slash-commands.ts` |
