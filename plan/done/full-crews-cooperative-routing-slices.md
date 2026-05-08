# Full Crews Cooperative Routing Slice Plan

**Status:** completed
**Author:** solution-architect
**Date:** 2026-04-29

## Background

Current `mah run` is crew-scoped in practice:

- agent discovery is centered on the active crew
- orchestrator routing is bounded to local crew topology
- expertise routing can optimize within that local boundary only

The proposed mode:

```bash
mah --runtime <runtime> run --full-crews
```

should allow the orchestrator to route cooperatively across all eligible workspace crews, while still enforcing:

- domain rules
- approval rules
- runtime compatibility
- explainability

The spec for this work is:

- [`specs/full-crews-cooperative-routing-spec.md`](file:///home/alysson/Github/meta-agents-harness/specs/full-crews-cooperative-routing-spec.md)

---

## Gap Summary

| # | Gap | Impact |
|---|-----|--------|
| G1 | No CLI routing scope flag for cooperative mode | No way to opt into cross-crew routing |
| G2 | No shared workspace-wide candidate resolver | Each run path remains implicitly crew-bounded |
| G3 | Expertise routing is not modeled as a composed ranking pass for workspace-wide candidates | Stronger cross-crew experts cannot be selected predictably |
| G4 | Explain/trace output does not expose cross-crew candidate reasoning | Hard to trust or debug cooperative routing |
| G5 | Lifecycle/session metadata has no `routing_scope`/selected crew markers | Cooperative runs cannot be observed cleanly |
| G6 | No governance surface for future allowlist/default-scope config | Hard to harden the feature later without refactor |

---

## Slice 1 — Explain-Only CLI Flag

### Name

`full-crews-explain-flag`

### Scope

Add `--full-crews` parsing to `mah explain run` first, without changing real execution behavior yet.

This slice is the safest place to validate:

- CLI ergonomics
- trace language
- candidate discovery shape
- explainability expectations

### Changed Files

| File | Action |
|------|--------|
| `scripts/meta-agents-harness.mjs` | **Edit** — parse `--full-crews` in explain/run argument handling |
| `scripts/explain/*` or local explain helpers in `meta-agents-harness.mjs` | **Edit** — include cooperative routing scope in explain output |
| `tests/*run*` / new focused tests | **Add/Edit** — assert explain output and JSON metadata |

### Design

- Introduce `routingScope = "active_crew" | "full_crews"` in explain preparation.
- When `--full-crews` is set, trace output must state:
  - scope enabled
  - source crew
  - number of crews considered
  - number of agents considered
- Real execution remains unchanged in this slice.

### Acceptance Criteria

- [x] `mah explain run --full-crews` is accepted by the CLI
- [x] explain output clearly states `routing_scope=full_crews`
- [x] existing explain behavior remains unchanged without the flag
- [x] no real execution semantics change yet

### Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Flag leaks into real execution too early | Low | Keep explain-only branch isolated |
| Trace output becomes noisy | Medium | Keep default concise, put details behind `--trace` |

---

## Slice 2 — Workspace Candidate Resolver

### Name

`workspace-candidate-resolver`

### Scope

Create a shared resolver that loads all crews and returns eligible agent candidates across the workspace.

This resolver should be reusable by:

- `explain run`
- future `run --full-crews`
- WebUI reasoning surfaces later

### Changed Files

| File | Action |
|------|--------|
| `scripts/meta-agents-harness.mjs` | **Edit** — call shared resolver |
| `scripts/routing/` new module(s) | **Create** — workspace candidate discovery + normalization |
| `tests/` new focused resolver tests | **Add** |

### Design

Resolver input:

```ts
{
  repoRoot,
  runtime,
  sourceCrew,
  routingScope
}
```

Resolver output:

```ts
{
  routingScope,
  sourceCrew,
  candidateCrews,
  candidates: [
    {
      crew,
      agent,
      role,
      team,
      skills,
      domainProfiles,
      runtimeCompatible
    }
  ]
}
```

### Acceptance Criteria

- [x] `active_crew` returns only local candidates
- [x] `full_crews` returns workspace candidates from multiple crews
- [x] runtime incompatibilities are filtered out
- [x] output shape is reusable by both explain and run paths

### Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Resolver logic duplicates existing crew lookup code | Medium | Extract once into a dedicated routing module |
| Candidate expansion grows too large | Medium | Keep normalization minimal and filtered early |

---

## Slice 3 — Expertise-First Ranking

### Name

`expertise-first-cooperative-ranking`

### Scope

Add a ranking pass for workspace candidates that prioritizes expertise over local crew proximity.

### Changed Files

| File | Action |
|------|--------|
| `scripts/routing/` ranking module(s) | **Create/Edit** |
| expertise lookup helpers | **Edit if needed** |
| `tests/` ranking tests | **Add** |

### Design

Suggested composed score:

```ts
score =
  expertiseScore * W1 +
  contextScore * W2 +
  continuityScore * W3 +
  activeCrewPreference * W4 +
  domainFit * W5
```

Rules:

- expertise should dominate
- active crew should be a tie-breaker, not the primary selector
- domain violations are excluded before ranking

### Acceptance Criteria

- [x] a stronger cross-crew expert can outrank a weaker local candidate
- [x] local crew still wins when expertise is materially equivalent
- [x] ranking output is explainable and inspectable
- [x] scoring does not bypass hard eligibility filters

### Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Ranking feels arbitrary | Medium | Persist score components in trace output |
| Expertise signal is too weak/noisy | Medium | Start with simple weighted rules before more complex tuning |

---

## Slice 4 — Real `run --full-crews`

### Name

`full-crews-run-execution`

### Scope

Enable real execution for:

```bash
mah run --full-crews
```

using the shared resolver and ranking pipeline from previous slices.

### Changed Files

| File | Action |
|------|--------|
| `scripts/meta-agents-harness.mjs` | **Edit** — wire real run path |
| runtime adapter preparation path(s) | **Edit** — accept selected crew/agent metadata |
| `tests/` execution path tests | **Add/Edit** |

### Design

- parse `--full-crews` in real `run`
- resolve workspace candidates
- rank them
- choose selected agent/crew
- prepare runtime run context using selected crew
- execute through existing MAH adapter flow

### Acceptance Criteria

- [x] `mah run --full-crews` performs real cross-crew routing
- [x] execution still goes through MAH adapters, not runtime-local cooperative logic
- [x] non-flagged `mah run` remains unchanged
- [x] failure modes are explicit when no valid cross-crew candidate exists

### Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Existing run path regressions | Medium | Keep active_crew branch untouched and covered by current tests |
| Selected crew context not propagated cleanly | Medium | Make selected crew an explicit field in run context |

---

## Slice 5 — Lifecycle and Session Metadata

### Name

`cooperative-routing-observability`

### Scope

Persist cooperative routing metadata in lifecycle events and session/status views.

### Changed Files

| File | Action |
|------|--------|
| `scripts/session/m3-ops.mjs` | **Edit** — extend lifecycle/session metadata |
| `types/agent-execution-result.mjs` or adjacent metadata types | **Edit if needed** |
| `tests/sessions-operations.test.mjs` | **Edit** |
| `tests/*lifecycle*` | **Add/Edit** |

### Design

Add metadata fields:

- `routing_scope`
- `source_crew`
- `selected_crew`
- `selected_agent`
- `candidate_crews`

### Acceptance Criteria

- [x] lifecycle events persist `routing_scope=full_crews`
- [x] session status/read model exposes cooperative routing markers
- [x] metadata is additive and backward-compatible

### Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Session JSON consumers assume old shape | Low | Only add optional fields |

---

## Slice 6 — Governance and Config Extensions

### Name

`cooperative-routing-governance`

### Scope

Add config-level controls for future hardening:

- default routing scope
- cooperative mode enable/disable
- allowed crews
- active crew preference tuning

### Changed Files

| File | Action |
|------|--------|
| config schema / validation | **Edit** |
| `docs/validate-semantics.md` | **Edit** |
| `meta-agents-harness.mjs` | **Edit** |
| tests for config validation | **Add/Edit** |

### Acceptance Criteria

- [x] config can restrict or disable `--full-crews`
- [x] validation rejects malformed cooperative routing config
- [x] default behavior remains `active_crew`

### Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Shipping config too early locks bad semantics | Medium | Keep this after execution path stabilizes |

---

## Slice 7 — WebUI Cooperative Mode

### Name

`webui-cooperative-routing-surface`

### Scope

Expose cooperative execution in the WebUI after CLI semantics are stable.

### Changed Files

| File | Action |
|------|--------|
| `webui/src/features/tasks/*` or run surfaces | **Edit** |
| sessions/overview surfaces | **Edit** |
| docs for WebUI | **Edit if needed** |

### Design

Potential UX:

- toggle: `Active Crew / Full Crews`
- reasoning drawer for top ranked candidates
- explicit labeling when a run was cross-crew

### Acceptance Criteria

- [x] operators can choose routing scope visually
- [x] WebUI reflects routing reasoning and selected crew/agent
- [x] API surfaces the same metadata as the CLI

---

## Test Strategy

Minimum coverage by the end of the feature:

- `explain run --full-crews` accepts the flag and emits scope metadata
- candidate resolver returns multiple crews in cooperative mode
- expertise-first ranking can select cross-crew expert over local weaker candidate
- domain enforcement still blocks invalid candidates
- `run --full-crews` uses the selected crew cleanly
- lifecycle/session metadata stores cooperative routing markers
- existing `mah run` and `mah explain run` remain stable without the flag

---

## Execution Order

Recommended order:

1. **Slice 1** — explain-only flag
2. **Slice 2** — shared workspace resolver
3. **Slice 3** — expertise-first ranking
4. **Slice 4** — real run path
5. **Slice 5** — lifecycle/session observability
6. **Slice 6** — governance/config
7. **Slice 7** — WebUI surface

Each slice should merge independently and keep existing single-crew behavior stable.
