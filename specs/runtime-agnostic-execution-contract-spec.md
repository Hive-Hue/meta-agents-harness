# Runtime-Agnostic Execution Contract

## Goal

Make lifecycle, provenance, and expertise evidence recording work the same way across all MAH runtimes.

The contract must:

- be runtime-agnostic
- keep `meta-agents.yaml` as the single policy source
- keep persistence in the MAH control plane
- avoid duplicating evidence logic in each runtime

## Problem

Today, MAH has two different execution patterns:

- `PI` can enforce behavior and record rich runtime-local signals through `extensions/multi-team.ts`
- other runtimes such as `opencode`, `claude`, `openclaude`, `hermes`, `kilo`, and `codex` primarily execute through MAH adapters and the CLI pipeline

This creates a structural mismatch:

- some behavior exists only in a runtime-local surface
- some behavior exists only in the MAH CLI
- evidence quality can diverge by runtime

The core issue is not evidence storage itself. The core issue is the absence of a single canonical execution result contract that every runtime can produce.

## Non-Goal

This spec does not propose:

- porting `multi-team.ts` semantics into every runtime
- making every runtime implement native domain or evidence storage internally
- forcing all runtimes to expose identical interactive UX

## Design

### Principle

Runtimes execute. MAH observes and persists.

The runtime integration layer must return a normalized execution result to the MAH control plane. The MAH control plane then performs:

- lifecycle event recording
- provenance recording
- expertise evidence recording
- task description sanitization

### Canonical Execution Result

Every runtime execution path should normalize to:

```ts
type AgentExecutionResult = {
  runtime: string
  crew: string
  agent: string
  task: string
  sessionId?: string | null
  output: string
  exitCode: number
  elapsedMs: number
  artifactPath?: string | null
  metadata?: Record<string, unknown>
}
```

Required fields:

- `runtime`
- `crew`
- `agent`
- `task`
- `output`
- `exitCode`
- `elapsedMs`

Optional fields:

- `sessionId`
- `artifactPath`
- `metadata`

### MAH-Controlled Persistence

Once a runtime returns `AgentExecutionResult`, the MAH control plane must own:

1. lifecycle persistence
2. provenance persistence
3. expertise evidence persistence

That means:

- runtimes do not call `recordEvidence()` directly unless they are implementing a MAH-owned runtime-local orchestration layer
- the CLI and adapter pipeline remain the authority for cross-runtime persistence

### Task Description Sanitization

Before expertise evidence is written, `task` must be normalized into a bounded, useful `task_description`.

Sanitization must strip:

- skill injection blocks such as `[CAVEMAN_CREW] ... [/CAVEMAN_CREW]`
- ANSI escape sequences
- orchestration boilerplate such as `Routing note from orchestrator`
- delegate-only scaffolding such as `Delegate internally ONLY ...`

The persisted field must preserve only the task intent.

### Runtime Adapter Responsibilities

Each runtime adapter must do only these things:

1. materialize runtime-specific crew state
2. prepare a run/headless run context
3. execute the runtime
4. return a normalized execution result

Each runtime adapter must not:

- define its own evidence schema
- define its own evidence persistence rules
- invent runtime-specific task_description sanitization

### PI Special Case

`PI` currently has `extensions/multi-team.ts`, which acts as a runtime-local orchestration surface.

This is allowed as a runtime-specific UX layer, but it should still converge on the same MAH-owned concepts:

- domain policy from `meta-agents.yaml`
- canonical lifecycle semantics
- canonical evidence semantics

`PI` remains a richer runtime surface, but it should not define a divergent persistence model.

## Runtime Coverage

This approach is intended to cover:

- `pi`
- `claude`
- `opencode`
- `openclaude`
- `hermes`
- `kilo`
- `codex`
- future plugin runtimes

It works for any runtime that satisfies the MAH execution contract.

It does not automatically cover:

- tools run outside the MAH pipeline
- runtimes/plugins that bypass MAH adapters
- external wrappers that never return a normalized execution result

## Implementation Plan

### Phase 1

Define a shared `AgentExecutionResult` contract and introduce a normalization helper in the MAH control plane.

Deliverables:

- shared type/module for the canonical result
- result normalization helper
- tests for normalization shape

### Phase 2

Update `mah delegate` and `mah run` flows so all adapter-backed executions produce or are converted into `AgentExecutionResult`.

Deliverables:

- adapter normalization points
- CLI integration updates
- lifecycle/provenance/evidence hooks consume canonical result

### Phase 3

Align runtime-local paths such as `PI multi-team` with the same persistence semantics where possible.

Deliverables:

- parity review between runtime-local orchestration and CLI-backed orchestration
- removal of duplicated evidence-shaping logic where feasible

## Acceptance Criteria

The contract is acceptable when:

1. `mah delegate` produces the same evidence shape regardless of runtime target
2. `task_description` is sanitized consistently across runtimes
3. lifecycle events use the same state model across runtimes
4. provenance and expertise evidence no longer depend on runtime-specific formatting quirks
5. adding a new runtime requires only adapter integration, not new evidence logic

## Rationale

This keeps MAH aligned with its identity:

- MAH is the orchestration intelligence and control plane
- runtimes are execution backends

That separation lets MAH support many runtimes without fragmenting its policy, evidence, and lifecycle model.

