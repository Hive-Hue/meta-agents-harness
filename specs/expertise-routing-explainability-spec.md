# Expertise Routing Explainability — Design Specification

**Document type:** Feature design specification
**Status:** Proposed (v0.10.0)
**Target:** v0.10.0 Pillar 2 — Enhanced Expertise Foundation
**Audience:** Architecture, backend, CLI, validation
**Sprint task:** v0.10.0-T5

---

## 1. Executive Summary

Operators need to understand why MAH selected a specific agent for a task. Today, `mah expertise explain` shows agent capabilities but does not expose the routing decision process — scoring breakdowns, policy constraints, candidate ranking, or confidence signals.

This spec defines a **read-only explainability surface** that makes routing decisions transparent without altering routing outcomes. The surface answers: *"Why was agent X chosen for task Y — and why were other candidates not chosen?"*

Key properties:

- **Read-only:** explain never changes routing outcomes
- **Bounded:** output budgets enforced for all modes
- **Runtime-agnostic:** no runtime-specific dependency
- **No mandatory vector store:** evidence scores derived from file-based expertise data

---

## 2. CLI Surface

### 2.1 Command Contract

```bash
# Default: task-based routing explanation
mah expertise explain --task "triage backlog using ClickUp"

# Agent-specific suitability analysis
mah expertise explain --agent planning-lead --task "triage backlog using ClickUp"

# Full scoring breakdown
mah expertise explain --task "triage backlog using ClickUp" --verbose

# Structured JSON output
mah expertise explain --task "triage backlog using ClickUp" --json

# Combined
mah expertise explain --agent planning-lead --task "triage backlog" --verbose --json
```

### 2.2 Flag Semantics

| Flag | Purpose | Required |
|------|---------|----------|
| `--task <text>` | Task description to route against | Yes |
| `--agent <name>` | Show suitability for specific agent instead of routing decision | No |
| `--verbose` | Full scoring breakdown for all candidates | No |
| `--json` | Structured JSON payload | No |

### 2.3 Default Output (≤5 lines)

When neither `--verbose` nor `--json` is specified:

```
Selected: planning-lead (confidence: 0.87)
Reason: strongest capability match for backlog-planning, 3 recent evidence records with 100% pass rate
Candidates considered: 5 | Policy-excluded: 1 (security-reviewer — trust_tier=restricted)
Run with --verbose for full breakdown.
```

Budget: **5 lines max, 120 chars per line.**

### 2.4 Verbose Output

When `--verbose` is specified:

```
Routing Explanation for: "triage backlog using ClickUp"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▸ planning-lead  [SELECTED] confidence: 0.87
  capability_match: 0.92 | domain_fit: 0.85 | evidence: 3 records (100% pass)
  Capabilities: backlog-planning, clickup-integration, sprint-grooming

▸ backend-dev  confidence: 0.61
  capability_match: 0.45 | domain_fit: 0.70 | evidence: 5 records (80% pass)
  ⚠ Low capability match for this task

▸ repo-analyst  confidence: 0.44
  capability_match: 0.30 | domain_fit: 0.55 | evidence: 2 records (100% pass)
  ⚠ Low confidence

✗ security-reviewer  [EXCLUDED]
  Reason: trust_tier=restricted, topology constraint (validation team not in planning workers)
```

Budget: **1 header + 1 separator + ≤5 lines per candidate. Total bounded by candidate count × 5 + 2.**

### 2.5 Agent-Specific Mode (`--agent`)

When `--agent <name>` is specified, output shifts from routing decision to suitability analysis:

```
Suitability: planning-lead for "triage backlog using ClickUp"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Overall confidence: 0.87 (HIGH)

Capability matches:
  ✓ backlog-planning     match: 0.95
  ✓ clickup-integration  match: 0.88
  ✗ frontend-ops         match: 0.10

Domain fit: 0.85 (planning team — planning_delivery domain)
Evidence strength: 3 recent records, 100% pass rate, avg age 2.1 days
Policy: trust_tier=standard, approval_required=false

Verdict: STRONG candidate for this task.
```

---

## 3. Routing Decision Payload

### 3.1 JSON Structure

```json
{
  "task_description": "triage backlog using ClickUp",
  "mode": "routing_decision",
  "selected_agent": {
    "id": "planning-lead",
    "confidence": 0.87,
    "selection_reason": "strongest capability match for backlog-planning, 3 recent evidence records with 100% pass rate"
  },
  "candidates": [
    {
      "agent_id": "planning-lead",
      "ranking_position": 1,
      "selected": true,
      "scores": {
        "capability_match": 0.92,
        "domain_fit": 0.85,
        "evidence_strength": {
          "record_count": 3,
          "recency_days_avg": 2.1,
          "pass_rate": 1.0
        },
        "confidence": 0.87,
        "confidence_flag": "HIGH"
      },
      "policy": {
        "trust_tier": "standard",
        "approval_required": false,
        "excluded": false,
        "exclusion_reason": null
      },
      "matching_capabilities": ["backlog-planning", "clickup-integration", "sprint-grooming"]
    },
    {
      "agent_id": "backend-dev",
      "ranking_position": 2,
      "selected": false,
      "scores": {
        "capability_match": 0.45,
        "domain_fit": 0.70,
        "evidence_strength": {
          "record_count": 5,
          "recency_days_avg": 4.3,
          "pass_rate": 0.80
        },
        "confidence": 0.61,
        "confidence_flag": "MEDIUM"
      },
      "policy": {
        "trust_tier": "standard",
        "approval_required": false,
        "excluded": false,
        "exclusion_reason": null
      },
      "matching_capabilities": ["integration-work"]
    }
  ],
  "policy_constraints_applied": [
    {
      "type": "topology",
      "description": "workers limited to team-assigned agents per topology config"
    },
    {
      "type": "trust_tier",
      "description": "security-reviewer excluded — trust_tier=restricted for planning tasks"
    }
  ],
  "fallback_note": null,
  "metadata": {
    "routing_engine": "expertise-routing.mjs",
    "evidence_source": "file-based",
    "vector_store_used": false,
    "timestamp": "2026-05-09T20:00:00.000Z"
  }
}
```

### 3.2 Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `task_description` | string | The task text passed to `--task` |
| `mode` | enum | `routing_decision` or `suitability_analysis` |
| `selected_agent` | object | The agent the router would select |
| `selected_agent.id` | string | Agent identifier |
| `selected_agent.confidence` | number | Composite confidence 0-1 |
| `selected_agent.selection_reason` | string | Human-readable reason, ≤120 chars |
| `candidates` | array | All evaluated agents, ranked by confidence |
| `candidates[].scores.capability_match` | number | 0-1 overlap between task and agent capabilities |
| `candidates[].scores.domain_fit` | number | 0-1 fit between task domain and agent domain_profile |
| `candidates[].scores.evidence_strength.record_count` | integer | Number of relevant evidence records |
| `candidates[].scores.evidence_strength.recency_days_avg` | number | Average age of matching evidence in days |
| `candidates[].scores.evidence_strength.pass_rate` | number | 0-1 ratio of successful evidence records |
| `candidates[].scores.confidence` | number | Composite score 0-1 |
| `candidates[].scores.confidence_flag` | enum | `HIGH` / `MEDIUM` / `LOW` / `NO_EVIDENCE` |
| `candidates[].policy.excluded` | boolean | Whether policy removed this candidate from selection |
| `candidates[].policy.exclusion_reason` | string\|null | Why excluded, null if not excluded |
| `policy_constraints_applied` | array | Global constraints that shaped the decision |
| `fallback_note` | string\|null | If best-scoring candidate was excluded by policy, explains who was selected instead and why |
| `metadata` | object | Engine version, data sources, timestamp |

---

## 4. Confidence Scoring Model

### 4.1 Composite Formula

```
confidence = (
  W_capability × capability_match +
  W_evidence  × evidence_score   +
  W_domain    × domain_fit       +
  W_continuity × continuity_bonus
) / (W_capability + W_evidence + W_domain + W_continuity)
```

### 4.2 Default Weights

| Component | Weight | Source |
|-----------|--------|--------|
| `capability_match` | 0.40 | Expertise model capabilities vs task text |
| `evidence_score` | 0.30 | Evidence records from expertise evidence store |
| `domain_fit` | 0.20 | Agent domain_profile vs task context |
| `continuity_bonus` | 0.10 | Session continuity — agent active in current session |

### 4.3 Component Calculations

**capability_match (0–1):**
- Lexical overlap between task text tokens and agent capability keywords
- Weighted by capability importance in expertise model
- If expertise model has `capability_weights`, use them; otherwise uniform

**evidence_score (0–1):**
```
evidence_score = min(1.0, record_count / MIN_EVIDENCE_THRESHOLD) × pass_rate × recency_factor
recency_factor = 1.0 / (1.0 + avg_age_days / RECENCY_HALF_LIFE)
```

**domain_fit (0–1):**
- Binary match: 1.0 if task context aligns with agent's `domain_profile`, 0.3 otherwise
- Future: semantic similarity via vector adapter (optional, additive)

**continuity_bonus (0–1):**
- 1.0 if agent is currently active in session
- 0.5 if agent was active in last 3 sessions
- 0.0 otherwise

### 4.4 Constants

| Constant | Default | Description |
|----------|---------|-------------|
| `MIN_EVIDENCE_THRESHOLD` | 5 | Records needed for full evidence score |
| `RECENCY_HALF_LIFE` | 7.0 | Days for recency factor to halve |
| `LOW_CONFIDENCE_THRESHOLD` | 0.50 | Below this → `LOW` flag |
| `HIGH_CONFIDENCE_THRESHOLD` | 0.75 | Above this → `HIGH` flag |
| `NO_EVIDENCE_THRESHOLD` | 0 | 0 records → `NO_EVIDENCE` flag |

### 4.5 Confidence Flags

| Flag | Condition |
|------|-----------|
| `HIGH` | confidence ≥ 0.75 and evidence record_count ≥ 2 |
| `MEDIUM` | 0.50 ≤ confidence < 0.75 |
| `LOW` | confidence < 0.50 |
| `NO_EVIDENCE` | evidence record_count = 0 |

### 4.6 Low-Confidence Warning

When the selected agent has `confidence < LOW_CONFIDENCE_THRESHOLD`:
- Default output appends: `⚠ Low confidence selection. Consider reviewing task description or adding evidence.`
- JSON payload includes `"low_confidence_warning": true` on selected_agent

---

## 5. Integration Points

### 5.1 Routing Engine

**File:** `scripts/expertise/expertise-routing.mjs`

The routing engine must expose a new function:

```javascript
export function explainRoutingDecision(expertiseDir, taskDescription, options = {}) {
  // options.agent — if set, return suitability analysis for specific agent
  // Returns: RoutingDecisionPayload (Section 3)
}
```

This function:
- Calls the existing routing logic but returns the full decision structure instead of just the selected agent
- Must NOT alter the routing algorithm — same inputs produce same selected agent
- Gathers scoring intermediates that the router currently computes but discards

### 5.2 CLI Surface

**File:** `scripts/meta-agents-harness.mjs`

Add `explain` subcommand to the `expertise` namespace:
- Parse `--task`, `--agent`, `--verbose`, `--json` flags
- Call `explainRoutingDecision` from routing engine
- Format output per Section 2 (default / verbose / JSON modes)

### 5.3 Expertise Model YAML

**File:** `expertise/*.yaml` (per-agent expertise models)

No schema changes required. The explainability surface reads existing fields:
- `capabilities` — for capability_match scoring
- `capability_weights` — optional per-capability importance (if absent, uniform)
- `domain_profile` — for domain_fit scoring
- `trust_tier`, `approval_required` — for policy constraint display

Optional additive field (future, not blocking):
- `capability_embeddings` — pre-computed vectors for semantic capability matching

### 5.4 Evidence Store

**File:** `scripts/expertise/evidence/expertise-evidence-store.mjs`

The explain surface reads evidence records to compute `evidence_strength`. No writes. Uses existing `readEvidenceStore` function.

---

## 6. Constraints

| Constraint | Enforcement |
|------------|-------------|
| Explain must not alter routing | `explainRoutingDecision` returns payload without calling `selectAgent` — both call the same scoring function independently |
| No mandatory vector store | `domain_fit` uses lexical matching by default; vector similarity is optional additive |
| Bounded output | Default ≤5 lines, verbose ≤ N×5+2 lines, JSON ≤ 50KB |
| Runtime-agnostic | No runtime imports; pure expertise + evidence data |
| No PII in output | Task descriptions truncated to 100 chars in stored payloads |
| Backward compatible | New `explain` subcommand does not change existing `mah expertise` behavior |

---

## 7. Acceptance Criteria

| # | Criterion | Status |
|---|-----------|--------|
| AC1 | `mah expertise explain --task "..." --json` returns structured JSON with scoring breakdown for all candidates | [ ] |
| AC2 | Default output is ≤5 lines with selected agent name, confidence score, and short reason | [ ] |
| AC3 | Per-candidate scoring includes `capability_match`, `domain_fit`, `evidence_strength`, and composite `confidence` | [ ] |
| AC4 | Candidates below `LOW_CONFIDENCE_THRESHOLD` are flagged with warning in both text and JSON output | [ ] |
| AC5 | Policy constraints that excluded candidates are visible in output with exclusion reason | [ ] |
| AC6 | `--verbose` shows full scoring breakdown for all candidates including matching capabilities | [ ] |
| AC7 | `--agent <name>` shows suitability analysis for specific agent with per-capability match scores | [ ] |
| AC8 | Explain output does not alter routing behavior — running `mah expertise route` before and after explain produces identical results | [ ] |
| AC9 | No mandatory external dependency — works with file-based expertise and evidence data only | [ ] |
| AC10 | JSON payload includes `metadata.vector_store_used: false` when no vector store is configured | [ ] |
| AC11 | `fallback_note` is populated when the highest-scoring candidate was excluded by policy | [ ] |

---

## 8. Out of Scope

- Automatic routing adjustment based on explain feedback
- Vector-embedded capability matching (optional future, not blocking)
- Historical routing decision log
- WebUI rendering of explain output
- Cost estimation based on agent selection
- Multi-step routing chain explanation (e.g., orchestrator → lead → worker)

---

## 9. Dependencies

- Existing expertise routing engine (`scripts/expertise/expertise-routing.mjs`)
- Existing evidence store (`scripts/expertise/evidence/expertise-evidence-store.mjs`)
- Per-agent expertise model YAML files
- No new external dependencies

---

## 10. Exit Condition

This spec is implemented when operators can run `mah expertise explain --task "any task"` and receive a transparent, structured explanation of why a specific agent would be selected, what alternatives were considered, what policy constraints applied, and what the confidence level is — without any change to actual routing behavior.
