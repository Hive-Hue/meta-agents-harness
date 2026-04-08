# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and Semantic Versioning is applied conservatively in pre-1.0 mode (`0.x`).

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
