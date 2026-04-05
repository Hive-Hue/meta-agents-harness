# RFC: v0.4.0 — Remote Execution Foundation

## Status

Draft for `development-evolve`.

## Scope

This RFC defines the smallest shippable slice for `v0.4.0` to start remote execution support without introducing policy/federation/confidential execution complexity.

## Goals

- Introduce a minimal node model for remote-capable targets.
- Introduce a minimal connector contract to dispatch bounded commands.
- Introduce a simple target registry used by CLI/runtime resolution.
- Add lightweight health/capability declaration for visibility.
- Keep release small, testable, and compatible with current `0.x` stabilization discipline.

## Non-Goals

- No policy engine.
- No trust-tier enforcement engine.
- No federation/interconnect.
- No confidential execution mode.
- No expertise-aware routing/scoring.
- No full remote session orchestration UX.

## Proposed Minimum Model

### 1) Node Model (minimum)

Each node must declare:

- `id`
- `display_name`
- `transport` (`local`, `ssh`)
- `endpoint` (only for remote transport)
- `runtime_support` (e.g. `pi`, `claude`, `opencode`)
- `status` (`unknown`, `healthy`, `unhealthy`)
- `capabilities` (lightweight tags, e.g. `bash`, `filesystem`, `docker`)

### 2) Connector Contract (minimum)

Connector interface must support:

- `checkHealth(node) -> { ok, status, details }`
- `listCapabilities(node) -> { capabilities }`
- `dispatch(node, command, args, options) -> { status, stdout, stderr }`

Constraints:

- bounded timeout
- deterministic error envelope
- no long-running orchestration semantics in this phase

### 3) Target Registry (minimum)

Registry responsibilities:

- load node definitions from a single canonical config file
- validate required node fields
- expose node lookup by `id`
- expose simple filtering by runtime support and health state

### 4) Health and Capability Declaration (minimum)

- Add lightweight command(s) for operator visibility:
  - `mah targets`
  - `mah targets --json`
- Surface: node id, transport, runtime support, status, capabilities

## CLI and UX (minimum)

Minimum additions:

- `mah targets` for listing target registry entries
- optional `--target <id>` for selected commands in experimental mode

No new complex workflow UI in `v0.4.0`.

## Validation and Testing

Required acceptance tests:

1. Registry loads valid node definitions.
2. Registry rejects missing required fields.
3. Health check command returns stable JSON envelope.
4. Dispatch succeeds for healthy local node.
5. Dispatch failure path returns deterministic error output.
6. Existing `validate:*` and smoke tests remain green.

## Release Acceptance Criteria

`v0.4.0` is acceptable only if:

- implementation stays inside goals/non-goals above
- all new commands have stable `--json` output
- tests cover happy path + core failure paths
- changelog can summarize the feature in 3–5 concise bullets
- no hidden dependency on policy/federation/confidential systems

## Risks and Mitigations

- **Risk:** scope creep toward policy and trust engine.  
  **Mitigation:** explicit non-goals + PR gate checklist.
- **Risk:** connector behavior drift across runtimes.  
  **Mitigation:** contract tests for connector envelope.
- **Risk:** unstable target model churn.  
  **Mitigation:** keep model intentionally minimal in `v0.4.0`.

## Out of Scope for Next Wave

Candidates for `v0.5.0+`:

- policy/guardrail engine
- federation/interconnect
- confidential execution
- deeper expertise operationalization
