# Expertise Integration Plan

## Problem

Two separate expertise systems exist with zero sync. System B (catalog governance) has the rich schema for routing but no data. System A (agent runtime files) has real learnings but a flat format. The routing engine falls back on every call because the catalog is empty.

## Systems

| | System A (Agent Runtime) | System B (Catalog Governance) |
|---|---|---|
| Location | `.pi/crew/dev/expertise/*.yaml` | `.mah/expertise/catalog/dev/*.yaml` |
| Schema | Simple: patterns, risks, lessons, decisions... | Rich: capabilities, domains, confidence, trust_tier, lifecycle... |
| Written by | `update_expertise_model` tool (live) | `mah expertise` CLI (manual, never used) |
| Has real data? | Yes | No — empty shells |
| Purpose | Per-agent durable working memory | Structured capability metadata for routing, trust, export |

## Value Chain

Topology defines **who may delegate to whom**. Expertise determines **who should receive the task** among permitted targets. The routing engine (`expertise-routing.mjs`) is built — scores on capabilities, domains, confidence, lifecycle, trust tier. It works when fed data. Currently fed nothing.

## Phases

### Phase 1: Seed the Catalog from Agent Definitions [v0.8.0, current]

Unblocks routing immediately. Generate catalog entries from `meta-agents.yaml` agent definitions.

**Deliverables:**
- `mah expertise seed` command (or wired into `sync-meta-agents`)
- Seeds `capabilities` from agent role + skills
- Seeds `domains` from crew/agent mission
- Sets `confidence: { score: 0.5, band: low }`, `validation_status: declared`, `lifecycle: active`, `trust_tier: internal`
- Rebuilds registry after seeding
- `mah expertise recommend` and `mah expertise explain` return real scores

**Example seeded entry:**
```yaml
id: dev:backend-dev
owner: { agent: backend-dev }
capabilities: [implementation, api-design, database, testing]
domains: [software-engineering, backend]
confidence: { score: 0.5, band: low }
validation_status: declared
lifecycle: active
trust_tier: internal
```

### Phase 2: Wire Evidence into Runtime Delegations [v0.8.0]

Creates the feedback loop. Pi runtime delegations currently produce zero evidence.

**Deliverables:**
- After each `delegate_agent` / `delegate_agents_parallel` in `multi-team.ts`, call `recordEvidence`
- `expertise_id: "dev:<target>"`, `outcome: success/failure`, `task_type` from keyword matching, `duration_ms` from timing
- Populates `.mah/expertise/evidence/dev:<agent>/` with real delegation results
- `mah expertise evidence dev:backend-dev` returns actual invocation history

### Phase 3: Sync Bridge — Agent Learnings → Catalog Confidence [v0.9.0]

Closes the loop. Evidence + agent learnings feed back into catalog confidence.

**Deliverables:**
- `mah expertise sync` command
- Reads evidence (Phase 2), computes success_rate, invocation_count, avg_latency
- Updates catalog confidence and metrics using existing `expertise-confidence.mjs`
- Scans System A files for recent lessons/decisions hinting at new capabilities
- Proposes capability/domain additions via `mah expertise propose`
- Rebuilds registry

**Unlocks:**
- Confidence bands move low → medium → high based on real evidence
- Routing engine uses real scores instead of uniform 0.5

### Phase 4: Governance Activation [DONE ✅]

Makes the system self-improving.

**Deliverables:**
- `mah expertise apply-proposal <file>` — applies approved proposals to catalog (stale-detect, actor auth, registry rebuild)
- `mah expertise lifecycle <id> --to <state>` — explicit lifecycle transitions with auth + requirements checks
- `mah expertise export <id> --with-evidence` — bundles evidence metrics into export payload
- `scripts/expertise/expertise-apply-proposal.mjs` (new)
- `scripts/expertise/expertise-lifecycle-cli.mjs` (new)
- `scripts/expertise/expertise-export.mjs` (modified)
- `tests/expertise/expertise-governance.test.mjs` (new, 6/6 pass)

## What This Unlocks

| Capability | Before | After Phase 3 |
|---|---|---|
| `mah expertise recommend --task "fix auth bug"` | Falls back, no scoring | Scores backend-dev high based on domains, capabilities, confidence |
| `mah expertise explain --task "..."` | Empty trace | Full decision trace with capability match, confidence adj, penalties |
| `mah delegate --auto` | Ignores expertise | Picks best-scored agent |
| Confidence bands | All low / 0.5 | Evidence-based: 0.85 / high for proven agents |
| `mah expertise export` | Exports empty shells | Exports validated, metrics-backed catalogs |
| Agent learnings | Trapped in System A | Feed into catalog confidence and capability discovery |

## Completion Status

| Phase | Status | Tests | Files |
|---|---|---|---|
| 1: Seed | ✅ Done | — | `scripts/expertise/expertise-seed.mjs` (new) |
| 2: Evidence | ✅ Done | 3/3 pass | `extensions/multi-team.ts`, `tests/expertise/evidence-recording.test.mjs` |
| 3: Sync | ✅ Done | 4/4 pass | `scripts/expertise/expertise-sync.mjs`, `tests/expertise/expertise-sync.test.mjs` |
| 4: Governance | ✅ Done | 6/6 pass | `scripts/expertise/expertise-apply-proposal.mjs`, `scripts/expertise/expertise-lifecycle-cli.mjs`, `scripts/expertise/expertise-export.mjs`, `tests/expertise/expertise-governance.test.mjs` |

Total: 13 tests, 0 failures. Evidence flowing for planning-lead (42), engineering-lead (22), validation-lead (3), backend-dev (1).

Additional fixes delivered during implementation:
- SKILL.md "Where Is Your File" section (agents know where expertise file is)
- MCP script `.claude/scripts/update-expertise-model-mcp.mjs` (opencode/claude-code runtime support)
- `persistArtifact` repo-root-relative path fix (artifact `read()` resolution)
- `deriveCapabilities` uses `agent.id` not `agent.role` (correct capability mapping)

## Scope

- Phase 1 → v0.8.0 (high value, low effort)
- Phase 2 → v0.8.0 (enables the feedback loop)
- Phase 3 → v0.9.0 (the real integration)
- Phase 4 → v0.9.0+ (governance activation)

Phase 1 alone makes the routing engine functional. Phase 2 alone starts building the evidence base. They are independent and can ship separately.
