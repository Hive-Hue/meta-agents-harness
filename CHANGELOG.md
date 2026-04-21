# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and Semantic Versioning is applied conservatively in pre-1.0 mode (`0.x`).

## [0.8.0] - 2026-04-21

### Added
- Global install support for the `mah`/`meta-agents-harness` CLI entrypoint
- Workspace-aware root resolution so a global `mah` command operates on the current repo instead of the package install directory
- `meta-agents-harness` packaging alias and install scripts for local/global usage
- `npm run stitch:secrets` to populate `GOOGLE_CLOUD_PROJECT` and `STITCH_ACCESS_TOKEN` directly in the target repo `.env` without overwriting the rest of the file
- Caveman skill suite (`caveman`, `caveman-commit`, `caveman-compress`, `caveman-help`, `caveman-review`) registered on all agents across all teams
- `.env.stitch` added to `.gitignore` to prevent credential leaks
- Regression test for YAML scalar round-trip backslash preservation

- **Expertise Integration (4-phase)** — seed→evidence→sync→governance pipeline connecting agent runtime learnings (System A) to structured catalog metadata (System B)
- `mah expertise seed` CLI command — generates populated v1 expertise catalog entries from `meta-agents.yaml` agent definitions with role-specific capabilities, domains, confidence, lifecycle, and trust tier
- `mah expertise sync` CLI command — bridges evidence store + agent learnings into catalog confidence updates and capability discovery from System A keyword scanning
- `mah expertise apply-proposal <file>` CLI command — applies approved governance proposals to catalog with stale detection, actor authorization, and registry rebuild
- `mah expertise lifecycle <id> --to <state>` CLI command — governed lifecycle state transitions with authorization and evidence requirements
- `mah expertise export <id> --with-evidence` — bundles evidence metrics (invocation count, success rate, latency) into export payload
- Evidence recording in pi runtime — `delegate_agent` and `delegate_agents_parallel` in `multi-team.ts` now record delegation outcomes to the evidence store after each completion
- `scripts/expertise-seed.mjs` — catalog seeding with capability/domain derivation from agent identity
- `scripts/expertise-sync.mjs` — sync bridge reading evidence + System A learnings, computing confidence, discovering capabilities
- `scripts/expertise-apply-proposal.mjs` — proposal application with stale detection and actor auth
- `scripts/expertise-lifecycle-cli.mjs` — lifecycle transition CLI wrapping the state machine
- `scripts/expertise-export.mjs` enhanced — optional `includeEvidence` for metrics bundling
- `.claude/scripts/update-expertise-model-mcp.mjs` — MCP stdio server for opencode/claude-code runtimes exposing `update-expertise-model` tool
- `tests/expertise/evidence-recording.test.mjs` — 3 tests for runtime evidence recording
- `tests/expertise/expertise-sync.test.mjs` — 4 tests for sync bridge
- `tests/expertise/expertise-governance.test.mjs` — 6 tests for governance surfaces
- `tests/expertise/update-expertise-model-mcp.test.mjs` — 18 tests for MCP script (YAML round-trip, category normalization, byte limit)

### Changed
- Runtime detection now follows a stricter plugin-first model: forced runtime flags and repository markers only
- Detection no longer infers a runtime from an executable on `PATH` when the workspace has no runtime markers
- Runtime terminology across docs and loader output now uses plugin-based language instead of built-in/core runtime wording
- Bundled runtime plugins remain prioritized over installed plugins with the same name
- Skill path resolution now uses a convention-based default (`skills/<skill-slug>/SKILL.md`) instead of a per-runtime matrix in `meta-agents.yaml`
- Expertise catalog resolution is now workspace-local only, and reports workspace paths instead of package-repo paths
- Orchestrator model updated from `glm-5-turbo` to `glm-5`
- Skill sync now copies entire skill directories (including scripts) instead of only `SKILL.md`
- Agent skill injection preserves existing `use-when` metadata from frontmatter instead of overwriting
- Model resolution for opencode and kilo runtimes returns raw catalog model IDs (no normalization)
- `detectRuntime` now walks up the directory tree to find markers (stops at HOME boundary)
- Smoke tests strip `MAH_RUNTIME` and related env vars so marker detection tests work in any environment
- Skill list assertions in tests use subset checks instead of exact match

- Expertise catalog now seeded with role-specific capabilities for all 10 agents — routing engine (`mah expertise recommend`, `mah expertise explain`) returns scored recommendations instead of falling back
- Expertise catalog schema upgraded from empty shells to full v1 schema with `id`, `owner`, `capabilities`, `domains`, `confidence`, `validation_status`, `lifecycle`, `trust_tier`, `policy`

### Fixed
- Expertise YAML scalar serialization used double-quote style with backslash escaping but the parser never unescaped, causing `\\` to double on every load→save cycle. Switched to single-quote style with proper unescaping in both `parseScalarToken` and `parseInlineArray`
- `mah detect` now walks up from nested directories to find runtime markers
- `mah detect` no longer leaks markers from HOME into subdirectory workspaces
- Empty workspaces now return `runtime=unknown` and `reason=none` instead of inheriting markers from the home directory
- Global `mah sync` and related script dispatch now resolve package-owned script paths instead of expecting a local `scripts/` directory in the target repo
- `mah init` now writes `.mcp.json` and runtime markers into the caller repo instead of the MAH package directory
- `mah sync` now materializes only the runtime markers present in the current repo
- `mah generate` / `mah expertise list` now operate on workspace-local `.mah` artifacts and no longer depend on a cloned MAH repository
- Global installs now clear stale `~/.mah/expertise/catalog` and `registry.json` leftovers instead of reseeding expertise from the package
- `mah init --ai` now forwards AI bootstrap flags to the bootstrap script and uses the bundled `bootstrap` skill instead of the retired `bootstrap-config-architect` name
- AI-assisted `mah init` now tries available runtimes in priority order (`opencode`, `codex`, `kilo`, `pi`) instead of getting stuck on a failing `pi` first
- Added regression coverage for AI bootstrap runtime selection so later runtimes can take over when earlier ones fail
- `mah run` for PI now falls back to the MAH package's bundled `extensions/` assets when the current repo does not have local extension files
- The custom `multi-team.yaml` parser now keeps all teams when list items wrap across multiple lines, so PI multi-team runs surface every lead instead of truncating after the first team
- MCP bridge tool calls now return controlled timeout errors instead of throwing out of the runtime, and Stitch gets a longer per-request timeout in PI MCP config
- Increased the PI Stitch MCP timeout again for long-running `generate_screen_from_text` calls
- Added regression coverage for the PI theme overlay registration so the global settings expose `~/.mah/extensions/themes`
- Added regression coverage for `mah run -c` resolving PI extensions from `~/.mah`

- Expertise skill SKILL.md now includes `## Where Is Your File` section pointing agents to `Declared expertise file` in Agent Contract — agents can now locate their expertise file
- `persistArtifact` in `multi-team.ts` now returns repo-root-relative paths instead of session-relative paths — `read()` resolves correctly from repo root
- `deriveCapabilities` in `expertise-seed.mjs` uses `agent.id` not `agent.role` — role is generic (worker/lead), id is specific (backend-dev)
- `.claude/scripts/update-expertise-model-mcp.mjs` YAML handling replaced hand-rolled regex parser with `yaml.parse()`/`yaml.stringify()` — fixes round-trip data loss, quote escaping, multiline notes
- MCP script replaced mixed `require("fs")` with top-level `readdirSync` import for ESM compatibility
- Registry `.mah/expertise/registry.json` no longer points to stale `/tmp/` paths — seeded entries use workspace-relative catalog roots

### Added
- **Context Memory Engine (M4 — PR1+PR2+PR3+PR4)** — new canonical layer for operational context retrieval, separate from Expertise routing
- `types/context-memory-types.mjs` — type definitions and constants for ContextMemoryDocument, ContextMemoryIndexEntry, ContextMemoryRetrievalRequest, ContextMemoryRetrievalResult, ContextMemoryProposal
- `scripts/context-memory-validate.mjs` — pure validation functions returning `{ valid, errors, warnings }`
- `scripts/context-memory-schema.mjs` — frontmatter parsing, ID derivation, file hashing, corpus walking, index building, and retrieval scoring utilities
- `mah context` CLI namespace with `validate`, `list`, `show`, `index`, `find`, and `explain` subcommands
- Canonical storage layout at `.mah/context/` with `operational/`, `index/`, `proposals/`, `cache/` subdirectories
- 5 test fixtures in `tests/fixtures/context-memory/` covering valid, minimal, and invalid documents
- `mah context index [--rebuild]` — deterministic index builder for the committed operational corpus only
- `mah context find --agent <name> --task "<desc>"` — lexical + metadata retrieval with scoring algorithm (agent filter, capability boost, tool/system matching, task-pattern/tag/heading lexical match, stability adjustment)
- `mah context explain --agent <name> --task "<desc>"` — explainable retrieval with step-by-step scoring breakdown and per-document reasoning
- `mah context propose --from-session <ref>` — create draft memory proposal from session
- `scripts/context-memory-integration.mjs` — runtime injection utilities (`isContextMemoryEnabled`, `parseContextMemoryOptions`, `buildContextMemoryBlock`)
- Hermes bootstrap injection via `MAH_CONTEXT_MEMORY=1` or `--with-context-memory` flag
- Supports `--context-limit <n>` (default 5, max 10) and `--context-mode=summary|snippets`
- Graceful fallback when corpus is empty or Hermes is unavailable
- `skills/context-memory/SKILL.md` and `.codex/skills/context-memory/SKILL.md` — specialized operator skill for retrieving and curating operational context
- `scripts/context-memory-proposal.mjs` — proposal generator (`proposeFromSession`, `writeProposal`, `listProposals`, `findSession`)
- `mah context propose --from-session <ref>` — create memory proposal from session (status: draft, requires review)

### Constraints
- No vector DB dependency — lexical + metadata retrieval only
- No Obsidian dependency — `.md` and `.qmd` files only; Obsidian is optional as an editor, not a runtime dependency
- Context Memory has zero role in expertise-based routing decisions
- Fixtures in `tests/fixtures/context-memory/` are validation-only and are not part of the operational corpus

### Validation
- PR1+PR2+PR3+PR4 acceptance criteria met
- All CLI commands functional: validate, list, show, index, find, explain, propose
- Schema stable, validators return `{ valid, errors, warnings }`
- Retrieval scoring: agent filter + capability/tool/system/tag/heading lexical + stability adjustment
- Hermes bootstrap injection with graceful fallback
- Proposal flow writes drafts to `.mah/context/proposals/` with status: draft
- No regressions in existing `mah expertise`, `mah sessions`, `mah run` commands
- Verified with: `node scripts/meta-agents-harness.mjs context --help`

### Fixed
- `context_memory` is now projected as a shared skill across runtime markers and resolves to the physical `skills/context-memory/SKILL.md` path

### Documentation
- `docs/context-memory.md` — Complete operator reference for Context Memory v0.8.0
- `docs/README.md` — Updated with Context Memory in Core Concepts
- `plan/slices/context-memory-pr1-schema.md` — PR1 technical specification
- `plan/context-memory-v0.8.0.md` — Full feature plan and rationale

## [0.7.0] - 2026-04-16

### Added
- Expertise Engine core modules for schema validation, catalog loading, registry generation, routing, evidence storage, confidence scoring, lifecycle control, export, and validation
- `mah expertise` command group with `list`, `show`, `recommend`, `evidence`, `explain`, `export`, and `propose` flows
- Governance proposal artifacts for catalog updates, generated by `orchestrator` and `*-lead` actors
- Proposal drafts can now be generated directly from recent evidence with `mah expertise propose --from-evidence`
- Expertise contract and integration coverage for M3, M4, M5, routing, CLI, and export/import behavior

### Changed
- Expertise CLI flows now resolve canonical catalog documents by expertise id instead of operating on registry summary refs
- Explainability output for `mah expertise explain` and `mah explain delegate` now reflects the routing engine's real score model and blocking metadata
- Expertise metrics/schema/type contracts are now aligned with the evidence aggregation model used by the runtime
- Expertise evidence storage now supports `MAH_EXPERTISE_EVIDENCE_ROOT`, so tests and temporary runs can stay out of `.mah/expertise/evidence`
- Expertise writing guidance now prefers `lessons`, `decisions`, `risks`, and `workflows` for durable knowledge, keeping `observations` narrow and short-lived
- Expertise catalog governance now explicitly routes changes through a proposal/review/write flow, with proposals generated from `orchestrator` or lead actors

### Fixed
- `mah expertise show` and `mah expertise export` now preserve canonical governance fields such as `allowed_environments`, `metadata`, `policy`, and declared ownership
- Registry path derivation now uses source-file provenance when available and falls back to the correct `.mah/expertise/catalog/<crew>/<name>.yaml` layout
- `mah validate:expertise` now forwards passthrough flags correctly, including owner-filtered validation runs
- `validate:expertise --owner <agent>` now works with the v0.7 owner object model and `metadata.owner_id`
- Lifecycle transition `experimental -> active` now enforces `review_pass_rate >= 0.8` instead of using a placeholder approval path
- Legacy expertise normalization now emits a v0.7-compatible shape for `owner`, `confidence`, `policy`, `input_contract`, and `evidence_refs`
- CLI explain traces no longer render missing score placeholders such as `expertise_match: —` or `score=n/a` for valid routing decisions
- Evidence-store and export/import tests now use temporary directories, leaving `.mah` clean for real runtime-generated evidence

### Validation
- Verified with:
  - `node --test tests/expertise-contract.test.mjs tests/expertise-m3.test.mjs tests/expertise-routing.test.mjs tests/expertise-cli-m4.test.mjs tests/expertise-m5-export.test.mjs`

## [0.6.1] - 2026-04-16

### Added
- Native runtime delegation adapter (`scripts/child-agent-native-runtime.mjs`) integrated into `mah delegate`
- Kilo headless adapter test suite (`tests/headless-kilo.test.mjs`)
- Additional `mah sessions` regression coverage for:
  - `inject` and `bridge` argument parsing
  - `--runtime` filtering behavior in CLI list output
  - Kilo session resume/new capability paths in operations tests

### Changed
- Codex runtime plugin path standardized from `plugins/codex` to `plugins/runtime-codex`
- `mah sessions --help` now renders runtime list and `sessions new` support dynamically from loaded runtime profiles
- `mah sessions` now preserves `--runtime` semantics when provided as global flag or subcommand flag
- Session interop pipeline (`export/inject/bridge`) now receives loaded runtime registry (built-ins + plugins), not built-ins only

### Fixed
- `mah sessions inject` and `mah sessions bridge` now parse `<id>` correctly (no longer reading subcommand token as session id)
- `mah sessions list` now correctly applies effective runtime override
- Global `--runtime` with `mah sessions` no longer breaks subcommand parsing
- `m3-ops` `exportSession` and `deleteSession` now resolve session source from inventory (`collectSessions`) instead of assuming fixed `crew/<id>/sessions` path layout
- Kilo runtime now declares full headless capability contract and implements `prepareHeadlessRunContext`

### Validation
- Verified with:
  - `node --test tests/sessions-operations.test.mjs`
  - `node --test tests/session-interop.test.mjs tests/runtime-core-integration.test.mjs`
  - `node --test tests/headless-contract.test.mjs tests/headless-pi.test.mjs tests/headless-claude.test.mjs tests/headless-opencode.test.mjs tests/headless-kilo.test.mjs tests/headless-hermes.test.mjs tests/headless-codex.test.mjs`

## [0.6.0] - 2026-04-15

### Added
- `RuntimeAdapter` extended with `capabilities.headless` schema (`supported`, `native`, `requiresSession`, `promptMode`, `outputMode`)
- `prepareHeadlessRunContext()` method on all runtime adapters (built-in + plugins)
- `mah run --headless "<task>"` CLI command with canonical JSON/text output envelope
- `mah explain run --headless --trace` now shows headless execution plan
- `--output=json|text` flag for structured headless output
- `runCommand()` switches to `stdio: "pipe"` in headless mode for output capture
- All 4 built-in adapters (pi, claude, opencode, hermes) have full headless support
- All 5 plugin adapters have headless capability declared (unsupported placeholder until Slice 3)
- Headless test suite: 6 test files (~58 tests across runtime adapters)
- Headless contract tests with graceful skip when runtime binary unavailable
- `docs/headless-runtime.md` — operational guide for headless execution
- `docs/plugin-api.md` — headless capability documentation for plugin developers

### Changed
- `plugins/runtime-pi` headless implementation now uses `pi run --no-session`
- `plugins/runtime-opencode` headless implementation now uses `--no-interactive` flag
- `plugins/runtime-hermes` headless requires active session; returns error if no session available

### Fixed
- Same-runtime (pi→pi) delegation correctly returns "no adapter found" instead of incorrectly routing through Codex sidecar
- Missing explicit `--no-session` flag in PI headless mode
- Missing explicit `--no-interactive` flag in OpenCode headless mode
- Hermes headless test correctly handles session-required behavior

### Added (Session Interop)
- Canonical session envelope `mah.session.v1` schema in `types/session-types.mjs`
- `FIDELITY_LEVELS` constants: `full`, `contextual`, `summary-only` (default: `contextual`)
- `SessionAdapter` contract in `scripts/session-adapter-contract.mjs`
- Structured session export with `mah-json`, `summary-md`, and `runtime-raw` formats in `scripts/session-export.mjs`
- Context projection and injection with fidelity-aware strategy selection in `scripts/session-injection.mjs`
- High-level `bridgeSession()` operation combining export + inject in `scripts/session-bridge.mjs`
- `mah sessions inject <id> --runtime <target> [--fidelity level]` CLI command
- `mah sessions bridge <id> --to <runtime> [--fidelity level]` CLI command
- `mah sessions export <id> --format mah-json|summary-md|runtime-raw` format flag
- Session interop test suite in `tests/session-interop.test.mjs`
- Session interop documentation in `docs/sessions-interop.md`

### Changed (Session Interop)
- `mah sessions export` defaults to `mah-json` format (was `runtime-raw` tar.gz)
- Default export format is now structured canonical envelope, not raw archive

### Added (Cross-Runtime Child Agents)
- `scripts/child-agent-adapter-contract.mjs` — ChildAgentAdapter contract with `SPAWN_MODES` constants, `SpawnSupportContext`, `SpawnContext`, `SpawnPlanResult`, `SpawnExecutionResult` types
- `scripts/delegation-resolution.mjs` — Shared `resolveDelegationTarget()` service enforcing crew topology authorization (orchestrator→leads, lead→own-team-workers, workers cannot delegate)
- `scripts/child-agent-spawn.mjs` — Strategy layer with `buildSpawnContext()`, `prepareChildSpawn()`, adapter registry, `selectAdapter()`, `determineSpawnMode()`, and `explainChildSpawn()`
- `scripts/child-agent-codex-sidecar.mjs` — First cross-runtime sidecar adapter using direct `codex exec --full-auto` for headless non-interactive execution
- `tests/child-agent-spawn.test.mjs` — Unit test suite (8 tests) covering SPAWN_MODES, resolveDelegationTarget authorization, codexSidecarAdapter contract, adapter registry
- `docs/cross-runtime-child-agents.md` — Feature documentation with architecture overview, policy rules, CLI usage
- `mah delegate` CLI command with `--target`, `--task`, `--runtime`, `--crew` flags and plan-only output
- `--execute`/`-x` flag on `mah delegate` for actual cross-runtime spawn execution

### Changed (Cross-Runtime Child Agents)
- `selectAdapter()` in child-agent-spawn.mjs now filters by `targetRuntime` to prevent cross-runtime adapters from matching same-runtime requests
- Codex sidecar now uses direct `codex exec --cd <repo> --full-auto <prompt>` instead of routing through `mah run --runtime codex`
- `SpawnSupportContext` typedef updated to include `targetRuntime` field

### Fixed (Cross-Runtime Child Agents)
- Codex sidecar adapter was over-matching same-runtime (pi→pi) requests due to missing `targetRuntime` check in `selectAdapter()`
- Codex sidecar now passes crew config via `MAH_ACTIVE_CREW` env var in `envOverrides` (no `--crew` CLI flag needed)

## [0.5.0] - 2026-04-10

### Highlights
- Runtime plugins became a supported release feature, so new runtimes can be installed, validated, listed, and removed without patching core files.
- Plugin discovery now covers `mah-plugins/` and `node_modules/@mah/runtime-*`, with built-in runtimes always taking priority and discovery anchored to the MAH package root.
- Core-managed plugin runtimes can join the normal MAH surface (`run`, `list:crews`, `use`, `clear`, and session flows) while still honoring the same adapter contract as built-ins.
- Codex sessions can now expose bounded MAH operational tools through a local `mah` MCP server, enabling active-context inspection and graph-based delegation from inside the Codex runtime.

### Added
- `scripts/plugin-loader.mjs` for plugin discovery, validation, registry merge, unload, and lifecycle hooks.
- `mah plugins list|install|uninstall|validate` CLI commands.
- Support for wrapper-based plugins and wrapperless core-integrated plugins.
- `MAH_PLUGINS_ENABLED=0` opt-out for plugin discovery.
- Runtime plugin documentation in [`docs/plugin-api.md`](./docs/plugin-api.md) and the README.
- Codex runtime CLI support with core-managed `list:crews`, `use`, `clear`, and `run` integration, including adapter-backed crew activation and diagnostics.
- Native Codex-facing `mah` MCP plugin under `plugins/mah/` with:
  - `mah_get_active_context`
  - `mah_list_agents`
  - `mah_delegate_agent`
- Codex plugin documentation covering MCP registration, `config.toml` setup, and in-session usage for the `mah` tools.
- Unit and end-to-end coverage for plugin loading, install/uninstall, validation, and runtime detection.
- `/thinking` slash command for runtime control of thinking level in delegated child agents.
  - Levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`
  - Usage: `/thinking`, `/thinking <level>`, `/thinking help`
  - Default changed from `off` to `minimal` for child agents

### Changed
- MAH runtime resolution now uses the merged built-in-plus-plugin registry instead of a static built-in-only view.
- Session and run-context handling derive from adapter capabilities, which lets plugin runtimes participate in `run` and session flows consistently.
- `mah plugins list` reports loaded, valid plugins rather than raw directory names.
- Plugin install/uninstall now preserves user-authored `meta-agents.yaml` runtime overrides while syncing plugin metadata.
- Plugin discovery is resolved from the MAH package root rather than the caller's current working directory, so plugins remain visible from subdirectories.
- Built-in runtimes (`pi`, `claude`, `opencode`, `hermes`) remain authoritative and cannot be shadowed by same-named plugins.
- Model projection is now runtime-specific: `pi` and `hermes` keep the canonical `minimax/minimax-m2.7` mapping, while `opencode` and `kilo` override to `minimax-coding-plan/MiniMax-M2.7` so delegated subagents resolve correctly.
- `thinkingLevel` option support in `dispatchChild` for elevated reasoning on complex tasks.
- Child agent thinking level default changed from `off` to `minimal`.
- `/thinking` command handler added to `pi.on("input")` processing, matching the `/compact` pattern.
- Codex-side MAH delegation now has a documented installation path through a local MCP server using absolute `node`/script paths and explicit `cwd`, which avoids shell- and path-resolution drift during Codex startup.

### Fixed
- Plugin validation now rejects incompatible `mahVersion` ranges and malformed adapter contracts before registration.
- `mah sync --check` no longer restores marker directories or mutates the worktree.
- `mah sync --json` and the generate aliases now emit clean machine-readable output without progress noise.
- Kilo onboarding now resolves the wrapper from the MAH package root instead of `process.cwd()`.
- `ProviderModelNotFoundError` during delegated subagent spawn is resolved by keeping provider-qualified models scoped to the runtimes that require them.
- `package.json` and release docs now align on `0.5.0`.

## [0.4.0] - 2026-04-08

### Highlights
- **Bootstrap CLI** with 99 tests and AI-assisted generation mode
- **Hermes runtime support** with full documentation and examples
- **Expertise model rewrites** across all 4 runtimes with 6-phase enforcement pipeline
- **Wildcard domain rules** for cleaner, maintainable domain configurations
- **Artifact reference system** for bounded delegation output

### Added
- Bootstrap CLI (`mah init`) with logical and AI-assisted modes
- 99 tests for bootstrap CLI across 4 test suites
- Hermes runtime adapter, wrapper, and documentation
- `bootstrap-config-architect` skill for all runtimes
- `bootstrap-config` crew ready for bootstrapping new projects
- `/compact` slash command for session compaction
- `mah run --session-mode none` for ephemeral sessions
- `docs/README.md` for organized documentation
- `docs/hermes/` with quickstart, runtime support, session management, and artifact structure docs

### Changed
- Expertise model skill completely rewritten with high-signal guidance
- All 10 domain blocks use wildcard patterns (`path: ./*`) — 365 lines removed
- `domain_profile` now accepts arrays for stacked domain rules per agent
- Runtime projection extended with bounded Hermes compatibility

### Fixed
- Critical: Expertise file corruption (1.7MB → bounded)
- Critical: Worker output not propagating to orchestrator
- Critical: Wildcard expansion blowing up context window
- Orchestrator/leads missing read/grep/find/ls tools
- Guardrail path resolution using wrong base directory
- Many other reliability and correctness issues

### Notes
- Expertise model corruption was the single largest reliability risk — now protected by 6-phase enforcement
- Hermes support is substantial but intentionally bounded; MAH remains an orchestration layer
- Conservative pre-1.0 SemVer with disciplined minor releases

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
