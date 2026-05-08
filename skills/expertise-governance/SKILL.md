---
name: expertise-governance
description: Automated expertise catalog curation workflow — sync, propose, apply, and govern lifecycle transitions for all agents in the crew. Designed for orchestrator use.
compatibility: [generic]
---

# Expertise Governance

Use this skill when the orchestrator needs to govern the expertise catalog systematically — either on a schedule (end of sprint, before release), on demand, or triggered by evidence accumulation.

## When To Use

- Before a release cut or sprint retrospective
- When evidence count has grown significantly for one or more agents
- As a periodic maintenance step (e.g., weekly sync + governance cycle)
- When a lead calls for a confidence/lifecycle review
- After the first delegation burst of a new agent

Do NOT use this skill when:

- The catalog was just seeded and no evidence exists yet
- There is no evidence to review (sync would be a no-op)
- A full governance cycle ran recently (avoid noise from duplicate proposals)

## Core Principle

**Automation is for preparation. Humans still approve.** The orchestrator prepares proposals, the governance workflow remains human-reviewed before applying. Auto-apply is disabled by design.

## Table of Contents

1. Workflow Overview (7-step cycle)
2. Step-by-Step Protocol
3. Eligibility Rules
4. Proposal Generation Guidelines
5. Human Review Criteria
6. Lifecycle Transition Rules
7. Quality Gates
8. Integration with Other Skills

---

## 1. Workflow Overview (7-Step Cycle)

```
Step 1  mah expertise seed [--force]
Step 2  (automatic — pi runtime records evidence after each delegation)
Step 3  mah expertise sync --dry-run    ← orchestrator reviews preview
Step 4  mah expertise sync             ← orchestrator executes
Step 5  mah expertise propose --from-evidence [--evidence-limit N]  ← per agent
Step 6  (human review)                 ← human reviews proposal JSON
Step 7  mah expertise apply-proposal   ← orchestrator applies after human approval
```

Optional Step 8 — Lifecycle transition:
```
mah expertise lifecycle <id> --to <state> --actor <role> --reason <text>
```

---

## 2. Step-by-Step Protocol

### Step 1 — Seed

Run once per crew, or whenever agents/skills change in `meta-agents.yaml`.

```bash
mah expertise seed [--force]
```

Use `--force` to overwrite existing entries with fresh declarations from `meta-agents.yaml`.

### Step 2 — Record (automatic)

Pi runtime records evidence after each `delegate_agent` / `delegate_agents_parallel` call. No operator action needed.

Evidence files land in `.mah/expertise/evidence/<crew>/<agent>/`.

### Step 3 — Preview Sync

Before running sync, preview what would change:

```bash
mah expertise sync --dry-run
```

Review output for:
- Any confidence drops (could indicate degraded capability)
- New capabilities discovered from keyword analysis
- Agents with zero evidence (may need manual review)
- Large jumps in evidence count

### Step 4 — Execute Sync

```bash
mah expertise sync
```

This updates confidence scores and discovers new capabilities. Registry is rebuilt automatically.

### Step 5 — Generate Proposals

For each agent that warrants a proposal:

```bash
# Default: 5 most recent evidence events
mah expertise propose <agent-id> --from-evidence --evidence-limit 5 \
  --summary "<human-readable summary>" \
  --output .mah/expertise/proposals/proposal-<agent-id>.yaml

# Example for backend-dev with higher evidence window
mah expertise propose dev:backend-dev --from-evidence --evidence-limit 10 \
  --summary "Evidence-backed confidence update after v0.9 release cycle" \
  --output .mah/expertise/proposals/proposal-dev-backend-dev.yaml
```

### Step 6 — Human Review

Present the proposal to a human (validation-lead or designated reviewer). Review criteria:

- Does the rationale match the actual evidence?
- Are proposed confidence changes directionally correct?
- Is `validation_status` change justified?
- Are proposed lessons/observations durable, not transient?
- Are there red flags: confidence spikes, suspicious keyword-only capability additions?

### Step 7 — Apply

After human approval:

```bash
mah expertise apply-proposal .mah/expertise/proposals/proposal-<agent-id>.yaml [--force]
```

Use `--force` only if the catalog changed since proposal was generated.

### Step 8 — Lifecycle (optional)

```bash
mah expertise lifecycle <agent-id> --to <state> --actor <role> --reason <text>
```

Valid transitions: `experimental → active`, `active → restricted`, `restricted → revoked`, etc.

---

## 3. Eligibility Rules

An agent qualifies for a proposal when at least ONE of:

| Criterion | Threshold | Rationale |
|-----------|-----------|-----------|
| evidence_count | ≥ 5 | Enough runs for statistical signal |
| confidence_change | ≥ 0.1 from previous sync | Meaningful recalibration |
| new_capabilities | ≥ 1 new capability keyword detected | Capability discovery |
| validation_status | `declared` but evidence_count ≥ 10 | Ready for promotion review |
| lifecycle_change_needed | lifecycle is `active` but evidence suggests degradation | Trust signal drop |

An agent does NOT qualify when:

- evidence_count is 0 (nothing to propose from)
- sync dry-run shows no changes
- A proposal for this agent was applied within the last 7 days (avoid noise)

---

## 4. Proposal Generation Guidelines

### `--evidence-limit` choice

| Situation | `--evidence-limit` |
|-----------|-------------------|
| Weekly maintenance | 5 (last week's runs) |
| Pre-release review | 10–15 (full sprint cycle) |
| New agent with few runs | 3 (small sample, still useful) |
| High-volume agent (>50 runs) | 5–10 (conservative window) |

### Summary template

```
<agent-id> — <confidence_change_direction> post-<sprint|release|period>
Evidence: <N> runs | Confidence: <old> → <new> | Status: <old> → <new>
```

### What to include in --summary

- Direction: "confidence update", "validation promotion", "capability expansion"
- Source: "post-sprint evidence", "weekly sync", "release cut"
- Scope: "all agents" or specific agent

---

## 5. Human Review Criteria

A human must review proposals before apply when ANY of:

- `validation_status` change is proposed (`declared → validated` or higher)
- `trust_tier` change is proposed
- `lifecycle` transition out of `active`
- Confidence change > 0.2 in either direction
- New capability keywords are unsubstantiated (keyword-only detection, no lesson backing)

A proposal can be applied without human review only when:

- Only `confidence` score is being updated (within ±0.15)
- No `validation_status`, `trust_tier`, or `lifecycle` changes
- No new capability keywords are being added

---

## 6. Lifecycle Transition Rules

| From | To | Requires | Who Can Authorize |
|------|----|---------|-------------------|
| experimental | active | ≥5 evidence events, confidence ≥0.6 | validation-lead |
| active | restricted | trust_tier drop OR repeated failures | security-reviewer |
| restricted | revoked | governance policy violation | security-reviewer + orchestrator |
| restricted | active | remediation accepted | validation-lead |
| active | experimental | explicit reversion reason | orchestrator |

Lifecycle transitions always require `--actor` and `--reason`.

---

## 7. Quality Gates

### Gate 1: Evidence Base Check

Before proposing, verify:
- The evidence store has entries for the target agent
- Evidence events are not all failures (single failure type is not sufficient for confidence downgrade)

**Fail**: If evidence_count is 0 or all events are failures with no success signal.

### Gate 2: Proposal Coherence Check

Verify the generated proposal:
- Rationale is not empty
- `proposed_changes` has at least one field
- `evidence_refs` contains at least one valid evidence ID
- `target_snapshot` matches the current catalog state

**Fail**: If any check fails. Report the specific failure and do not apply.

### Gate 3: Non-Regression Check

Before applying, verify:
- `apply-proposal --dry-run` equivalent behavior (if available)
- Proposed confidence is not a downgrade for an agent that is performing well
- No lifecycle transitions that would lock an active agent without justification

**Fail**: If non-regression check fails. Return the proposal for human re-review.

### Gate 4: Post-Apply Verification

After applying:
- Run `mah expertise show <agent-id>` to confirm changes persisted
- Run `mah expertise list` to confirm registry consistency
- Confirm registry was rebuilt

**Fail**: If changes did not persist. Run `mah expertise sync` to rebuild.

---

## 8. Integration with Other Skills

### active-listener

Before generating a proposal summary, review recent delegation context. Distinguish:
- Facts: actual evidence events, real success/failure counts
- Assumptions: inferred capability based on keyword detection alone

### delegate-bounded

When delegating a governance sub-task to a lead, assign one agent per delegation. Example:

```
Delegate to engineering-lead: Review the proposal for dev:backend-dev and confirm the confidence change is warranted.
Expected artifact: approval or rejection with rationale.
```

### context-memory

If the task that generated evidence had relevant context memory, that context may contain lessons worth including in the proposal's `lessons` field. Use `mah context find --agent <agent> --task "<task>"` to retrieve.

### bootstrap

When bootstrapping a new crew, run `mah expertise seed` as part of the bootstrap sequence to establish the initial catalog baseline before any delegation begins.

---

## CLI Reference

```bash
# Seed
mah expertise seed [--force]

# Sync
mah expertise sync [--crew <crew>] [--dry-run]

# Propose (per agent)
mah expertise propose <agent-id> --from-evidence [--evidence-limit <N>] \
  --summary "<text>" [--output <path>]

# Propose (all agents — batch)
for agent in $(mah expertise list --json | jq -r '.expertise[].id'); do
  mah expertise propose "$agent" --from-evidence --evidence-limit 5 \
    --summary "Periodic governance update" \
    --output ".mah/expertise/proposals/proposal-$(echo $agent | tr ':' '-').yaml"
done

# Apply
mah expertise apply-proposal <file> [--force] [--json]

# Lifecycle
mah expertise lifecycle <agent-id> --to <state> --actor <role> --reason <text> [--json]

# Export
mah expertise export <agent-id> [--with-evidence] [--json]

# List
mah expertise list [--crew <crew>] [--json]
```
