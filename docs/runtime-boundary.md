# Runtime Boundary

## Canonical Ownership

- `meta-agents.yaml` is the canonical source for crews, topology, models, skill refs, and domains.
- `scripts/runtime/runtime-adapters.mjs` is the canonical source for runtime operational behavior.

## Why this boundary exists

- Prevents behavior duplication between YAML and runtime dispatch code.
- Keeps operational logic testable in adapter code.
- Keeps config declarative and reviewable.

## Practical rule

- Add declarative data to YAML when it describes reusable crew/config intent.
- Add operational behavior to adapters when it changes dispatch/runtime execution semantics.
- Skill path layout is convention-based in MAH (`skills/<skill-slug>/SKILL.md`), so YAML should reference skill IDs rather than per-runtime path matrices.
- `context_memory` is an internal shared skill default and does not need to be listed in YAML.
- Runtime adapter and projection rules are internal to MAH and live in `scripts/runtime/runtime-adapters.mjs` plus the runtime bridge code, not in user YAML.
- The global install materializes `~/.mah/` as the preferred runtime overlay for `skills/`, `extensions/` (including `extensions/themes/` for PI themes), `mah-plugins/`, and `scripts/`; it also updates `~/.pi/agent/settings.json` so PI discovers themes from `~/.mah/extensions/themes` before falling back to built-in light/dark.
- Expertise catalog loading is workspace-local. `mah sync` / `mah generate` materialize `.mah/expertise/catalog` from `meta-agents.yaml`, and `mah expertise list` reads from that workspace tree rather than from the MAH package repository.

## Headless Execution

- Headless behavior is adapter-owned and declared via `capabilities.headless`.
- MAH core normalizes external UX (`mah run --headless`, `--output=json|text`, `-o=json|text`) while runtime-specific mechanics remain in adapter methods.
- `prepareHeadlessRunContext()` is the contract boundary for runtime-specific non-interactive execution plans.

## Claude Domain Boundary

- In Claude runtime, crew `domain` entries are currently **declarative** unless an adapter-level enforcement surface is available.
- MAH now projects domain intent into sub-agent prompts as `Declared domain rules: ...` for observability and auditability.
- `--policy enforce-domain` activates fail-fast protection in Claude runtime:
  - If granular per-agent domain rules are detected, MAH stops before dispatch with a clear error.
  - This prevents a false sense of path-level enforcement where runtime ACL wiring is not available.
- For path-enforced domain controls, use runtimes/adapters that implement executable ACL/domain checks.

## Current status

- Adapter model is stable enough for current harness usage, but still evolutive in `0.x`.
- External plugin API guarantees are not declared yet.
- Hermes runtime added as first-class adapter in v0.4.0 — see `docs/hermes/runtime-support.md` for details.
