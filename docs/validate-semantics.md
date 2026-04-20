# Validation Semantics

## Scope

This document defines the primary ownership of each validation command to avoid overlapping diagnostics.

## Commands

### `validate:config`

Owns declarative and semantic config checks:

- schema and required fields
- config version compatibility
- cross-reference integrity (`model_ref`, `agent.skills`, `domain_profile`, topology references)

Primary failure examples:

- unknown `model_ref`
- missing orchestrator agent in crew topology
- unsupported config version
- unknown skill refs declared on an agent

### `validate:runtime`

Owns operational runtime checks:

- runtime adapter precheck (`markerDir`, command table, declared runtime wiring)
- runtime executable health (`check:runtime` dispatch)

Primary failure examples:

- missing runtime wrapper/cli executable
- adapter precheck invalid for selected runtime

### `validate:sync`

Owns materialization/drift checks:

- generated runtime artifacts versus canonical source
- prompt/config drift for crew projections

Primary failure examples:

- missing generated artifact
- out-of-sync generated file

### `validate:all`

Owns ordered composition:

1. `validate:config`
2. `validate:sync`
3. `validate:runtime`

`validate:all` should report a composed status while preserving per-level diagnostics.

## Ownership Rule

Each error should belong to one primary validation level.  
If a failure could appear in more than one place, assign it to the earliest semantic owner above.
