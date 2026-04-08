# Hermes Integration Guide

## Overview

This guide walks through integrating Hermes as a runtime in Meta Agents Harness (MAH), from initial setup to a working multi-agent crew.

---

## Prerequisites

- **MAH installed**: `npm install -g .` or use `node bin/mah` locally
- **Hermes CLI available**: `hermes` or `hermesh` command accessible in PATH
- **Node.js**: v18+ (for MAH CLI)

---

## Integration Steps

### 1. Add Hermes to your existing config

If you already have a `meta-agents.yaml`, add the Hermes sections:

```yaml
# In runtime_detection.marker:
marker:
  hermes: ".hermes"

# In runtime_detection.cli:
cli:
  hermes:
    direct_cli: "hermes"
    wrapper: "hermesh"

# In runtimes:
runtimes:
  hermes:
    wrapper: "hermesh"
    direct_cli: "hermes"
    config_root: ".hermes"
    config_pattern: ".hermes/crew/<crew>/config.yaml"
    capabilities:
      persistent_memory: true
      supports_background_operation: true
      supports_multi_backend_execution: true
      gateway_aware: true
```

### 2. Initialize the Hermes marker

```bash
mah init --runtime hermes
```

This creates the `.hermes/` directory that MAH uses for runtime detection.

### 3. Generate Hermes artifacts

```bash
npm run sync:meta
```

This projects your canonical crew configuration into Hermes-specific files under `.hermes/crew/`.

### 4. Verify integration

```bash
# Check that Hermes is detected
mah detect

# Run Hermes-specific diagnostics
mah --runtime hermes doctor

# Verify runtime contract
mah contract:runtime

# Full validation
mah --runtime hermes validate:all
```

### 5. Start using Hermes

```bash
# Interactive session
mah --runtime hermes run

# With session controls
mah --runtime hermes run --session-mode new
mah --runtime hermes run --session-mode continue --session-id my-session

# Explain what will happen before running
mah --runtime hermes explain run --trace
```

---

## Adding Hermes to an existing multi-runtime project

If your project already supports PI, Claude, or OpenCode, adding Hermes is additive:

```bash
# Initialize Hermes alongside existing runtimes
mah init --runtime hermes --crew dev

# Re-sync to generate Hermes artifacts alongside existing ones
npm run sync:meta

# Verify all runtimes are detected
mah detect
mah --runtime hermes detect
mah --runtime pi detect
```

MAH's `meta-agents.yaml` supports multiple runtimes simultaneously. Hermes is added without affecting existing runtime configurations.

---

## Hermes-specific capabilities

Hermes exposes capability metadata that MAH recognizes:

| Capability | Description |
|---|---|
| `persistent_memory` | Hermes retains context across sessions |
| `supports_background_operation` | Hermes can run tasks in the background |
| `supports_multi_backend_execution` | Hermes supports multiple execution backends |
| `gateway_aware` | Hermes can operate through gateway channels |

These capabilities are informational in v0.4.0 — they surface in diagnostics and explainability output but do not change MAH's dispatch behavior.

---

## Configuring Hermes session storage

Customize where Hermes sessions are stored per crew:

```yaml
crews:
  - id: "dev"
    session:
      hermes_root: ".hermes/crew/dev/sessions"
```

---

## Hermes-specific runtime overrides

Add Hermes-specific overrides per crew when needed:

```yaml
crews:
  - id: "dev"
    runtime_overrides:
      hermes:
        expertise_context: ".hermes/crew/dev/expertise/"
        backend_hint: "local"
```

### Available override fields

| Field | Description | Example |
|---|---|---|
| `expertise_context` | Custom expertise directory path | `.hermes/crew/dev/expertise/` |
| `backend_hint` | Preferred execution backend | `local`, `remote`, `hybrid` |

---

## Troubleshooting

### Hermes not detected

```bash
# Check marker exists
ls -la .hermes/

# Force explicitly
mah --runtime hermes detect

# Check CLI availability
which hermes
which hermesh
```

### Artifact drift

```bash
# Check what changed
mah diff

# Preview planned sync
mah plan

# Re-sync
npm run sync:meta
```

### Contract validation failure

```bash
mah contract:runtime
```

This validates that the Hermes adapter satisfies all required fields and commands.

---

## Related resources

- [`../docs/hermes/runtime-support.md`](../../docs/hermes/runtime-support.md) — Full runtime support details
- [`../docs/hermes/quickstart.md`](../../docs/hermes/quickstart.md) — Quick reference guide
- [`../docs/hermes/artifact-structure.md`](../../docs/hermes/artifact-structure.md) — Directory layout
- [`../docs/hermes/session-management.md`](../../docs/hermes/session-management.md) — Session handling
- [`../docs/runtime-boundary.md`](../../docs/runtime-boundary.md) — MAH runtime architecture
