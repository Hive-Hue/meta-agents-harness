# Unified Session Operations — v0.4.0

## 1. Feature Name

**Unified Session Operations** — A single `mah sessions` CLI surface that works identically across PI, Claude Code, OpenCode, and Hermes runtimes.

## 2. One-Line Description

Provide operator-facing session lifecycle commands (`list`, `resume`, `new`, `export`, `delete`) via `mah sessions <subcommand>`, delegating runtime-specific session management to each adapter.

## 3. Motivation

MAH already carries session-aware fields in the runtime adapter contract (`sessionModeNew`, `sessionModeContinue`, `sessionIdFlag`, `sessionRootFlag`, `sessionMirrorFlag`), but there is **no unified CLI surface** that lets operators manage sessions without knowing which runtime is active.

Today:
- PI uses `PI_MULTI_SESSION_ID` env var and `--session-root` flag
- Claude Code uses `--session-id` flag with session-mirror enabled
- OpenCode uses `--session-id` flag (no new-session mode)
- Hermes uses `HERMES_SESSION_ID` env var and `--session-root` flag

Operators working with multiple runtimes must learn four different session idioms. This feature unifies those idioms behind `mah sessions`, abstracting the runtime adapter while letting each runtime execute its native session mechanics.

## 4. Per-Runtime Session Model (Current State)

| Runtime     | `sessionModeNew` | `sessionModeContinue` | `sessionModeNone` | Session ID Method     | `--session-root` | `--session-id` | Session Mirror |
|-------------|-------------------|------------------------|-------------------|-----------------------|------------------|----------------|----------------|
| PI          | true              | true                   | true              | env `PI_MULTI_SESSION_ID` | `--session-root` | —          | false          |
| Claude Code | false             | true                   | true              | flag `--session-id`       | false            | `--session-id` | true           |
| OpenCode    | false             | true                   | false             | flag `--session-id`       | false            | `--session-id` | false          |
| Hermes      | true              | true                   | false             | env `HERMES_SESSION_ID`   | `--session-root` | —          | false          |

**Key observations:**
- PI and Hermes can start new sessions (`sessionModeNew: true`); Claude Code and OpenCode cannot (must continue or none).
- PI and Hermes use env vars for session ID; Claude Code and OpenCode use CLI flags.
- Only Claude Code enables session mirroring.
- OpenCode does not support `sessionModeNone` — every invocation must be in a session context.

## 5. Unified Surface Proposal

```
mah sessions list                    # List active/available sessions for current runtime
mah sessions resume <id>             # Continue session <id> on current runtime
mah sessions new                      # Start a fresh session on current runtime (if supported)
mah sessions export <id>             # Export session history/artefacts to portable format
mah sessions delete <id>             # Terminate/prune session <id> (prompts for confirmation)
mah sessions status [id]             # Show detailed status of a session (optional helper)
```

### Subcommand Details

| Subcommand      | Behavior |
|-----------------|----------|
| `mah sessions list` | Calls adapter's new `listSessions()` method. Outputs runtime-specific session list in a normalised table (id, created, last-active, runtime). |
| `mah sessions resume <id>` | Sets `sessionModeContinue` + appropriate session ID (env or flag per runtime). Invokes the runtime's `run` command. |
| `mah sessions new` | Sets `sessionModeNew`. Invokes the runtime's `run` command with new-session context. Fails gracefully on runtimes where `sessionModeNew: false`. |
| `mah sessions export <id>` | Calls adapter's new `exportSession(id)` method. Writes session artefacts to `$MAH_SESSIONS_DIR/<runtime>/<id>.tar.gz` (or similar). |
| `mah sessions delete <id>` | Calls adapter's new `deleteSession(id)` method. Prompts: "Delete session `<id>` on `<runtime>`? [y/N]". Requires explicit confirmation. |

### Global Flags (applicable to `mah sessions`)

| Flag | Purpose |
|------|---------|
| `--runtime <name>` | Target a specific runtime regardless of auto-detection |
| `--json` | Output results as JSON instead of human-readable table |
| `--sessions-dir <path>` | Override default session storage root |

## 6. Adapter Contract Implications

The runtime adapter contract (defined in `scripts/runtime-adapters.mjs`) must be extended with the following fields and methods:

### New Capability Fields

```js
capabilities: {
  // ... existing fields ...

  // NEW — session management
  supportsSessions: true,                        // boolean (default: false)
  sessionListCommand: ["hermes", ["session", "list"]],  // [exec, args] tuple, null if unsupported
  sessionExportCommand: ["hermes", ["session", "export"]], // [exec, args] tuple, null if unsupported
  sessionDeleteCommand: ["hermes", ["session", "delete"]], // [exec, args] tuple, null if unsupported
  supportsSessionNew: true,                       // boolean (runtime can start new sessions)
}
```

### New Adapter Methods (to be implemented on each adapter object)

| Method | Signature | Description |
|--------|-----------|-------------|
| `listSessions()` | `() => Promise<Session[]>` | Returns normalised array of session descriptors |
| `exportSession(id)` | `(id: string) => Promise<string>` | Exports session; returns path to exported artefact |
| `deleteSession(id)` | `(id: string) => Promise<void>` | Deletes session; must confirm before acting |
| `resumeSession(id)` | `(id: string) => CommandPlan` | Returns resolved run command primed for continuation |
| `startSession()` | `() => CommandPlan` | Returns resolved run command primed for new session |

### Session Object Schema

```js
{
  id: string,           // runtime-native session identifier
  runtime: string,      // "pi" | "claude" | "opencode" | "hermes"
  createdAt: Date,
  lastActiveAt: Date,
  label: string,        // optional human-readable label
  isActive: boolean,    // true if this is the current session
}
```

### Fallback Behaviour

- If a runtime does not support a session subcommand (e.g., `sessionListCommand: null`), `mah sessions list` returns a clear error: "Runtime `<runtime>` does not support session enumeration."
- `mah sessions new` on a runtime with `supportsSessionNew: false` exits with: "Runtime `<runtime>` does not support starting new sessions. Use `mah sessions resume` instead."

## 7. Bounded Scope Checklist — What IS in v0.4.0

- [x] `mah sessions list` — unified listing across all four runtimes
- [x] `mah sessions resume <id>` — unified resume across all four runtimes
- [x] `mah sessions new` — unified new-session across runtimes that support it (PI, Hermes; no-op/error on Claude Code, OpenCode)
- [x] `mah sessions export <id>` — export session artefacts to local storage
- [x] `mah sessions delete <id>` — delete/prune with explicit confirmation prompt
- [x] Adapter contract extension with new capability fields and method signatures
- [x] Normalised `Session` object schema across all runtimes
- [x] `--runtime` flag to force targeting a specific runtime
- [x] `--json` flag for machine-readable output
- [x] Graceful error messages when a runtime lacks support for a subcommand

## 8. Deferred to v0.5.0+

The following are explicitly **out of scope** for v0.4.0:

| Feature | Reason |
|---------|--------|
| Remote session access (node model, connector model) | Requires network layer, auth, and remote execution contracts |
| Session sharing between runtimes | Requires federation layer and conflict resolution |
| Session policy / guardrails | Requires policy engine and evaluation runtime |
| Session federation | Requires cross-runtime identity and trust model |
| Session mirroring (cloning a session across runtimes) | Design TBD; depends on policy work |
| Background session operation | Already exists in Hermes (`supportsBackgroundOperation: true`); deferred for unified surface |
| Session expiration / TTL management | Requires persistent session store across all runtimes |

## 9. Next Slice — First PR-Sized Implementation

**Scope:** Implement `mah sessions list` only, across all four runtimes, as a single bounded PR.

### Steps

1. **Extend the adapter contract** in `scripts/runtime-adapters.mjs`:
   - Add `supportsSessions: boolean` (default `false`)
   - Add `sessionListCommand: [exec, args] | null`
   - Add `listSessions(): Promise<Session[]>` method stub on `createAdapter`

2. **Update each runtime adapter** (pi, claude, opencode, hermes):
   - Set `supportsSessions: true`
   - Provide `sessionListCommand` pointing to the runtime's native session-list command (or `null` with a comment if none exists)
   - Implement `listSessions()` by executing `sessionListCommand` and normalising the output

3. **Implement `mah sessions list` CLI command** in the `mah` CLI entry point:
   - Detect active runtime(s)
   - For each active runtime, call `adapter.listSessions()`
   - Render a unified table: `RUNTIME | SESSION ID | CREATED | LAST ACTIVE | LABEL`

4. **Add `--json` output mode** as a trivial passthrough of the normalised session array

5. **Add tests:**
   - Unit test `listSessions()` for each adapter (mock the native command output)
   - Integration test: `mah sessions list --runtime hermes` produces expected output

### Success Criteria

- `mah sessions list` runs without error on all four runtimes (or exits gracefully with a clear message if unsupported)
- Output is consistent schema regardless of which runtime is active
- First-time operator can list sessions without consulting per-runtime documentation

---

*Last updated: v0.4.0 planning*
*Owner: MAH Operator Experience*
