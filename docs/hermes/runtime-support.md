# Hermes Runtime Support

## Overview

Hermes is a supported runtime in Meta Agents Harness, treated as a first-class member of the runtime portfolio alongside PI, Claude Code, and OpenCode.

This document describes what is supported, how Hermes integrates into the MAH architecture, and what is intentionally out of scope.

---

## Integration philosophy

Hermes support follows the principle of **selective absorption**:

> Integrate Hermes deeply enough to be useful, but not so deeply that MAH stops being an orchestration layer and starts becoming a Hermes clone.

### What this means

- **Borrowed**: Runtime patterns that strengthen MAH (capability metadata, persistence hints, backend awareness)
- **Adapted**: Hermes commands mapped to MAH's unified command surface
- **Rejected**: Hermes-specific lifecycle, automation semantics, or product identity imposed on MAH

---

## Adapter model

Hermes is integrated through the standard adapter pattern in `scripts/runtime-adapters.mjs`.

### Adapter configuration

| Field | Value |
|---|---|
| `name` | `hermes` |
| `markerDir` | `.hermes` |
| `wrapper` | `hermesh` |
| `directCli` | `hermes` |

### Detection precedence

Hermes follows the same detection priority as all runtimes:

1. **Forced**: `--runtime hermes`, `-r hermes`, or `MAH_RUNTIME=hermes`
2. **Marker**: presence of `.hermes/` directory in the repository
3. **CLI**: `hermes` or `hermesh` executable available in PATH

### Capabilities

```yaml
capabilities:
  persistent_memory: true
  supports_background_operation: true
  supports_multi_backend_execution: true
  gateway_aware: true
```

---

## Command mapping

Hermes maps to the standard MAH command surface:

| MAH Command | Hermes Equivalent | Status |
|---|---|---|
| `mah detect` | Runtime detection via marker/CLI | Supported |
| `mah doctor` | `hermesh doctor` → `hermes doctor` | Supported |
| `mah check:runtime` | `hermesh doctor` → `hermes doctor` | Supported |
| `mah validate:runtime` | `hermesh doctor` → `hermes doctor` | Supported |
| `mah validate` | Config + runtime validation | Supported |
| `mah explain` | Resolution plan display | Supported |
| `mah run` | `hermesh run` → `hermes chat` | Supported |
| `mah list:crews` | `hermesh list:crews` | Supported |
| `mah use <crew>` | `hermesh use <crew>` | Supported |
| `mah clear` | Crew/session reset | Supported |

If a command cannot be cleanly mapped to Hermes behavior, it fails with a clear, honest error message rather than silently degrading.

---

## Session management

Hermes session semantics are handled through MAH's unified session controls and the repo-local `hermesh` wrapper:

```bash
mah --runtime hermes run --session-mode new
mah --runtime hermes run --session-mode continue
mah --runtime hermes run --session-mode none  # not supported — warning emitted
mah --runtime hermes run --session-id <id>
```

`mah --runtime hermes run` bootstraps the active crew's orchestrator context into a new Hermes session before continuing interactively.

`--session-mode continue` and `--session-id` skip that bootstrap and resume an existing Hermes session instead.

`--session-mode none` is not natively supported by Hermes — MAH emits a warning and the session persists normally.

`--session-root` is accepted by the wrapper as MAH metadata, but Hermes does not currently expose a native session-root flag.

See [`session-management.md`](./session-management.md) for details.

---

## What is supported

- Hermes detection and forcing
- Hermes adapter with bounded command mapping through the shared adapter contract
- Hermes-aware diagnostics and explainability
- Hermes in `mah doctor`, `mah validate:*`, `mah explain`
- Hermes runtime contract validation
- Canonical config compatibility (`meta-agents.yaml`)
- Hermes docs/examples for operator setup and validation

## Current maturity

- Hermes support in `v0.4.0` is an adapter foundation, not full runtime parity.
- Forced detection, contract checks, and explainability are first-class.
- `list:crews`, `use`, and `clear` work through the repo-local wrapper alone.
- Interactive `run` and `doctor` still depend on an actual `hermes` CLI being available in PATH.

---

## What is intentionally out of scope

- Full Hermes feature parity
- Hermes-native automation semantics as MAH's universal model
- Remote execution foundation across all runtimes
- Federation, policy engine, or confidential execution
- MAH becoming a Hermes-shaped product
- Hermes lifecycle as MAH's universal agent lifecycle

---

## Related documents

- [`session-management.md`](./session-management.md) — Hermes session semantics
- [`artifact-structure.md`](./artifact-structure.md) — `.hermes/` directory layout
- [`quickstart.md`](./quickstart.md) — Getting started guide
- [`../runtime-boundary.md`](../runtime-boundary.md) — MAH runtime architecture
