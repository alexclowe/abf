---
name: dev
description: Start working with your business agent team. Shows how to use agents interactively, run the orchestrator, and set up automation. Use when the user wants to start using their agents.
disable-model-invocation: true
---

# Start Working With Your Agents

Your agents run natively in Claude — no server to start, no dashboard to open.

## Steps

1. **Check the project has agents** — Verify `.claude/agents/` contains agent markdown files.

2. **Show the user their options**:

### Interactive (recommended for daily use)

Just talk to Claude. It reads your agent definitions and delegates automatically. Ask things like:
- "Research our competitors"
- "Draft this week's newsletter"
- "Analyze our sales data"
- "What should I focus on today?"

### Run the orchestrator directly

```bash
claude --agent atlas
```

This starts a session with Atlas as the primary agent. Atlas coordinates all other agents.

### Headless mode (for automation)

```bash
claude --agent atlas --message "Run the daily standup" --headless
```

### Automated schedules (cron)

Add to crontab for recurring tasks:

```bash
# Edit crontab
crontab -e

# Daily market scan at 9am
0 9 * * * cd /path/to/project && claude --agent atlas --message "Daily market scan" --headless >> logs/daily.log 2>&1

# Weekly content planning on Monday 10am
0 10 * * 1 cd /path/to/project && claude --agent atlas --message "Plan this week's content" --headless >> logs/weekly.log 2>&1

# Monthly report on the 1st at 9am
0 9 1 * * cd /path/to/project && claude --agent atlas --message "Monthly business review" --headless >> logs/monthly.log 2>&1
```

3. **Show the team roster** — Read `.claude/agents/` and list all agents with their roles.

4. **Check knowledge files** — Verify `knowledge/company.md` and `knowledge/brand-voice.md` exist.

5. **Remind** the user:
   - Agents learn over time (memory is stored in `.claude/agent-memory/`)
   - To add agents: `/abf:agent-add`
   - To check status: `/abf:status`
