---
name: run
description: Run a specific agent with a task. Launches the agent directly using claude --agent or delegates to it in the current session. Use when the user wants to trigger a specific agent.
argument-hint: "<agent-name> [task description]"
disable-model-invocation: true
---

# Run Agent

Trigger a specific agent to execute a task.

## Steps

1. **Parse arguments**: Extract agent name and optional task from `$ARGUMENTS`.

2. **Verify the agent exists** — Check for `.claude/agents/<name>.md`.

3. **Two options for running**:

### Option A: Delegate within current session

If already in a Claude session, delegate to the agent:

```
Use the <agent-name> agent to <task description>
```

Claude will automatically invoke the sub-agent.

### Option B: Run directly via CLI

For standalone execution or automation:

```bash
claude --agent <agent-name> --message "<task description>"
```

For headless (no interactive prompts):

```bash
claude --agent <agent-name> --message "<task description>" --headless
```

4. **Show the user** both options and recommend Option A for interactive use, Option B for automation/testing.

## Examples

```bash
# Interactive
claude --agent scout --message "Research competitor pricing for Q1 2026"

# Headless (for cron/CI)
claude --agent atlas --message "Generate weekly performance report" --headless

# With output capture
claude --agent writer --message "Draft blog post about our product launch" --headless > output.md
```
