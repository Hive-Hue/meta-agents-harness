# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and Semantic Versioning is applied conservatively in pre-1.0 mode (`0.x`).

## [Unreleased]

### Added
- Placeholder for changes after `v0.3.0`.

### Changed
- Placeholder for behavior and stability updates after `v0.3.0`.

### Notes
- Continue with conservative pre-1.0 SemVer (`0.x`) and disciplined minor releases.

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
- Platform capabilities (`sessions`, provenance, graph, demo) are initial support.
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
