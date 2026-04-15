# Slice 4 — Documentation Plan

**Sprint**: v0.6.0-headless-and-sessions  
**Created**: 2026-04-15  
**Status**: Archived — implementation complete

---

## Executive Summary

Slice 4 documentation covers three areas: a new **Operational Guide** (`docs/headless-runtime.md`) explaining headless execution across all runtimes, **CLI help updates** to surface `--headless` flag behavior, and updates to the **runtime support matrix** in existing docs. All changes are additive — no existing documentation is removed or restructured.

---

## 1. New Documentation: `docs/headless-runtime.md`

### Purpose

This is the primary new document for v0.6.0 headless execution. It serves as the single authoritative reference for operators running `mah run --runtime <x> --headless "<task>"` across any supported runtime.

### Target Audience

- Operators running MAH in CI/CD pipelines
- Developers integrating MAH into automation scripts
- Platform engineers evaluating headless execution capabilities

### Document Outline

```markdown
# Headless Runtime Execution

## Overview

Headless execution allows `mah run` to invoke a runtime CLI without a controlling TTY,
capturing stdout/stderr and returning an exit code. This is the primary execution model
for CI/CD, scripting, and automated workflows.

## Usage

    mah run --runtime <runtime> --headless "<task>" [flags]

## Runtimes

### PI

**Status**: Supported  
**Command**: `pi run <task>`  
**Session Required**: No  
**Environment Variables**:
- `PI_MULTI_HEADLESS=1` — suppresses interactive TUI
- `PI_MULTI_CONFIG` — crew config path (auto-injected by MAH)
- `PI_MULTI_SESSION_ROOT` — session root (auto-injected by MAH)

**Example**:
    mah run --runtime pi --headless "write a hello world file"

**Exit Codes**:
- `0` — task completed successfully
- `1` — runtime error or task failure
- `2` — configuration error (missing crew, extension not found)

### Claude

**Status**: Supported  
**Command**: `claude --print --no-session-persistence <task>`  
**Session Required**: No  
**Environment Variables**:
- `CLAUDE_HEADLESS=1` — marks headless execution context
- `MAH_ACTIVE_CREW` — crew context (auto-injected by MAH)

**Example**:
    mah run --runtime claude --headless "list the files in src/"

**Exit Codes**:
- `0` — task completed successfully
- Non-zero — runtime error or tool call failure

### OpenCode

**Status**: Supported  
**Command**: `opencode <task>`  
**Session Required**: No  
**Environment Variables**:
- `OPENCODE_HEADLESS=1` — suppresses interactive TUI

**Example**:
    mah run --runtime opencode --headless "refactor the auth module"

**Exit Codes**:
- `0` — task completed successfully
- Non-zero — runtime error

### Hermes

**Status**: Supported (requires active session)  
**Command**: `hermes chat [-c <session-id>] <task>`  
**Session Required**: Yes  
**Environment Variables**:
- `HERMES_SESSION_ID` — active session ID (required)
- `HERMES_HEADLESS=1` — marks headless execution context
- `MAH_ACTIVE_CREW` — crew context (auto-injected by MAH)

**Example**:
    HERMES_SESSION_ID=my-session mah run --runtime hermes --headless "summarize project state"

**Error Cases**:
- If no `HERMES_SESSION_ID` is set: returns error `"Hermes headless requires an active session"`
- Use `mah sessions new --runtime hermes` to create a session first

**Exit Codes**:
- `0` — task completed successfully
- Non-zero — runtime or session error

### Codex

**Status**: Supported  
**Command**: `codex -c "<mcp_config>" initial_messages="[...]" exec --full-auto <task>`  
**Session Required**: No  
**Environment Variables**:
- `MAH_CODEX_AUTONOMOUS=1` — enables autonomous execution mode
- `MAH_ACTIVE_CREW` — crew context (auto-injected by MAH)
- `MAH_AGENT` — selected agent name (auto-injected by MAH)

**Example**:
    mah run --runtime codex --headless "implement the login feature"

**Notes**:
- Uses MCP server config to inject crew context via the MAH MCP bridge
- Uses `exec --full-auto` for autonomous task execution (no interactive prompts)

**Exit Codes**:
- `0` — task completed successfully
- Non-zero — runtime error

## Output Modes

### Text Output (default)

stdout/stderr are written directly to the terminal:

    mah run --runtime pi --headless "echo hello"
    # → hello

### JSON Output

Use `--output=json` for machine-readable output:

    mah run --runtime pi --headless "echo hello" --output=json
    {
      "runtime": "pi",
      "command": "run",
      "status": 0,
      "stdout": "hello\n",
      "stderr": "",
      "crew": "dev",
      "session_id": "...",
      "execution_time_ms": 1234
    }

## Troubleshooting

### "Runtime does not support headless execution"

The runtime adapter's `capabilities.headless.supported` is `false`. This may mean:
- The headless implementation has not been ported to the plugin form
- Run `mah contract:runtime` to check adapter compliance

### Hermes returns "requires an active session"

Hermes headless requires an existing session. Create one with:
    mah sessions new --runtime hermes
Then run with the session ID:
    HERMES_SESSION_ID=<session-id> mah run --runtime hermes --headless "<task>"

### Output is truncated

Headless mode uses `spawnSync` with piped stdio. Very large outputs may be buffered.
For large artifact generation, consider redirecting output to a file.

## See Also

- `mah help run` for general run command documentation
- `mah sessions` for session management commands
- `docs/runtime-boundary.md` for MAH vs. runtime responsibility split
```

### Creation Criteria

- File created at `docs/headless-runtime.md`
- All five runtimes documented with command, env vars, session requirements, exit codes
- Both text and JSON output modes documented
- Troubleshooting section covers the three most likely failure modes
- Cross-references to `mah help run` and `docs/runtime-boundary.md`

---

## 2. CLI Help Updates

### File: `scripts/meta-agents-harness.mjs`

**Function**: `printHelp()`

**Current state** (line ~159):
```
  console.log("  --headless")
  console.log("  --output <json|text>")
  console.log("  -o <json|text>")
```

**Proposed update** — add one-line descriptions:

```js
  console.log("  --headless               run without TTY (captures stdout/stderr, returns exit code)")
  console.log("  --output <json|text>     output format for headless mode (default: text)")
  console.log("  -o <json|text>           alias for --output")
```

**Verification**:
```bash
node scripts/meta-agents-harness.mjs --help | grep -A3 "headless"
```
Expected output:
```
  --headless               run without TTY (captures stdout/stderr, returns exit code)
  --output <json|text>     output format for headless mode (default: text)
  -o <json|text>           alias for --output
```

---

## 3. Update Existing Docs: `docs/platform-capabilities.md`

**Purpose**: Add headless support column to the runtime support matrix.

### Current state (approximate)

The document likely has a table with columns like: Runtime | Sessions | MCP | Multi-Team | ...

### Proposed change

Add a "Headless" column to the runtime support table:

| Runtime | Headless | Session Required | Prompt Mode | Output Mode |
|---------|----------|-----------------|-------------|-------------|
| PI | ✅ | No | argv | stdout |
| Claude | ✅ | No | argv | stdout |
| OpenCode | ✅ | No | argv | stdout |
| Hermes | ✅ | Yes | argv | mixed |
| Codex | ✅ | No | env | stdout |

Also add a subsection:

```markdown
## Headless Execution

MAH supports headless execution across all runtimes via `mah run --runtime <x> --headless "<task>"`.
Each runtime has a native headless mode that suppresses interactive TUIs and captures execution output.

See [Headless Runtime Execution](../../docs/headless-runtime.md) for full documentation.
```

---

## 4. Update Existing Docs: `docs/runtime-boundary.md`

**Purpose**: Clarify that headless execution is a MAH-owned operational mode.

### Proposed addition

Add a section:

```markdown
## Headless Execution (MAH-owned)

Headless execution is an operational mode fully owned by MAH. The runtime's role
is limited to receiving a task prompt and producing output — MAH handles:

- stdio capture (via `spawnSync` with `stdio: pipe`)
- exit code interpretation
- JSON envelope formatting (`--output=json`)
- session context injection (where required by the runtime)

The runtime adapter's `prepareHeadlessRunContext()` method is the boundary
point — it defines what CLI arguments and environment variables are produced
for a given headless task.

See [Headless Runtime Execution](../../docs/headless-runtime.md) for per-runtime details.
```

---

## 5. Update Existing Docs: `docs/README.md`

**Purpose**: Add `headless-runtime.md` to the doc index.

### Current state (from docs/README.md)

```
## Core Concepts
- [Expertise Model Foundation](../../docs/expertise-model-foundation.md)
- [Platform Capabilities](../../docs/platform-capabilities.md)
- [Runtime Boundary](../../docs/runtime-boundary.md)
- [Validate Semantics](../../docs/validate-semantics.md)
```

### Proposed change

Add under Core Concepts or create a new "Operations" section:

```markdown
## Operations

- [Headless Runtime Execution](../../docs/headless-runtime.md) — Runtimes without TTY in CI/CD and scripts
```

---

## 6. Session Documentation Updates

For Slice 5/6 (session export/import), the following docs need updates:

### `docs/hermes/session-management.md` (existing)

Add section:
```markdown
## Headless Session Execution

Hermes headless execution requires an active session. Use:

    hermes sessions new --runtime hermes  # create session
    HERMES_SESSION_ID=<id> mah run --runtime hermes --headless "<task>"

Sessions created by MAH are stored in `.hermes/crew/<crew>/sessions/`.
```

### New doc: `docs/sessions.md`

A cross-runtime session guide covering:
- Session lifecycle across runtimes
- `mah sessions` command reference
- Export format (for Slice 5/6)
- Import/injection (for Slice 5/6)

**Deferred to Slice 5/6** — not in Slice 4 scope.

---

## 7. Document Update Summary

| File | Action | Scope Estimate |
|------|--------|----------------|
| `docs/headless-runtime.md` | **CREATE** — new operational guide | ~150 lines |
| `scripts/meta-agents-harness.mjs` | **MODIFY** — add `--headless` flag descriptions to `printHelp()` | ~3 lines |
| `docs/platform-capabilities.md` | **MODIFY** — add headless column to runtime matrix | ~20 lines |
| `docs/runtime-boundary.md` | **MODIFY** — add headless section | ~15 lines |
| `docs/README.md` | **MODIFY** — add headless-runtime.md to index | ~3 lines |

**Total new documentation**: 1 new file (~150 lines)  
**Total modified files**: 4 files (~41 lines total)

---

## 8. Verification Checklist

Before declaring Slice 4 documentation complete:

- [ ] `docs/headless-runtime.md` exists and covers all 5 runtimes
- [ ] `mah --help` output includes `--headless` with description
- [ ] `docs/platform-capabilities.md` has headless support matrix
- [ ] `docs/runtime-boundary.md` has headless section
- [ ] `docs/README.md` indexes `headless-runtime.md`
- [ ] All cross-references between docs are valid
- [ ] Code examples in `headless-runtime.md` are syntactically correct

---

## 9. Out of Scope for v0.6.0 Documentation

| Doc | Reason |
|-----|--------|
| `docs/sessions.md` (full session interop guide) | Deferred to Slice 5/6 |
| Headless transcript replay portability docs | Not in v0.6.0 scope |
| CI/CD integration cookbook | Could be a future add-on |
| Remote execution documentation | Deferred post-v0.6.0 |
| Policy engine documentation | Out of scope |

---

## 10. Appendix: Document Dependencies

```
docs/headless-runtime.md
  └── references: docs/runtime-boundary.md (cross-ref)
  └── references: mah --help (implementation source)

docs/platform-capabilities.md  
  └── references: docs/headless-runtime.md (new cross-ref)

docs/runtime-boundary.md
  └── references: docs/headless-runtime.md (new cross-ref)

docs/README.md
  └── references: docs/headless-runtime.md (index entry)

scripts/meta-agents-harness.mjs (printHelp)
  └── no doc dependencies
```
