# Phase 3 — PI Evidence Alignment Slice Plan

**Status:** draft
**Author:** solution-architect
**Date:** 2026-04-24

## Background

CLI delegate path: `recordDelegationEvidence` → constructs evidence with `normalizeExecutionResult` → `recordEvidence`.
PI multi-team path: calls `recordEvidence` directly at two sites, bypasses `normalizeExecutionResult`, no `execution_result` field, no `AgentExecutionResult` contract.

## Gap Summary

| # | Gap | Impact |
|---|-----|--------|
| G1 | PI bypasses `normalizeExecutionResult` | Evidence lacks canonical `execution_result` shape |
| G2 | PI evidence missing fields | No `quality_signals`, no `execution_result`, no `id`, no `recorded_at` |
| G3 | Duplicate `deriveTaskType` | CLI and PI each have their own — drift risk |
| G4 | No lifecycle events | PI never calls `recordLifecycleEvent` |

---

## Slice 1 — Shared Evidence Pipeline Helper

### Name

`shared-evidence-pipeline`

### Scope

Extract a single shared function `recordDelegationEvidence` (renamed to avoid collision with the existing CLI-local one) that both CLI and PI call instead of constructing evidence ad-hoc. PI's two direct `recordEvidence` call sites become calls to this helper.

### Changed Files

| File | Action |
|------|--------|
| `scripts/expertise/evidence/evidence-pipeline.mjs` | **Create** — canonical `recordDelegationEvidence` extracted from CLI |
| `extensions/multi-team.ts` | **Edit** — replace 2× direct `recordEvidence` with `recordDelegationEvidence` import |
| `scripts/meta-agents-harness.mjs` | **Edit** — replace local `recordDelegationEvidence` with import from pipeline |
| `types/agent-execution-result.mjs` | **No change** — already has `normalizeExecutionResult` |

### Design

```
scripts/expertise/evidence/evidence-pipeline.mjs exports:
  recordDelegationEvidence({ crew, expertiseId, taskDescription, outcome, durationMs, sourceAgent, sessionId, isExecuted })
    → calls normalizeExecutionResult from types/agent-execution-result.mjs
    → calls recordEvidence from scripts/expertise/evidence/expertise-evidence-store.mjs
    → wraps in try/catch (best-effort, never blocks)
```

Key: `recordDelegationEvidence` in `evidence-pipeline.mjs` is a **superset** of the existing CLI-local function (L2669-2727 in meta-agents-harness.mjs), plus:
- Accepts `sessionId` explicitly (PI passes `currentSessionId()`)
- Sets `source_session` from parameter, falls back to `process.env.MAH_SESSION_ID || "unknown"`
- Reuses shared `deriveTaskType` and `sanitizeTaskDescription`

### Deduplication

- `deriveTaskType`: currently duplicated between `multi-team.ts:298` and CLI's inline version in `meta-agents-harness.mjs:2679-2692`. Move canonical version into `scripts/expertise/evidence/evidence-pipeline.mjs`. PI and CLI both use it.
- `sanitizeTaskDescription`: PI has its own at `multi-team.ts:262`. CLI has inline version. Move canonical into `scripts/expertise/evidence/evidence-pipeline.mjs`.

### PI Integration Points

**Site A — `delegate_agent` (~L3370):**

```typescript
// BEFORE:
const { recordEvidence } = await import("../scripts/expertise/evidence/expertise-evidence-store.mjs");
await recordEvidence({ expertise_id: ..., outcome: ..., ... });

// AFTER:
const { recordDelegationEvidence } = await import("../scripts/expertise/evidence/evidence-pipeline.mjs");
await recordDelegationEvidence({
  crew: process.env.MAH_ACTIVE_CREW || "dev",
  expertiseId: effectiveTarget,
  taskDescription: effectiveTask,
  outcome: result.exitCode === 0 ? "success" : "failure",
  durationMs: Math.round(result.elapsed),
  sourceAgent: runtime!.agent.name,
  sessionId: currentSessionId() || "unknown",
  isExecuted: true,
});
```

**Site B — `delegate_agents_parallel` (~L3650):**

Same pattern, inside the per-target loop.

### TS↔mjs Boundary

- PI (`.ts`) imports from `scripts/expertise/evidence/evidence-pipeline.mjs` via dynamic `await import()`.
- `evidence-pipeline.mjs` imports from `types/agent-execution-result.mjs` (already ESM) and `scripts/expertise/evidence/expertise-evidence-store.mjs`.
- No type annotations in the `.mjs` file — PI passes plain objects. TypeScript's dynamic import of `.mjs` returns `any`, which is fine for this best-effort fire-and-forget path.
- **Risk:** If the TS compiler resolves `../scripts/expertise/evidence/evidence-pipeline.mjs` incorrectly at build time, the dynamic import will fail at runtime. Mitigate by keeping path relative and testing with a smoke test.

### Acceptance Criteria

- [ ] `scripts/expertise/evidence/evidence-pipeline.mjs` exists and exports `recordDelegationEvidence`
- [ ] PI `delegate_agent` no longer calls `recordEvidence` directly — calls `recordDelegationEvidence`
- [ ] PI `delegate_agents_parallel` no longer calls `recordEvidence` directly — calls `recordDelegationEvidence`
- [ ] CLI `meta-agents-harness.mjs` imports `recordDelegationEvidence` from pipeline, local function removed
- [ ] Evidence records from PI contain `execution_result` field with canonical `AgentExecutionResult` shape
- [ ] Evidence records from PI contain `id`, `recorded_at`, `quality_signals`
- [ ] Existing PI session tracking (events.jsonl, conversation.jsonl, etc.) untouched
- [ ] Best-effort error handling preserved — try/catch around every evidence call
- [ ] `deriveTaskType` no longer duplicated — single canonical in pipeline
- [ ] Smoke test: `mah delegate` via CLI still records evidence correctly
- [ ] Build passes (`tsc --noEmit` for multi-team.ts if applicable)

### Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| TS↔mjs dynamic import path resolution fails | Medium | Use exact relative path `../scripts/expertise/evidence/evidence-pipeline.mjs`; test at runtime |
| `deriveTaskType` behavior differs between CLI and PI versions | Low | PI version has more categories (bugfix, refactoring, documentation, security). Use PI's richer version as canonical |
| Evidence schema change breaks downstream consumers | Low | Fields are additive only — no removals |
| `sanitizeTaskDescription` signature differs (PI has `limit` param) | Medium | Canonical version accepts optional `limit`, defaults to 200 |

---

## Slice 2 — PI Lifecycle Events (Optional, depends on Slice 1)

### Name

`pi-lifecycle-events`

### Scope

Add `recordLifecycleEvent` calls at PI delegate start/end, mapping PI session IDs to the CLI lifecycle event format. Only proceed if Slice 1 merges cleanly.

### Changed Files

| File | Action |
|------|--------|
| `extensions/multi-team.ts` | **Edit** — add `recordLifecycleEvent` calls at delegate_agent start/end and delegate_agents_parallel start/end |

### Design

PI already has `currentSessionId()` producing `<runtime>:<crew>:<session>` format. Map to lifecycle events:

```typescript
// At delegate_agent start (before execution):
const { recordLifecycleEvent } = await import("../scripts/session/m3-ops.mjs");
recordLifecycleEvent(repoRoot, delegateLifecycleId, {
  event: "queued",
  details: { task: effectiveTask.substring(0, 100), sourceAgent: runtime!.agent.name }
});

// After execution completes:
recordLifecycleEvent(repoRoot, delegateLifecycleId, {
  event: result.exitCode === 0 ? "completed" : "failed",
  result_code: result.exitCode,
  result_reason: result.exitCode === 0 ? "success" : "non-zero exit",
});
```

For parallel delegates: emit `queued` per target before execution, `completed`/`failed` per target after.

### Acceptance Criteria

- [ ] PI `delegate_agent` emits `queued` lifecycle event before execution
- [ ] PI `delegate_agent` emits `completed` or `failed` lifecycle event after execution
- [ ] PI `delegate_agents_parallel` emits per-target `queued`/`completed`/`failed`
- [ ] Lifecycle events include PI session ID in `source_session`
- [ ] Existing PI session tracking untouched
- [ ] Best-effort wrapping preserved (lifecycle event failure never blocks delegation)

### Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `m3-ops.mjs` not designed for concurrent multi-target events | Low | `recordLifecycleEvent` appends to JSONL — concurrent writes are safe per-target |
| Additional I/O in hot delegate path | Low | Lifecycle writes are sync file appends, sub-ms overhead |
| Slice 2 regressions hidden by Slice 1 | Medium | Slice 2 has its own acceptance criteria; verify independently |

---

## Deferred (explicitly out of scope)

- Unifying PI local session tracking (events.jsonl etc.) with CLI lifecycle events — structural change, v0.9.0+
- Adding `AgentExecutionResult` return type to PI delegate functions — requires interface changes across runtime
- Vector/embedding-based evidence matching — out of v0.8.0 scope
- Removing PI's local `deriveTaskType`/`sanitizeTaskDescription` functions entirely — may keep as wrappers for backward compat

## Execution Order

1. **Slice 1** — shared-evidence-pipeline. Self-contained, no cross-runtime dependency.
2. **Slice 2** — pi-lifecycle-events. Optional, only if Slice 1 merges without regression.

Each slice = one PR. Each PR passes CI independently.
