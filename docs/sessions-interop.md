# Sessions Interoperability (v0.6.0)

## Overview

MAH v0.6.0 introduces canonical session management enabling cross-runtime session export and context injection.

## Core Concepts

### 1. Session Canonical Envelope (mah.session.v1)

Every session gets a canonical envelope:

```json
{
  "schema": "mah.session.v1",
  "mah_session_id": "pi:dev:abc123",
  "runtime": "pi",
  "runtime_session_id": "abc123",
  "crew": "dev",
  "agent": "planning-lead",
  "created_at": "2026-04-14T00:00:00.000Z",
  "last_active_at": "2026-04-14T01:00:00.000Z",
  "summary": "...",
  "artifacts": [],
  "provenance": [],
  "context_blocks": [],
  "raw_export_ref": null
}
```

### 2. Fidelity Levels

| Level | Description | Use Case |
|-------|-------------|----------|
| `full` | Full replay support (if runtime supports it) | Direct session continuation |
| `contextual` | **Default** — summary + artifacts + provenance | Cross-runtime context injection |
| `summary-only` | Text summary only | Lightweight context sharing |

### 3. Session Adapter Contract

Session adapters are validated separately from runtime adapters:

```javascript
const { validateSessionAdapterContract } = require('./session-adapter-contract')
```

Required fields: `runtime`, `listSessions`, `exportSession`, `supportsRawExport`, `supportsContextInjection`, `buildInjectionPayload`

## Operations

### Export

```bash
# MahJSON format (canonical)
mah sessions export pi:dev:abc123 --format mah-json

# Summary markdown
mah sessions export pi:dev:abc123 --format summary-md

# Raw tar.gz (legacy)
mah sessions export pi:dev:abc123 --format runtime-raw
```

### Injection

```bash
# Inject with contextual fidelity (default)
mah sessions inject pi:dev:abc123 --runtime hermes

# Inject with explicit fidelity
mah sessions inject pi:dev:abc123 --runtime hermes --fidelity summary-only
```

### Bridge

```bash
# Full bridge with explainability
mah sessions bridge pi:dev:abc123 --to hermes
```

## Storage Structure

```
.mah/sessions/
├── index.json
├── exports/
│   └── <runtime>/
│       └── <session_id>.mah.json
└── projections/
    └── <target_runtime>/
        └── <session_id>_to_<target>.projection.json
```

## Boundary Rules

- ❌ No universal transcript replay
- ❌ No false "resume anywhere" promises
- ❌ No federation between workspaces
- ❌ No remote session transport
- ❌ No distributed session storage

## Runtime Support Matrix

| Runtime | Raw Export | Context Injection | Full Replay |
|---------|------------|------------------|-------------|
| PI | ✅ | ✅ | ✅ |
| Claude | ✅ | ✅ | ❌ |
| Codex | ✅ | ✅ | ❌ |
| Hermes | ✅ | ✅ | ✅ |
| OpenCode | ✅ | ✅ | ❌ |

## Migration Path

For sessions created before v0.6.0:

1. Sessions continue to work normally
2. Export with `--format runtime-raw` preserves existing behavior
3. New sessions automatically get canonical envelopes on export

## API Reference

### Types (`types/session-types.mjs`)

- `MAH_SESSION_SCHEMA_VERSION`
- `FIDELITY_LEVELS`
- `DEFAULT_FIDELITY_LEVEL`
- `MahSession`, `MahJsonExport`, `InjectionPayload`, etc.

### Session Export (`scripts/session-export.mjs`)

- `exportSession(repoRoot, sessionId, format)` — unified export
- `exportSessionMahJson(repoRoot, sessionId)` — canonical JSON
- `exportSessionSummaryMd(repoRoot, sessionId)` — markdown summary
- `buildMahSessionEnvelope(sessionRef)` — build canonical envelope

### Session Injection (`scripts/session-injection.mjs`)

- `injectSessionContext(repoRoot, session, targetRuntime, fidelityLevel)` — inject context
- `buildInjectionPayload(repoRoot, session, targetRuntime, fidelityLevel)` — build payload
- `determineInjectionStrategy(fidelityLevel, targetRuntime, adapter)` — determine strategy

### Session Bridge (`scripts/session-bridge.mjs`)

- `bridgeSession(repoRoot, sourceSessionId, targetRuntime, options)` — high-level bridge
