# Meta Agents Harness  
## Expertise Model Specification  
### From Agent Memory to Capability Intelligence

**Document type:** Core feature specification  
**Status:** Future design spec  
**Audience:** Product, architecture, platform, orchestration, future maintainers

---

## 1. Executive Summary

The Expertise Model in Meta Agents Harness should evolve from a simple agent memory artifact into a **core intelligence layer for routing, trust, collaboration, and execution**.

In its stronger form, expertise is not just “what an agent knows.”  
It becomes a structured representation of:

- what an agent or team is qualified to do
- under which conditions it should be used
- where it may operate
- what confidence or trust level it has
- what inputs and outputs it supports
- whether it requires review or confidential execution
- how it performs over time

This shifts expertise from a passive documentation artifact into an active control surface for the orchestration system.

### Core Thesis

> Expertise should become the semantic engine that helps Meta Agents Harness decide **who should handle a task, where it can run, how much it can be trusted, and under what policy constraints it may operate**.

---

## 2. Why This Matters

As Meta Agents Harness evolves into a secure orchestration layer for distributed and federated agent teams, routing tasks based only on topology or static role definitions becomes insufficient.

The system increasingly needs to answer questions like:

- Which agent or team is actually best suited for this task?
- Which expertise is trusted enough for autonomous handling?
- Which expertise is valid only in certain environments or trust tiers?
- Which expertise may be exported to another team or federation domain?
- Which expertise may require confidential execution?
- Which expertise is merely declared, versus observed and validated?

A richer Expertise Model enables:

- better delegation quality
- lower operational ambiguity
- stronger trust-aware routing
- reusable specialist capability catalogs
- federated expertise exchange
- measurable improvement over time

---

## 3. Product Thesis

The Expertise Model should evolve from:

- static memory
- prompt-side notes
- unstructured domain hints

into:

- structured capability metadata
- confidence-aware execution guidance
- validation-aware trust signals
- policy-aware routing intelligence
- exportable expertise contracts

### Short Form

**Memory remembers. Skills instruct. Expertise decides where, when, and with what confidence an agent should be used.**

---

## 4. Design Goals

### G1 — Make expertise operational
Expertise should influence actual orchestration behavior, not just documentation.

### G2 — Support expertise-aware delegation
The system should use expertise to help choose who should receive work, within allowed topology and policy boundaries.

### G3 — Support trust-aware expertise
The system should distinguish between self-declared, observed, and validated expertise.

### G4 — Make expertise portable and federatable
Expertise should be exportable across teams and federation domains under policy.

### G5 — Support measurable expertise quality
The system should track expertise performance over time.

### G6 — Support environment- and policy-aware expertise
Some expertises should only be usable in certain nodes, trust tiers, or confidential modes.

---

## 5. Non-Goals

### NG1
The Expertise Model is not intended to become a full ontology engine from day one.

### NG2
The Expertise Model should not replace policy or topology; it should complement them.

### NG3
The Expertise Model should not make automatic trust decisions without evidence or policy.

### NG4
The Expertise Model should not be reduced to freeform text blobs.

---

## 6. Core Conceptual Shift

The feature should move through this maturity ladder:

### Stage 1 — Memory Artifact
Expertise exists mostly as notes, prompt context, or other freeform working artifacts.

### Stage 2 — Structured Expertise Metadata
Expertise becomes a structured object with fields and constraints.

### Stage 3 — Expertise-Aware Orchestration
Expertise influences delegation, routing, and trust decisions.

### Stage 4 — Federated Expertise Layer
Expertise can be exported, shared, requested, and audited across teams.

### Stage 5 — Measured Capability Intelligence
Expertise is continuously improved through observed evidence and validation.

## 6.1 Current Runtime Direction

As of `v0.7.0`, the implementation has already moved into the Stage 2-5 space:

- canonical catalog-backed expertise loading
- routing with explainable scoring and filtering
- evidence capture and confidence aggregation
- lifecycle and governance controls
- bounded export/import with redaction

The remaining work is refinement, policy hardening, and coverage, not invention of the core model.

---

## 7. Expertise Layers

The strongest model separates expertise into three layers.

### 7.1 Declared Expertise
What an agent or team claims to be able to do.

Examples:
- hardware diagnostics
- policy review
- RAG synthesis
- frontend implementation
- incident triage

**Purpose:** initial authoring and routing hints  
**Risk:** may be inaccurate or aspirational

### 7.2 Observed Expertise
What the system learns from real execution.

Examples:
- success rate
- review outcomes
- escalation frequency
- latency
- failure patterns
- environment compatibility

**Purpose:** empirical evidence  
**Risk:** can drift or reflect biased task distribution

### 7.3 Trusted Expertise
What has been validated by policy, human review, automated evaluation, or sustained evidence.

Examples:
- approved for autonomous low-risk execution
- validated for policy-sensitive review
- approved only under supervision
- confidential-only expertise

**Purpose:** policy-grade confidence signal  
**Risk:** requires governance process

---

## 8. Core Responsibilities of the Expertise Model

The Expertise Model should help answer:

1. **Who is allowed to receive this task?**
2. **Who is best suited to receive this task?**
3. **What confidence level applies?**
4. **Which environments are acceptable?**
5. **Does this expertise require supervision or approval?**
6. **Can this expertise be exported to another team?**
7. **Does this task require confidential execution?**
8. **What handoff contract applies?**

---

## 9. Expertise Object Model

A future expertise object may include fields like:

```yaml
id: hardware-diagnostics
name: Hardware Diagnostics
domain: edge-ops
description: Diagnose device issues using telemetry, logs, and bounded inspection workflows.
owner:
  type: team
  id: validation-team
declared_capabilities:
  - read_telemetry
  - inspect_service_health
  - classify_anomaly
restricted_capabilities:
  - direct_actuation
input_contract:
  schema_ref: contracts/hardware-diagnostics-input.json
output_contract:
  schema_ref: contracts/hardware-diagnostics-output.json
allowed_environments:
  - edge-node
  - private-vps
trust_tier_required: 2
confidential_mode:
  required: false
  preferred: false
validation_status: validated
confidence_score: 0.87
evidence_refs:
  - run-182
  - review-991
metrics:
  invocation_count: 124
  success_rate: 0.91
  review_pass_rate: 0.88
  escalation_rate: 0.12
  avg_latency_ms: 2400
  avg_token_cost: 1830
state: active
```

---

## 10. Proposed Data Model

### 10.1 Expertise
- `id`
- `name`
- `domain`
- `description`
- `owner_type` (agent, team, node-scoped service)
- `owner_id`
- `declared_capabilities`
- `restricted_capabilities`
- `input_contract`
- `output_contract`
- `allowed_environments`
- `trust_tier_required`
- `confidential_mode`
- `validation_status`
- `confidence_score`
- `evidence_refs`
- `state`

### 10.2 Expertise Evidence
- `id`
- `expertise_id`
- `source_type` (run, review, evaluation, policy approval)
- `source_ref`
- `signal_type`
- `signal_value`
- `recorded_at`

### 10.3 Expertise Metrics
- `expertise_id`
- `invocation_count`
- `success_rate`
- `review_pass_rate`
- `escalation_rate`
- `avg_latency_ms`
- `avg_token_cost`
- `failure_modes`

### 10.4 Expertise Export Policy
- `expertise_id`
- `federated_allowed`
- `allowed_consumers`
- `allowed_domains`
- `approval_required`
- `data_class_restrictions`

---

## 11. Lifecycle

Expertise should not be static. It should have a lifecycle.

### Suggested States
- `draft`
- `active`
- `restricted`
- `deprecated`
- `experimental`

### Possible Transitions
- `draft -> active` after initial approval
- `active -> restricted` after policy change or repeated issues
- `active -> deprecated` when replaced
- `experimental -> active` after validation
- `active -> experimental` if confidence drops or environment changes

### Lifecycle Principle
An expertise should be treated as a managed product asset, not just documentation.

---

## 12. Confidence and Validation

### 12.1 Confidence Score
A numerical or categorical score that reflects how strongly the system should trust the expertise in routing and autonomy decisions.

Possible bands:
- `low`
- `medium`
- `high`
- `supervised-only`
- `validated-autonomous`

### 12.2 Validation Status
Possible values:
- `declared`
- `observed`
- `validated`
- `restricted`
- `revoked`

### 12.3 Recommended Rule
Declared expertise may inform routing.  
Validated expertise may influence autonomy.  
Restricted or revoked expertise should block certain flows.

---

## 13. Expertise-Aware Delegation

This is one of the highest-value uses of the model.

### Principle
Topology defines **who may delegate to whom**.  
Expertise helps determine **who should receive the task** among permitted targets.

### Delegation Logic Example
1. Find policy-allowed targets
2. Filter by environment compatibility
3. Filter by trust tier compatibility
4. Score by expertise match
5. Adjust score by confidence and validation
6. Route to best eligible target
7. If no trusted match exists, escalate or request approval

### Benefit
This preserves control while making orchestration smarter.

---

## 14. Expertise Registry

The product should eventually expose a registry of available expertises.

### Registry Questions
- Which expertises exist in this team?
- Which team is strongest at policy review?
- Which expertises are exportable?
- Which expertises require confidential mode?
- Which expertises are restricted to certain nodes?

### Value
This turns expertise into a discoverable organizational asset.

---

## 15. Expertise Bundles

Expertise should be able to group into reusable bundles.

### Examples
- `institutional-rag-bundle`
- `secure-ops-bundle`
- `edge-device-bundle`
- `compliance-review-bundle`

### Bundle Composition
A bundle may include:
- expertises
- skills
- policy defaults
- tool constraints
- recommended topology
- handoff contracts

### Why Bundles Matter
They enable templates, onboarding, and domain packaging for customers.

---

## 16. Environment-Aware Expertise

Not every expertise should be globally available.

An expertise may declare:
- allowed environments
- required capabilities
- node class compatibility
- trust tier requirements
- confidential execution preference

### Example
`gpio-diagnostics`
- only on nodes with `hardware_gpio_access`
- only in trust tier >= 2
- not exportable outside local federation domain

### Benefit
Expertise becomes operationally grounded, not abstract.

---

## 17. Confidential Expertise

Some expertises may require stronger execution guarantees.

### Examples
- security review on sensitive logs
- incident triage with sealed data
- policy validation over confidential content
- protected institutional RAG synthesis

### Expertise Fields
- `confidential_mode.required`
- `confidential_mode.preferred`
- `sealed_context_required`
- `attestation_required`

### Why This Matters
It aligns expertise with confidential execution and protected delegation.

---

## 18. Federated Expertise Exchange

The Expertise Model should support cross-team collaboration.

### Exported Expertise
A team may publish a bounded expertise for use by other teams.

### Importing Team
Another team may request that expertise through a structured handoff.

### Key Constraints
Exporting expertise does **not** automatically imply:
- tool access
- node access
- hardware access
- unrestricted session access

These remain separately governed.

### Benefit
This turns expertise into a reusable network asset while preserving trust boundaries.

---

## 19. Handoff Contracts

Each expertise should be able to define a structured contract.

### Contract Elements
- input schema
- output schema
- allowed attachments
- required context fields
- confidentiality level
- failure modes
- escalation policy

### Why This Matters
It makes delegation safer, more interoperable, and easier to validate.

---

## 20. Metrics and Measurement

Expertise should become measurable over time.

### Suggested Metrics
- invocation count
- success rate
- review pass rate
- escalation rate
- average latency
- average token cost
- failure mode distribution
- restricted-use frequency
- confidential-use frequency

### Product Value
This supports:
- explainability
- routing optimization
- trust calibration
- operational improvement
- cost-aware orchestration

---

## 21. Relationship to Other Core Concepts

### Expertise vs Memory
- Memory helps the agent remember context
- Expertise helps the system know when to use the agent

### Expertise vs Skills
- Skills guide how an agent performs tasks
- Expertise defines what the agent is trusted to handle and under what conditions

### Expertise vs Policy
- Policy defines what is allowed
- Expertise helps choose among allowed options

### Expertise vs Topology
- Topology defines reachable delegation paths
- Expertise helps select the best path within those constraints

---

## 22. UX Implications

The UX should expose expertise in operator-friendly terms.

### Potential Views
- expertise registry
- expertise details page
- validation / confidence panel
- delegation recommendation panel
- exported expertise directory
- expertise performance dashboard

### Useful Operator Questions
- Which team is strongest at this task?
- Is this expertise validated or only declared?
- Can this expertise be exported?
- Does this expertise require confidential mode?
- Why was this target selected?

---

## 23. Roadmap Placement

### Phase 1
Structure expertise as first-class objects

### Phase 2
Connect expertise to delegation and routing

### Phase 3
Add confidence, evidence, and lifecycle

### Phase 4
Expose expertise registry and bundles

### Phase 5
Enable federated expertise exchange and confidential expertise paths

---

## 24. Recommended Implementation Path

### Step 1 — Structured Expertise Model
Turn expertise into structured metadata rather than freeform text.

### Step 2 — Expertise-Aware Routing
Use expertise as a scoring signal in delegation.

### Step 3 — Validation and Confidence Layer
Track declared vs observed vs validated expertise.

### Step 4 — Registry and Export Layer
Make expertise discoverable and exportable under policy.

### Step 5 — Federated and Confidential Expertise
Support cross-team exchange and confidential execution-aware expertise.

---

## 25. Open Questions

- Should expertise belong primarily to agents, teams, or both?
- How should confidence be calculated?
- Which evidence sources are trustworthy enough to promote expertise status?
- How should expertise export be approved?
- Which expertises should be allowed to trigger confidential execution?
- How should bundle composition work across products or customers?

---

## 26. Risks

### Product Risks
- making expertise too abstract and hard to manage
- overcomplicating routing too early
- turning expertise into a manual governance burden

### Technical Risks
- mixing expertise with policy in unclear ways
- poor confidence scoring leading to bad routing
- weak contract design for exported expertise

### UX Risks
- showing too much complexity too early
- making expertise feel like bureaucracy instead of leverage
- confusing expertise with roles or skills

---

## 27. Final Recommendation

The Expertise Model should be treated as a high-value core feature.

It has the potential to evolve from simple “agent memory” into a **capability intelligence layer** that powers:

- expertise-aware delegation
- trust-aware orchestration
- environment-aware routing
- federated expertise exchange
- confidential execution decisions
- measurable capability governance

### Strategic Thesis

> The Expertise Model can become the semantic engine for routing, trust, and collaboration inside Meta Agents Harness.

That makes it one of the most powerful future investments in the core platform.
