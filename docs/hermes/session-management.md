# Hermes Session Management

## Overview

MAH provides unified session controls that are translated through the repo-local Hermes wrapper. For Hermes, session management follows the standard MAH session model with bounded Hermes-specific adaptations.

---

## Unified Session Operations

All MAH runtimes (PI, Claude Code, OpenCode, Hermes) support unified session management via `mah sessions`:

```bash
mah sessions list                       # List all sessions (current runtime)
mah sessions list --runtime hermes      # List sessions for a specific runtime
mah sessions list --json                # JSON output
mah sessions list --crew dev            # Filter by crew
mah sessions resume <id>                # Resume session by ID (format: runtime:crew:sessionId)
mah sessions new --runtime hermes        # Start a new session (PI and Hermes only)
mah sessions new --runtime hermes --dry-run  # Preview new-session command without spawning
mah sessions export <id>                # Export session to $MAH_SESSIONS_DIR/<runtime>/<id>.tar.gz
mah sessions delete <id> --yes          # Delete session (requires --yes confirmation)
```

**Session ID format**: `runtime:crew:sessionId` (e.g., `hermes:dev:2026-04-08T13-00-00-abc123`)

**Per-runtime support for `mah sessions new`**:
- PI and Hermes: supported
- Claude Code and OpenCode: not supported — emits clear error

Use `mah sessions --help` for full usage information.

---

## Session controls

All session controls are accessed through the `mah run` command:

```bash
mah --runtime hermes run [session-options] [runtime-args]
```

### Available session flags

| Flag | Description | Hermes Support |
|---|---|---|
| `--session-mode new` | Start a new session | Supported via wrapper bootstrap |
| `--session-mode continue` | Continue an existing session | Supported with orchestrator-session pinning |
| `--session-mode none` | Ephemeral session (no persistence) | Not supported — warning emitted, session persists |
| `--session-id <id>` | Target a specific session by ID | Supported via wrapper resume bridge |
| `--session-root <path>` | Override session directory | Captured as wrapper metadata |
| `--session-mirror` | Mirror session artifacts | Not applicable |

---

## Session semantics

### New sessions

```bash
mah --runtime hermes run --session-mode new
```

Creates a fresh Hermes execution context.

On a fresh run, the wrapper first injects the selected crew's orchestrator context into a quiet Hermes session and then continues that session interactively. That is why Hermes starts in-role instead of acting like a generic assistant.

### Continuing sessions

```bash
mah --runtime hermes run --session-mode continue
```

Resumes an existing Hermes session for the active crew.

When continuing an existing session, the wrapper skips bootstrap.

If MAH has a pinned orchestrator session for the active crew, `--session-mode continue` resolves to `--resume <pinned-session-id>` to keep you on the orchestration thread.

If no pinned session exists yet, the wrapper falls back to native Hermes continue behavior.

### Targeting a specific session

```bash
mah --runtime hermes run --session-mode continue --session-id <id>
```

Resumes a specific session by its identifier.

MAH passes the session ID through the wrapper, which translates it to Hermes resume arguments.

---

## Session directory

By default, MAH projects Hermes session metadata under:

```
.hermes/crew/<crew>/sessions/
```

This can be overridden per-crew in `meta-agents.yaml`:

```yaml
crews:
  - id: "dev"
    session:
      hermes_root: ".hermes/crew/dev/sessions"
```

---

## Ephemeral sessions

```bash
mah --runtime hermes run --session-mode none
```

Hermes does not natively support ephemeral sessions. MAH emits a warning and the session will persist normally. For true ephemeral sessions, use the pi runtime (`mah --runtime pi run --session-mode none`).

---

## Differences from other runtimes

Hermes session handling may differ from other MAH runtimes in the following ways:

1. **Session bootstrap**: MAH injects crew context on fresh runs before continuing interactively
2. **Session persistence**: Hermes owns the real session store and may retain context beyond MAH metadata
3. **Session root**: Hermes does not currently expose a native session-root flag, so MAH stores that path as wrapper metadata instead of forcing Hermes storage layout

Inspect the resolved plan with:

```bash
mah --runtime hermes explain run --session-mode continue --trace
```

`--session-mirror` is ignored for Hermes.

---

## Environment variables

| Variable | Description |
|---|---|
| `MAH_RUNTIME` | Force Hermes as runtime (`MAH_RUNTIME=hermes`) |
| `MAH_AUDIT` | Enable provenance logging (`MAH_AUDIT=1`) |
| `MAH_PROVENANCE` | Alternative provenance flag (`MAH_PROVENANCE=1`) |

---

## Related documents

- [`runtime-support.md`](./runtime-support.md) — Runtime integration overview
- [`artifact-structure.md`](./artifact-structure.md) — Directory layout
- [`quickstart.md`](./quickstart.md) — Getting started
