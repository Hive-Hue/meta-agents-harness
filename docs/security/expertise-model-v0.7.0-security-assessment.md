# Security Assessment: Expertise Model v0.7.0

> Historical note: this report describes the pre-fix assessment state. The current verified state is documented in [`docs/security/expertise-model-v0.7.0-patch-verification.md`](./expertise-model-v0.7.0-patch-verification.md).

## Summary

**Overall risk level: Alta**

The expertise model is directionally strong on schema validation and export redaction, but there are several high-impact file-system trust boundary issues and a few important policy/routing gaps. The largest risks are arbitrary path writes/reads through user-controlled IDs and output paths, plus unbounded evidence and catalog traversal that can be abused for denial of service.

## Findings

#### [CRITICAL] Arbitrary file write via `recordEvidence()` expertise_id path join
- **File**: `scripts/expertise/evidence/expertise-evidence-store.mjs`
- **Line**: ~87-100
- **Description**: `recordEvidence()` builds the evidence directory with `resolvePath('.mah/expertise/evidence/${expertise_id}')` and then writes a JSON file there without validating or normalizing `expertise_id`. A crafted value like `../../.ssh` or an absolute path component can escape the intended evidence store.
- **Impact**: Arbitrary file creation/overwrite within the process permissions. This can corrupt repository files, plant malicious JSON, or overwrite sensitive files if the runtime has write access.
- **PoC/Scenario**: A caller submits `expertise_id = '../../../docs/security/pwned'`; the function creates directories and writes evidence outside `.mah/expertise/evidence`.
- **Recommendation**: Validate `expertise_id` against a strict identifier regex (for example `^[a-z0-9._-]+:[a-z0-9._-]+$`), reject path separators and `..`, and resolve/verify the final path stays under the evidence root before writing.

#### [HIGH] Arbitrary file write via `exportExpertiseToFile()` output path
- **File**: `scripts/expertise/expertise-export.mjs`
- **Line**: ~500-525
- **Description**: `exportExpertiseToFile()` writes to `outputPath` directly after only extracting a parent directory with `substring()`. There is no check that the output path stays within a safe export directory.
- **Impact**: A user can write exported JSON to any writable path, including overwriting project files or dropping artifacts into locations that later get executed or committed.
- **PoC/Scenario**: `mah expertise export dev:backend-dev --output .github/workflows/ci.yml` writes attacker-controlled JSON into a workflow file path if the process has permission.
- **Recommendation**: Restrict export destinations to an allowlisted export directory, or require explicit confirmation for absolute/parent-traversal paths. Resolve the path and reject if it escapes the intended base.

#### [HIGH] Path traversal in expertise lookup by ID
- **File**: `scripts/expertise/expertise-loader.mjs`
- **Line**: ~155-186
- **Description**: `findExpertiseFileById()` splits an expertise ID on `:` and uses the second segment as a filename in `join(catalogRoot, crew, `${name}${ext}`)`. No sanitization prevents `../` or path separators in `crew` or `name`.
- **Impact**: An attacker can coerce the loader into probing and potentially loading files outside the catalog tree, depending on filesystem layout and matching IDs.
- **PoC/Scenario**: A malicious target like `dev:../../.mah/expertise/registry` causes the search to inspect paths outside the catalog root.
- **Recommendation**: Reject IDs containing `/`, `\`, `..`, or drive prefixes before path construction. Resolve the final candidate path and verify it is still under the catalog root.

#### [HIGH] CLI `--output` and `--file` surfaces lack path safety controls
- **File**: `scripts/meta-agents-harness.mjs`
- **Line**: ~2606-2670
- **Description**: The `mah expertise export` and `mah expertise import` command handlers accept raw file paths and pass them to file I/O helpers without canonical path checks or sandboxing.
- **Impact**: Combined with the lower-level helper behavior, users can read or write arbitrary repository or filesystem locations from CLI input.
- **PoC/Scenario**: `mah expertise import /etc/passwd` attempts to read sensitive local files; `mah expertise export dev:orchestrator --output ../../.git/hooks/post-commit` can write outside the project tree if permitted.
- **Recommendation**: Enforce a safe base directory for CLI file operations, canonicalize with `resolve()`, and reject paths that escape the repository or export/import sandbox.

#### [MEDIUM] Unbounded evidence loading can cause memory/CPU denial of service
- **File**: `scripts/expertise/evidence/expertise-evidence-store.mjs`
- **Line**: ~120-216
- **Description**: `loadEvidenceFor()` reads every JSON file in the evidence directory, parses them all into memory, and `computeMetrics()` then iterates the full set. There is no cap on file count, file size, or parse time.
- **Impact**: Large evidence directories can trigger high memory use, long blocking reads, and slow routing/CLI operations.
- **PoC/Scenario**: A single expertise folder with tens of thousands of evidence JSON files causes `mah expertise show` or `recommend` to stall or exhaust memory.
- **Recommendation**: Add bounded pagination/limits, file size caps, and streaming aggregation. Consider storing precomputed metrics and refusing to scan directories over a configured threshold.

#### [MEDIUM] Registry/catalog build is recursively unbounded and trusts directory contents
- **File**: `scripts/expertise/expertise-loader.mjs`
- **Line**: ~30-47, ~86-99; `scripts/expertise/expertise-registry.mjs` ~150-180
- **Description**: The catalog loader recursively walks every matching file under the catalog path and the registry builder materializes all entries in memory. There is no depth, entry-count, or symlink safeguard visible here.
- **Impact**: Large or malicious catalog trees can force expensive recursive traversal and registry generation. If symlinks are present, path surprises may arise depending on the environment.
- **PoC/Scenario**: A nested catalog with thousands of files or recursive directory structure causes `buildRegistry()` to consume significant time and memory.
- **Recommendation**: Limit recursion depth and total files processed, ignore symlinks unless explicitly needed, and introduce a cached incremental index rather than full rebuilds on every stale read.

#### [MEDIUM] Trust tier is not enforced in routing, despite spec expectations
- **File**: `scripts/expertise/expertise-routing.mjs`
- **Line**: ~170-260; `scripts/meta-agents-harness.mjs` ~1946-2074, ~2528-2582
- **Description**: The routing algorithm filters by `allowed_environments` and `validation_status`, but trust tier is only displayed and never used as a gating or scoring factor. The harness comments describe trust-tier awareness, but no actual trust-tier requirement is applied in scoring.
- **Impact**: Lower-trust expertise can be selected for tasks that should require stricter trust boundaries, weakening policy-based delegation.
- **PoC/Scenario**: A `federated` or otherwise sensitive expertise can outscore a safer internal expertise because the trust dimension is ignored.
- **Recommendation**: Add explicit trust-tier compatibility checks before scoring and/or a trust-tier penalty or threshold policy. Make the requirement part of the candidate filter, not just the UI.

#### [MEDIUM] Lifecycle state transitions are not authorization-aware
- **File**: `scripts/expertise/expertise-lifecycle.mjs`
- **Line**: ~137-188
- **Description**: `transitionExpertise()` validates state transitions and evidence requirements, but there is no authorization check or actor context. Any caller with access to the function can promote/restrict/deprecate expertise objects.
- **Impact**: A compromised caller or misused internal script can change lifecycle state without governance approval.
- **PoC/Scenario**: A utility script imports `transitionExpertise()` and transitions a restricted expertise back to active after meeting the numeric checks, regardless of who requested the change.
- **Recommendation**: Require an actor/authority context and enforce an authorization policy for sensitive transitions, especially `restricted -> active` and any promotion to `active`.

#### [LOW] Confidence scoring is easily influenced by fabricated evidence records
- **File**: `scripts/expertise/expertise-confidence.mjs`
- **Line**: ~35-90
- **Description**: `computeConfidence()` uses `successful_invocations`, `review_pass_rate`, and `rejection_rate` as direct inputs. If the evidence pipeline is polluted, the score can be artificially inflated or depressed.
- **Impact**: Confidence manipulation may bias routing toward untrusted expertise.
- **PoC/Scenario**: A malicious or buggy evidence recorder emits success-heavy metrics, causing the computed confidence band to rise despite poor real-world performance.
- **Recommendation**: Treat metrics as untrusted input, derive them from signed/verified evidence, and add sanity checks or provenance requirements before score computation.

#### [LOW] Import validation accepts unknown fields with warnings only
- **File**: `scripts/expertise/expertise-export.mjs`
- **Line**: ~249-360, ~401-490
- **Description**: `validateImportPayload()` warns on unknown fields instead of rejecting them. That is intentional for forward compatibility, but it means hostile payloads can smuggle extra data into downstream consumers that do not re-validate.
- **Impact**: Extra fields may survive import and later influence insecure consumers or logs.
- **PoC/Scenario**: An attacker imports a payload with a benign-looking core schema plus hidden extension fields that another tool later interprets unsafely.
- **Recommendation**: Keep the tolerant parser, but enforce strict field allowlists before any persistence or execution path, and document that downstream consumers must ignore unknown fields.

## False Positives / Intentional Behavior

- `checkExportPolicy()` blocking export when `federated_allowed === false` is **intentional** policy enforcement, not a bug.
- `validateImportPayload()` warning on `metadata.owner_id` is **intentional redaction behavior**; ownership is supposed to be reassigned by the importing organization.
- `transitionExpertise()` requiring reasons for `deprecated` and `restricted -> active` is **intentional governance**, not over-restriction.
- `scoreCandidates()` blocking `restricted` and `revoked` validation statuses is **correct policy filtering**.
- `exportExpertise()` redacting `owner_id` and non-allowlisted metadata is **intentional disclosure control**.

## Recommendations Summary

1. **Fix path traversal first**: sanitize `expertise_id`, `targetId`, and all CLI file paths; enforce canonical base-directory checks.
2. **Bound evidence and catalog scans**: add limits on file counts, sizes, recursion depth, and/or switch to incremental indexes.
3. **Add trust-tier routing enforcement**: make trust tier part of candidate eligibility and scoring.
4. **Add authorization to lifecycle transitions**: require actor context and governance checks.
5. **Harden confidence inputs**: ensure metrics derive from trusted evidence and add provenance validation.
6. **Document import/export trust boundaries**: clarify what is redacted, what is tolerated, and what downstream consumers must re-check.

## Notes

This assessment intentionally reviewed the listed expertise files as a system, because the main issues emerge at the boundaries between loader, registry, evidence store, CLI, and routing.

## Supplementary QA Review — No Additional Findings

The additional gap review covered `scripts/expertise/expertise-validate.mjs`, `types/expertise-types.mjs`, `scripts/expertise/evidence/expertise-evidence-store.mjs`, `scripts/expertise/expertise-routing.mjs`, `scripts/meta-agents-harness.mjs` (delegate path), and `scripts/expertise/expertise-loader.mjs`.

- **Schema validation depth**: `validateExpertise()` is not implemented in the files reviewed here; the CLI wrapper only forwards to `scripts/expertise/expertise-schema.mjs`. The exposed wrapper handles missing/optional fields by delegating validation, but no new bypass was identified in the reviewed wrapper file itself.
- **Race conditions**: `recordEvidence()` still uses a single `writeFileSync()` after `mkdirSync()` with no lock or atomic temp-file rename, so concurrent writers may race; this is already an inherent limitation of the current design and remains covered by the existing file-system risk findings.
- **Graceful degradation**: routing and `mah delegate` both catch scoring failures and fall back to policy-allowed targets or explicit targets where possible, so failure handling is intentionally best-effort rather than fail-closed.
- **YAML/JSON injection**: the loader uses `yaml.parse()` and `JSON.parse()` with warning-based error handling. No separate parser escape was identified in this review beyond the already noted unbounded parse/traversal concerns.

No additional reportable findings beyond the existing assessment were identified in these gap areas.
