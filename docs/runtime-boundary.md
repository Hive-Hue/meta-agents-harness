# Runtime Boundary

## Canonical Ownership

- `meta-agents.yaml` is the canonical source for crews, topology, models, skills, domains, and runtime projection metadata.
- `scripts/runtime-adapters.mjs` is the canonical source for runtime operational behavior.

## Why this boundary exists

- Prevents behavior duplication between YAML and runtime dispatch code.
- Keeps operational logic testable in adapter code.
- Keeps config declarative and reviewable.

## Practical rule

- Add declarative data to YAML when it describes reusable crew/config intent.
- Add operational behavior to adapters when it changes dispatch/runtime execution semantics.

## Current status

- Adapter model is stable enough for current harness usage, but still evolutive in `0.x`.
- External plugin API guarantees are not declared yet.
