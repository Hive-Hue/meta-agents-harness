<p align="center">
  <img src="./assets/banner_metaagent.png" alt="Meta Agents Harness" width="100%" />
</p>

[![](https://img.shields.io/github/actions/workflow/status/Hive-Hue/meta-agents-harness/validate.yml?style=flat&label=validate)](https://github.com/Hive-Hue/meta-agents-harness/actions/workflows/validate.yml)
[![](https://img.shields.io/github/last-commit/Hive-Hue/meta-agents-harness?style=flat)](https://github.com/Hive-Hue/meta-agents-harness/commits)
[![](https://img.shields.io/badge/license-AGPLv3%20%2B%20Commercial-6f42c1?style=flat)](./LICENSE)

# Meta Agents Harness

Meta Agents Harness is a dual-licensed (AGPLv3 + commercial) product that provides a unified multi-agent harness for:

- OpenCode
- Claude Code
- PI

It detects the available runtime in the current repository and adapts commands dynamically through a single CLI: `mah`.

Core value:

- one command surface for three runtimes
- deterministic runtime detection and fallback behavior
- shared multi-team operating model (orchestrator -> leads -> workers)

## Key Idea

Instead of maintaining separate operator flows per runtime, Meta Agents Harness exposes a common command surface and dispatches to the correct underlying toolchain.

Detection priority:

1. Forced runtime via `--runtime` or `MAH_RUNTIME`
2. Runtime marker directory in repository (`.pi`, `.claude`, `.opencode`)
3. Installed CLI binaries (`pi`, `claude`, `opencode`)

## Install

```bash
git clone https://github.com/Hive-Hue/meta-agents-harness.git
cd meta-agents-harness
npm run setup
```

Optional environment setup:

```bash
cp .env.sample .env
```

`npm run setup` installs root dependencies plus runtime dependencies in `.opencode`, `.claude`, and `.pi`.

## Unified CLI (`mah`)

Show help:

```bash
mah --help
```

Detect runtime:

```bash
mah detect
```

Run runtime check:

```bash
mah check:runtime
```

Validate configuration:

```bash
mah validate
```

List crews:

```bash
mah list:crews
```

Activate crew:

```bash
mah use <crew>
```

Clear active crew:

```bash
mah clear
```

Run interactive runtime:

```bash
mah run
```

Force explicit runtime:

```bash
mah --runtime opencode validate
mah --runtime claude check:runtime
mah --runtime pi run -c
```

## Canonical Config

The repository includes:

- [meta-agents.yaml](./meta-agents.yaml)
- [meta-agents.yaml.example](./examples/meta-agents.yaml.example)

`meta-agents.yaml` is the canonical runtime index.  
`examples/meta-agents.yaml.example` is the practical authoring template with crews, role permissions, and runtime-specific overrides.

### Full YAML Structure

Top-level sections:

- `version`, `name`, `description`
- `runtime_detection` (forced args/env, marker dirs, CLI fallback)
- `runtimes` (wrapper and config roots per runtime)
- `crews` (topology, role permissions, runtime overrides)
- `adapters` (mapping rules and translation contracts)

### Field-by-Field Guide

- `runtime_detection.order`: precedence between explicit runtime, repository markers, and installed CLIs.
- `runtimes.<runtime>.wrapper`: command wrapper to execute (`pimh`, `ccmh`, `ocmh`).
- `runtimes.<runtime>.config_root`: runtime root folder (`.pi`, `.claude`, `.opencode`).
- `crews[].topology`: orchestrator, leads, and workers in abstract form.
- `crews[].role_permissions`: runtime-agnostic permission intent.
- `crews[].runtime_overrides`: per-runtime controls (CCR on Claude, `permission.task` on OpenCode, `multi-team`/extension on PI).
- `adapters.mapping_rules`: conversion contract from abstract roles/scopes to runtime-native config fields.

### How Adapter Conversion Works

The adapter layer translates abstract crew intent into runtime-native models:

- OpenCode: roles and delegation become agent files plus `permission.task` constraints.
- Claude: role routing becomes CCR route-map constraints and wrapper routing policies.
- PI: role + ownership intent maps into `.pi/crew/*/multi-team.yaml` and runtime extension wiring in `extensions/`.

Current runtime dispatch is implemented in [meta-agents-harness.mjs](./scripts/meta-agents-harness.mjs); the YAML files define and document the canonical mapping contract for runtime parity.

## Runtime-Specific Assets

This repository ships runtime assets for all three CLIs:

- `.opencode/` for OpenCode harness topology and scripts
- `.claude/` for Claude runtime wrappers and crew structure
- `.pi/` for PI runtime wrappers and crew structure
- `extensions/` for PI runtime extension entrypoints used by `.pi/scripts/run-crew.mjs`

The `mah` CLI is runtime-agnostic and dispatches dynamically based on detected runtime markers or explicit `--runtime`.

## Adapter Model

`mah` uses an adapter-like dispatch model:

- runtime profile selection (`pi`, `claude`, `opencode`)
- command variants per runtime (`list:crews`, `use`, `run`, `validate`)
- executable fallback (wrapper first, runtime/package script fallback)

Implementation reference:

- [meta-agents-harness.mjs](./scripts/meta-agents-harness.mjs)

## PI Integration Details

PI runtime integration is based on:

- `.pi/bin/pimh` wrapper orchestration
- `.pi/scripts/*.mjs` runtime helpers
- `extensions/*.ts` loaded by `.pi/scripts/run-crew.mjs`

Quick checks:

```bash
node .pi/bin/pimh check:runtime
node .pi/bin/pimh list:crews
```

## Comparison with Legacy Harness Repos

- `pi-multi-harness`, `claude-multi-harness`, and `opencode-multi-harness` expose runtime-specific flows.
- `meta-agents-harness` keeps those runtime assets, but adds a unified entrypoint (`mah`) and a canonical runtime index (`meta-agents.yaml`).
- migration path is incremental: existing wrappers remain valid while teams adopt `mah`.

## Troubleshooting

- `ERROR: could not detect runtime`
  - ensure one of `.pi`, `.claude`, `.opencode` exists
  - or pass explicit `--runtime`
- `ERROR: no executable found for runtime`
  - install wrapper/runtime CLI (`pimh`, `ccmh`, `ocmh`, `pi`, `claude`, `opencode`)
  - run `npm run setup`
- PI runtime starts but fails on extension path
  - confirm `extensions/` exists and includes `multi-team.ts`
- validate badge shows not found
  - ensure `.github/workflows/validate.yml` exists on default branch

## Local Development

Install all dependencies:

```bash
npm run setup
```

Run smoke tests for `mah`:

```bash
npm run test:smoke
```

## License

Dual licensing:

- AGPLv3 open-source license
- Commercial proprietary license

See:

- [LICENSE](./LICENSE)
- [AGPL-3.0.md](./AGPL-3.0.md)
- [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md)
