# Expertise Catalog Governance

## What Actually Happens Today

1. `mah expertise seed` generates catalog entries from `meta-agents.yaml` with declared capabilities
2. Pi runtime records evidence after each delegation to `.mah/expertise/evidence/`
3. `mah expertise sync` reads evidence + System A learnings → updates catalog confidence and discovers capabilities
4. `mah expertise propose --from-evidence <id>` generates governance proposals from evidence
5. `mah expertise apply-proposal <file>` applies approved proposals to catalog
6. `mah expertise lifecycle <id> --to <state>` governs lifecycle transitions with auth + requirements

## Recommended Operator Workflow

| Step | Command | When |
|---|---|---|
| **1. Bootstrap** | `mah expertise seed [--force]` | Once per crew, or when agents/skills change in `meta-agents.yaml` |
| **2. Record** | *(automatic)* | Every pi runtime delegation — no operator action needed |
| **3. Review changes** | `mah expertise sync --dry-run` | Before sync — see what would change |
| **4. Sync** | `mah expertise sync` | Periodically: after sprints, before release cuts, or on demand |
| **5. Propose** | `mah expertise propose --from-evidence <agent>` | When evidence justifies capability/confidence/lifecycle changes |
| **6. Apply** | `mah expertise apply-proposal <file>` | After human review of proposal JSON |
| **7. Govern lifecycle** | `mah expertise lifecycle <id> --to <state>` | When lifecycle state change is warranted (e.g., active → experimental) |
| **8. Export** | `mah expertise export <id> --with-evidence` | When sharing validated expertise across crews |

**Minimal cycle**: seed once → evidence accumulates automatically → sync for updated scores → propose/apply for governance changes.

## Purpose

Expertise catalog is versioned seed for runtime expertise in MAH.
Keep it small, explicit, governed. It is not evidence store and not registry cache.

## Source Of Truth Layers

- `catalog`: canonical seed data for each crew and agent, stored in workspace-local `.mah/expertise/catalog`
- `registry`: derived index rebuilt from catalog into workspace-local `.mah/expertise/registry.json`
- `evidence`: runtime-only learning records stored in workspace-local `.mah/expertise/evidence`
- runtime expertise mirrors: generated from catalog for each runtime, using current workspace as target tree

## Update Flow

1. **Seed (Manual):** run `mah expertise seed` once for bootstrap, then on schema or baseline changes.
2. **Evidence recording (Automated):** pi runtime records evidence after each delegation.
3. **Sync (Manual):** run `mah expertise sync` periodically or after evidence accumulates.
4. **Proposal generation (Manual):** run `mah expertise propose` (often `--from-evidence`).
5. **Review (Manual):** human reviews proposal JSON for durability, safety, and governance fit.
6. **Apply (Manual):** run `mah expertise apply-proposal <file>` for approved proposal.
7. **Registry rebuild (Automated):** `apply-proposal` and `sync` rebuild registry.

Primary proposal generator:

```bash
mah expertise propose <id> --summary "<summary>" --changes '<json>'
```

Command is intentionally limited to `orchestrator` and `*-lead` actors.

Evidence-driven drafting:

```bash
mah expertise propose <id> --from-evidence --evidence-limit 5
```

This drafts conservative changes from recent evidence; approval flow stays manual.

Optional AI rewrite mode:

```bash
mah expertise propose <id> --from-evidence --ai --provider openrouter --model nvidia/nemotron-3-super-120b-a12b:free
```

- `--ai` rewrites `summary`, `rationale`, and `proposed_changes` for reviewer clarity.
- Falls back to deterministic proposal text when AI is not configured or fails.

## Update Rules

- Do not write raw session logs into catalog.
- Do not move transient observations directly into seed files.
- Prefer `lessons`, `decisions`, `risks`, and `workflows` for durable updates.
- Keep catalog minimal: fields needed for routing, validation, trust, governance.
- Use `observed` or `validated` only when evidence is strong enough.
- Use proposals as reviewable step before catalog writes.

## Recommended Ownership

- `orchestrator` and `*-lead` can generate proposals (active).
- `validation-lead` and `security-reviewer` are designated reviewers (role exists).
- `orchestrator` approves final seed as release baseline.

## Bootstrap Policy

`mah expertise seed` is bootstrap mechanism.
When repo is reset, regenerate catalog seed from `meta-agents.yaml` declarations, then govern deltas through evidence + proposals.

## Workspace And Global Overlay

MAH does not load expertise from global `~/.mah` overlay.
Global install keeps shared runtime assets such as skills, extensions, plugins, and themes.
Expertise is workspace concern and is materialized into `.mah/expertise/catalog` by `mah sync` / `mah generate`.

## Automation Skill

The [`skills/expertise-governance/SKILL.md`](../../skills/expertise-governance/SKILL.md) skill provides an automated orchestrator workflow for running the full governance cycle (steps 1–8) across all agents. It includes eligibility rules, evidence-limit guidance, human review criteria, lifecycle transition table, and quality gates.

Use the skill when running governance on a schedule or before release cuts — it automates preparation steps while keeping human review as a required checkpoint before `apply-proposal`.
