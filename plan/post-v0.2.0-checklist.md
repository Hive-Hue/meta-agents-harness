# Post v0.2.0 Checklist and v0.3.0 Direction

## Post-Release Checklist (Milestone Proposal)

### Diagnostics and Output Stability

- [x] Normalize `--json` payload shape across `detect`, `doctor`, `validate:*`, `plan`, `diff`, and `explain`.
- [x] Define a small stable schema contract for diagnostic JSON output.
- [x] Add regression tests for JSON schema shape in core diagnostic commands.

### Validation Semantics Consolidation

- [x] Document and lock semantics for `validate:config`, `validate:runtime`, `validate:sync`, and `validate:all`.
- [x] Reduce overlap between validation levels to keep errors attributable to one primary level.
- [x] Add dedicated docs examples for expected failures per validation level.

### YAML vs Adapter Boundary

- [x] Finalize and document canonical boundary:
  - YAML as canonical source for crews/config content.
  - runtime adapters as canonical source for runtime behavior.
- [x] Review `meta-agents.yaml` adapter metadata scope to prevent behavior duplication.
- [x] Add explicit boundary statement in README and architecture docs.

### plan/diff Maturity

- [x] Improve `plan` and `diff` UX with clearer preview semantics and deterministic output.
- [x] Add tests for no-change, create, update, and drift scenarios.
- [x] Decide whether plan/diff should remain sync-report oriented or become first-class operation planners.

Decision:

- keep `plan`/`diff` sync-report oriented for current cycle
- revisit first-class planner semantics in `v0.3.x` only after diagnostics schema stabilization

### Platform Capability Maturity

- [x] Decide capability status for `sessions`, `graph`, and `demo`:
  - remain experimental
  - or graduate to stable operator surface
- [x] Define provenance retention/rotation policy.
- [x] Add minimum reliability tests for sessions indexing and graph generation.

Decision:

- keep `sessions`, `graph`, `demo`, and provenance as experimental in the current release line
- graduate status only after additional reliability coverage and output schema stabilization

## v0.3.0 Narrative Options

### Option A — Diagnostics + Operator UX Stabilization

Focus:

- stable and consistent `--json`
- stronger explain/plan/diff ergonomics
- clearer validation diagnostics

Recommended release title:

- `v0.3.0 — Diagnostics and Operator UX Stabilization`

### Option B — Adapter/Runtime Model Hardening

Focus:

- hardening runtime adapter contract
- clearer YAML vs adapter boundaries
- stronger runtime-level contract tests

Recommended release title:

- `v0.3.0 — Runtime Adapter Hardening`

## SemVer Discipline After v0.2.0

- Keep project in `0.x` while contracts and behavior are still evolving.
- Prefer smaller, disciplined minor releases with explicit caveats.
- Keep README and CHANGELOG aligned to actual implementation maturity in every release cycle.
