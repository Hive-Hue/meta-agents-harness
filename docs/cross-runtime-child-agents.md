# Cross-Runtime Child Agents — v0.6.0

## Overview

The cross-runtime child agents feature allows MAH agents to delegate subtasks to child agents that may execute in a different runtime than the parent agent.

The authorization decision is always based on crew topology. The runtime target only determines how the child agent is executed.

## Key Concepts

### Logical Target
The agent in the crew topology to whom the task belongs.

### Runtime Target
The runtime where the child agent will actually execute.

### Spawn Modes

- `native-same-runtime`: Child runs in the same runtime as the parent
- `cross-runtime-sidecar`: Child runs in a different runtime via a sidecar adapter

## Architecture

### Components

1. **ChildAgentAdapter Contract** (`scripts/child-agent-adapter-contract.mjs`)
   - Defines the adapter contract and the available spawn modes
   - Exports `SPAWN_MODES`, `validateChildAgentAdapter()`, and `isValidSpawnMode()`

2. **DelegationResolution** (`scripts/delegation-resolution.mjs`)
   - Shared service for resolving logical targets against crew topology
   - Enforces crew authorization rules before any spawn planning

3. **Child Agent Spawn** (`scripts/child-agent-spawn.mjs`)
   - Strategy layer combining delegation resolution with spawn planning
   - Provides adapter registration, mode selection, and spawn context building

4. **Codex Sidecar** (`scripts/child-agent-codex-sidecar.mjs`)
   - First cross-runtime sidecar implementation
   - Produces a Codex execution plan with non-interactive environment overrides

## Usage

### Logical Delegation API

Use a single logical delegation call (`delegate_agent` / `mah_delegate_agent`) and let MAH resolve execution mode and runtime adapter.

### CLI

```bash
# Native delegation (same runtime)
mah delegate --target backend-dev --task "Implement the parser"

# Cross-runtime delegation to Codex
mah delegate --target backend-dev --runtime codex --task "Implement the parser"

# Show delegation plan
mah explain delegate --target backend-dev --runtime codex --task "..."
```

`--runtime` is an optional execution hint. Authorization remains topology-based.

## Policy Rules

1. **orchestrator** → can only delegate to **leads**
2. **lead** → can only delegate to workers in **own team**
3. **worker** → cannot delegate
4. Runtime target is a **detail of execution**, not authorization

## Codex Sidecar

The Codex sidecar adapter prepares a spawn plan that invokes Codex directly with the task as a prompt:

```bash
codex exec --cd <repoRoot> --full-auto "[Crew: <crew>] [Agent: <target>] Task: <task>"
```

Environment overrides used by the adapter:

- `MAH_ACTIVE_CREW=<crew>` for crew context

The adapter exposes this plan through `codexSidecarAdapter.prepareSpawn()` and does not directly spawn the process itself.

## ChildAgentAdapter Contract

Every adapter must implement:

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Unique adapter identifier |
| `sourceRuntime` | `string\|"*"` | Runtime this adapter produces spawns FROM |
| `targetRuntime` | `string` | Runtime this adapter produces spawns INTO |

| Method | Returns | Description |
|--------|---------|-------------|
| `supportsSpawn(ctx)` | `boolean` | Whether the adapter can handle the given spawn context |
| `listSpawnModes(ctx)` | `SpawnMode[]` | List of supported spawn modes |
| `prepareSpawn(ctx)` | `SpawnPlanResult` | Execution plan without side effects |

## Spawn Modes Reference

| Mode | Description |
|------|-------------|
| `native-same-runtime` | Child runs in the same runtime as the parent |
| `cross-runtime-sidecar` | Child runs in a different runtime via sidecar |

## Type Definitions

```typescript
type SpawnMode = "native-same-runtime" | "cross-runtime-sidecar"

interface SpawnSupportContext {
  crew: string
  sourceRuntime: string
  sourceAgent: string
  logicalTarget: string
}

interface SpawnContext extends SpawnSupportContext {
  targetRuntime: string
  effectiveLogicalTarget: string
  task: string
  mode: SpawnMode
}

interface SpawnPlanResult {
  ok: boolean
  mode: SpawnMode
  exec: string
  args: string[]
  envOverrides: Record<string, string>
  warnings: string[]
  error?: string
}
```

## Reference Files

- `scripts/child-agent-adapter-contract.mjs`
- `scripts/delegation-resolution.mjs`
- `scripts/child-agent-spawn.mjs`
- `scripts/child-agent-codex-sidecar.mjs`
- `scripts/meta-agents-harness.mjs`

## Notes

- Crew topology remains the source of truth for authorization.
- Runtime choice affects execution only.
- Cross-runtime delegation remains bounded to the v0.6.0 headless and sessions scope.
