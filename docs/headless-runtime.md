# Headless Runtime Operations (v0.6.0)

This guide documents bounded headless execution in Meta Agents Harness (MAH) for v0.6.0.

## Purpose

Headless mode enables non-interactive runtime execution with explicit behavior:

- No TTY-dependent interaction loops
- Deterministic command plan construction
- Machine-consumable output when requested

## CLI Usage

```bash
mah run --headless -- "your task prompt"
```

Optional output mode:

```bash
mah run --headless --output=json -- "your task prompt"
# or
mah run --headless -o=json -- "your task prompt"
```

## Explainability

Use explain with trace to inspect the operational plan:

```bash
mah explain run --headless --trace -- "your task prompt"
```

## Runtime Capability Contract

Each runtime adapter must declare:

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

## Adapter Hook

Adapters that support headless execution must implement:

```js
prepareHeadlessRunContext({ repoRoot, task, argv, envOverrides })
```

Expected return envelope:

```js
{
  ok: true,
  exec: "<binary>",
  args: [/* base args */],
  passthrough: [/* task/prompt args */],
  envOverrides: { /* merged env */ },
  warnings: [],
  internal: { mode: "headless", runtime: "<name>" }
}
```

Or error:

```js
{ ok: false, error: "<reason>" }
```

## Runtime Notes

- **PI**: headless supported (`promptMode=argv`, `outputMode=stdout`)
- **Claude**: headless supported (`promptMode=argv`, `outputMode=stdout`)
- **OpenCode**: headless supported (`promptMode=argv`, `outputMode=stdout`)
- **Kilo plugin**: headless supported (`promptMode=argv`, `outputMode=stdout`)
- **Hermes**: headless supported but session-gated (`requiresSession=true`, `outputMode=mixed`)
- **Codex plugin**: currently declares headless unsupported

## Validation

Run contract validation test:

```bash
node --test tests/headless-contract.test.mjs
```

Run runtime-specific tests:

```bash
node --test tests/headless-pi.test.mjs
node --test tests/headless-claude.test.mjs
node --test tests/headless-opencode.test.mjs
node --test tests/headless-kilo.test.mjs
node --test tests/headless-hermes.test.mjs
node --test tests/headless-codex.test.mjs
```
