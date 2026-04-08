# Hermes Capability Inventory — v0.4.0 Runtime Evolution

**Branch:** development
**Sprint:** v0.4.0-runtime-evolution
**Purpose:** Bounded inventory of Hermes CLI surface, MAH exposure, gaps, and runtime-capture risks.

---

## 1. Hermes CLI Commands (hermesh wrapper)

Source: `.hermes/scripts/hermesh.mjs`, `docs/hermes/runtime-support.md`

### 1.1 hermesh Commands

| Hermes Command | Flags / Args | Description |
|---|---|---|
| `list:crews` | `[--json]` | List available crews from `meta-agents.yaml` |
| `use <crew>` | `--crew <crew>` | Set active crew; persists to `.hermes/.active-crew.json` |
| `clear` | — | Remove active crew selection |
| `run` | `--crew <crew>`, `--new-session`, `--session-root <path>`, `[-- ...passthrough]` | Run Hermes interactively (delegates to `hermes chat`) |
| `chat` | `--crew <crew>`, `--new-session`, `--session-root <path>`, `[-- ...passthrough]` | Alias for `run` (both route to `hermes chat`) |
| `doctor` | `--crew <crew>`, `--json`, `[-- ...passthrough]` | Health-check crew config + forward to `hermes doctor` |
| `check:runtime` | `--crew <crew>`, `--json` | Check `.hermes/` artifact completeness |

### 1.2 Internal Hermes CLI Calls (from hermesh.mjs)

| Internal Call | Context |
|---|---|
| `hermes sessions list --limit 1` | Used by `latestSessionId()` to pin/resume sessions |
| `hermes chat -Q -q <query>` | Bootstrap query injection before interactive session |
| `hermes doctor` | Forwarded passthrough in `hermesh doctor` |

---

## 2. MAH `mah` CLI Surface — Hermes Coverage

Source: `scripts/meta-agents-harness.mjs`, `scripts/runtime-adapters.mjs`

### 2.1 MAH Commands with Hermes Mapping

| MAH Command | Hermes Equivalent | Adapter Status | Notes |
|---|---|---|---|
| `mah detect` | runtime detection via `.hermes/` marker or `hermes`/`hermesh` in PATH | Supported | Detection reason: `forced`, `marker`, or `cli` |
| `mah list:crews` | `hermesh list:crews` | Supported | Via `node .hermes/bin/hermesh list:crews` (variant chain) |
| `mah use <crew>` | `hermesh use <crew>` | Supported | Persists to `.hermes/.active-crew.json` |
| `mah clear` | `hermesh clear` | Supported | Removes active-crew state |
| `mah run` | `hermesh run` → `hermes chat` | Supported | `--session-mode new/continue`, `--session-id`, `--session-root` passed through |
| `mah doctor` | `hermesh doctor` → `hermes doctor` | Supported | |
| `mah check:runtime` | `hermesh doctor` (via `check:runtime` alias) | Supported | |
| `mah validate:runtime` | `hermesh doctor` | Supported | |
| `mah validate` | `hermesh doctor` | Supported | |
| `mah validate:config` | — | Supported | Not Hermes-specific |
| `mah validate:sync` | — | Supported | Not Hermes-specific |
| `mah validate:all` | — | Supported | Not Hermes-specific |
| `mah sessions` | — | **Not Hermes-specific** | MAH sessions collection; Hermes native sessions not enumerated |
| `mah graph` | — | Partial | Uses MAH provenance data, not Hermes session graph |
| `mah explain` | — | Supported | Shows Hermes dispatch resolution |
| `mah init` | — | Partial | Creates `.hermes/` marker if `--runtime hermes` |
| `mah plan` | — | Supported | Not Hermes-specific |
| `mah diff` | — | Supported | Not Hermes-specific |

### 2.2 Hermes Runtime Capabilities (from meta-agents.yaml / runtime-adapters.mjs)

| Capability | Value | MAH Surface |
|---|---|---|
| `persistent_memory` | `true` | Not operator-facing in MAH |
| `supports_background_operation` | `true` | Not surfaced in MAH CLI |
| `supports_multi_backend_execution` | `true` | Not surfaced in MAH CLI |
| `gateway_aware` | `true` | Not surfaced in MAH CLI |
| `sessionModeNew` | `true` | `--session-mode new` on `mah run` |
| `sessionModeContinue` | `true` | `--session-mode continue` on `mah run` |
| `sessionModeNone` | `false` | Warning emitted; session persists |
| `sessionIdViaEnv` | `HERMES_SESSION_ID` | `--session-id` passed through |
| `sessionRootFlag` | `--session-root` | Passed through to wrapper |

---

## 3. Runtime Capture Risk — Hermes Capabilities Without MAH Equivalents

These are points where Hermes functionality exists but MAH does not surface or manage it. Each represents a potential gravity point pulling MAH toward Hermes-specific behavior.

| Hermes Capability / Feature | MAH Gap | Risk Level |
|---|---|---|
| `hermes sessions list` — native session enumeration | MAH `sessions` command does not read Hermes session store; only MAH-projected provenance | **Medium** |
| Hermes session pinning per crew (`orchestrator_session_id` in `.active-crew.json`) | No MAH command to inspect, clear, or manage pinned sessions; internal only | **Medium** |
| Bootstrap query injection (`hermes chat -Q -q`) | No MAH flag to trigger or disable bootstrap context load; implicit on fresh `mah run` | **Low** |
| Hermes prompt/frontmatter loading from `.hermes/crew/<crew>/agents/` | Not operator-accessible via MAH; purely internal bootstrap | **Low** |
| Multi-backend execution (`supports_multi_backend_execution: true`) | Not exposed; no MAH flag to select or visualize backend targets | **Medium** |
| Background operation (`supports_background_operation: true`) | No MAH command for background Hermes runs; `mah run` is always blocking | **Medium** |
| Gateway awareness (`gateway_aware: true`) | Not exposed; no MAH control over gateway integration | **Medium** |
| Persistent memory (`persistent_memory: true`) | Not configurable or observable via MAH; Hermes-native behavior only | **Low** |
| Crew-level multi-team topology from `multi-team.yaml` | MAH projects this but does not render Hermes team topology as a first-class view | **Low** |
| Hermes-native `doctor` passthrough args | `-- ...passthrough` forwarded but not validated or documented in MAH help | **Low** |

---

## 4. Hermes Commands / Flags with NO MAH Equivalent

These are Hermes CLI features that exist in the codebase but have no corresponding `mah` command, flag, or path.

| Hermes Command / Flag | Location | MAH Gap |
|---|---|---|
| `hermes sessions list [--limit N]` | `hermesh.mjs` line 215 | No `mah sessions --runtime hermes --list` equivalent |
| `hermes chat -Q -q <query>` (quiet bootstrap) | `hermesh.mjs` line 415 | No MAH flag to trigger quiet/headless bootstrap query |
| `--new-session` on `hermesh run` | `hermesh.mjs` line 399 | Supported via `--session-mode new`; functionally equivalent |
| `--session-root <path>` passthrough | `hermesh.mjs` line 398 | Stored as wrapper metadata; Hermes does not natively honor this |
| `--json` on `hermesh list:crews` | `hermesh.mjs` line 333 | `mah list:crews --json` works (via adapter) |
| `--json` on `hermesh doctor` | `hermesh.mjs` line 373 | `mah doctor --json` works (via adapter) |
| `--json` on `hermesh check:runtime` | `hermesh.mjs` line 361 | `mah check:runtime --json` works (via adapter) |
| Hermes expertise model files (`.hermes/crew/<crew>/expertise/*.yaml`) | `hermesh.mjs` line 276 | Not readable via MAH |
| Hermes skill files (`.hermes/skills/<skill>/SKILL.md`) | `hermesh.mjs` line 276 | Not operator-accessible via MAH |
| `MAH_HERMES_CONFIG`, `MAH_HERMES_MULTI_TEAM`, `MAH_HERMES_SESSION_ROOT` env vars | `hermesh.mjs` lines 314–318 | Internal only; not documented as operator surface |
| `HERMES_SESSION_ID` env var for resume | `hermesh.mjs` line 402 | Captured by wrapper; not a user-facing MAH flag |

---

## 5. Deferred — Out of v0.4.0 Scope

The following are identified but explicitly deferred beyond v0.4.0. Adding any of these would constitute v0.5.0+ work.

| Deferred Item | Rationale |
|---|---|
| Full Hermes feature parity | Against sprint "no full Hermes parity" directive |
| Hermes native session store enumeration via `mah sessions` | Would require Hermes session store integration; remote-session foundation |
| Policy engine integration | Not in v0.4.0 scope |
| Federation / interconnect between Hermes and other runtimes | Not in v0.4.0 scope |
| Confidential / secure execution mode for Hermes | Not in v0.4.0 scope |
| Hermes background operation (`mah run --background`) | Blocking-only run model; background requires separate infrastructure |
| Multi-backend execution visualization or control | No MAH surface for backend routing; would require runtime contract expansion |
| Gateway-aware routing in MAH dispatcher | `gateway_aware: true` capability exists in config but no MAH control surface |
| MAH becoming Hermes-shaped product alignment | Anti-goal explicitly flagged in sprint must_not_deliver |

---

## 6. Runtime Capture Risk Section

**Definition:** A runtime-capture risk is any Hermes feature that, if added to MAH, would pull the product toward being "Hermes-shaped" instead of remaining runtime-agnostic.

### 6.1 Active Capture Risk Points

| Risk | Description | Severity |
|---|---|---|
| **Hermes bootstrap query injection** | `hermesh.mjs` injects crew context via `hermes chat -Q -q`. If MAH adopts this as the default session-start model, other runtimes must replicate it or Hermes becomes the "correct" runtime. | **High** |
| **Hermes session pinning** | `.active-crew.json` stores `orchestrator_session_id` per crew. This is Hermes-specific session management leaking into MAH state. If other runtimes get analogous state, MAH becomes a session-state aggregator rather than an orchestrator. | **High** |
| **Hermes capabilities as MAH features** | `persistent_memory`, `multi_backend_execution`, `gateway_aware` are Hermes-native features declared in `meta-agents.yaml`. If MAH surfaces these as first-class features (e.g., `mah run --enable-persistent-memory`), Hermes semantics become MAH semantics. | **Medium** |
| **Hermes adapter command variants** | The Hermes adapter in `runtime-adapters.mjs` has more command variants than other runtimes (4 per command vs 3 for others). This asymmetry signals Hermes is getting preferential adapter coverage. | **Medium** |
| **Hermes-only session env vars** | `MAH_HERMES_CONFIG`, `MAH_HERMES_MULTI_TEAM`, `MAH_HERMES_SESSION_ROOT` are Hermes-specific. If new env vars are added per-runtime, MAH becomes a runtime-specific env var store. | **Low** |
| **Hermes prompt projection** | MAH generates `.hermes/crew/<crew>/agents/*.md` from `meta-agents.yaml`. If Hermes agent prompts are the most feature-complete, teams will treat Hermes as the canonical runtime and migrate toward it. | **Low** |

### 6.2 Anti-Capture Guidance

- MAH's session model must remain runtime-agnostic. The `.active-crew.json` pinning mechanism is Hermes-specific and should be evaluated for removal or abstraction in v0.5.0.
- Bootstrap context injection (`-Q -q`) must be evaluated as a general pattern, not a Hermes-specific one. If it is valuable, it should be runtime-general.
- Hermes capabilities (`persistent_memory`, `gateway_aware`, etc.) must not become MAH CLI flags without a cross-runtime capability agreement.
- The Hermes adapter should have feature parity with other adapters, not exceed them.

---

## 7. Summary Table — Command Coverage Map

| Hermes Command | MAH Command | Covered? |
|---|---|---|
| `hermesh list:crews` | `mah list:crews` | Yes |
| `hermesh use <crew>` | `mah use <crew>` | Yes |
| `hermesh clear` | `mah clear` | Yes |
| `hermesh run` | `mah run` | Yes |
| `hermesh chat` | `mah run` | Yes |
| `hermesh doctor` | `mah doctor` | Yes |
| `hermesh check:runtime` | `mah check:runtime` | Yes |
| `hermes sessions list` | `mah sessions` | **Partial** (MAH provenance only, not Hermes native) |
| `hermes chat -Q -q <query>` | — | **No MAH equivalent** |
| Hermes env vars (internal) | — | **Internal only** |
| Hermes expertise model files | — | **No MAH equivalent** |
| Hermes skill files | — | **No MAH equivalent** |

---

*Inventory produced for v0.4.0-runtime-evolution sprint. All deferred items are explicitly out-of-scope for the current release.*
