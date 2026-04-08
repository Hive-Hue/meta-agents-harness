# Hermes Quickstart Guide

## Prerequisites

- Meta Agents Harness installed (`npm install -g .` or local `node bin/mah`)
- Repo-local `.hermes/` runtime assets generated from `meta-agents.yaml`
- Hermes CLI available (`hermes` command in PATH) for `doctor` and interactive `run`
- A repository initialized with `meta-agents.yaml`

---

## Step 1: Initialize Hermes runtime if needed

```bash
mah init --runtime hermes --crew dev
```

If you are adapting a different repository, this creates:
- `.hermes/` marker directory
- `meta-agents.yaml` (if not already present)
- `.mcp.json` (if not already present)

Output:

```
mah init completed
created=.hermes
skipped=meta-agents.yaml
crew_hint=dev
next=mah use dev
next=npm run sync:meta
```

In this repository, `.hermes/` is already tracked, so the normal starting point is syncing artifacts and selecting a crew.

---

## Step 2: Configure your crew

Edit `meta-agents.yaml` to include Hermes in the runtimes section and define your crew topology.

See [`examples/hermes/crew-simple.example.yaml`](../../examples/hermes/crew-simple.example.yaml) for a minimal crew configuration.

---

## Step 3: Generate runtime artifacts

```bash
npm run sync:meta
```

This generates Hermes-specific files under `.hermes/crew/<crew>/`.

Select the active crew before interactive runs:

```bash
mah use dev
```

To verify without writing:

```bash
npm run check:meta-sync
```

---

## Step 4: Verify Hermes runtime

```bash
mah --runtime hermes detect
```

Expected output:

```
runtime=hermes
reason=forced
```

Or if `.hermes/` marker is present:

```
runtime=hermes
reason=marker
```

---

## Step 5: Run diagnostics

```bash
mah --runtime hermes doctor
```

This runs Hermes-specific health checks and reports the runtime status.

---

## Step 6: Explain execution plan

```bash
mah --runtime hermes explain run --trace
```

Shows the full resolution plan for Hermes execution, including warnings for any Hermes-specific behaviors.

---

## Step 7: Run Hermes

```bash
mah --runtime hermes run
```

Starts an interactive Hermes session with the active crew.

On a fresh run, the repo-local wrapper bootstraps the orchestrator context for the selected crew before continuing interactively.

### With session controls

```bash
# New session
mah --runtime hermes run --session-mode new

# Continue existing session
mah --runtime hermes run --session-mode continue

# Specific session
mah --runtime hermes run --session-mode continue --session-id <id>

# Ephemeral (not supported — warning emitted)
mah --runtime hermes run --session-mode none
```

`--session-root` is accepted by the wrapper as MAH metadata, but Hermes still manages its own global session storage.

---

## Common workflows

### Full validation

```bash
mah --runtime hermes validate:all
```

### Check runtime contract

```bash
mah --runtime hermes validate:runtime
```

### List available crews

```bash
mah --runtime hermes list:crews
```

### Switch crew

```bash
mah --runtime hermes use dev
```

### Clear session state

```bash
mah --runtime hermes clear
```

---

## Environment variables

| Variable | Example | Description |
|---|---|---|
| `MAH_RUNTIME` | `hermes` | Force Hermes runtime globally |
| `MAH_AUDIT` | `1` | Enable provenance audit logging |
| `MAH_PROVENANCE` | `1` | Enable provenance logging |

Example with forced runtime:

```bash
MAH_RUNTIME=hermes mah detect
```

---

## Troubleshooting

### "could not detect runtime"

Hermes requires either:
- The `.hermes/` marker directory, or
- The `hermes` or `hermesh` executable in PATH

Fix:

```bash
# Option 1: Force explicitly
mah --runtime hermes detect

# Option 2: Initialize marker
mah init --runtime hermes

# Option 3: Verify CLI available
which hermes
which hermesh
```

### "no executable available for command"

The repo-local wrapper could not be resolved, or the global Hermes CLI is missing for commands that require it.

Fix:

```bash
npm run sync:meta
which hermes
```

### Sync drift detected

Generated artifacts are out of date.

Fix:

```bash
npm run sync:meta
```

---

## Next steps

- Read [`runtime-support.md`](./runtime-support.md) for full integration details
- Read [`artifact-structure.md`](./artifact-structure.md) for directory layout reference
- Read [`session-management.md`](./session-management.md) for session semantics
- See [`examples/hermes/`](../../examples/hermes/) for configuration examples
