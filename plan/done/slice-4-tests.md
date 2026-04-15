# Slice 4 — Test Coverage Plan

**Sprint**: v0.6.0-headless-and-sessions  
**Created**: 2026-04-15  
**Status**: Draft — for PLANNING review

---

## Executive Summary

Slice 4 defines the complete test coverage for v0.6.0 headless execution. Tests are organized in three tiers: **unit tests** validating adapter-level headless contracts, **integration tests** validating end-to-end `mah run --runtime <x> --headless` dispatch, and **contract tests** validating the headless envelope schema and adapter compliance. No headless tests exist today — this is net-new coverage.

---

## 1. Test Inventory

### 1.1 New Test Files to Create

| File | Purpose | Runtime | Scope Estimate |
|------|---------|---------|----------------|
| `tests/headless-contract.test.mjs` | Headless capability contract validation | All | ~120 lines, 12 tests |
| `tests/headless-pi.test.mjs` | PI headless dispatch validation | PI | ~80 lines, 8 tests |
| `tests/headless-claude.test.mjs` | Claude headless dispatch validation | Claude | ~80 lines, 8 tests |
| `tests/headless-opencode.test.mjs` | OpenCode headless dispatch validation | OpenCode | ~80 lines, 8 tests |
| `tests/headless-hermes.test.mjs` | Hermes headless dispatch validation | Hermes | ~100 lines, 10 tests |
| `tests/headless-codex.test.mjs` | Codex headless dispatch validation | Codex | ~120 lines, 12 tests |

**Total new test files**: 6  
**Total new tests**: ~58  
**Total estimated lines**: ~580 lines

---

## 2. Test Category A — Headless Capability Contract Tests

**File**: `tests/headless-contract.test.mjs`

### Rationale

Every runtime adapter that declares `capabilities.headless.supported === true` must satisfy a minimum contract. These tests validate the contract **without** executing any runtime CLI, making them fast and reliable in any environment.

### Tests

```js
// Test 1: capabilities.headless is declared on all built-in adapters
test("all built-in adapters declare capabilities.headless", () => {
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    assert.ok(name in RUNTIME_ADAPTERS, `${name} must be in RUNTIME_ADAPTERS`)
    assert.ok(adapter.capabilities?.headless, `${name} must declare capabilities.headless`)
  }
})

// Test 2: headless.supported is a boolean
test("headless.supported is boolean on all adapters", () => {
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    assert.equal(typeof adapter.capabilities.headless.supported, "boolean", `${name}`)
  }
})

// Test 3: headless.native is a boolean
test("headless.native is boolean on all adapters", () => {
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    assert.equal(typeof adapter.capabilities.headless.native, "boolean", `${name}`)
  }
})

// Test 4: headless.requiresSession is a boolean
test("headless.requiresSession is boolean on all adapters", () => {
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    assert.equal(typeof adapter.capabilities.headless.requiresSession, "boolean", `${name}`)
  }
})

// Test 5: headless.promptMode is a valid value
const VALID_PROMPT_MODES = ["argv", "stdin", "env", "unsupported"]
test("headless.promptMode is a valid value on all adapters", () => {
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    assert.ok(VALID_PROMPT_MODES.includes(adapter.capabilities.headless.promptMode), `${name}`)
  }
})

// Test 6: headless.outputMode is a valid value
const VALID_OUTPUT_MODES = ["stdout", "file", "mixed"]
test("headless.outputMode is a valid value on all adapters", () => {
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    assert.ok(VALID_OUTPUT_MODES.includes(adapter.capabilities.headless.outputMode), `${name}`)
  }
})

// Test 7: If headless.supported === true, prepareHeadlessRunContext must be a function
test("supported=true adapters have prepareHeadlessRunContext function", () => {
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    if (adapter.capabilities.headless.supported === true) {
      assert.equal(typeof adapter.prepareHeadlessRunContext, "function", `${name}`)
    }
  }
})

// Test 8: prepareHeadlessRunContext returns expected shape when supported
test("prepareHeadlessRunContext returns { ok, exec, args, passthrough, envOverrides, ... }", () => {
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    if (adapter.capabilities.headless.supported !== true) continue
    const result = adapter.prepareHeadlessRunContext({ repoRoot, task: "test", argv: [], envOverrides: {} })
    assert.equal(typeof result, "object")
    assert.equal(typeof result.ok, "boolean")
    if (result.ok) {
      assert.equal(typeof result.exec, "string")
      assert.ok(Array.isArray(result.args))
      assert.ok(Array.isArray(result.passthrough))
      assert.equal(typeof result.envOverrides, "object")
    }
  }
})

// Test 9: validateRuntimeAdapterContract passes for headless-capable adapters
test("validateRuntimeAdapterContract passes for all built-in adapters", () => {
  const result = validateRuntimeAdapterContract(RUNTIME_ADAPTERS)
  assert.equal(result.ok, true, result.errors.join("\n"))
})

// Test 10: Plugin adapters declare headless capabilities
test("plugin adapters that support headless have prepareHeadlessRunContext", async () => {
  const { getAllRuntimes } = await import("../scripts/plugin-loader.mjs")
  const plugins = await getAllRuntimes()
  for (const [name, adapter] of Object.entries(plugins)) {
    if (adapter.capabilities?.headless?.supported === true) {
      assert.equal(typeof adapter.prepareHeadlessRunContext, "function", `${name} plugin`)
    }
  }
})
```

### Pass/Fail Criteria

- All 10 tests pass
- No runtime CLI binaries are invoked
- Tests execute in < 1 second total

### Dependencies

- `RUNTIME_ADAPTERS` from `scripts/runtime-adapters.mjs`
- `validateRuntimeAdapterContract` from `scripts/runtime-adapter-contract.mjs`
- `getAllRuntimes` from `scripts/plugin-loader.mjs`

---

## 3. Test Category B — Per-Runtime Headless Integration Tests

### 3.1 PI Headless Tests

**File**: `tests/headless-pi.test.mjs`

Uses the same `run()` helper pattern as `runtime-core-integration.test.mjs` — spawns `meta-agents-harness.mjs` via `spawnSync`, captures stdout/stderr to temp files.

```js
// Test 1: mah run --runtime pi --headless "echo test" exits 0
test("pi headless: simple echo exits 0", () => {
  const result = run(["--runtime", "pi", "run", "--headless", "echo test"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /test/)
})

// Test 2: mah run --runtime pi --headless "echo test" --output=json
test("pi headless: json output envelope", () => {
  const result = run(["--runtime", "pi", "run", "--headless", "echo test", "--output=json"])
  assert.equal(result.status, 0, result.stderr)
  const envelope = JSON.parse(result.stdout)
  assert.equal(envelope.status, 0)
  assert.ok(typeof envelope.stdout === "string")
  assert.ok(typeof envelope.stderr === "string")
  assert.ok(envelope.runtime, "pi")
})

// Test 3: mah explain run --runtime pi --headless shows correct exec/args
test("pi headless explain: shows pi run command", () => {
  const result = run(["--runtime", "pi", "explain", "run", "--headless", "--trace", "echo test"])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.mode, "headless")
  assert.equal(payload.exec, "pi")
  assert.ok(payload.execArgs.includes("run"))
})

// Test 4: pi headless without task returns error
test("pi headless: no task returns error", () => {
  const result = run(["--runtime", "pi", "run", "--headless"])
  // Should either exit non-0 or return error envelope
  if (result.status === 0) {
    const envelope = JSON.parse(result.stdout)
    assert.ok(envelope.error || envelope.status !== 0)
  } else {
    assert.notEqual(result.status, 0)
  }
})

// Test 5: pi headless passes PI_MULTI_HEADLESS=1
test("pi headless: verify PI_MULTI_HEADLESS env propagation", () => {
  const result = run(["--runtime", "pi", "explain", "run", "--headless", "--trace", "echo test"])
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.env.PI_MULTI_HEADLESS, "1")
})

// Test 6: pi headless with extensions preserved
test("pi headless: extensions are passed through", () => {
  const result = run(["--runtime", "pi", "explain", "run", "--headless", "--trace", "echo test"])
  const payload = JSON.parse(result.stdout)
  assert.ok(payload.execArgs.some(arg => arg === "-e"))
})

// Test 7: unsupported runtime returns error
test("unsupported runtime returns clear error", () => {
  const result = run(["--runtime", "nonexistent", "run", "--headless", "echo test"])
  assert.notEqual(result.status, 0)
})

// Test 8: pi headless with empty task string handled
test("pi headless: empty task handled gracefully", () => {
  const result = run(["--runtime", "pi", "run", "--headless", ""])
  assert.notEqual(result.status, 0)
})
```

### 3.2 Claude Headless Tests

**File**: `tests/headless-claude.test.mjs`

```js
// Test 1: mah run --runtime claude --headless "echo test" exits 0 (or acceptable error if no claude binary)
// Pattern: skip test if claude binary not available

// Test 2: --print --no-session-persistence flags present in explain
test("claude headless explain: --print --no-session-persistence in args", () => {
  const result = run(["--runtime", "claude", "explain", "run", "--headless", "--trace", "echo test"])
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.mode, "headless")
  assert.ok(payload.execArgs.includes("--print"))
  assert.ok(payload.execArgs.includes("--no-session-persistence"))
})

// Test 3: CLAUDE_HEADLESS=1 env var set
test("claude headless: CLAUDE_HEADLESS env set", () => {
  const result = run(["--runtime", "claude", "explain", "run", "--headless", "--trace", "echo test"])
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.env.CLAUDE_HEADLESS, "1")
})

// Test 4: json envelope correct shape
test("claude headless: json envelope schema", () => {
  const result = run(["--runtime", "claude", "run", "--headless", "echo test", "--output", "json"])
  if (result.status === 0 || result.stderr.includes("claude")) {
    const envelope = JSON.parse(result.stdout)
    assert.ok(typeof envelope.status === "number")
    assert.ok(typeof envelope.stdout === "string")
    assert.ok(typeof envelope.stderr === "string")
  }
})
// ... 4-5 more tests following PI pattern
```

### 3.3 OpenCode Headless Tests

**File**: `tests/headless-opencode.test.mjs`

```js
// Test 1: mah run --runtime opencode --headless "echo test" explain shows correct exec
test("opencode headless explain: opencode exec with task passthrough", () => {
  const result = run(["--runtime", "opencode", "explain", "run", "--headless", "--trace", "echo test"])
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.mode, "headless")
  assert.equal(payload.exec, "opencode")
})

// Test 2: OPENCODE_HEADLESS=1 env var
test("opencode headless: OPENCODE_HEADLESS env set", () => {
  const result = run(["--runtime", "opencode", "explain", "run", "--headless", "--trace", "echo test"])
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.env.OPENCODE_HEADLESS, "1")
})
// ... 6 more tests following PI pattern
```

### 3.4 Hermes Headless Tests

**File**: `tests/headless-hermes.test.mjs`

Hermes is special because it **requires a session**. Tests must handle both the session-present and session-missing cases.

```js
// Test 1: hermes headless without session returns clear error
test("hermes headless: no session returns error", () => {
  const result = run(["--runtime", "hermes", "run", "--headless", "echo test"])
  // Should return { ok: false, error: "Hermes headless requires an active session..." }
  assert.notEqual(result.status, 0)
  if (result.status === 0) {
    // JSON envelope mode
    const envelope = JSON.parse(result.stdout)
    assert.ok(envelope.error || envelope.status !== 0)
    assert.match(result.stdout + result.stderr, /session/i)
  }
})

// Test 2: hermes headless with HERMES_SESSION_ID env: explain shows correct exec
test("hermes headless: with session env, shows hermes chat", () => {
  const result = run([
    "--runtime", "hermes", "explain", "run", "--headless", "--trace", "echo test",
    "--env", "HERMES_SESSION_ID=test-session-123"
  ])
  // Note: --env is hypothetical; if not supported, set env in spawnSync
  assert.equal(result.status, 0, result.stderr)
})

// Test 3: hermes headless with session: correct args
test("hermes headless: chat mode with session", () => {
  const result = run(["--runtime", "hermes", "explain", "run", "--headless", "--trace", "echo test"], {
    env: { ...process.env, HERMES_SESSION_ID: "test-session-123" }
  })
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.exec, "hermes")
  assert.ok(payload.execArgs.includes("chat"))
})

// Test 4: hermes headless explain: -c flag present when session provided
test("hermes headless: -c flag in passthrough with session", () => {
  const result = run(["--runtime", "hermes", "explain", "run", "--headless", "--trace", "echo test"], {
    env: { ...process.env, HERMES_SESSION_ID: "test-session-123" }
  })
  const payload = JSON.parse(result.stdout)
  assert.ok(payload.passthrough.includes("-c"))
})

// Test 5: HERMES_HEADLESS=1 env var
test("hermes headless: HERMES_HEADLESS env set", () => {
  const result = run(["--runtime", "hermes", "explain", "run", "--headless", "--trace", "echo test"], {
    env: { ...process.env, HERMES_SESSION_ID: "test-session-123" }
  })
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.env.HERMES_HEADLESS, "1")
})
// ... 5 more tests
```

### 3.5 Codex Headless Tests

**File**: `tests/headless-codex.test.mjs`

Codex is the most complex because it uses `exec --full-auto` + `initial_messages` via `-c` MCP config.

```js
// Test 1: codex headless explain: exec --full-auto in args
test("codex headless explain: exec --full-auto present", () => {
  const result = run(["--runtime", "codex", "explain", "run", "--headless", "--trace", "echo test"])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.mode, "headless")
  assert.ok(payload.execArgs.includes("exec"))
  assert.ok(payload.execArgs.includes("--full-auto"))
})

// Test 2: initial_messages in args
test("codex headless explain: initial_messages present", () => {
  const result = run(["--runtime", "codex", "explain", "run", "--headless", "--trace", "echo test"])
  const payload = JSON.parse(result.stdout)
  assert.ok(payload.execArgs.join(" ").includes("initial_messages="))
})

// Test 3: mcp_servers.mah config present
test("codex headless explain: mcp_servers.mah config present", () => {
  const result = run(["--runtime", "codex", "explain", "run", "--headless", "--trace", "echo test"])
  const payload = JSON.parse(result.stdout)
  assert.ok(payload.execArgs.join(" ").includes("mcp_servers.mah="))
})

// Test 4: MAH_CODEX_AUTONOMOUS=1 env var
test("codex headless: MAH_CODEX_AUTONOMOUS env set", () => {
  const result = run(["--runtime", "codex", "explain", "run", "--headless", "--trace", "echo test"])
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.env.MAH_CODEX_AUTONOMOUS, "1")
})

// Test 5: task passed to --full-auto
test("codex headless explain: task passed to exec --full-auto", () => {
  const result = run(["--runtime", "codex", "explain", "run", "--headless", "--trace", "implement feature x"])
  const payload = JSON.parse(result.stdout)
  const argsStr = payload.execArgs.join(" ")
  assert.ok(argsStr.includes("implement feature x"))
})

// Test 6: json envelope correct shape
test("codex headless: json envelope schema", () => {
  const result = run(["--runtime", "codex", "run", "--headless", "echo test", "--output", "json"])
  const envelope = JSON.parse(result.stdout)
  assert.ok(typeof envelope.status === "number")
  assert.ok(typeof envelope.stdout === "string")
  assert.ok(typeof envelope.stderr === "string")
})
// ... 6 more tests
```

---

## 4. Test Category C — CLI Flag and Help Tests

### Tests to add to `tests/smoke.test.mjs`

```js
// New test: --headless flag appears in help
test("--headless flag appears in help output", () => {
  const result = run(["--help"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /--headless/)
})

// New test: --output flag appears in help
test("--output flag appears in help output", () => {
  const result = run(["--help"])
  assert.match(result.stdout, /--output/)
})
```

### Tests to add to `tests/diagnostics-json.test.mjs`

```js
// New test: explain run --headless --json follows diagnostics schema
test("explain run --headless --json follows diagnostics schema", () => {
  const result = run(["--runtime", "pi", "explain", "run", "--headless", "--json", "echo test"])
  assert.equal(result.json.schema, "mah.diagnostics.v1")
  assert.equal(result.json.command, "explain")
  assert.equal(result.json.data?.mode, "headless")
  assert.equal(result.json.data?.payload?.runtime, "pi")
})
```

---

## 5. Test Execution Patterns

### 5.1 Test Helper Functions

Each integration test file should use this helper, consistent with `runtime-core-integration.test.mjs`:

```js
function run(args, options = {}) {
  const env = { ...process.env, ...(options.env || {}) }
  delete env.NODE_OPTIONS
  delete env.NODE_TEST_CONTEXT
  delete env.NODE_V8_COVERAGE
  const outputDir = mkdtempSync(path.join(os.tmpdir(), "mah-headless-test-"))
  const stdoutPath = path.join(outputDir, "stdout.txt")
  const stderrPath = path.join(outputDir, "stderr.txt")
  const stdoutFd = openSync(stdoutPath, "w")
  const stderrFd = openSync(stderrPath, "w")
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", stdoutFd, stderrFd]
  })
  closeSync(stdoutFd)
  closeSync(stderrFd)
  return {
    status: result.status,
    stdout: existsSync(stdoutPath) ? readFileSync(stdoutPath, "utf-8") : "",
    stderr: existsSync(stderrPath) ? readFileSync(stderrPath, "utf-8") : ""
  }
}
```

### 5.2 Runtime Availability Handling

Some tests require the actual runtime binary to be present. Use a skip pattern:

```js
function runtimeAvailable(runtime) {
  const result = spawnSync("bash", ["-lc", `command -v ${runtime} >/dev/null 2>&1`], { encoding: "utf-8" })
  return result.status === 0
}

// In tests that require a runtime binary:
test("pi headless: actual execution", { skip: !runtimeAvailable("pi") }, () => {
  const result = run(["--runtime", "pi", "run", "--headless", "echo test"])
  assert.equal(result.status, 0, result.stderr)
})
```

### 5.3 Environment Variable Propagation in Tests

For Hermes tests that need `HERMES_SESSION_ID`:

```js
test("hermes headless with session", () => {
  const result = run(
    ["--runtime", "hermes", "explain", "run", "--headless", "--trace", "echo test"],
    { env: { ...process.env, HERMES_SESSION_ID: "test-session" } }
  )
  // assertions...
})
```

---

## 6. Execution Blockers

| Blocker | Severity | Workaround | Resolution Owner |
|---------|----------|------------|------------------|
| Runtime binaries not installed in CI | Medium | Use `{ skip: !runtimeAvailable("pi") }` pattern | backend-dev |
| Hermes session requirement needs active session setup | Low | Pre-create a test session in `beforeEach` | backend-dev |
| Codex MCP server path may differ across environments | Low | Use `path.join(repoRoot, "plugins", "mah", "mcp", "server.mjs")` | backend-dev |
| `hermes sessions new` may not be available in test environment | Medium | Mock session creation or test explain path only | backend-dev |

---

## 7. Pass/Fail Gate Criteria

Before Slice 4 is complete, all tests must pass in the following environments:

1. **Linux x64** with all runtime binaries available — all tests run, all pass
2. **Linux x64** with no runtime binaries — contract tests pass, integration tests are skipped gracefully
3. **`--headless` flag**: help text includes `--headless` and `--output` documentation

---

## 8. Test File Creation Order

1. `tests/headless-contract.test.mjs` — Foundation; validates all adapters
2. `tests/headless-pi.test.mjs` — Simplest runtime; first integration test
3. `tests/headless-claude.test.mjs` — Second simplest
4. `tests/headless-opencode.test.mjs` — Third simplest
5. `tests/headless-hermes.test.mjs` — Complex session handling
6. `tests/headless-codex.test.mjs` — Most complex; greenfield implementation
7. Smoke and diagnostics test additions

---

## 9. Coverage Gaps (Deferred)

| Gap | Why Deferred | Ticket |
|-----|---------------|--------|
| End-to-end session export/import tests | Session interop is Slice 5/6 | TBD |
| Headless output to file (`outputMode: "file"`) | Not in v0.6.0 scope | TBD |
| Concurrent headless execution | Not in v0.6.0 scope | TBD |
| Timeout handling for long-running headless tasks | Not in v0.6.0 scope | TBD |
| Signal handling (SIGINT, SIGTERM) during headless | Not in v0.6.0 scope | TBD |

---

## 10. Appendix: Test Naming Conventions

Follow the existing convention in the codebase:

```
test("<runtime> headless: <what is tested>", () => { ... })
test("<feature>: <what is tested>", { skip: condition }, () => { ... })
```

File naming: `headless-<runtime>.test.mjs`  
Contract test file: `headless-contract.test.mjs`
