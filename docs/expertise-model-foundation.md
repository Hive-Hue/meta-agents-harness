## Expertise Model Foundation (v0.8.0)

## Status

Expertise Model is operational foundation for routing, trust calibration, evidence tracking, and bounded export/import in `v0.8.0`.

## System Topology

Two expertise stores exist with different schemas and purposes:

| | System A (Agent Runtime) | System B (Catalog Governance) |
|---|---|---|
| Location | `.<runtime>/crew/<crew>/expertise/<agent>-expertise-model.yaml` | `.mah/expertise/catalog/<crew>/<agent>.yaml` |
| Schema | Simple: patterns, risks, lessons, decisions, observations... | Rich v1: capabilities, domains, confidence, trust_tier, lifecycle, policy |
| Written by | `update_expertise_model` tool at runtime | `mah expertise` CLI commands |
| Synced by | `mah expertise sync` reads System A to discover capabilities | `mah expertise sync` writes confidence updates |
| Purpose | Per-agent durable working memory | Structured capability metadata for routing, trust, export |

## What It Is Now

Expertise Model is structured object used to decide:

- who is eligible to receive task
- who is best candidate among eligible targets
- which environments are allowed
- which trust and validation constraints apply
- how much confidence system should assign
- whether expertise can be exported or imported under policy

## Canonical Implementation

Current implementation is spread across:

- [`types/expertise-types.mjs`](../types/expertise-types.mjs)
- [`scripts/expertise-schema.mjs`](../scripts/expertise-schema.mjs)
- [`scripts/expertise-loader.mjs`](../scripts/expertise-loader.mjs)
- [`scripts/expertise-registry.mjs`](../scripts/expertise-registry.mjs)
- [`scripts/expertise-routing.mjs`](../scripts/expertise-routing.mjs)
- [`scripts/expertise-evidence-store.mjs`](../scripts/expertise-evidence-store.mjs)
- [`scripts/expertise-confidence.mjs`](../scripts/expertise-confidence.mjs)
- [`scripts/expertise-lifecycle.mjs`](../scripts/expertise-lifecycle.mjs)
- [`scripts/expertise-export.mjs`](../scripts/expertise-export.mjs)
- [`scripts/expertise-validate.mjs`](../scripts/expertise-validate.mjs)
- [`scripts/expertise-seed.mjs`](../scripts/expertise-seed.mjs)
- [`scripts/expertise-sync.mjs`](../scripts/expertise-sync.mjs)
- [`scripts/expertise-apply-proposal.mjs`](../scripts/expertise-apply-proposal.mjs)
- [`scripts/expertise-lifecycle-cli.mjs`](../scripts/expertise-lifecycle-cli.mjs)

CLI entry points live under `mah expertise` and are wired through [`scripts/meta-agents-harness.mjs`](../scripts/meta-agents-harness.mjs).

## Current Data Shape

Canonical v1 expertise object includes:

- `id`
- `owner`
- `schema_version`
- `capabilities`
- `domains`
- `input_contract`
- `allowed_environments`
- `validation_status`
- `confidence`
- `trust_tier`
- `lifecycle`
- `policy`
- `evidence_refs`
- `metadata`

Canonical owner is object with `agent` and/or `team`, not freeform string.

## What It Does

Current release supports:

- `mah expertise list`
- `mah expertise show <id>`
- `mah expertise recommend --task "<...>"`
- `mah expertise evidence <id>`
- `mah expertise explain --task "<...>"`
- `mah expertise export <id>`
- `mah expertise import <file> --dry-run`
- `mah expertise seed`
- `mah expertise sync`
- `mah expertise propose --from-evidence <id>`
- `mah expertise apply-proposal <file>`
- `mah expertise lifecycle <id> --to <state>`
- `mah validate:expertise`

Behaviorally, MAH now:

- routes with seeded catalog data
- scores candidate targets with explainable routing data
- records delegation evidence from pi runtime
- sync bridges runtime expertise (System A) and catalog governance (System B)
- updates confidence from evidence and synced signals
- preserves policy and redaction boundaries during export

## Current Limitations

- Lifecycle transitions are CLI-only — no automatic promotion from sync
- Capability discovery from System A uses keyword matching — may miss implicit capabilities
- Evidence recording is best-effort — failures never block delegations
- `mah expertise recommend` scores keyword overlap — no semantic matching
- Export is workspace-local — no cross-workspace federation yet

## What It Is Not

Expertise Model is not:

- ontology engine
- federation handshake protocol
- UI product
- automatic trust authority
- replacement for topology or policy

Policy and topology still define what is allowed. Expertise ranks and annotates within that allowed set.

## Relationship To Other MAH Concepts

- `Memory` retains conversational and working context.
- `Skills` provide procedural behavior.
- `Expertise` provides structured capability intelligence.

In practice:

- memory remembers
- skills instruct
- expertise decides who should handle work, within policy

## Operational Notes

- Registry is summary index, not source of truth.
- Catalog is canonical for expertise content and loads from workspace-local `.mah/expertise/catalog`.
- `show`, `recommend`, `explain`, and `export` resolve canonical catalog docs by expertise id and report workspace-relative paths.
- `export` redacts sensitive fields such as `owner_id` and evidence details.
- `validate:expertise` understands current owner object model.
- Lifecycle promotion from `experimental` to `active` requires review evidence.
- Evidence is workspace-local and recorded under `.mah/expertise/evidence/`; redirect with `MAH_EXPERTISE_EVIDENCE_ROOT` only when needed (e.g., shared evidence across multiple workspaces). Tests should use a temp root.

## Evidence Writing Policy

Expertise engine expects high-signal notes and compact observations:

- use `lessons`, `decisions`, `risks`, and `workflows` for durable learning
- reserve `observations` for narrow, time-bound facts
- compress or prune weak notes before they become session logs
- avoid raw transcripts, copied output, or narrative summaries in expertise files

## The Compounding Loop

The expertise and context systems form a virtuous cycle across sessions:

- **Session outcomes** produce evidence, expertise notes, and session artifacts.
- **`mah expertise sync`** bridges those outcomes into the catalog — discovering capabilities, adjusting confidence bands, and strengthening routing data. This is operational strengthening, not maintenance.
- **`mah context propose --from-session`** extracts reusable knowledge from sessions as governed proposals. Draft → human review → promote to operational. This is governed learning, not a raw memory dump.
- **Stronger routing confidence** selects better agents for the next task.
- **Better context** loads the right operational memory for the selected agent.
- **Better outcomes** close the loop.

In short: **route the right agent → load the right context → show the work → compound over time.**

Each sync and each curated proposal makes the next session marginally better. The system improves through use, not through configuration.

## Historical Note

Original `v0.3.0` note captured rename and early stabilization. Current document describes implemented `v0.8.0` behavior.

## Related Release Work

- [`plan/done/expertise-integration-v0.8.0.md`](../plan/done/expertise-integration-v0.8.0.md)
- [`specs/meta-agents-harness-expertise-model-spec.md`](../specs/meta-agents-harness-expertise-model-spec.md)
- [`CHANGELOG.md`](../CHANGELOG.md)
