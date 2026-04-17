# Expertise Model Foundation (v0.7.0)

## Status

The Expertise Model is no longer just a naming or documentation layer. In `v0.7.0`, it is an operational foundation for routing, trust calibration, evidence tracking, and bounded export/import.

This document reflects the current implementation in the repository, not the original `v0.3.0` stabilization note.

## What It Is Now

The Expertise Model is a structured object that helps MAH decide:

- who is eligible to receive a task
- who is the best candidate among eligible targets
- which environments are allowed
- which trust and validation constraints apply
- how much confidence the system should assign
- whether the expertise can be exported or imported under policy

## Canonical Implementation

The current implementation is spread across:

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

CLI entry points live under `mah expertise` and are wired through [`scripts/meta-agents-harness.mjs`](../scripts/meta-agents-harness.mjs).

## Current Data Shape

The canonical v1 expertise object includes:

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

The canonical owner is an object with `agent` and/or `team`, not a freeform string tag.

## What It Does

The current release supports:

- `mah expertise list`
- `mah expertise show <id>`
- `mah expertise recommend --task "<...>"`
- `mah expertise evidence <id>`
- `mah expertise explain --task "<...>"`
- `mah expertise export <id>`
- `mah expertise import <file> --dry-run`
- `mah validate:expertise`

Behaviorally, MAH now:

- loads canonical expertise from the catalog by id
- scores candidate targets with explainable routing data
- uses confidence and validation as routing signals
- records and aggregates evidence for later decision support
- preserves policy and redaction boundaries during export

## What It Is Not

The Expertise Model is not yet:

- a full ontology engine
- a federation handshake protocol
- a UI product
- an automatic trust authority
- a replacement for topology or policy

Policy and topology still define what is allowed. Expertise only ranks and annotates within that allowed set.

## Relationship To Other MAH Concepts

- `Memory` retains conversational and working context.
- `Skills` provide procedural behavior.
- `Expertise` provides structured capability intelligence.

In practice:

- memory remembers
- skills instruct
- expertise decides who should handle the work, within policy

## Operational Notes

- The registry is a summary index, not the source of truth.
- The catalog remains canonical for expertise content.
- `show`, `recommend`, `explain`, and `export` now resolve canonical catalog documents by expertise id.
- `export` redacts sensitive fields such as `owner_id` and evidence details.
- `validate:expertise` understands the v0.7 owner object model.
- Lifecycle promotion from `experimental` to `active` now requires review evidence.
- Evidence is runtime-only and may be redirected with `MAH_EXPERTISE_EVIDENCE_ROOT`; tests should use a temp root instead of writing into `.mah/expertise/evidence`.
- The repository's checked-in `.mah/expertise/evidence` directory is kept empty except for `.gitkeep`; real evidence should be produced by actual tasks.

## Evidence Writing Policy

The Expertise Engine now expects high-signal notes and short-lived observations to stay compact:

- use `lessons`, `decisions`, `risks`, and `workflows` for durable learning
- reserve `observations` for narrow, time-bound facts
- compress or prune weak notes before they turn into session logs
- avoid storing raw transcripts, copied output, or narrative summaries in the expertise files

This keeps the runtime file budget stable and improves the signal-to-noise ratio for future sessions.

## Historical Note

The original `v0.3.0` foundation note described the point where the name changed from mental model to expertise model. That framing is now obsolete as a release description, but the stabilization goal was still useful as a stepping stone.

## Related Release Work

- [`plan/done/v0.7.0-expertise-engine-plan.md`](../plan/done/v0.7.0-expertise-engine-plan.md)
- [`specs/meta-agents-harness-expertise-model-spec.md`](../specs/meta-agents-harness-expertise-model-spec.md)
- [`CHANGELOG.md`](../CHANGELOG.md)
