# OpenCode Multi-Team Plan

## Goal

Create an OpenCode-native multi-team harness equivalent to the current Pi runtime design:

- orchestrator -> team leads -> workers
- bounded delegation and ownership domains
- persistent agent expertise
- optional MCP integration per role

This plan is intentionally incremental so the branch can be validated in small steps.

## Scope

### In Scope (this branch baseline)

- canonical high-level spec at `.opencode/multi-team.yaml`
- `.opencode/` architecture scaffold
- custom agents for the three-layer hierarchy
- minimal skills set for delegation and mental-model discipline
- custom tool `update-mental-model` for expertise persistence
- initial expertise YAML files
- OpenCode config with MCP wiring and task-permission boundaries

### Out of Scope (next iterations)

- full parity with Pi session artifacts (`conversation.jsonl`, `tool_calls.jsonl`, etc.)
- custom dashboard widget equivalent to Pi TUI cards
- automatic child session replay orchestration
- complete migration of every existing Pi extension

## Architecture

### Runtime shape

- Primary agent: `orchestrator`
- Subagents:
  - leads: `planning-lead`, `engineering-lead`, `validation-lead`
  - workers:
    - Planning: `repo-analyst`, `solution-architect`
    - Engineering: `frontend-dev`, `backend-dev`
    - Validation: `qa-reviewer`, `security-reviewer`

### Control model

- Delegation is done via OpenCode Task tool (`permission.task`), not `delegate_agent`.
- Expertise persistence is done via custom tool `update-mental-model`.
- Ownership boundaries are encoded by per-agent permissions (`read/edit/bash/...`) plus prompt contract.

### Storage model

- Canonical topology spec: `.opencode/multi-team.yaml`
- Expertise files: `.opencode/expertise/*.yaml`
- Skills: `.opencode/skills/*/SKILL.md`
- Custom tools: `.opencode/tools/*.ts`
- OpenCode sessions (future): `.opencode/sessions/`

## Delivery Phases

1. Baseline scaffold
   - create `.opencode/opencode.json`, `.opencode/agents`, `.opencode/skills`, `.opencode/tools`, `.opencode/expertise`
2. Behavior hardening
   - tighten per-agent permission rules
   - refine prompts and task delegation constraints
3. Traceability parity
   - add custom tools/hooks for artifact/session logging
4. DX polish
   - runbook + troubleshooting + migration guide from Pi config

## Validation Checklist

- `.opencode/multi-team.yaml` parses and references valid files.
- `sync:multi-team --check` passes (no drift between YAML and generated agents).
- OpenCode boots with project config and loads custom agents.
- Task permission matrix enforces:
  - orchestrator can call leads only
  - each lead can call only own workers
  - workers cannot spawn subagents
- `update-mental-model` writes valid YAML entries for the current agent.
- MCP servers are discoverable via OpenCode config.

## Runbook (Baseline)

```bash
# in this repo
opencode
```

Suggested interaction flow:

1. Switch to `@orchestrator`
2. Ask for a task that requires Planning -> Engineering -> Validation
3. Confirm subagent delegation path follows task permissions
4. Ask one agent to persist a durable insight through `update-mental-model`
