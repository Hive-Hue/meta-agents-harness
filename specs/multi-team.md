# Specification: Multi-Team Runtime

## Goal

Reproduce a layered multi-agent system in this repository with three runtime levels:
- Orchestrator
- Team Leads
- Workers

The implementation is centered on:
- `multi-team.yaml`
- `extensions/multi-team.ts`
- `.pi/agents/`, `.pi/expertise/`, plus `.pi/multi-team/skills/` and `.pi/multi-team/sessions/`

Agent contracts are declared twice on purpose:
- centrally in `multi-team.yaml`
- locally in each `.pi/agents/*.md` frontmatter

That keeps the topology centralized while making each prompt self-describing.
Both locations can use the same rule-based `domain` shape.
Agent frontmatter can also declare:
- `model`
- `expertise.path`, `expertise.use-when`, `expertise.updatable`, `expertise.max-lines`
- `skills[].path` and `skills[].use-when`

## How It Works

1. Start Pi with:

```bash
pi -e extensions/multi-team.ts
```

2. The extension loads `multi-team.yaml` and starts in `orchestrator` mode.
3. The orchestrator can only use `delegate_agent`.
4. Delegation spawns a child Pi process running the same extension in `lead` or `worker` mode.
5. Workers get direct tools plus ownership guardrails based on read/write paths.
6. Every run writes canonical session files under `.pi/multi-team/sessions/<session-id>/`:
   - `conversation.jsonl`
   - `tool_calls.jsonl`
   - `events.jsonl`
   - `artifacts/`
   - `state/`
   - `jsonl/`
7. Each delegated child still writes its raw Pi JSON stream under `jsonl/`, while the runtime also normalizes conversation and tool activity into the canonical files above.
8. Each agent also keeps a persistent YAML expertise file under `.pi/expertise/`.
9. Agents can update their own expertise explicitly with `update_mental_model`, typically guided by the `.pi/multi-team/skills/mental_model.md` skill.
10. Expertise files keep `agent`, `meta`, and evolving top-level sections such as `architecture`, `decisions`, `observations`, or `open_questions`.

## Current Repository Mapping

This repo does not have `src/backend/` and `src/frontend/`, so the initial team layout maps to real ownership areas here:
- Planning team: discovery and specs
- Engineering team: `extensions/` plus runtime config and prompts
- Validation team: QA and security review

## Guardrails

- Orchestrators and leads are blocked from direct code tools.
- Workers are blocked from reads and writes outside their configured ownership.
- The preferred domain format is rule-based:

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

- The runtime resolves the most specific matching path rule.
- Legacy `read/write` domain declarations still work as fallback compatibility.
- Bash enforcement is heuristic:
  - explicit path references outside the domain are blocked
  - obvious mutating commands outside write scope are blocked
  - read-only commands remain allowed
- Child delegations do not resume prior Pi conversation sessions by default. Durable memory should live in expertise files, not accumulated chat state, to avoid empty, slow, or contaminated follow-up turns.

## Session Layout

The session directory acts as the shared persistent workspace for the whole multi-agent run:

- `manifest.json`: static metadata and file map
- `session_index.json`: mutable session summary with process and count information
- `conversation.jsonl`: normalized user, delegation, and assistant messages
- `tool_calls.jsonl`: normalized tool-call attempts, blocks, starts, and completions
- `events.jsonl`: runtime lifecycle and orchestration events
- `artifacts/`: human-readable outputs such as delegation results and final responses
- `state/`: persistent Pi session files for delegated children
- `jsonl/`: raw JSON output from child Pi processes for traceability

## Known Gaps Compared To A Full Harness

- No live nested dashboard from child processes back into the top-level TUI.
- Bash ownership enforcement is strong for explicit path usage, but still heuristic.
- Automatic delegation summaries still append fallback observations; deeper expertise curation depends on agents using `update_mental_model` well.
- `session_index.json` is updated best-effort and may be overwritten by concurrent child writes; the append-only JSONL files remain the source of truth.

## Useful Commands

- `/multi-team`
- `/multi-team-tree`
