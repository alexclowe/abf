---
name: run
description: Run an ABF agent session manually. Triggers a specific agent to execute a task. Use when the user wants to test an agent, run it on demand, or trigger a specific task.
argument-hint: "<agent-name> [task description]"
disable-model-invocation: true
---

# Run ABF Agent

Manually trigger an agent session in the ABF runtime.

## Steps

1. **Parse arguments**: Extract agent name and optional task from `$ARGUMENTS`.

2. **Verify the agent exists** by checking for `agents/<name>.agent.yaml`.

3. **Check if ABF runtime is running** by checking if port 3000 (or the configured gateway port) is active:

```bash
curl -s http://localhost:3000/api/agents 2>/dev/null
```

4. **If runtime is running**, trigger via the API:

```bash
curl -X POST http://localhost:3000/api/agents/<agent-name>/run \
  -H "Content-Type: application/json" \
  -d '{"task": "<task description or default from manual trigger>"}'
```

5. **If runtime is NOT running**, tell the user to start it first:
   - Run `/abf:dev` to start the development server
   - Or run `npx abf dev` in a terminal

6. **Show the response** — session ID, status, and any output.

## Alternative: Push to Inbox

If the user wants to queue a task rather than run immediately:

```bash
curl -X POST http://localhost:3000/api/agents/<agent-name>/inbox \
  -H "Content-Type: application/json" \
  -d '{"task": "<task>", "priority": "normal", "source": "manual"}'
```
