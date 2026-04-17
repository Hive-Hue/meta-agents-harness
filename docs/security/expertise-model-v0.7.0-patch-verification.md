# Security Patch Verification: Expertise Model v0.7.0

## Status Table

| Original Finding | Status | Evidence |
|---|---:|---|
| Arbitrary file write via `recordEvidence()` expertise_id path join | FIXED | `scripts/expertise-evidence-store.mjs:16-18, 52-58, 136-160, 206-231, 273-301`; self-test rejects traversal IDs and accepts `dev:orchestrator`. |
| Path traversal in expertise lookup by ID | FIXED | `scripts/expertise-loader.mjs:22-24, 38-56, 67-85, 239-263`; self-test rejects traversal attempts and accepts normal IDs. |
| Arbitrary file write via `exportExpertiseToFile()` output path | FIXED | `scripts/expertise-export.mjs:29-43, 544-557`; self-test confirms safe path accepted and traversal blocked. |
| CLI `--output` and `--file` surfaces lack path safety controls | FIXED | `scripts/meta-agents-harness.mjs:211-237, 2669-2735, 2879-2881`; CLI self-test confirms safe path accepted and unsafe paths rejected. |
| Unbounded evidence loading can cause memory/CPU denial of service | FIXED | `scripts/expertise-evidence-store.mjs:16-18, 206-266`; file-count and file-size bounds implemented. |
| Registry/catalog build is recursively unbounded and trusts directory contents | FIXED | `scripts/expertise-loader.mjs:22-24, 67-85`; recursion depth, symlink skipping, and file-count limit implemented. |
| Trust tier is not enforced in routing, despite spec expectations | FIXED | `scripts/expertise-routing.mjs:74-76, 241-260, 335-371`; trust tier filter and mismatch penalty are active. |
| Lifecycle state transitions are not authorization-aware | FIXED | `scripts/expertise-lifecycle.mjs:139-192, 235-238, 319-357`; hard authorization enforcement now blocks unauthorized sensitive transitions, audit trail persists, and self-tests cover blocked attempts. |
| Confidence scoring is easily influenced by fabricated evidence records | FIXED | `scripts/expertise-confidence.mjs:48-145, 183-260`; provenance assessment adds trust caps, suspicious metrics detection, and self-tests verify manipulation scenarios. |
| Import validation accepts unknown fields with warnings only | FIXED | `scripts/expertise-export.mjs:277-280, 405-427, 567-620`; strict mode is now default, unknown fields are rejected by default, and `--lenient`/`strict:false` are explicit opt-outs. |

## Verdict

**APPROVED**

All 10 original findings are now verified as FIXED.

## Verification Details

### 1) `scripts/expertise-evidence-store.mjs`

- **Checked**: `sanitizeExpertiseId()` exists and enforces `^[a-z0-9._-]+:[a-z0-9._-]+$` with explicit rejection of `/`, `\`, and `..`.
- **Checked**: `recordEvidence()` calls `sanitizeExpertiseId()` before path creation, then verifies the resolved evidence directory stays under the configured evidence root. The default remains `.mah/expertise/evidence`, but tests can redirect via `MAH_EXPERTISE_EVIDENCE_ROOT`.
- **Checked**: `loadEvidenceFor()` and `computeMetrics()` also sanitize IDs before using them.
- **Checked**: `MAX_EVIDENCE_FILES = 10000` and `MAX_EVIDENCE_FILE_SIZE = 1MB` are enforced before JSON parsing.
- **Checked**: self-tests reject traversal IDs and accept `dev:orchestrator`.
- **Result**: fixed.

### 2) `scripts/expertise-loader.mjs`

- **Checked**: ID segments are validated with `ID_SEGMENT_REGEX = /^[a-z0-9._-]+$/`.
- **Checked**: `sanitizeIdSegment()` rejects path separators and `..`.
- **Checked**: candidate paths are resolved and compared against `catalogRoot`.
- **Checked**: recursion depth is capped at 5, symlinks are skipped, and file count is capped at 1000.
- **Checked**: self-test rejects traversal attempts such as `dev:../../etc` and `../:name`.
- **Result**: fixed.

### 3) `scripts/expertise-export.mjs`

- **Checked**: `validateExportPath()` resolves the user path against the repo root and rejects escapes.
- **Checked**: `exportExpertiseToFile()` validates the output path before writing.
- **Checked**: import validation now defaults to strict mode and rejects unknown fields unless lenient mode is explicitly requested.
- **Checked**: self-test confirms safe export paths work and `../../etc/passwd` is blocked.
- **Result**: fixed.

### 4) `scripts/meta-agents-harness.mjs`

- **Checked**: `validateCliPath()` exists and rejects absolute or parent-traversal paths outside the repository.
- **Checked**: `mah expertise export` and `mah expertise import` both call path validation before I/O.
- **Checked**: CLI self-test `selftest:cli-path` passes for safe paths and rejects unsafe paths.
- **Checked**: help/command flow now exposes `--lenient` for import while keeping strict behavior by default.
- **Result**: fixed.

### 5) `scripts/expertise-routing.mjs`

- **Checked**: `checkTrustTierFilter()` exists and is wired into scoring before match scoring.
- **Checked**: `TRUST_TIER_MISMATCH_PENALTY` is applied when the candidate is below the best trust tier in the candidate set.
- **Checked**: agents without a trust tier are treated as `untrusted`, preserving backward compatibility.
- **Checked**: routing self-test includes a trust-tier scenario and passes.
- **Result**: fixed.

### 6) `scripts/expertise-lifecycle.mjs`

- **Checked**: `isAuthorizedTransition()` exists and hard-blocks sensitive transitions without an authorized actor.
- **Checked**: sensitive transitions include `restricted→active` and `active→restricted`; the implementation also treats these as authorization-sensitive boundaries.
- **Checked**: non-sensitive transitions still work without actor context, with advisory warning only.
- **Checked**: `_transition_actor` and `_transition_at` are recorded in metadata for successful transitions with actor context.
- **Checked**: self-tests now cover unauthorized attempts that must fail, plus successful governance-authorized transition.
- **Result**: fixed.

### 7) `scripts/expertise-confidence.mjs`

- **Checked**: `assessProvenance()` exists and classifies metrics as `verified`, `unverified`, or `fabricated_risk`.
- **Checked**: `computeConfidence()` applies a 0.7 multiplier for unverified provenance and caps fabricated-risk confidence at 0.2.
- **Checked**: suspicious patterns such as evidence without invocation, suspiciously high success rates with low evidence, and perfect review with minimal evidence are detected.
- **Checked**: self-tests cover verified, unverified, fabricated-risk, and capped-confidence scenarios.
- **Checked**: legitimate metrics without provenance metadata still compute normally; they are only down-weighted when suspicious signals are present.
- **Result**: fixed.

### 8) `scripts/expertise-export.mjs` strict import default

- **Checked**: `validateImportPayload()` now defaults to strict mode via `options.strict !== false`.
- **Checked**: unknown fields are rejected by default, and the error message includes the field name.
- **Checked**: a lenient mode exists via `{ strict: false }`.
- **Checked**: `loadImportFile()` passes strict mode through by default.
- **Checked**: self-tests show default strict rejection and lenient acceptance.
- **Result**: fixed.

### 9) `scripts/meta-agents-harness.mjs` lenient flag

- **Checked**: `--lenient` is available in `mah expertise import` command handling.
- **Checked**: no flag means strict mode is used.
- **Checked**: help text reflects the new import usage and lenient opt-out.
- **Checked**: CLI validation still blocks unsafe import paths before file I/O.
- **Result**: fixed.

## Re-Verification (Residual Findings)

### 1) [MEDIUM] Lifecycle Authorization — Hard Enforcement
- **Previous Status**: PARTIAL
- **New Status**: FIXED
- **Verification**: `scripts/expertise-lifecycle.mjs:139-192` adds `isAuthorizedTransition(actor, fromState, toState)` and `transitionExpertise()` now pushes an error immediately for unauthorized sensitive transitions. The sensitive transition set includes `restricted:active` and `active:restricted`. The implementation then returns `ok: false` when errors are present. Audit metadata is added at `scripts/expertise-lifecycle.mjs:235-238`.
- **Self-Test Results**: PASS — `node scripts/expertise-lifecycle.mjs` reports `28 passed, 0 failed`; unauthorized sensitive transitions are blocked, non-admin actors are blocked, and governance actors succeed.
- **Bypass**: No bypass found in this re-verification. The only accepted actor values are role-based; fake actors without `admin`/`governance` role are rejected for sensitive transitions.
- **New Issues**: None.

### 2) [LOW] Confidence Provenance — Evidence Trust Mechanism
- **Previous Status**: NOT FIXED
- **New Status**: FIXED
- **Verification**: `scripts/expertise-confidence.mjs:48-97` adds `assessProvenance()`, and `computeConfidence()` at `scripts/expertise-confidence.mjs:137-145` applies trust caps based on provenance. The code detects suspicious metrics patterns and lowers scores accordingly.
- **Self-Test Results**: PASS — `node scripts/expertise-confidence.mjs` reports `=== All Self-Tests Passed ===`; verified, fabricated-risk, unverified, and capped-confidence scenarios all behave as expected.
- **Bypass**: No bypass found in the implementation reviewed. Legitimate metrics without provenance metadata still compute, but suspicious metrics are down-weighted.
- **New Issues**: None.

### 3) [LOW] Import Strict Mode — Default to Strict
- **Previous Status**: NOT FIXED
- **New Status**: FIXED
- **Verification**: `scripts/expertise-export.mjs:277-280` sets strict mode default-on with `const strict = options.strict !== false`. Unknown fields are promoted to errors in the strict branch at `scripts/expertise-export.mjs:405-427`. `loadImportFile()` preserves strict default at `scripts/expertise-export.mjs:567-620`. `scripts/meta-agents-harness.mjs:2667-2735` adds `--lenient` to import, and strict mode is used when the flag is absent.
- **Self-Test Results**: PASS — `node scripts/expertise-export.mjs` reports strict rejection by default, `--lenient`/`{ strict: false }` acceptance, and safe path validation passing.
- **Bypass**: No bypass found in normal CLI flow; permissive mode now requires explicit `--lenient` or `strict:false`.
- **New Issues**: None.

## New Issues

- None introduced by the final patches under review.

## Compatibility Check

- Normal expertise IDs such as `dev:backend-dev` are accepted.
- Safe export/import file paths work as expected.
- Routing still returns results for agents without explicit trust tier values.
- Lifecycle transitions still work when an actor is provided, and non-sensitive transitions remain backward-compatible when omitted.
- Evidence-store tests now run against temporary directories so `.mah/expertise/evidence` stays runtime-only and can be rebuilt from real task execution.
