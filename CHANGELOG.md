# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and Semantic Versioning is applied conservatively in pre-1.0 mode (`0.x`).

## [Unreleased]

### Added
- **Bootstrap CLI test suite** — 99 tests across 4 test files:
  - `tests/bootstrap/schema-validation.test.mjs` — 39 tests for schema structure, required fields, optional defaults, data types, reference integrity (SV-*, RF-*, OF-*, DT-*, RI-*).
  - `tests/bootstrap/edge-cases.test.mjs` — 23 tests for overwrite, merge, partial input, invalid input, file system edge cases (OB-*, MB-*, PI-*, II-*, FS-*).
  - `tests/bootstrap/fallback-flows.test.mjs` — 18 tests for AI mode fallback, project brief handling, runtime detection, tool availability (FF-*, PB-*, UR-*, RT-*).
  - `tests/bootstrap/ai-assisted.test.mjs` — 19 tests for AI-assisted mode, API key handling, timeout/failure, fallback behavior (AI-*).
- **Bootstrap CLI specification** — `specs/bootstrap-cli-test-specifications.md` defines 68 test cases across 5 categories with validation checklist and coverage matrix.
- **Bootstrap CLI improvements**:
  - `.env` loading — loads API keys from target directory's `.env` file before invoking AI runtime
  - `adapters` section — generated config now includes adapters with mapping rules
  - Interactive mission preservation — preserves user's custom mission when provided alongside brief
  - AI prompt updates — enhanced to require all schema sections (runtime_detection, runtimes, catalog, domain_profiles, adapters, crews)
- **bootstrap-config-architect skill** — updated with full schema reference including wildcard domain rules and adapter configuration; copied to all runtimes (pi, claude, opencode, hermes)
- **`/compact` slash command** — new session compaction command in pi multi-team extension:
  - Usage: `/compact [--keep N] [--tokens N] [--dry-run]`
  - Removes old conversation turns to reduce token count
  - Reports token reduction percentage
  - Logs compaction events to events.jsonl
- **Agent Session Navigator fixes**:
  - Removed mouse tracking mode (DECSET 1000/1006) that blocked text selection — text selection now works
  - Mouse wheel still works via keyboard escape sequences (SGR and X10 modes)
  - Added error handling to Ctrl+X and Alt+O shortcuts to prevent crashes
- Hermes runtime support and adapter integration.
- Hermes-aware diagnostics and explainability coverage.
- Hermes documentation suite (`docs/hermes/`) with runtime support guide, session management, artifact structure, and quickstart.
- Hermes example configurations (`examples/hermes/`) with minimal and integration-ready config examples.
- Runtime-projected crew metadata foundation for mission, sprint mode, and agent sprint responsibilities.
- Normalized optional `crew_context` in dispatcher-facing diagnostics and explainability when crew sprint metadata is defined.
- Compact runtime instruction blocks derived from `crew_context` for generated prompts and runtime configs.
- 6-phase intelligent expertise enforcement pipeline in `multi-team.ts`:
  - Phase 1: Hard-cap note truncation at 2000 chars.
  - Phase 2: Cosine-similarity deduplication (threshold 0.55) with length-ratio guard — merges similar notes, keeps longer/newer version.
  - Phase 3: Stale entry eviction — `open_questions` older than 14 days are automatically removed.
  - Phase 4: Proactive compression — when approaching 80% budget, all notes >160 chars are compressed to ideal length.
  - Phase 5: Line-limit enforcement — evicts oldest entries from lowest-priority sections first.
  - Phase 6: Byte-size hard cap (32KB) as final safety net.
- New helper functions: `cosineSimilarityTokens`, `notesAreSimilar`, `daysBetweenDates`, `isNoteStale`, `compressNote`, `deduplicateAndMerge`, `evictStaleAndLowSignal`, `compressAllNotes`.
- Pre-injection guard in `loadPromptBundle()` — skips oversized expertise files (>24KB / >500 lines) with diagnostic message and auto-fix attempt.
- `expertise_enforcement` event logging when dedup, eviction, or compression occurs during saves.
- New constants: `EXPERTISE_IDEAL_NOTE_CHARS` (160), `EXPERTISE_DECAY_AFTER_DAYS` (14), `EXPERTISE_SIMILARITY_THRESHOLD` (0.55).
- **Wildcard domain rules** — `path: ./*`, `path: specs/*`, `path: bin/*` etc. expand recursively at config load time and continue matching new files at runtime without restart.
- `recursive` field on `DomainRule` and `NormalizedDomainRule` interfaces for explicit recursive matching.
- `expandDomainRules()` — expands glob patterns against the filesystem at config load, keeps the original glob as a runtime matcher for files created later.
- `expandGlobPatterns()` — walks filesystem with depth limit 10 to collect matching entries.
- `matchingDomainRule()` updated with descendant-of check for recursive rules.
- `shared_output` domain profile for cross-team data sharing (read-all + `plan/` write access).
- **`mah run --session-mode none`** — ephemeral session mode per runtime:
  - pi: maps to `--no-session`.
  - claude: maps to `--print --no-session-persistence` (non-interactive).
  - opencode: not supported, warning emitted.
  - hermes: not supported, warning emitted.
  - Conflicting flags (`--session-id`, `--session-root`, `--session-mirror`) are ignored with warnings when `--session-mode none` is set.
  - `sessionModeNone` capability flag added to all runtime adapters.
- **Artifact reference system** — delegation results are persisted as session artifacts; only compact references flow through prompts instead of raw output:
  - `ArtifactRef` interface: `{ path, hash, summary, bytes }`.
  - `contentHash(text)` — SHA256 first 12 hex chars for integrity checks.
  - `buildArtifactRef(path, output)` — creates a typed artifact reference.
  - `formatArtifactRef(ref)` — renders as `[artifact] path (hash=xxx, NNNB) — summary`.
  - `buildDelegationResultContent(target, status, elapsed, output, artifactPath, header)` — produces inline output for small results (<600B) or ref-only for large results.
  - `ARTIFACT_REF_INLINE_THRESHOLD` constant (600 chars) controls inline vs ref-only behavior.
  - `dispatchChild` now returns `artifactPath` alongside `output` and `exitCode`.

### Changed
- **Expertise model skill (`SKILL.md`) completely rewritten** across all 4 runtimes (`.pi`, `.claude`, `.hermes`, `.opencode`) with:
  - High-signal note writing guidance: `<subject> — <constraint>` pattern with 4 good and 4 bad examples.
  - Category guide table mapping all 8 standard categories to their purpose.
  - Compactness rules (40-120 chars ideal, one insight per note, lead with subject).
  - Revise-before-append guidance (contradicted/refined/confirmed/related decision branches).
  - Signals worth vs not worth capturing with concrete examples.
  - Runtime-specific adaptations (Claude: call shape JSON + `expertise_path` handling; OpenCode: `update-expertise-model` tool name + opencode-specific examples).
- Canonical config and runtime projection extended with bounded Hermes compatibility.
- Runtime portfolio expanded (PI, Claude, OpenCode, Hermes) while preserving runtime-agnostic orchestration model.
- Runtime artifacts now surface selected crew/agent planning metadata from `meta-agents.yaml` for effective downstream use.
- Crew planning metadata is now formally recognized by config validation instead of existing only as passthrough metadata.
- README updated with Hermes runtime support information and examples.
- Runtime command resolution now prefers actually usable variants instead of selecting wrappers only by executable name presence.
- Multi-team session artifacts now redact common secret material and keep delegation artifacts bounded for reviewability.
- Hermes wrapper now bootstraps orchestrator context on fresh runs and pins orchestration session IDs per active crew.
- Hermes continue/session-id handling now prefers explicit `--resume` against the pinned orchestration session to avoid drifting into unrelated Hermes threads.
- Hermes and README documentation were aligned to the real wrapper behavior, including bounded support for `session-root` and wrapper-only crew commands.
- `enforceExpertiseLineLimit()` now returns `{ doc, stats }` with dedup/evict/compress counts for observability.
- `saveExpertiseDocument()` logs enforcement stats as `expertise_enforcement` events.
- OpenCode `update-expertise-model` tool updated with deduplication, stale eviction (14-day decay), and 32KB byte cap matching the pi runtime.
- All 10 domain blocks in `multi-team.yaml` rewritten from verbose per-path entries (3 fields each) to wildcard patterns — **365 lines removed (27% reduction)**.
- Domain profiles in `meta-agents.yaml` rewritten to use `/*` wildcard syntax — sync propagates to all 12 runtime configs via `npm run sync:meta`.
- `delete: false` lines removed from domain rules — the field defaults to `false` when omitted, reducing noise.
- `sync-meta-agents.mjs` `domainFromProfile()` now detects `/*` suffix and adds `recursive: true` to generated rules.
- `domain_profile` field in `meta-agents.yaml` agent definitions now accepts an array of profile names to stack/concatenate domain rules.
- `effectiveDomain()` in `multi-team.ts` iterates array profiles and merges rules from all listed profiles.
- **Delegation output flow redesigned** from raw-text relay to artifact reference protocol:
  - `buildDelegationPrompt()` now instructs leads to forward `[artifact]` refs verbatim instead of relaying or summarizing worker output.
  - `delegate_agent execute()` uses `buildDelegationResultContent()` — small outputs inlined, large outputs become refs.
  - `delegate_agents_parallel execute()` same treatment — removed the 4000-char per-result truncation that was dropping data.
  - Response format changed from `"Return: 1. Outcome 2. Files changed 3. Verification 4. Risks"` to `"1. Outcome (one sentence) 2. Files changed 3. Artifact references 4. Risks"`.

### Fixed
- **Critical: Expertise file corruption causing context window exhaustion.** Engineering-lead expertise file grew to 1.7MB (from accumulated observation notes containing full tool output). This exceeded the model context window on every delegation, causing `model_context_window_exceeded` before any output was generated — the root cause of the "leads return empty content" failure mode.
- **Root cause chain:** `max-lines: 10000` in crew configs disabled line-limit enforcement → LLM sent massive notes via `update_expertise_model` → `yamlScalar` escaping doubled size with `\` → 1.7MB file → `loadPromptBundle` injected entire file into system prompt → model returned zero tokens.
- `max-lines: 10000` replaced with `max-lines: 120` across all 9 `multi-team.yaml` crew configs (`.pi`, `.hermes`, `.claude` for `bootstrap-config`, `dev`, `marketing`).
- `max_lines: 10000` replaced with `max_lines: 120` across all 30 agent prompt `.md` frontmatters (`dev/agents/*`).
- All 113 expertise files across all crews and runtimes reset to clean default state.
- 5 corrupted expertise files (orchestrator, engineering-lead, cli-dev across `.pi` and `.hermes`) that exceeded 10KB were identified and reset.
- Hermes wrapper argument parsing no longer misreads short flags like `-c` as crew IDs.
- Expertise model file resolution is now anchored to repository root instead of current working directory, preventing nested `.pi/crew/*/.pi/...` artifact duplication.
- Accidental nested `.pi` runtime artifacts were removed from `dev` and `marketing` crews.
- **Critical: Worker output never propagates to orchestrator.** Leads summarized worker output instead of relaying verbatim; orchestrator only saw "Successfully delegated... completed in X seconds" — not raw findings, analysis, or tool output.
- **Root cause chain:** `buildDelegationPrompt()` gave leads no structured protocol for output forwarding → leads summarized or discarded worker output → orchestrator received only completion status → session produced 74 delegations, 51 artifacts, 0 productive output in 24 minutes.
- Removed 12000-char truncation on delegation result output in `delegate_agent execute()` — full output now passes through to artifact layer.
- **Critical: `--tools` flag only passed for workers.** Line ~2580 had `if (child.role === "worker" && spawnTools.length > 0)` — leads never got `read/grep/find/ls` even though `SAFE_LEAD_TOOLS` defined them.
- Removed the `child.role === "worker"` guard so all spawned roles receive their configured tools.
- **Critical: Guardrail path resolution used wrong base directory.** `extractPathLikeTokens` resolved relative paths against `config.baseDir` (`.pi/crew/bootstrap-config/`) instead of `config.repoRoot`.
- Changed `resolve(config.baseDir, token)` → `resolve(config.repoRoot, token)` in `protectWorkerPaths()` so guardrails correctly validate paths like `specs/`, `plan/`, `package.json`.
- Worker domain configs missing access to `specs/`, `plan/`, `package.json` — workers could not read the spec file or project metadata needed for their tasks.
- Added missing read paths to `cli-dev`, `runtime-dev`, `docs-reviewer`, `ux-researcher`, and `schema-planner` domain rules in `multi-team.yaml`.
- **Critical: Wildcard expansion blew up context window.** `expandGlobPatterns()` materialized every matching file as a separate `NormalizedDomainRule`. `domainRulesSummary()` then injected all 1,869 expanded rules into the prompt — 155 KB for orchestrator, ~468 KB for leads — exhausting the context window before any tool call.
- Split prompt display from guardrail enforcement: `domainRulesSummary()` now shows original glob patterns (e.g., `./*`) instead of expanded per-file entries. `normalizeDomainRules()` still expands for runtime guardrail checks. Prompt domain section reduced from ~468 KB to <1 KB.
- **Critical: `delegate_agents_parallel` truncated each result to 4000 chars.** The `content` sent to the model cut off worker output, losing data. Replaced with the same `buildDelegationResultContent()` artifact-ref system used by `delegate_agent`.
- `update_expertise_model` tool registration had missing closing braces (`};` and `},`) for the `return {}` and `execute()` blocks — caused a preexisting brace imbalance (`-1`) in `multi-team.ts`. Fixed.
- **Orchestrator and lead agents had no read/grep/find/ls tools.** `runtimeTools()` in `sync-meta-agents.mjs` hardcoded orchestrators and leads to only delegation + MCP tools. Root orchestrator (not spawned as child) could not read files, search code, or inspect artifacts.
- Added `read`, `grep`, `find`, `ls` to orchestrator and lead toolsets in `runtimeTools()`. Now propagates to all agent prompt frontmatters via `npm run sync:meta`.
- Redundant read-only domain entries removed from `meta-agents.yaml` profiles: `read_only_repo`, `planning_delivery`, and `validation_runtime` had entries that only duplicated the base `path: . read: true` scope.

### Notes
- Hermes support is substantial but intentionally bounded.
- MAH remains an orchestration layer, not a Hermes fork.
- Continue with conservative pre-1.0 SemVer (`0.x`) and disciplined minor releases.
- Expertise model corruption was the single largest reliability risk in the delegation chain. The 6-phase enforcement pipeline + absolute caps + pre-injection guard should prevent recurrence regardless of model behavior.
- Session post-mortem documented in `plan/session-2026-04-07-runtime-analysis.md`.
- Wildcard expansion is filesystem-dependent at load time — new directories created before crew start are included automatically.
- The `/*` suffix is the only supported wildcard form; `**`, `?`, and bracket patterns are not implemented.
- Artifact reference system applies only to the PI runtime (the only runtime that loads `extensions/multi-team.ts`). Claude, OpenCode, and Hermes configs do not use glob expansion and are unaffected.
- `domainRulesSummary()` is PI-only code — other runtimes use static YAML without programmatic expansion, so the wildcard blowup fix does not apply to them.
- Estimated impact: the same "read a spec file" task that took 74 delegations in 24 minutes should now complete in 2-3 delegations in ~2 minutes.
- `path: .` with `read: true` covers the entire repo recursively via prefix matching — additional entries that only add `read` (or `read` + `bash` when `.` already has `bash`) are redundant.
- `--session-mode none` for claude forces `--print` mode which is non-interactive; for true interactive ephemeral sessions, use the pi runtime.

## [0.3.0] - 2026-04-05

### Added
- Mermaid architecture output for `mah graph` with selectable detail levels:
  - `--mermaid-level basic`
  - `--mermaid-level group`
  - `--mermaid-level detailed`
- Optional capability rendering in detailed Mermaid view with:
  - `--mermaid-capabilities`
  - role-based skills/MCP blocks
  - visual legend and color classes.
- Structured diagnostics envelope `mah.diagnostics.v1` for key diagnostic commands (`detect`, `doctor`, `validate*`, `plan`, `diff`, `explain`).
- New documentation for stabilization and operational boundaries:
  - `docs/validate-semantics.md`
  - `docs/runtime-boundary.md`
  - `docs/platform-capabilities.md`.
- Expertise Model foundation documentation:
  - `docs/expertise-model-foundation.md`.
- Additional diagnostics/platform reliability tests and CI coverage (`test:diagnostics`).

### Changed
- Terminology renamed across the project:
  - `mental model` -> `expertise model`
  - `update mental model` -> `update expertise model`.
- Related paths, skill references, runtime tool names, scripts, and generated artifacts were updated to match the new naming.
- Mermaid detailed layout refined for readability:
  - orchestrator kept in final tier block
  - delegation-only arrows (`can delegate`)
  - capabilities presented as low-level contextual blocks.
- `mah graph` capabilities now read MCP servers from local configuration (`.mcp.json` with fallback to `.mcp.example.json`) instead of fixed static values.
- Provenance retention/rotation behavior introduced with configurable limits:
  - `MAH_PROVENANCE_MAX_LINES`
  - `MAH_PROVENANCE_MAX_DAYS`.

### Fixed
- Graph JSON/Mermaid command behavior normalized for CLI flags and output consistency.
- Deterministic sync action reporting improved for create/update/no-change/applied flows.

### Notes
- This release continues the pre-1.0 stabilization path and should be treated as hardening, not final API stability.
- Runtime adapter contract and platform features remain under incremental maturation in `0.x`.
- Expertise Model is consolidated as a foundation concept in this release; orchestration intelligence capabilities are deferred.

## [0.2.0] - 2026-04-04

### Added
- Expanded layered validation workflows (`validate:config`, `validate:runtime`, `validate:sync`, `validate:all`).
- Runtime adapter foundation and runtime contract checks.
- Initial platform capabilities (`sessions`, provenance trail, graph, demo).

### Changed
- Improved operator diagnostics and explainability workflows.
- Improved plan/diff workflow for sync preparation reporting.
- CI validation expanded with smoke, contract, config, sync, and runtime checks.

### Notes
- Product-grade foundation milestone in pre-1.0 phase (`0.x`).
- Runtime adapter model remains evolutive.
- Platform capabilities (`sessions`, provenance, graph, demo`) are initial support.
- Diagnostic structured output is expanded but still maturing in normalization.

## [0.1.0] - 2026-04-04

### Added
- Baseline unified CLI (`mah`) for PI, Claude Code, and OpenCode.
- Deterministic runtime detection precedence (forced, marker, executable).
- Canonical sync/check workflow for generated runtime artifacts.
- Baseline smoke test and CI validation pipeline.

### Notes
- Historical baseline release from `main`.
- Pre-1.0 maturity expectations apply.
