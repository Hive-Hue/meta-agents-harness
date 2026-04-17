# Expertise Catalog Governance

## Purpose

The expertise catalog is the versioned seed for runtime expertise in MAH.
It should be small, explicit, and governed. It is not the evidence store and it is not the registry cache.

## Source Of Truth Layers

- `catalog`: canonical seed data for each crew and agent
- `registry`: derived index rebuilt from the catalog
- `evidence`: runtime-only learning records
- runtime expertise mirrors: generated from the catalog for each runtime

## Update Flow

1. Real task execution produces evidence in the runtime evidence store.
2. `orchestrator` or a `*-lead` summarizes evidence into a proposal for catalog changes.
3. A reviewer checks whether the change is durable, reusable, and safe.
4. Approved changes are written into the catalog seed files.
5. Registry is rebuilt from the catalog.
6. Runtime mirrors are resynced from the catalog when needed.

The primary generator is the CLI command:

```bash
mah expertise propose <id> --summary "<summary>" --changes '<json>'
```

That command is intentionally limited to `orchestrator` and `*-lead` actors.

To draft from the evidence store instead of hand-writing the proposal fields:

```bash
mah expertise propose <id> --from-evidence --evidence-limit 5
```

That mode summarizes recent evidence, derives a conservative draft change set, and keeps the final approval flow unchanged.

## Update Rules

- Do not write raw session logs into the catalog.
- Do not move transient observations directly into seed files.
- Prefer `lessons`, `decisions`, `risks`, and `workflows` for durable updates.
- Keep the catalog minimal: only the fields needed for routing, validation, trust, and governance.
- Use `observed` or `validated` only when the evidence is strong enough to justify it.
- Use proposals for the reviewable step before catalog writes; do not edit the seed directly from transient evidence.

## Recommended Ownership

- `planning-lead` and `engineering-lead` can generate proposals from evidence and release plans.
- `orchestrator` can also generate proposals when coordinating cross-team changes.
- `validation-lead` reviews whether the proposal matches real execution.
- `security-reviewer` checks for unsafe confidence inflation or policy drift.
- `orchestrator` approves the final seed as part of the release baseline.

## Bootstrap Policy

When the repo is reset, the catalog seed should be recreated from a checked-in bootstrap template, not from runtime data.
That keeps the foundation fresh while still giving the project a known-good starting point.
