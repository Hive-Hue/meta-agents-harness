# Hermes Runtime Validation Rules and Diagnostics Specification
## For v0.4.0 Meta Agents Harness

**Document type:** Technical specification — validation and diagnostics contract  
**Target release:** `v0.4.0`  
**Status:** Implementation-ready [done — Hermes-aware diagnostics tests added to tests/diagnostics-json.test.mjs; 9/9 tests pass]  
**Audience:** Engineering, Validation, QA  
**Complements:** `hermes-runtime-config-design.md`, `hermes-implementation-checklist.md`  
**Date:** 2026-04-05

---

## 1. Executive Summary

Defines complete validation rules, diagnostic behaviors, and test expectations for Hermes runtime support in v0.4.0. Covers three validation levels (config, runtime, sync), diagnostic JSON envelope integration, smoke/contract/diagnostic test cases, and exact expected outputs for every Hermes-aware command.

**Key principles:**
- Every Hermes validation rule follows existing three-level semantic ownership (D3)
- All diagnostic output conforms to `mah.diagnostics.v1` envelope
- Hermes participates in every `validate:*` command identically to pi/claude/opencode
- Honest failure: unsupported features surface explicit, actionable errors
- No new validation levels introduced
- No cross-level error ownership conflicts

---

## 2. Validation Architecture Recap

### 2.1 Three Semantic Levels (D3)

| Level | Owner | Scope |
|-------|-------|-------|
| `validate:config` | Schema and semantic config | schema, version, cross-refs |
| `validate:runtime` | Operational/environmental | adapter precheck, executable health |
| `validate:sync` | Materialization/drift | canonical vs generated artifacts |
| `validate:all` | Ordered composition | config → sync → runtime |

### 2.2 Diagnostic Envelope

All `--json` output uses `mah.diagnostics.v1`:
```json
{ "schema": "mah.diagnostics.v1", "command": "<cmd>", "ok": true|false, "status": 0|1, "runtime": "<rt>", "reason": "<why>", "data": {}, "errors": [] }
```

---

## 3. Config Validation Rules (validate:config)

### R-CFG-1: Runtime entry exists
Hermes MUST have an entry under `runtimes`:
```yaml
runtimes:
  hermes:
    wrapper: "hermesh"
    config_root: ".hermes"
    config_pattern: ".hermes/crew/<crew>/config.yaml"
```
**Validation:** Zod `z.record(z.string(), z.object({ wrapper: z.string().optional() }).passthrough())`

### R-CFG-2: Marker reference
`runtime_detection.marker.hermes: ".hermes"` MUST exist. Cross-ref checked by `validateCrossRefs()`.
**Failure:** `runtime_detection.marker references unknown runtime 'hermes'`

### R-CFG-3: CLI reference (optional)
`runtime_detection.cli.hermes` with `direct_cli` and `wrapper`. Schema-level optional.

### R-CFG-4: Source config consistency
If any crew has `source_configs.hermes`, hermes must exist in runtimes.

### R-CFG-5: Wrapper name consistency
`runtime_detection.cli.hermes.wrapper` SHOULD match `runtimes.hermes.wrapper`. Warning only in v0.4.0.

---

## 4. Runtime Validation Rules (validate:runtime)

### 4.1 Adapter Contract (11 required fields)

| Field | Hermes Value | Source |
|-------|-------------|--------|
| `name` | `"hermes"` | Declaration |
| `markerDir` | `".hermes"` | Declaration |
| `wrapper` | `"hermesh"` | Declaration |
| `directCli` | `"hermes"` | Declaration |
| `capabilities` | See §4.2 | Declaration |
| `commands` | See §4.3 | Declaration |
| `detect()` | auto | createAdapter() |
| `supports()` | auto | createAdapter() |
| `resolveCommandPlan()` | auto | createAdapter() |
| `validateRuntime()` | auto | createAdapter() |

### 4.2 Capabilities (from discovery)
```javascript
capabilities: {
  sessionModeNew: false,       // TBD
  sessionModeContinue: true,  // TBD
  sessionIdViaEnv: null,       // TBD
  sessionIdFlag: null,         // TBD
  sessionRootFlag: false,      // TBD
  sessionMirrorFlag: false     // TBD
}
```

**R-RT-3:** Capabilities MUST NOT claim unsupported features.

### 4.3 Required Commands (8)

| Command | Status | Notes |
|---------|--------|-------|
| `list:crews` | TBD | Discovery needed |
| `use` | TBD | Discovery needed |
| `clear` | TBD | Discovery needed |
| `run` | ✅ Always works | directCli fallback |
| `doctor` | TBD | Discovery needed |
| `check:runtime` | TBD | Discovery needed |
| `validate` | ✅ Alias | → check:runtime |
| `validate:runtime` | ✅ Alias | → check:runtime |

**R-RT-4:** Unsupported commands use empty array `[]` → honest error.
**R-RT-5:** `run` always falls back to `directCli` ("hermes") per dispatcher.

### 4.4 Precheck (6 checks)

| Check | Condition | Expected (no CLI) |
|-------|-----------|------------------|
| `marker_dir` | Boolean(markerDir) | ✅ true |
| `wrapper_declared` | Boolean(wrapper) | ✅ true |
| `direct_cli_declared` | Boolean(directCli) | ✅ true |
| `wrapper_available` | commandExists("hermesh") | ❌ false |
| `direct_cli_available` | commandExists("hermes") | ❌ false |
| `commands_declared` | keys.length > 0 | ✅ true |

**R-RT-6:** `_available` checks are non-fatal. Precheck passes even without binaries.
```javascript
const ok = checks.every((item) => item.ok || item.name.endsWith("_available"))
```

### 4.5 Two-Phase validate:runtime Flow

1. **Precheck:** `runtimeValidationReport("hermes")` → passes if adapter configured correctly
2. **Health dispatch:** `dispatchCapture("hermes", "check:runtime", [])` → fails if no binary

---

## 5. Sync Validation Rules (validate:sync)

### Current Architecture
`sync-meta-agents.mjs` hardcodes pi/claude/opencode in main loop. PI also gets `syncPiPrompts()`, OpenCode gets `ensureOpencodeArtifacts()`.

### Options for Hermes

**Option A (full):** Add hermes to sync loop with `buildRuntimeCrewDoc(meta, crew, "hermes")`. Requires deterministic Hermes config format.

**Option B (skip, recommended for v0.4.0):** Skip Hermes projection. `validate:sync` still passes (no Hermes artifacts to check).

**Option C (partial):** Generate only viable artifacts.

### R-SYNC-1: No regression
Existing pi/claude/opencode sync must not break.

### R-SYNC-2: Mode support
All modes: `--check` (exit 0/1), `--plan` (exit 0), `--diff` (exit 0), sync (exit 0).

### R-SYNC-3: JSON format
Records follow existing `{ mode, ok, totals, records }` shape.

### R-SYNC-4: No Hermes artifacts = no failure
Missing Hermes projection must not fail sync validation.

---

## 6. Diagnostic Test Cases

### 6.1 Smoke Tests (tests/smoke.test.mjs)

**TC-SM-1:** Forced Hermes detection
```javascript
test("forced Hermes runtime detection works", () => {
  const result = run(["--runtime", "hermes", "detect"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /runtime=hermes/)
  assert.match(result.stdout, /reason=forced/)
})
```

**TC-SM-2:** Help includes Hermes (auto-passes via `Object.keys`)

**TC-SM-3:** Update existing detect regex: `/runtime=(pi|claude|opencode|hermes)/`

### 6.2 Contract Tests (tests/runtime-contract.test.mjs)

**TC-CT-1:** Auto-covers Hermes (existing test iterates ALL adapters). No change needed.

**TC-CT-2 (optional):** Hermes-specific assertions for required commands and name match.

### 6.3 Diagnostics JSON Tests (tests/diagnostics-json.test.mjs)

**TC-DIAG-1:** `detect --json --runtime hermes` → schema, command, runtime, reason, ok, status

**TC-DIAG-2:** `doctor --json --runtime hermes` → precheck.ok === true even without CLI

**TC-DIAG-3:** `explain detect --json --runtime hermes` → data.payload.runtime === "hermes"

**TC-DIAG-4:** `validate:runtime --json --runtime hermes` → precheck checks array with marker_dir, wrapper_declared, direct_cli_declared

### 6.4 Command Tests

**TC-CMD-1:** Unsupported command → status 1, stderr matches `/not supported|no executable/i`

**TC-CMD-2:** `mah run --runtime hermes` → falls back to directCli "hermes"

**TC-CMD-3:** `mah explain run --json --runtime hermes` → exec === "hermes"

---

## 7. validate:* Integration

| Command | Code Change | Hermes Behavior |
|---------|-------------|----------------|
| `validate:config` | None | Dynamic cross-refs |
| `validate:runtime` | None | Precheck + dispatch |
| `validate:sync` | Sync loop (Option A/B) | Skip or check drift |
| `validate:all` | None | Composed: config→sync→runtime |
| `validate` (bare) | None | Config then runtime |
| `doctor` | None | Runtime name + health |

---

## 8. Dispatcher Integration

### D1: normalizeRunArgs() — REQUIRED
New branch: `else if (runtime === "hermes") { ... }` with capabilities-based session flag normalization.

**R-DISP-1:** Hermes logic MUST NOT appear elsewhere in dispatcher.
**Check:** `grep -n "hermes" scripts/meta-agents-harness.mjs` → only normalizeRunArgs match.

### D2: printHelp() — AUTO-UPDATED (Object.keys)
### D3: Error messages — AUTO-UPDATED (RUNTIME_ORDER.join)
### D4: RUNTIME_ORDER — REQUIRED (append "hermes")

---

## 9. Expected Outputs Reference

### mah detect --runtime hermes
Terminal: `runtime=hermes\nreason=forced`

### mah validate:runtime --json --runtime hermes (no CLI)
```json
{
  "schema": "mah.diagnostics.v1",
  "command": "validate:runtime",
  "ok": false, "status": 1,
  "runtime": "hermes", "reason": "forced",
  "data": {
    "precheck": { "ok": true, "checks": [
      {"name":"marker_dir","ok":true}, {"name":"wrapper_declared","ok":true},
      {"name":"direct_cli_declared","ok":true}, {"name":"wrapper_available","ok":false},
      {"name":"direct_cli_available","ok":false}, {"name":"commands_declared","ok":true}
    ]},
    "stdout": "", "stderr": "ERROR: no executable available for check:runtime (hermesh: not found, hermes: not found)"
  },
  "errors": ["runtime-validation-failed"]
}
```

### mah validate:all --json --runtime hermes (no CLI)
```json
{
  "schema": "mah.diagnostics.v1",
  "command": "validate:all",
  "ok": false, "status": 1,
  "runtime": "hermes", "reason": "forced",
  "data": {
    "checks": {
      "config": {"status":0,"stdout":"validate:config passed","stderr":""},
      "sync": {"status":0,"stdout":"meta sync check passed","stderr":"","report":null},
      "runtime": {"status":1,"stdout":"","stderr":"ERROR: no executable available..."}
    }
  },
  "errors": ["composed-validation-failed"]
}
```

### mah explain run --json --runtime hermes
```json
{
  "schema": "mah.diagnostics.v1",
  "command": "explain", "ok": true, "status": 0,
  "runtime": "hermes", "reason": "forced",
  "data": {
    "target": "run",
    "payload": {
      "runtime": "hermes", "reason": "forced", "command": "run",
      "exec": "hermes", "execArgs": [], "passthrough": [],
      "env": {}, "warnings": [], "candidates": []
    }
  },
  "errors": []
}
```

---

## 10. Regression Prevention

| Check | Expected |
|-------|----------|
| `mah detect` (multi-marker) | Prefers pi/claude/opencode over hermes |
| `mah --runtime pi detect` | Unaffected by Hermes |
| `npm run test:contract` | All 4 adapters pass |
| `npm run check:meta-sync` | Passes without Hermes artifacts |
| Hermes grep in dispatcher | Only normalizeRunArgs match |

---

## 11. Required Code Changes Summary

| File | Change |
|------|--------|
| `scripts/runtime-adapters.mjs` | RUNTIME_ORDER + hermes adapter |
| `scripts/meta-agents-harness.mjs` | normalizeRunArgs hermes branch |
| `meta-agents.yaml` | marker + cli + runtimes hermes entries |
| `tests/smoke.test.mjs` | Detect regex update |
| `tests/diagnostics-json.test.mjs` | Hermes diagnostic tests |
| `scripts/sync-meta-agents.mjs` | Hermes sync (Option A/B) |

**No changes needed:** runtime-adapter-contract.mjs, validate-meta-config.mjs, runtime-contract.test.mjs, package.json

---

## 12. Risks and Blockers

### 🔴 Blockers
1. Hermes CLI discovery incomplete (binary name, commands, session semantics)

### 🟡 Risks
2. normalizeRunArgs() coupling (existing tech debt)
3. Sync projection format unknown
4. Tests assume Hermes CLI not installed

### 🟢 Mitigations
5. Contract test auto-covers Hermes
6. Diagnostic envelope unchanged
7. All changes additive and reversible