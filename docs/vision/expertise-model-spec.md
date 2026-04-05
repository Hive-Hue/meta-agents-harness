# Meta Agents Harness  
## Expertise Model Specification  
### From Agent Memory to Capability Intelligence

**Document type:** Core feature specification  
**Status:** Future design spec  
**Audience:** Product, architecture, platform, orchestration, future maintainers

---

## 1. Executive Summary

The Expertise Model in Meta Agents Harness should evolve from a simple agent memory artifact into a **core intelligence layer for routing, trust, collaboration, and execution**.

In its stronger form, expertise is not just “what an agent knows.” It becomes a structured representation of:
- what an agent or team is qualified to do
- under which conditions it should be used
- where it may operate
- what confidence or trust level it has
- what inputs and outputs it supports
- whether it requires review or confidential execution
- how it performs over time

### Core Thesis

> Expertise should become the semantic engine that helps Meta Agents Harness decide **who should handle a task, where it can run, how much it can be trusted, and under what policy constraints it may operate**.

---

## 2. Why This Matters

As Meta Agents Harness evolves into a secure orchestration layer for distributed and federated agent teams, routing tasks based only on topology or static role definitions becomes insufficient.

The system increasingly needs to answer:
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

## 3. Expertise Layers

### Declared Expertise
What an agent or team claims to be able to do.

### Observed Expertise
What the system learns from real execution.

### Trusted Expertise
What has been validated by policy, human review, automated evaluation, or sustained evidence.

---

## 4. Core Responsibilities

The Expertise Model should help answer:

1. Who is allowed to receive this task?
2. Who is best suited to receive this task?
3. What confidence level applies?
4. Which environments are acceptable?
5. Does this expertise require supervision or approval?
6. Can this expertise be exported to another team?
7. Does this task require confidential execution?
8. What handoff contract applies?

---

## 5. Proposed Object Model

A future expertise object may include:

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
state: active
```

---

## 6. Key Behaviors

### Expertise-Aware Delegation
Topology defines **who may delegate to whom**.  
Expertise helps determine **who should receive the task** among permitted targets.

### Expertise Registry
The product should eventually expose a registry of available expertises.

### Expertise Bundles
Reusable bundles such as:
- `institutional-rag-bundle`
- `secure-ops-bundle`
- `edge-device-bundle`
- `compliance-review-bundle`

### Environment-Aware Expertise
Some expertises should only be usable in certain nodes, trust tiers, or confidential modes.

### Federated Expertise Exchange
A team may publish a bounded expertise for use by other teams.

### Confidential Expertise
Some expertises may require stronger execution guarantees and confidential execution mode.

---

## 7. Relationship to Other Core Concepts

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

## 8. Roadmap Placement

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

## 9. Final Recommendation

The Expertise Model should be treated as a high-value core feature.

It has the potential to evolve from simple “agent memory” into a **capability intelligence layer** that powers:
- expertise-aware delegation
- trust-aware orchestration
- environment-aware routing
- federated expertise exchange
- confidential execution decisions
- measurable capability governance
