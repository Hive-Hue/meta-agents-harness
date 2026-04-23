# Context Memory Finalization Slices

**Version:** 0.8.0-followup  
**Status:** proposed  
**Purpose:** unify the remaining executable slices required to finish Context Memory

## 1. Overview

Context Memory is already partially delivered.

Delivered:

- M1 — foundation
- M2 — indexing and retrieval MVP
- M4 — operator CLI namespace

Still open:

- M3 — runtime visibility of retrieved context
- M5 — proposal governance and promotion workflow
- M6 — canonical assistant-state base

This document consolidates the remaining work into one execution plan.

It also supersedes these earlier slice docs:

- `plan/slices/context-memory-pr1-schema.md`
- `plan/slices/context-memory-m3-runtime-visibility.md`
- `plan/slices/context-memory-m5-proposal-governance.md`
- `plan/slices/context-memory-m6-assistant-state.md`

Those files are intentionally removed after consolidation to keep the planning surface single-sourced.

## 2. Delivered Baseline

### B1 — PR1 Foundation Slice

Status: delivered

Delivered baseline:

- Context Memory type definitions
- schema parsing and validation
- canonical `.mah/context/` storage layout
- initial CLI contract
- boundary definition across Expertise, Sessions, Provenance, and Evidence

Implementation reference:

- `types/context-memory-types.mjs`
- `scripts/context-memory-schema.mjs`
- `scripts/context-memory-validate.mjs`
- `docs/context-memory.md`

### B2 — PR2 Retrieval Slice

Status: delivered

Delivered baseline:

- deterministic index builder
- lexical and metadata-aware retrieval
- explainable retrieval output
- `mah context index`
- `mah context find`
- `mah context explain`

Implementation reference:

- `scripts/context-memory-schema.mjs`
- `scripts/meta-agents-harness.mjs`
- `tests/context-memory.test.mjs`

### B3 — Remaining Work

Still open:

- runtime visibility of retrieved context
- governed proposal lifecycle
- canonical assistant-state surface

## 3. Delivery Strategy

Recommended order:

1. `S1` — Runtime visibility
2. `S2` — Proposal governance
3. `S3` — Assistant-state base

Rationale:

- `S1` closes the most operator-visible gap in the current feature
- `S2` closes the governance gap so derived memory can be managed safely
- `S3` builds the higher-level assistance model on top of the previous surfaces

## 4. Slice Map

| Slice | Milestone | Status | Outcome |
|---|---|---|---|
| S1 | M3 remainder | proposed | Make retrieved Context Memory visible in explain surfaces before runtime execution |
| S2 | M5 remainder | proposed | Turn proposal drafts into a governed review, reject, and promote workflow |
| S3 | M6 | proposed | Expose a canonical runtime-agnostic assistant-state surface |

## 5. Slice S1 — Runtime Visibility

### Goal

Close the remaining runtime-injection gap by making retrieved Context Memory visible to operators before execution, without changing runtime semantics or exposing raw prompt internals.

### Current State

- Context Memory can already be injected into Hermes bootstrap
- `--with-context-memory`, `--context-limit`, and `--context-mode` are already parsed and consumed by MAH
- runtime bootstrap remains bounded and optional

### Missing State

- the operator still cannot clearly inspect which context documents were used for a run
- there is no first-class explanation surface equivalent to the original `mah explain run` expectation

### Proposed Surface

```bash
mah explain run --runtime hermes --crew dev --with-context-memory --task "triage backlog" --json
```

Expected addition to the explain payload:

```json
{
  "runtime": "hermes",
  "exec": "hermes",
  "context_memory": {
    "enabled": true,
    "status": "matched",
    "mode": "summary",
    "limit": 5,
    "matched_docs": [
      {
        "id": "dev/planning-lead/backlog-planning/clickup-backlog-triage",
        "score": 0.91,
        "reasons": ["agent match", "capability match", "task pattern overlap"]
      }
    ],
    "summary_blocks": [
      "Use ClickUp MCP directly when the task explicitly mentions backlog grooming."
    ]
  }
}
```

Explicit non-success states:

- `status: "disabled"`
- `status: "missing-corpus"`
- `status: "no-match"`
- `status: "error"`

### Scope

In scope:

- attach a bounded Context Memory explanation payload to explain surfaces
- keep payload shape stable and runtime-agnostic
- preserve MAH-only flag stripping before runtime launch
- document operator expectations

Out of scope:

- changing runtime stdout or bootstrap prompt text
- interactive visualization
- full document dumping
- routing behavior changes

### Likely Files

- `scripts/context-memory-integration.mjs`
- `scripts/runtime-core-integrations.mjs`
- `scripts/meta-agents-harness.mjs`
- `tests/runtime-core-integration.test.mjs`
- `tests/context-memory.test.mjs`
- `docs/context-memory.md`

### Acceptance Criteria

- `mah explain run ... --with-context-memory --json` includes a `context_memory` block
- the block reports `enabled`, `status`, `mode`, and `limit`
- matched docs include document IDs and concise reasons
- summary blocks remain bounded
- no-corpus and no-match states are explicit
- existing runtime execution behavior remains unchanged
- MAH-only flags are still stripped before the runtime CLI is launched

### Test Plan

- explain payload contains `context_memory` when enabled
- explain payload reports `missing-corpus` when the corpus is absent
- explain payload reports `no-match` when retrieval returns zero matches
- runtime passthrough still omits `--with-context-memory`, `--context-limit`, and `--context-mode`
- no regression in Hermes bootstrap tests

### Exit Condition

S1 is complete when the operator can inspect the exact bounded Context Memory retrieval result for a run without starting the runtime and without reading internal code.

## 6. Slice S2 — Proposal Governance

### Goal

Turn draft proposal generation into a governed operator workflow.

### Current State

- `mah context propose --from-session <session-ref>` generates a draft proposal
- proposals are written to `.mah/context/proposals/`
- proposals have schema validation and traceable source references

### Missing State

- no promote workflow
- no reject workflow
- no dedupe or merge guidance
- no clear governance contract for reviewing and curating proposals

### Proposed Surface

```bash
mah context proposals list
mah context proposals show <proposal-id>
mah context proposals promote <proposal-id> --stability curated
mah context proposals reject <proposal-id> --reason "duplicate of existing playbook"
```

Promotion should:

- validate the proposal payload
- derive or confirm the target operational path
- refuse unsafe writes
- refuse silent overwrite by default
- write a curated document into `.mah/context/operational/`
- mark proposal status as `promoted`

Rejection should:

- preserve the proposal file
- update status to `rejected`
- record a reason and timestamp

### Dedupe and Merge Baseline

Minimum viable overlap detection:

- same target `proposed_document_id`
- same agent plus overlapping capability set
- same source session already proposed
- high lexical overlap with an existing operational document title or first headings

This slice does not require full automatic merge logic.

It only needs to:

- flag likely overlap
- show candidate existing refs
- require explicit operator action

### Scope

In scope:

- proposal listing and inspection
- proposal promote and reject operations
- traceable status transitions
- overlap hints
- safety checks for file paths and overwrite behavior

Out of scope:

- automatic promotion from raw session output
- full semantic dedupe
- background reviewer daemon
- policy-driven auto-approval

### Likely Files

- `scripts/context-memory-proposal.mjs`
- `scripts/context-memory-validate.mjs`
- `scripts/context-memory-schema.mjs`
- `scripts/meta-agents-harness.mjs`
- `docs/context-memory.md`
- `tests/context-memory.test.mjs`

### Acceptance Criteria

- `mah context proposals list` returns proposal IDs and statuses
- `mah context proposals show <id>` renders source, summary, rationale, and overlap hints
- `mah context proposals promote <id>` validates and writes a curated operational document
- promoted proposals are marked as `promoted`
- `mah context proposals reject <id> --reason ...` marks the proposal as `rejected` without deleting it
- promotion never happens automatically from `mah context propose --from-session`
- unsafe or conflicting promotion targets fail clearly

### Test Plan

- list returns existing proposal files
- show returns structured proposal metadata
- promote writes into `.mah/context/operational/` and updates proposal status
- reject preserves file and updates status plus reason
- duplicate target detection produces overlap warnings
- path traversal and overwrite edge cases are rejected

### Exit Condition

S2 is complete when proposal creation, review, rejection, and promotion form a complete governed operator workflow with traceable state transitions.

## 7. Slice S3 — Assistant-State Base

### Goal

Define a canonical, runtime-agnostic `assistant-state` model that describes how MAH is helping the current task at the orchestration layer.

### Current State

- the original Context Memory plan already positioned MAH toward bounded contextual assistance
- routing, sessions, and Context Memory primitives already exist

### Missing State

- no canonical `assistant-state` model
- no single structured surface combining expertise, context, session, and provenance
- no runtime-agnostic explanation surface describing the current assistance state

### Proposed Surface

```bash
mah explain state --crew dev --agent planning-lead --task "triage backlog" --json
```

Proposed payload:

```json
{
  "crew": "dev",
  "agent": "planning-lead",
  "runtime": "hermes",
  "expertise": {
    "selected": "planning-lead",
    "capability_hint": "backlog-planning",
    "confidence": 0.82
  },
  "context_memory": {
    "status": "matched",
    "matched_docs": [
      "dev/planning-lead/backlog-planning/clickup-backlog-triage"
    ]
  },
  "session": {
    "mode": "continue",
    "session_id": "hermes:dev:abc123"
  },
  "provenance": {
    "refs": []
  },
  "readiness": {
    "status": "ready",
    "notes": [
      "routing selected planning-lead",
      "context memory matched 1 document",
      "session continuity available"
    ]
  }
}
```

### Scope

In scope:

- canonical state schema
- operator-facing explanation surface
- runtime-agnostic aggregation of routing, context, session, and provenance signals
- bounded output suitable for CLI and automation

Out of scope:

- background daemon
- dashboard or web UI
- agent memory replay
- replacing existing routing or session commands

### Design Constraints

- must not alter runtime launch behavior
- must not make routing depend on Context Memory
- must not require a specific runtime
- must tolerate missing layers:
  - no active session
  - no provenance refs
  - no context-memory match

### Likely Files

- `scripts/meta-agents-harness.mjs`
- a new helper such as `scripts/assistant-state.mjs`
- `scripts/context-memory-integration.mjs`
- session and explain helpers already used by MAH
- `docs/context-memory.md`
- explain docs
- tests under `tests/`

### Acceptance Criteria

- `mah explain state ... --json` returns a stable structured payload
- the payload includes expertise, context memory, session, and provenance sections
- missing sections degrade gracefully with explicit status values
- the surface is runtime-agnostic
- no runtime execution side effects occur when using the command

### Test Plan

- explain state returns valid JSON with all top-level sections
- explain state works when no session exists
- explain state works when no context-memory match exists
- explain state works without provenance refs
- no regression in `mah explain run`, `mah sessions`, or `mah expertise`

### Exit Condition

S3 is complete when MAH can describe its current assistance state in a single structured surface that remains runtime-agnostic and operator-usable.

## 8. Dependencies

Dependency order:

- `S1` and `S2` are independent and can be built in either order
- `S3` benefits from both, but is not strictly blocked by either

Recommended order remains:

1. `S1`
2. `S2`
3. `S3`

## 9. PR Grouping

Recommended pull requests:

1. `PR-A` — Runtime visibility (`S1`)
2. `PR-B` — Proposal governance (`S2`)
3. `PR-C` — Assistant-state base (`S3`)

If minimizing PR count:

1. `PR-A` — `S1 + S2`
2. `PR-B` — `S3`

## 10. Final Exit Criteria

Context Memory can be considered functionally complete when:

1. operators can inspect bounded retrieved context for a run
2. derived memory proposals can be listed, reviewed, rejected, and promoted safely
3. MAH can describe its current assistance state in one structured runtime-agnostic surface

At that point, the remaining Context Memory work is no longer foundational. It becomes productization and uplift work rather than missing core capability.
