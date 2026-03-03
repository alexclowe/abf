---
name: deploy
description: Set up automated agent execution for production. Configure cron jobs, CI/CD pipelines, or cloud functions to run agents on a schedule. Use when the user wants to automate their agents.
argument-hint: "[--target cron|github-actions|fly]"
disable-model-invocation: true
---

# Deploy Agent Automation

Set up automated, scheduled execution of your business agents.

## Steps

1. **Verify the project** — Check `.claude/agents/` exists with agent files.

2. **Choose a deployment target** from `$ARGUMENTS` or ask:
   - **Cron** (simplest) — Local crontab for scheduled tasks
   - **GitHub Actions** — CI/CD based scheduling
   - **Fly.io / Railway** — Cloud-hosted automation

3. **For Cron** (recommended for solo founders):

   Create `scripts/cron-setup.sh`:
   ```bash
   #!/bin/bash
   PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

   # Write crontab entries
   (crontab -l 2>/dev/null; cat << EOF
   # ABF Agent Automation
   # Daily standup at 9am
   0 9 * * * cd $PROJECT_DIR && claude --agent atlas --message "Daily standup" --headless >> logs/daily.log 2>&1
   # Weekly review on Monday 10am
   0 10 * * 1 cd $PROJECT_DIR && claude --agent atlas --message "Weekly business review" --headless >> logs/weekly.log 2>&1
   EOF
   ) | crontab -
   ```

4. **For GitHub Actions**:

   Create `.github/workflows/agents.yml`:
   ```yaml
   name: Agent Automation
   on:
     schedule:
       - cron: '0 9 * * *'    # Daily at 9am UTC
       - cron: '0 10 * * 1'   # Monday at 10am UTC
     workflow_dispatch:
       inputs:
         task:
           description: 'Task for the orchestrator'
           required: true

   jobs:
     run-agent:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - name: Install Claude Code
           run: npm install -g @anthropic-ai/claude-code
         - name: Run agent
           env:
             ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
           run: |
             if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
               claude --agent atlas --message "${{ inputs.task }}" --headless
             elif [ "${{ github.event.schedule }}" = "0 9 * * *" ]; then
               claude --agent atlas --message "Daily standup" --headless
             else
               claude --agent atlas --message "Weekly business review" --headless
             fi
   ```

5. **Create `logs/` directory** and add to `.gitignore`.

6. **Remind the user**:
   - Set `ANTHROPIC_API_KEY` as a secret in GitHub or environment variable
   - Agent memory persists in `.claude/agent-memory/` (commit this for continuity)
   - Review logs regularly for quality
