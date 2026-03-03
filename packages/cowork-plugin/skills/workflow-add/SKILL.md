---
name: workflow-add
description: Create a reusable multi-agent workflow. Defines a pattern for coordinating agents through a common business process like content pipelines, customer onboarding, or reporting. Use when the user wants to set up a repeatable multi-step process.
argument-hint: "[workflow-name]"
---

# Add Workflow

Create a documented workflow that coordinates multiple agents for a recurring business process.

## Steps

1. **Parse arguments**: Extract workflow name from `$ARGUMENTS`. If not provided, ask the user.

2. **Ask the user** what this workflow should accomplish and which agents should participate.

3. **Read existing agents** from `.claude/agents/` to know what's available.

4. **Choose a pattern**:

### Pattern A: Fan-out & Synthesize
Send task to multiple agents in parallel, then have the orchestrator synthesize.

**Example**: Weekly market report
1. Scout researches competitors (parallel)
2. Analyst pulls internal metrics (parallel)
3. Atlas synthesizes findings into a report

### Pattern B: Sequential Pipeline
Pass output from one agent to the next.

**Example**: Content pipeline
1. Scout researches the topic
2. Writer drafts the content
3. Atlas reviews and finalizes

### Pattern C: Conditional
Different agents handle based on the input type.

**Example**: Customer inquiry routing
1. Atlas analyzes the inquiry
2. Routes to Support (issues), Sales (questions), or Writer (content requests)

5. **Generate a workflow script** at `scripts/<workflow-name>.sh`:

```bash
#!/bin/bash
# Workflow: <name>
# Pattern: <fan-out|sequential|conditional>
# Agents: <list>

set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "Running workflow: <name>"

# For sequential:
claude --agent <agent1> --message "<task 1>" --headless
claude --agent <agent2> --message "<task 2 using previous output>" --headless

# For parallel (use & and wait):
claude --agent <agent1> --message "<task A>" --headless &
claude --agent <agent2> --message "<task B>" --headless &
wait

# Final synthesis:
claude --agent atlas --message "<synthesize results>" --headless
```

6. **Document the workflow** in `AGENTS.md` — add a workflows section describing:
   - What the workflow does
   - Which agents participate
   - How to trigger it: `bash scripts/<name>.sh` or via cron

7. **Make it executable**: `chmod +x scripts/<name>.sh`

8. **Optionally add to cron** if it should run on a schedule.

## Example Workflows

### Content Pipeline
```bash
#!/bin/bash
# Weekly content pipeline: research → draft → review
claude --agent scout --message "Research trending topics in our industry this week" --headless > data/research.md
claude --agent writer --message "Draft a blog post based on data/research.md" --headless > data/draft.md
claude --agent atlas --message "Review data/draft.md and finalize for publication" --headless > data/final.md
```

### Daily Standup
```bash
#!/bin/bash
# Parallel data gathering, then synthesis
claude --agent scout --message "What happened in our market today?" --headless > data/market.md &
claude --agent analyst --message "Pull today's key metrics" --headless > data/metrics.md &
wait
claude --agent atlas --message "Generate daily standup from data/market.md and data/metrics.md" --headless
```
