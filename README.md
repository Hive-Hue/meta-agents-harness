# Multi-Agent Runtime for Pi

This repository implements a layered multi-agent coding runtime on top of `pi`, inspired by a three-level team structure:

- `Orchestrator`
- `Team Leads`
- `Workers`

The goal is to move from a single conversational agent to a system that routes work across specialized agents with explicit ownership, persistent mental models, and session-level traceability.

## What This Repo Implements

- A hierarchical runtime in [extensions/multi-team.ts](./extensions/multi-team.ts)
- A central topology and ownership config in [multi-team.yaml](./multi-team.yaml)
- Self-describing agent prompts in [`.pi/agents/`](./.pi/agents)
- Persistent mental models in [`.pi/expertise/`](./.pi/expertise)
- Shared skills in [`.pi/multi-team/skills/`](./.pi/multi-team/skills)
- Persistent, append-only session traces in [`.pi/multi-team/sessions/`](./.pi/multi-team/sessions)

This is not a generic framework package. It is a concrete Pi extension and repo-local harness for experimenting with multi-agent engineering workflows.

## Core Architecture

The runtime is intentionally split into three layers.

### 1. Orchestrator

The top-level agent receives the user prompt and routes work across teams.

- It does not write code directly.
- It should use `delegate_agent` for meaningful work.
- It is responsible for sequencing Planning, Engineering, and Validation.

Current prompt: [orchestrator.md](./.pi/agents/orchestrator.md)

### 2. Team Leads

Each team has a lead agent.

- Leads do not write code directly.
- Leads delegate to workers in their own team.
- Leads are responsible for bounded hand-offs and low blast radius.

Current leads:

- [planning_lead.md](./.pi/agents/planning_lead.md)
- [engineering_lead.md](./.pi/agents/engineering_lead.md)
- [validation_lead.md](./.pi/agents/validation_lead.md)

### 3. Workers

Workers are the execution layer.

- They use direct tools such as `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`.
- They are constrained by path-based ownership rules.
- They can update their own expertise using `update_mental_model`.

Current workers:

- Planning
  - [repo_analyst.md](./.pi/agents/repo_analyst.md)
  - [solution_architect.md](./.pi/agents/solution_architect.md)
- Engineering
  - [extension_engineer.md](./.pi/agents/extension_engineer.md)
  - [config_engineer.md](./.pi/agents/config_engineer.md)
- Validation
  - [qa_reviewer.md](./.pi/agents/qa_reviewer.md)
  - [security_reviewer.md](./.pi/agents/security_reviewer.md)

## Contract Model

Each agent is defined in two places on purpose:

- topology and ownership in [multi-team.yaml](./multi-team.yaml)
- self-description in each [`.pi/agents/*.md`](./.pi/agents)

This gives you:

- one central file for team structure
- one local file per agent for self-contained prompt engineering

### Agent Frontmatter Shape

Each agent prompt uses YAML frontmatter with fields like:

```yaml
---
name: engineering-lead
model: openai-codex/gpt-5.2
role: lead
team: Engineering
expertise:
  path: .pi/expertise/engineering-lead-mental-model.yaml
  use-when: Track architecture decisions, implementation sequencing, risk patterns, and which worker allocations reduce blast radius.
  updatable: true
  max-lines: 10000
skills:
  - path: .pi/multi-team/skills/delegate.md
    use-when: Always. Delegate to the right engineering owner instead of implementing directly.
  - path: .pi/multi-team/skills/mental_model.md
    use-when: Read at task start for context. Update after learning architecture or sequencing lessons.
tools:
  - delegate_agent
  - update_mental_model
domain:
  - path: .
    read: true
    upsert: false
    delete: false
---
```

### What the Runtime Reads From the Contract

- `model`
  - used for delegated child processes when explicitly set
  - `inherit` means use the current session model
- `expertise`
  - `path`: file location for the agent’s mental model
  - `use-when`: instructions injected into the runtime contract text
  - `updatable`: whether `update_mental_model` should write
  - `max-lines`: soft trimming limit enforced when saving expertise
- `skills`
  - `path`: skill file to load into the prompt bundle
  - `use-when`: usage guidance shown in the runtime contract
- `tools`
  - allowed tools for that agent
- `domain`
  - path ownership rules for read, upsert, and delete

## Ownership and Guardrails

The system uses explicit path ownership instead of open-ended tool access.

Example:

```yaml
domain:
  - path: .
    read: true
    upsert: false
    delete: false
  - path: extensions/
    read: true
    upsert: true
    delete: true
```

This is enforced in the runtime for workers.

- `read` controls read-like tools such as `read`, `grep`, `find`, and `ls`
- `upsert` controls file creation and mutation via `write`, `edit`, and mutating shell commands
- `delete` controls destructive shell operations such as `rm`

Important details:

- Orchestrators and leads are blocked from direct code tools.
- Workers are blocked when paths fall outside their domain.
- Bash protection is strong for explicit path references, but still heuristic.

## Expertise and Mental Models

Every agent has a persistent YAML expertise file under [`.pi/expertise/`](./.pi/expertise).

These files are meant to be:

- durable memory
- high-signal summaries
- architecture and workflow knowledge
- not conversation logs

The behavior is driven by [mental_model.md](./.pi/multi-team/skills/mental_model.md).

The runtime:

- loads the expertise file into the prompt bundle at session start
- exposes `update_mental_model`
- trims oversized expertise files based on `max-lines`
- stores YAML, not Markdown bullets

## Session Persistence

Each run creates a directory under [`.pi/multi-team/sessions/`](./.pi/multi-team/sessions).

Example layout:

```text
.pi/multi-team/sessions/<session-id>/
  manifest.json
  session_index.json
  conversation.jsonl
  tool_calls.jsonl
  events.jsonl
  artifacts/
    index.jsonl
    ...
  state/
    <child>.session.jsonl
  jsonl/
    <raw-child-stream>.jsonl
```

### Session Files

- `manifest.json`
  - static metadata and file map
- `session_index.json`
  - mutable summary with process list, status, and counters
- `conversation.jsonl`
  - normalized user, delegation, and assistant messages
- `tool_calls.jsonl`
  - normalized tool-call attempts, starts, blocks, and completions
- `events.jsonl`
  - lifecycle and orchestration events
- `artifacts/`
  - human-readable output snapshots such as delegation results and final responses
- `state/`
  - Pi session files used to resume delegated children
- `jsonl/`
  - raw JSON output from child Pi processes

### Why Both Canonical JSONL and Raw JSON?

The repo keeps both because they serve different purposes:

- canonical files are easier to query and reason about
- raw JSON streams keep exact subprocess traceability

## Skills

Shared skills live in [`.pi/multi-team/skills/`](./.pi/multi-team/skills).

Current skills:

- [delegate.md](./.pi/multi-team/skills/delegate.md)
- [active_listener.md](./.pi/multi-team/skills/active_listener.md)
- [mental_model.md](./.pi/multi-team/skills/mental_model.md)
- [zero_micromanagement.md](./.pi/multi-team/skills/zero_micromanagement.md)

The runtime loads these files into the prompt bundle and also surfaces their `use-when` guidance in the effective contract shown to each agent.

## Model Routing

Model selection works in two layers.

### Top-Level Session

The root Pi session uses whatever model you launch Pi with.

Example:

```bash
pi -e extensions/multi-team.ts --model openai-codex/gpt-5.2
```

### Delegated Children

When the orchestrator or a lead spawns a child, the runtime prefers:

1. the child’s `model` from frontmatter
2. otherwise the explicit model from `multi-team.yaml`
3. otherwise the current session model

`inherit` means “use the current Pi session model”.

## Repo Layout

```text
.
├── .pi/
│   ├── agents/
│   ├── expertise/
│   └── multi-team/
│       ├── skills/
│       └── sessions/
├── extensions/
│   └── multi-team.ts
├── specs/
└── multi-team.yaml
```

## Running the System

### Interactive Run

```bash
pi -e extensions/multi-team.ts
```

Useful commands inside Pi:

- `/multi-team`
- `/multi-team-tree`

### Non-Interactive Run

```bash
pi -e extensions/multi-team.ts --mode json -p --thinking off "Review the current multi-team runtime and summarize the main guardrails."
```

### Run With an Alternate Config via `PI_MULTI_CONFIG`

The runtime resolves the active config in this order:

1. `PI_MULTI_CONFIG`
2. `./multi-team.yaml`
3. `./.pi/multi-team.yaml`

Use `PI_MULTI_CONFIG` when you want to switch packs without renaming the default file.

```bash
PI_MULTI_CONFIG=multi-team.hivehue.yaml pi -e extensions/multi-team.ts
```

This is useful when the repo contains more than one team pack, for example a repo-local default config plus a product-specific config.

### Run With an Explicit Root Model

```bash
pi -e extensions/multi-team.ts --model openai-codex/gpt-5.2
```

### Pointing the Runtime at Another Repo

Absolute paths are supported in config values such as:

- `prompt`
- `expertise`
- `session_dir`
- `expertise_dir`
- `domain[].path`

The runtime resolves config paths with `path.resolve(baseDir, value)`, which means:

- relative paths are resolved from the directory that contains the active config file
- absolute paths remain absolute

Important nuances:

- config paths can point to another repo
- the runtime does not currently expose a first-class `repo_root` that remaps every relative tool call to that external repo
- delegated children resolve `extensions/multi-team.ts` relative to the active config directory

So today the safest setup is:

1. Keep the active config in this runtime repo, or in another directory that also contains the same runtime assets (`extensions/multi-team.ts`, `.pi/agents`, `skills`, and expertise files).
2. Use absolute paths in `domain[].path` for the target repo you want workers to inspect or modify.
3. Prefer absolute file paths in prompts/tasks when agents need to operate outside the current cwd.

If you move the config file into a different repo without copying the runtime assets alongside it, delegated child runs will fail because they look for `extensions/multi-team.ts` relative to that config base.

## Example Prompts

### Example 1: Architecture Review

```text
Review the current multi-team runtime and explain:
1. how ownership is enforced
2. how sessions are persisted
3. the main gaps compared to a full harness
```

### Example 2: Planning + Engineering + Validation Flow

```text
Add a new session artifact that summarizes every delegation in Markdown.
Preserve current repo patterns and keep ownership boundaries intact.
```

Expected flow:

- Orchestrator routes to Planning for scoping
- Engineering lead delegates implementation
- Validation lead runs QA/security review

### Example 3: Direct Delegation Pattern

```text
Use delegate_agent to ask Planning for a file-level implementation plan for improving session persistence.
```

### Example 4: Read-Only Security Review

```text
Review the current bash ownership guardrail and identify where the enforcement is heuristic rather than hard.
```

## Engineering Notes

### Effective Prompt Bundle

Before an agent starts, the runtime assembles a prompt bundle containing:

- the agent body prompt
- loaded skill bodies
- persistent expertise
- runtime metadata
- effective tools
- effective domain rules

This happens in the `before_agent_start` hook.

### Delegation Mechanics

Delegation is implemented by spawning a child `pi` process with:

- `--mode json`
- `--session <state-file>`
- the same extension
- role and identity passed via environment variables

This allows:

- hierarchical execution
- per-child persistence
- raw JSON stream capture
- canonic session normalization at the parent level

### Session Hooks Used

The runtime relies heavily on Pi hooks:

- `session_start`
- `before_agent_start`
- `input`
- `tool_call`
- `tool_execution_end`
- `agent_end`
- `session_shutdown`

## Current Team Mapping

This repo does not implement a frontend/backend app split, so the team mapping is adapted to the repository itself.

- Planning
  - discovery
  - constraints
  - specs
- Engineering
  - extension runtime
  - prompt and config assets
- Validation
  - QA
  - security
  - blast-radius review

## Known Limitations

- The top-level orchestrator model is not auto-forced from frontmatter; it follows the model used to launch Pi.
- Bash enforcement is still heuristic for some command classes.
- `session_index.json` is best-effort and may lose concurrent updates under heavy parallelism.
- The runtime does not yet provide a live nested dashboard that merges all child UIs into one canonical orchestrator view.

## Implementation References

- Runtime: [extensions/multi-team.ts](./extensions/multi-team.ts)
- Topology: [multi-team.yaml](./multi-team.yaml)
- Runtime spec: [specs/multi-team.md](./specs/multi-team.md)
- Agents: [`.pi/agents/`](./.pi/agents)
- Expertise: [`.pi/expertise/`](./.pi/expertise)
- Skills: [`.pi/multi-team/skills/`](./.pi/multi-team/skills)

## Quick Start

If you only need the shortest possible path:

```bash
pi -e extensions/multi-team.ts --model openai-codex/gpt-5.2
```

Then ask for a real repo task, for example:

```text
Review the current multi-team runtime, propose a concrete improvement, implement it with ownership-safe delegation, and finish with validation findings.
```
