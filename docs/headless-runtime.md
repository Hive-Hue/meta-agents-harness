# Headless Runtime Operations

Non-interactive runtime execution with deterministic output capture.

## CLI Usage

```bash
mah run --headless -- "your task prompt"
```

Targeted delegation in headless mode:

```bash
mah -r pi delegate --target planning-lead --headless --task "ask planning team workers to echo: OK" --execute
```

## When to Use Which

| Command | Scope | Authorization model | Best for |
|---------|-------|---------------------|----------|
| `mah run --headless -- "..."` | Direct runtime execution in current/default agent | No logical target policy check | Fast task execution |
| `mah delegate --target <agent> --headless --task "..." --execute` | Specific logical target agent | Enforced by crew topology | Role-specific execution and team boundaries |

Examples:

```bash
# Direct execution (default/current agent)
mah --headless run -- "ask planning team workers to echo: OK"

# Target-specific execution (planning-lead)
mah -r pi delegate --target planning-lead --headless --task "ask planning team workers to echo: OK" --execute
```

Structured output:

```bash
mah run --headless --output=json -- "your task prompt"
# or
mah run --headless -o=json -- "your task prompt"
```

## Explainability

```bash
mah explain run --headless --trace -- "your task prompt"
```

## How It Works

1. MAH detects the active runtime (pi, claude, opencode, etc.)
2. The runtime adapter's `prepareHeadlessRunContext` builds a non-interactive execution plan
3. MAH executes the plan via `spawnSync` with `stdio: ["ignore", "pipe", "pipe"]`
4. Output is captured and returned to the caller
5. `process.exit()` terminates immediately (avoids plugin event loop hang)

## Runtime Notes

- **PI**: uses native `-p` flag for non-interactive mode. Process-and-exit, no TUI.
  Example: `pi -e <ext1> -e <ext2> -p "task"`
- **Claude**: uses native `-p` flag for non-interactive mode.
  Example: `claude -p "task"`
- **OpenCode**: uses `run` subcommand for non-interactive mode.
  Example: `opencode run "task"`
- **Kilo**: uses native `run` subcommand for non-interactive mode.
  Example: `kilo run "task"`
- **Hermes**: session-gated — requires an active session for headless execution. Splash output is automatically stripped in headless mode.
- **Codex**: currently declares headless unsupported.

## Adapter Contract

Each runtime adapter declares headless capability:

```js
capabilities: {
  headless: {
    supported: Boolean,
    native: Boolean,
    requiresSession: Boolean,
    promptMode: "argv" | "stdin" | "env" | "unsupported",
    outputMode: "stdout" | "file" | "mixed"
  }
}
```

Adapters must implement:

```js
prepareHeadlessRunContext({ repoRoot, task, argv, envOverrides })
```

Returns:

```js
{
  ok: true,
  exec: "<binary>",
  args: [/* base args including headless flag */],
  passthrough: [/* task/prompt */],
  envOverrides: { /* merged env */ },
  warnings: [],
  internal: { mode: "headless", runtime: "<name>" }
}
```

## Known Behaviors

- The `--` separator between `--headless` and the task prompt is required to prevent flag misinterpretation
- MAH strips `--`, `--headless`, and `--output` flags before passing args to the runtime
- Extensions are loaded in headless mode the same as interactive mode
- `process.exit()` is used after execution to avoid lingering plugin handles

## Validation

```bash
node --test tests/headless-contract.test.mjs
node --test tests/headless-*.test.mjs
```

## Troubleshooting

**Process hangs after headless run**: The runtime may not support non-interactive mode. Check `mah explain run --headless --trace` to verify the execution plan uses the correct non-interactive flag (e.g., `-p` for PI, `-p` for Claude).

**Wrong prompt injected**: Ensure the task is passed after `--` separator. MAH strips `--` before forwarding to the runtime.

**Empty output**: Some runtimes write to stderr in headless mode. Use `--output=json` to capture both stdout and stderr separately.

## Runtime-Agnostic Execution Contract

MAH's headless pipeline normalizes all execution results to a canonical `AgentExecutionResult` shape regardless of which runtime executes the task.

### Canonical fields

| Field | Type | Description |
|---|---|---|
| `runtime` | string | Runtime identifier (e.g. `pi`, `codex`) |
| `crew` | string | Crew name |
| `agent` | string | Target agent id |
| `task` | string | Sanitized task description (no CAVEMAN blocks, ANSI, or routing boilerplate) |
| `output` | string | Execution output |
| `exitCode` | number | Process exit code |
| `elapsedMs` | number | Execution time in ms |
| `sessionId` | string\|null | Session identifier |
| `artifactPath` | string\|null | Optional artifact path |
| `metadata` | object | Optional additional metadata |

### Normalization

`normalizeExecutionResult(raw, options)` in `types/agent-execution-result.mjs` handles:
- Missing `output` → falls back to `raw.stdout`
- Missing `exitCode` → falls back to `raw.status`
- All required fields get safe defaults; result is frozen

### Task sanitization

Before evidence is recorded, `task` is passed through `sanitizeTaskDescription()` which strips:
- `[CAVEMAN_CREW]...[/CAVEMAN_CREW]` blocks
- ANSI escape sequences
- `Routing note from orchestrator:` lines
- Delegate-only scaffolding (`Delegate internally ONLY...`)

### Evidence pipeline

`scripts/evidence-pipeline.mjs` exports `recordDelegationEvidence()` used by both CLI (`mah delegate`, `mah run`) and PI (`delegate_agent`, `delegate_agents_parallel`). The pipeline:
1. Sanitizes task description
2. Derives task type from keywords (8-category superset)
3. Constructs `AgentExecutionResult` via `normalizeExecutionResult`
4. Attaches `execution_result` to evidence record
5. Calls `recordEvidence` — best-effort, never blocks

### Adding a new runtime

A new runtime adapter satisfies the MAH execution contract by returning a normalized `AgentExecutionResult` from its headless execution path. No new evidence logic is needed in the adapter — the MAH control plane handles lifecycle, provenance, and expertise persistence from the canonical result.
