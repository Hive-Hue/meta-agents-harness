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
npm install
```

Optional environment setup:

```bash
cp .env.sample .env
```

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

## Runtime-Specific Assets

This repository ships runtime assets for all three CLIs:

- `.opencode/` for OpenCode harness topology and scripts
- `.claude/` for Claude runtime wrappers and crew structure
- `.pi/` for PI runtime wrappers and crew structure
- `extensions/` for PI runtime extension entrypoints used by `.pi/scripts/run-crew.mjs`

The `mah` CLI is runtime-agnostic and dispatches dynamically based on detected runtime markers or explicit `--runtime`.

## Local Development

Install OpenCode runtime dependencies:

```bash
npm --prefix .opencode install
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
