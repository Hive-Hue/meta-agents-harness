<p align="center">
  <img src="./assets/banner_metaagent.png" alt="Meta Agents Harness" width="100%" />
</p>

[![](https://img.shields.io/github/actions/workflow/status/Hive-Hue/meta-agents-harness/validate.yml?branch=development&style=flat&label=validate%20(development))](https://github.com/Hive-Hue/meta-agents-harness/actions/workflows/validate.yml)
[![](https://img.shields.io/github/last-commit/Hive-Hue/meta-agents-harness/development?style=flat&label=last%20commit)](https://github.com/Hive-Hue/meta-agents-harness/commits/development)
[![](https://img.shields.io/badge/license-AGPLv3%20%2B%20Commercial-6f42c1?style=flat)](./LICENSE)

# Meta Agents Harness

**Meta Agents Harness** is a unified multi-agent control layer for **OpenCode**, **Claude Code**, and **PI**.

Instead of maintaining separate operator flows, wrappers, and team topologies for each runtime, this project exposes a **single command surface** — `mah` — and dispatches to the correct runtime automatically.

The `development` branch represents the **product-grade evolution path** of the project: stronger canonical configuration, layered validation, explainability, and a future adapter-based runtime architecture.

---

## Why this exists

Multi-agent teams often end up fragmented across runtime-specific repos and operator flows.

Meta Agents Harness solves that by providing:

- **one CLI surface** for multiple runtimes
- **runtime-aware dispatch** with deterministic detection
- **shared multi-team topology** (`orchestrator -> leads -> workers`)
- **canonical config generation** for runtime-specific artifacts
- **incremental migration path** from runtime-specific harnesses to a unified entrypoint

This makes it easier to standardize operations without forcing teams to abandon the runtime they already use.

---

## Current status of the `development` branch

This branch is where the project is being shaped into a more robust product layer.

Current focus areas include:

- making `meta-agents.yaml` the true canonical source of truth
- reducing drift between config and generated runtime artifacts
- improving validation and diagnostics
- preparing an adapter model for future runtime extensibility
- improving operator UX with explainability and safer sync flows

This branch is the right place to evaluate the **direction**, **architecture**, and **product positioning** of the project.

---

## Core product idea

Use one command surface:

```bash
mah <command>
```

And let the harness resolve:

- which runtime is available
- which wrapper or executable to use
- which crew is active
- how session flags should be normalized
- how runtime-specific artifacts are generated or validated

---

## Runtime detection model

Detection currently follows this priority:

1. forced runtime via `--runtime`, `-r`, `-f`, or `MAH_RUNTIME`
2. runtime marker directory in the repository (`.pi`, `.claude`, `.opencode`)
3. installed executable or wrapper available in the environment

This allows the same repository to remain runtime-aware while preserving explicit overrides for CI, local debugging, or controlled execution.

---

## Supported runtimes

Meta Agents Harness currently targets:

- **OpenCode**
- **Claude Code**
- **PI**

The repository ships runtime assets for all three, while presenting a single operator entrypoint.

---

## Key concepts

### 1. Unified CLI

The main operator surface is `mah`.

Examples:

```bash
mah detect
mah explain
mah explain run --trace
mah doctor
mah init --runtime opencode --crew dev
mah plan
mah diff
mah sessions --json
mah targets --json
mah targets --runtime opencode --status healthy
mah graph --crew dev --json
mah graph --crew dev --mermaid
mah graph --crew dev --mermaid --mermaid-level group
mah graph --crew dev --mermaid --mermaid-level detailed
mah graph --crew dev --mermaid --mermaid-level detailed --mermaid-capabilities
mah demo dev
MAH_AUDIT=1 mah run --session-mode continue
mah validate:runtime
mah validate:config
mah validate:sync
mah validate:all
mah validate
mah list:crews
mah use dev
mah clear
mah run
```

### 2. Canonical configuration

The project uses `meta-agents.yaml` as the canonical multi-runtime configuration index.

This config is used to define:

- runtime detection metadata
- runtime-specific wrappers and config roots
- model catalog and fallbacks
- skill references
- domain profiles
- multi-team crew topology
- runtime overrides and mapping rules

### 3. Generated runtime artifacts

From the canonical config, the project materializes runtime-specific files under:

- `.pi/`
- `.claude/`
- `.opencode/`

This preserves runtime-native structures while reducing duplicated authoring effort.

### 4. Multi-team operating model

The common abstraction is:

- **orchestrator**
- **team leads**
- **workers**

This structure is translated into each runtime’s expected configuration model.

### 5. Expertise model foundation

In `v0.3.0`, expertise model is treated as a normalized foundation concept:

- consistent naming in paths, scripts, tools, and generated artifacts
- consistent runtime references in configs and prompts
- visibility in graph and documentation

This phase is intentionally structural.  
It does not yet add expertise-aware routing/scoring/governance behavior.

See: `docs/expertise-model-foundation.md`

---

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/Hive-Hue/meta-agents-harness.git
cd meta-agents-harness
npm run setup
```

Optional local environment setup:

```bash
cp .env.sample .env
```

The setup script installs root dependencies and runtime dependencies used by the repository.

---

## MCP configuration

The repository uses two MCP-related files:

- `.mcp.example.json` — tracked repository template
- `.mcp.json` — local active configuration (gitignored)

Recommended flow:

```bash
cp .mcp.example.json .mcp.json
```

Then adjust local values and secrets as needed.

---

## Running the CLI

You can use the CLI locally:

```bash
node bin/mah --help
```

Or install it globally:

```bash
npm install -g .
```

Then:

```bash
mah --help
```

---

## Common commands

### Show help

```bash
mah --help
```

### Detect runtime

```bash
mah detect
```

### Run diagnostics

```bash
mah doctor
mah check:runtime
mah validate:runtime
mah validate:config
mah validate:sync
mah validate:all
mah validate
mah explain detect
mah explain run --trace
```

### Crew operations

```bash
mah list:crews
mah use <crew>
mah clear
```

### Target visibility

```bash
mah targets
mah targets --json
mah targets --runtime opencode
mah targets --status healthy
```

### Interactive runtime execution

```bash
mah run
```

### Force runtime explicitly

```bash
mah --runtime opencode validate
mah --runtime claude check:runtime
mah --runtime pi run -c
```

---

## Unified session controls

The CLI normalizes session-related controls across runtimes.

Examples:

```bash
mah run --session-mode continue
mah run --session-mode new
mah run --session-id 11111111-1111-1111-1111-111111111111
mah run --session-root .pi/crew/dev/sessions
mah run --session-mirror
```

These are translated to runtime-native behavior internally.

---

## Canonical config and examples

The repository includes:

- [`meta-agents.yaml`](./meta-agents.yaml)
- [`examples/meta-agents.yaml.example`](./examples/meta-agents.yaml.example)
- [`examples/crew-dev.complete.example.yaml`](./examples/crew-dev.complete.example.yaml)
- [`examples/crew-marketing.complete.example.yaml`](./examples/crew-marketing.complete.example.yaml)

Use these files to understand and author crew topology, model mapping, skill references, and runtime-specific overrides.

---

## Sync and drift detection

Generate runtime artifacts from canonical config:

```bash
npm run sync:meta
```

Check drift without writing files:

```bash
npm run check:meta-sync
```

This is an important part of keeping runtime artifacts aligned with the source configuration.

---

## Runtime assets

The repository currently contains runtime-specific assets such as:

- `.opencode/` — OpenCode harness topology and scripts
- `.claude/` — Claude runtime wrappers and crew structure
- `.pi/` — PI runtime wrappers and crew structure
- `extensions/` — PI runtime extensions and entrypoints

The purpose of the unified CLI is not to remove those assets, but to make them easier to manage from a single operational layer.

---

## Product direction for this branch

The `development` branch is focused on turning the project into a more mature platform.

### Planned evolution areas

#### Canonical config hardening
- formal config schema
- explicit config versioning
- stronger validation boundaries
- reduced duplication between YAML and dispatcher logic

#### Validation model
- split validation by concern:
  - config
  - runtime
  - sync
  - full validation
- semantics and ownership are defined in `docs/validate-semantics.md`

#### Operator UX
- improved diagnostics
- explainability for runtime resolution
- preview-oriented checks of generated changes before sync (`plan` / `diff`)
- stricter handling of ambiguous runtime markers

#### Platform capabilities
- initial unified session registry
- initial provenance and execution audit trails
- initial execution graph visibility
- runtime adapter foundation (still evolving, not a final external plugin API)
- capability status and policy details are documented in `docs/platform-capabilities.md`

This branch is therefore useful both as a working branch and as a public-facing signal of the product roadmap.

Current maturity note:

- diagnostics include expanded structured outputs, but output schemas are still being normalized
- `plan` and `diff` are currently lightweight operator workflows around sync reporting
- `sessions`, `provenance`, `graph`, and `demo` remain initial support in this release line

---

## Architectural direction

The long-term direction is to move toward an adapter model for runtimes.

Canonical boundary in this repository:

- `meta-agents.yaml` is the source of truth for crews/config content
- `runtime-adapters.mjs` is the source of truth for runtime operational behavior

Boundary details are documented in `docs/runtime-boundary.md`.

A runtime should be represented as an explicit contract rather than implicit command branching scattered through the dispatcher.

Illustrative direction:

```ts
interface RuntimeAdapter {
  name: string
  detect(context: DetectContext): DetectResult
  validate(level: "runtime" | "config" | "sync"): ValidationResult
  run(args: RunArgs): RunResult
  useCrew(crew: string): CommandResult
  clearCrew(): CommandResult
  capabilities(): CapabilityMatrix
}
```

This is an architectural direction for the branch, not yet a claim of completed implementation.

---

## Why this branch may matter publicly

If you are evaluating the project from the outside, the `development` branch is where you can understand:

- how the project intends to evolve from wrapper to orchestration layer
- how canonical config and runtime parity are being shaped
- what product-grade features are being prioritized
- how future extensibility and observability may work

It is the best branch to inspect for **roadmap**, **direction**, and **product architecture**.

---

## Troubleshooting

### Runtime could not be detected

Possible causes:

- the repository has no `.pi`, `.claude`, or `.opencode` marker
- no relevant runtime executable is available
- no explicit `--runtime` was passed

Try:

```bash
mah detect
mah --runtime opencode detect
```

### Executable not found for runtime

Try:

- running `npm run setup`
- verifying wrapper/runtime availability
- forcing a known runtime explicitly

### MCP configuration missing

If `.mcp.json` is missing:

```bash
cp .mcp.example.json .mcp.json
```

### `mah` command not available

Use the local entrypoint:

```bash
node bin/mah --help
```

Or install globally:

```bash
npm install -g .
```

---

## Local development

Install dependencies:

```bash
npm run setup
```

Run smoke tests:

```bash
npm run test:smoke
```

Validate canonical sync:

```bash
npm run check:meta-sync
```

---

## Related positioning

Meta Agents Harness can be viewed as the unification layer above runtime-specific harness repos.

Instead of replacing runtime-native behavior, it provides:

- shared operator commands
- canonical team definition
- consistent validation direction
- structured migration path

That makes it useful both for greenfield setups and for teams already operating per-runtime harnesses.

---

## License

Dual licensing:

- AGPLv3 open-source license
- Commercial proprietary license

See:

- [LICENSE](./LICENSE)
- [AGPL-3.0.md](./AGPL-3.0.md)
- [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md)
