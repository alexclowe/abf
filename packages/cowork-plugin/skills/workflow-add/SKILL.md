---
name: workflow-add
description: Create a new multi-agent workflow for an ABF project. Workflows coordinate multiple agents through sequential, parallel, or conditional steps. Use when the user wants to create a workflow, coordinate agents, or automate a multi-step process.
argument-hint: "[workflow-name] [--template <type>]"
---

# Add Workflow to ABF Project

Create a new workflow definition that coordinates multiple agents.

## Steps

1. **Parse arguments**: Extract workflow name and optional template from `$ARGUMENTS`.

2. **Choose a template** (or start from scratch):
   - `fan-out-synthesize` — Send task to multiple agents in parallel, then synthesize results
   - `sequential-pipeline` — Pass output from one agent to the next in sequence
   - `event-triggered` — React to an event by coordinating multiple agents

3. **Ask the user** what this workflow should accomplish and which agents should participate.

4. **Read existing agents** from `agents/*.agent.yaml` to know what's available.

5. **Generate the workflow YAML** at `workflows/<name>.workflow.yaml`:

```yaml
name: <workflow-name>
display_name: <Human Readable Name>
description: <What this workflow does>
timeout: 300000  # 5 minutes
on_failure: escalate  # stop | skip | escalate

steps:
  - id: step-1
    agent: <agent-name>
    task: <What this agent should do>
    depends_on: []

  - id: step-2
    agent: <agent-name>
    task: <What this agent should do, can reference step-1 output>
    depends_on: [step-1]

  # Parallel steps have the same depends_on
  - id: step-3a
    agent: <agent-name>
    task: <Parallel task A>
    depends_on: [step-2]

  - id: step-3b
    agent: <agent-name>
    task: <Parallel task B>
    depends_on: [step-2]

  - id: step-4
    agent: <agent-name>
    task: <Synthesize results from step-3a and step-3b>
    depends_on: [step-3a, step-3b]
```

6. **Validate** that all referenced agents exist in the project.

7. **Report** what was created and how to trigger the workflow.

## Template: fan-out-synthesize

```yaml
steps:
  - id: research-1
    agent: <researcher>
    task: Research aspect A
  - id: research-2
    agent: <researcher>
    task: Research aspect B
  - id: synthesize
    agent: <orchestrator>
    task: Synthesize findings from research-1 and research-2
    depends_on: [research-1, research-2]
```

## Template: sequential-pipeline

```yaml
steps:
  - id: research
    agent: <researcher>
    task: Gather information
  - id: draft
    agent: <writer>
    task: Write draft based on research
    depends_on: [research]
  - id: review
    agent: <orchestrator>
    task: Review and finalize
    depends_on: [draft]
```

## Template: event-triggered

```yaml
triggers:
  - type: webhook
    path: /webhooks/workflow-name
steps:
  - id: analyze
    agent: <analyst>
    task: Analyze incoming event data
  - id: respond
    agent: <customer-support>
    task: Respond based on analysis
    depends_on: [analyze]
  - id: log
    agent: <monitor>
    task: Log event and response
    depends_on: [respond]
```
