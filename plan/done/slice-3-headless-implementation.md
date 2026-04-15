# Slice 3 — Per-Runtime Headless Implementation Plan

**Sprint**: v0.6.0-headless-and-sessions  
**Created**: 2026-04-15  
**Status**: Draft — for PLANNING review

---

## Executive Summary

Slice 0 correctly identified that all runtimes were "unsupported" in their **plugin** form. However, the **built-in** adapters in `scripts/runtime-adapters.mjs` already have working `prepareHeadlessRunContext` implementations for all four classic runtimes (pi, claude, opencode, hermes). The v0.6.0 headless work for Slice 3 is therefore:

1. **Port the four working headless implementations from `runtime-core-integrations.mjs`** into each plugin's `prepareHeadlessRunContext` method
2. **Add codex headless support** (most complex — uses MCP server config injection)
3. **Update `capabilities.headless` flags** in all plugin adapters to `supported: true`
4. **Validate the full `--headless` dispatch path** end-to-end

---

## Discovery Findings

### Built-in vs Plugin Headless State

| Runtime | Built-in (`runtime-adapters.mjs`) | Plugin (`plugins/runtime-*/index.mjs`) | Delta |
|---------|-----------------------------------|----------------------------------------|-------|
| pi | `supported: true` + `preparePiHeadlessRunContext` exists | `supported: false` + stub error | Port implementation |
| hermes | `supported: true` + `prepareHermesHeadlessRunContext` exists | `supported: false` + stub error | Port implementation |
| claude | `supported: true` + `prepareClaudeHeadlessRunContext` exists | `supported: false` + stub error | Port implementation |
| opencode | `supported: true` + `prepareOpencodeHeadlessRunContext` exists | `supported: false` + stub error | Port implementation |
| codex | Not in built-in | `supported: false` + stub error | **Greenfield** |

**Conclusion**: The four classic runtimes are all "copy the implementation from core-integrations into the plugin". Only codex needs genuine new design.

---

## Implementation Priority Order

### Priority 1 — PI (`plugins/runtime-pi/index.mjs`)

**Why first**: Simplest implementation. `pi run <task>` is a direct passthrough. No session dependency. Lowest risk to interactive mode.

- **Headless Command**: `pi run <task>`
- **Prompt Injection**: task as plain argv argument after `run` subcommand
- **Output Capture**: `stdio: pipe` via `spawnSync`
- **Exit Status**: `spawnSync.status` — 0 = success, non-zero = runtime error
- **Implementation Complexity**: Low
- **Break Risk to Interactive**: Low (headless path uses `PI_MULTI_HEADLESS=1` env var to diverge; interactive `pi` invocation unchanged)
- **Expected mah run behavior**:
  ```
  mah run --runtime pi --headless "write a hello world file"
  → spawnSync("pi", ["-e", "<ext1>", "-e", "<ext2>", "run", "write a hello world file"], { PI_MULTI_HEADLESS: "1" })
  → stdout/stderr captured, process exit code returned
  ```
- **Blockers**: None — implementation already exists in `runtime-core-integrations.mjs:preparePiHeadlessRunContext`

**Plugin changes required**:
1. Update `capabilities.headless` to `supported: true`, `native: true`, `promptMode: "argv"`, `outputMode: "stdout"`, `requiresSession: false`
2. Replace stub `prepareHeadlessRunContext()` with the logic from `runtime-core-integrations.mjs:preparePiHeadlessRunContext`

---

### Priority 2 — Claude (`plugins/runtime-claude/index.mjs`)

**Why second**: Still simple. `--print --no-session-persistence` flags are well-understood non-interactive paths. No session dependency.

- **Headless Command**: `claude --print --no-session-persistence <task>`
- **Prompt Injection**: task as plain argv argument after known flags
- **Output Capture**: `stdio: pipe` via `spawnSync`
- **Exit Status**: `spawnSync.status` — 0 = success, non-zero = runtime error or tool call failure
- **Implementation Complexity**: Low
- **Break Risk to Interactive**: Low (`--print` mode is a documented Claude Code flag; interactive TUI not launched)
- **Expected mah run behavior**:
  ```
  mah run --runtime claude --headless "list the files in this directory"
  → spawnSync("claude", ["--print", "--no-session-persistence", "list the files in this directory"], { CLAUDE_HEADLESS: "1" })
  → stdout/stderr captured
  ```
- **Blockers**: None — implementation already exists in `runtime-core-integrations.mjs:prepareClaudeHeadlessRunContext`

**Plugin changes required**:
1. Update `capabilities.headless` to `supported: true`, `native: true`, `promptMode: "argv"`, `outputMode: "stdout"`, `requiresSession: false`
2. Replace stub `prepareHeadlessRunContext()` with the logic from `runtime-core-integrations.mjs:prepareClaudeHeadlessRunContext`
3. Consider: should `--print` output go through the existing `executePreparedRun` path or bypass it entirely? Recommendation: bypass — `prepareHeadlessRunContext` returns a direct `claude --print` plan.

---

### Priority 3 — OpenCode (`plugins/runtime-opencode/index.mjs`)

**Why third**: Straightforward passthrough like PI. Task as argv. No session dependency.

- **Headless Command**: `opencode <task>`
- **Prompt Injection**: task as plain argv argument
- **Output Capture**: `stdio: pipe` via `spawnSync`
- **Exit Status**: `spawnSync.status` — 0 = success, non-zero = runtime error
- **Implementation Complexity**: Low
- **Break Risk to Interactive**: Low (`OPENCODE_HEADLESS=1` env var gates divergence)
- **Expected mah run behavior**:
  ```
  mah run --runtime opencode --headless "refactor the auth module"
  → spawnSync("opencode", ["refactor the auth module"], { OPENCODE_HEADLESS: "1" })
  → stdout/stderr captured
  ```
- **Blockers**: None — implementation already exists in `runtime-core-integrations.mjs:prepareOpencodeHeadlessRunContext`

**Plugin changes required**:
1. Update `capabilities.headless` to `supported: true`, `native: true`, `promptMode: "argv"`, `outputMode: "stdout"`, `requiresSession: false`
2. Replace stub `prepareHeadlessRunContext()` with the logic from `runtime-core-integrations.mjs:prepareOpencodeHeadlessRunContext`

---

### Priority 4 — Hermes (`plugins/runtime-hermes/index.mjs`)

**Why fourth**: More complex — requires active session (`-c` flag) and has a bootstrap mechanism (`-Q` flag). Session dependency means session must exist or be created.

- **Headless Command**: `hermes chat <task>` or `hermes chat -c <task>`
- **Prompt Injection**: task as plain argv after `chat` subcommand; session via `-c`
- **Output Capture**: `stdio: pipe` via `spawnSync`
- **Exit Status**: `spawnSync.status` — 0 = success, non-zero = runtime error or session error
- **Implementation Complexity**: Medium
- **Break Risk to Interactive**: Medium (Hermes chat mode is the interactive path; headless needs `-c` continue flag)
- **Key Design Decision**: Hermes headless REQUIRES an active session. `prepareHermesHeadlessRunContext` returns an error if no `HERMES_SESSION_ID` env var and no `crew` parameter. This is intentional — Hermes cannot run headless without session bootstrapping.
- **Expected mah run behavior**:
  ```
  mah run --runtime hermes --headless "summarize the current project state"
  → if HERMES_SESSION_ID set: spawnSync("hermes", ["chat", "-c", "summarize..."], { HERMES_HEADLESS: "1" })
  → if no session: returns { ok: false, error: "Hermes headless requires an active session..." }
  ```
- **Blockers**: None — implementation already exists in `runtime-core-integrations.mjs:prepareHermesHeadlessRunContext`

**Plugin changes required**:
1. Update `capabilities.headless` to `supported: true`, `native: true`, `promptMode: "argv"`, `outputMode: "mixed"`, `requiresSession: true`
2. Replace stub `prepareHeadlessRunContext()` with the logic from `runtime-core-integrations.mjs:prepareHermesHeadlessRunContext`

---

### Priority 5 — Codex (`plugins/codex/index.mjs`)

**Why last**: Most complex. Uses MCP server config (`-c`) for context injection. No built-in implementation to port.

- **Headless Command**: `codex -c "<mcp_servers.mah={...}>" initial_messages=[{role="system",content=...}] exec --full-auto <task>`
- **Prompt Injection**: `initial_messages` via `-c` MCP server config; task via `exec --full-auto` subcommand
- **Output Capture**: `stdio: pipe` via `spawnSync`
- **Exit Status**: `spawnSync.status` — 0 = success, non-zero = runtime error
- **Implementation Complexity**: High
- **Break Risk to Interactive**: Low (Codex headless uses a completely different execution path than interactive `--cd` mode)
- **Key Design Decision**: Codex headless needs `MAH_CODEX_AUTONOMOUS=1` set in env to enable the `exec --full-auto <task>` subcommand path. Without this, the existing interactive path is used.
- **Expected mah run behavior**:
  ```
  mah run --runtime codex --headless "implement the feature"
  → codex -c "mcp_servers.mah={command=node,args=[server.mjs],cwd=...}"
          initial_messages=[{role="system",content="<system prompt>"}]
          exec --cd /repo --full-auto "implement the feature"
  → stdout/stderr captured
  ```
- **Blockers**: None — greenfield, but `buildCodexRunContext` in the existing plugin already shows the MCP config pattern via `buildCodexMahMcpConfigArg()` and `buildCodexInitialMessagesPrompt()`. The headless path extends this pattern.

**Plugin changes required**:
1. Update `capabilities.headless` to `supported: true`, `native: true`, `promptMode: "env"`, `outputMode: "stdout"`, `requiresSession: false`
2. Implement `prepareHeadlessRunContext()` using the existing `buildCodexMahMcpConfigArg()` and `buildCodexInitialMessagesPrompt()` helpers but targeting `exec --full-auto <task>` instead of interactive `--cd` mode
3. Add `MAH_CODEX_AUTONOMOUS=1` to envOverrides to gate the autonomous execution path

---

## Cross-Cutting Concerns

### 1. Harness Dispatch Path (already wired)

The harness in `scripts/meta-agents-harness.mjs` already has the full headless dispatch path:

```
main()
  → hasHeadlessFlag(argv) detects --headless
  → dispatchHeadless(runtime, command, passthrough, outputMode)
    → adapter.prepareHeadlessRunContext({ repoRoot, runtime, task, argv, envOverrides })
    → runCommand(..., { headless: true })  ← stdio: pipe
    → format output (text or JSON envelope)
```

**No harness changes needed** for PI, Claude, OpenCode, Hermes. The harness is runtime-agnostic — it calls `adapter.prepareHeadlessRunContext()` and the adapter provides the execution plan.

### 2. Adapter Contract (`scripts/runtime-adapter-contract.mjs`)

The contract already validates:
- `capabilities.headless.supported === true` requires `prepareHeadlessRunContext` to be a function
- `promptMode` must be one of `["argv", "stdin", "env", "unsupported"]`
- `outputMode` must be one of `["stdout", "file", "mixed"]`

**No contract changes needed.**

### 3. Session Handling in Headless Mode

| Runtime | Headless Session Behavior |
|---------|-------------------------|
| PI | No session required. `PI_MULTI_HEADLESS=1` suppresses session creation. |
| Claude | No session required. `--no-session-persistence` prevents session creation. |
| OpenCode | No session required. `OPENCODE_HEADLESS=1` suppresses session. |
| Hermes | **Session required.** Must have `HERMES_SESSION_ID` set or pass `--crew` to create one. Error if no session. |
| Codex | No session. Uses MCP context injection instead. |

### 4. Output Capture

All five runtimes use `stdio: pipe` via `spawnSync` (set by `runCommand(..., { headless: true })`). The harness `dispatchHeadless` function handles both text output (direct write to stdout/stderr) and JSON envelope output.

---

## Required Changes Per File

### `plugins/runtime-pi/index.mjs`
```js
// Before
capabilities: {
  headless: { supported: false, native: false, requiresSession: false, promptMode: "unsupported", outputMode: "stdout" }
}

// After
capabilities: {
  headless: { supported: true, native: true, requiresSession: false, promptMode: "argv", outputMode: "stdout" }
}

// prepareHeadlessRunContext: replace stub with port of preparePiHeadlessRunContext
```

### `plugins/runtime-claude/index.mjs`
```js
// Before
capabilities: {
  headless: { supported: false, native: false, requiresSession: false, promptMode: "unsupported", outputMode: "stdout" }
}

// After
capabilities: {
  headless: { supported: true, native: true, requiresSession: false, promptMode: "argv", outputMode: "stdout" }
}

// prepareHeadlessRunContext: replace stub with port of prepareClaudeHeadlessRunContext
```

### `plugins/runtime-opencode/index.mjs`
```js
// Before
capabilities: {
  headless: { supported: false, native: false, requiresSession: false, promptMode: "unsupported", outputMode: "stdout" }
}

// After
capabilities: {
  headless: { supported: true, native: true, requiresSession: false, promptMode: "argv", outputMode: "stdout" }
}

// prepareHeadlessRunContext: replace stub with port of prepareOpencodeHeadlessRunContext
```

### `plugins/runtime-hermes/index.mjs`
```js
// Before
capabilities: {
  headless: { supported: false, native: false, requiresSession: false, promptMode: "unsupported", outputMode: "stdout" }
}

// After
capabilities: {
  headless: { supported: true, native: true, requiresSession: true, promptMode: "argv", outputMode: "mixed" }
}

// prepareHeadlessRunContext: replace stub with port of prepareHermesHeadlessRunContext
```

### `plugins/codex/index.mjs`
```js
// Before
capabilities: {
  headless: { supported: false, native: false, requiresSession: false, promptMode: "unsupported", outputMode: "stdout" }
}

// After
capabilities: {
  headless: { supported: true, native: true, requiresSession: false, promptMode: "env", outputMode: "stdout" }
}

// prepareHeadlessRunContext: NEW implementation using buildCodexMahMcpConfigArg + exec --full-auto
```

---

## Blockers and Dependencies

| Blocker | Severity | Resolution |
|---------|----------|------------|
| None for PI, Claude, OpenCode, Hermes | — | Port existing implementations from `runtime-core-integrations.mjs` |
| Codex headless design not finalized | Medium | Solution Architect to finalize `initial_messages` + `exec --full-auto` pattern in this slice's spike |
| Need validation harness for headless output | Low | Can be deferred to integration test layer (backend-dev responsibility) |

---

## Slice 3 Gate Criteria

Before declaring Slice 3 complete, the following must pass:

1. **`mah run --runtime pi --headless "<task>"`** → exits 0, stdout captured, no TTY launched
2. **`mah run --runtime claude --headless "<task>"`** → exits 0, stdout captured, no TTY launched
3. **`mah run --runtime opencode --headless "<task>"`** → exits 0, stdout captured, no TTY launched
4. **`mah run --runtime hermes --headless "<task>"`** → exits 0 with session, error-without-session when no HERMES_SESSION_ID
5. **`mah run --runtime codex --headless "<task>"`** → exits 0, stdout captured, autonomous execution confirmed
6. **`mah explain run --runtime <x> --headless "<task>"`** → shows correct exec/args/env for each runtime
7. **`mah contract:runtime`** → all adapters pass headless capability validation

---

## Deferred Items (Out of Scope for v0.6.0)

- **Headless output to file** (`outputMode: "file"`) — not needed for v0.6.0 scope
- **Headless transcript replay** — full multi-runtime portability not in scope
- **Remote execution foundation** — deferred to post-v0.6.0
- **Policy engine** — out of scope
- **Federation/interconnect** — out of scope

---

## Appendix: Implementation Reference

### Key helper functions to port (from `runtime-core-integrations.mjs`)

| Function | Used By | Purpose |
|----------|---------|---------|
| `preparePiHeadlessRunContext` | PI plugin | Builds `pi run <task>` plan with extensions |
| `prepareClaudeHeadlessRunContext` | Claude plugin | Builds `claude --print --no-session-persistence <task>` plan |
| `prepareOpencodeHeadlessRunContext` | OpenCode plugin | Builds `opencode <task>` plan |
| `prepareHermesHeadlessRunContext` | Hermes plugin | Builds `hermes chat [-c] <task>` plan with session check |
| `buildCodexMahMcpConfigArg` | Codex plugin (existing) | Builds `-c mcp_servers.mah={...}` argument |
| `buildCodexInitialMessagesPrompt` | Codex plugin (existing) | Builds `initial_messages=[...]` argument |

### Existing harness headless infrastructure

- `hasHeadlessFlag(argv)` — detects `--headless` flag
- `stripHeadlessArgs(argv)` — removes `--headless` and `--output` flags from passthrough
- `dispatchHeadless(runtime, command, passthrough, outputMode)` — orchestrates headless dispatch
- `runCommand(command, args, passthrough, env, { headless: true })` — executes with `stdio: pipe`

No changes needed to any of the above for v0.6.0 headless implementation.
