# Meta Agents Harness  
## Handoff Specification  
### Secure UX Abstraction Layer for Distributed and Federated Agent Teams

**Document type:** Product + Architecture Handoff Spec  
**Status:** Future-direction handoff  
**Product stage:** Post-`v0.3.0` foundation  
**Audience:** Product, engineering, design, platform, future maintainers

---

## 1. Executive Summary

Meta Agents Harness should evolve from a unified multi-runtime CLI into a **secure orchestration and UX abstraction layer for distributed and federated agent teams**.

In this future direction:

- the **runtime** becomes a **backplane**
- the primary user experience shifts from runtime-centric commands to:
  - team definition
  - topology
  - scopes
  - guardrails
  - target environments
  - execution policy
- agent teams operate across:
  - local machines
  - VPS
  - containers
  - SBCs
  - Raspberry Pi
  - remote nodes
  - hybrid environments
- autonomy is enabled **safely**, through:
  - typologies
  - capability boundaries
  - trust tiers
  - policy gating
  - auditability
  - explainability
- teams and specialist agents may interoperate through a **policy-aware interconnect layer**
- selected sensitive workloads may run through **confidential execution modes**

The product should be positioned as:

> **A secure orchestration and UX control layer for distributed and federated agent teams, abstracting runtime complexity behind topology, policy, execution guardrails, and optional confidential execution.**

---

## 2. Product Thesis

Users should not primarily think about:

- which runtime is active
- which wrapper is being used
- where the agent is physically running
- how session semantics differ by runtime

Users should primarily think about:

- what team should exist
- what that team is allowed to do
- where it can operate
- how it is organized
- what trust boundary applies
- when it can act autonomously
- what needs approval or escalation
- which other teams it may safely collaborate with

Meta Agents Harness becomes:

- **not only** a CLI
- **not only** a runtime abstraction
- but a **policy-aware orchestration layer** for distributed and federated agent systems

---

## 3. Core Product Model

### Layered Model

#### Layer 1 — UX / Control Layer
What operators interact with:
- teams
- policies
- scopes
- nodes
- sessions
- runs
- graphs
- approvals
- audits
- federation domains
- exported expertise

#### Layer 2 — Orchestration Layer
What coordinates execution:
- routing
- delegation
- capability matching
- target resolution
- trust evaluation
- policy evaluation
- inter-team handoff evaluation

#### Layer 3 — Runtime Backplane
Execution-capable runtimes:
- Claude Code
- OpenCode
- PI
- future runtimes

#### Layer 4 — Environment / Execution Plane
Where work runs:
- local machines
- VPS
- containers
- SBCs
- Raspberry Pi
- edge nodes
- remote worker environments

#### Layer 5 — Interconnect / Federation Plane
How teams may discover and collaborate:
- service-like expertise exposure
- bounded capability export
- secure handoff contracts
- domain-aware team federation

#### Layer 6 — Optional Confidential Execution Plane
Where sensitive workloads may execute:
- confidential VMs
- enclaves
- attested containers
- trusted confidential worker environments

#### Layer 7 — Hardware / Service Plane
What agents may act on:
- filesystems
- services
- APIs
- Docker workloads
- GPIO
- sensors
- relays
- cameras
- device daemons

---

## 4. Strategic Value

This direction creates strong differentiation across six dimensions:

1. **UX abstraction** — users configure teams and policies rather than runtime quirks.
2. **Runtime independence** — execution backplanes become replaceable.
3. **Distributed operations** — cloud, local, and edge environments can be coordinated under one model.
4. **Safe autonomy** — agents operate under bounded trust and scope.
5. **Governance and explainability** — policy, audit trails, and operational clarity become first-class.
6. **Federated reuse** — specialist teams and expert agents become reusable under bounded, auditable rules.

---

## 5. Key Concepts

- **Team** — a logical unit of agents with shared intent and policy.
- **Typology** — a structural pattern for team behavior.
- **Scope** — the effective boundary of allowed operation.
- **Capability** — a declared permitted ability.
- **Guardrail** — a constraint on agent autonomy or execution.
- **Target Environment** — a specific execution destination.
- **Trust Tier** — a security classification for execution context.
- **Node** — a registered execution endpoint with declared identity and capabilities.
- **Connector** — a mediated bridge between orchestration and a target node/environment.
- **Federation Domain** — a bounded trust and connectivity domain in which teams may interoperate.
- **Exported Expertise** — a bounded expertise another team may request under policy.
- **Confidential Execution Requirement** — a policy condition requiring an attested confidential environment.

---

## 6. Runtime Backplane Assessment

### Claude Code
Strong candidate for structured, headless, high-quality execution.

### OpenCode
Strong candidate for remote backplane experimentation and service-oriented execution.

### PI
Useful and flexible, but less naturally aligned to autonomous remote backplane operation without an additional orchestration layer.

### Strategic Conclusion
The product should **not** rely on any runtime as the whole control model.

Instead:
- runtime = execution substrate
- orchestration layer = policy + routing + visibility
- connectors = safe operational bridge
- interconnect = bounded collaboration layer
- confidential execution = optional high-trust path
- UX layer = user-facing control plane

---

## 7. Federated Interconnect

The interconnect layer should be a **policy-aware coordination fabric** through which agent teams, runtimes, and execution environments can:

- discover each other
- delegate bounded work
- request expertise
- expose capabilities
- exchange structured outputs
- participate in controlled handoffs

It should be treated as a **federated service layer**, not as unrestricted peer-to-peer messaging.

### Key Principles
- no implicit trust from network reachability
- default deny for cross-team exchange
- explicit export/import permissions
- structured handoff instead of free-form unrestricted control
- provenance on all remote expertise exchanges
- data minimization across domains
- trust tier compatibility checks

---

## 8. Confidential Computing Agents

Confidential Computing Agents should be modeled as an **optional execution class**, not the default path.

Suggested execution classes:
- **Standard Execution**
- **Guarded Execution**
- **Confidential Execution**

A Confidential Computing Agent is an agent execution mode in which a task runs inside a confidential or attested execution environment, with stricter controls over:
- context release
- secret access
- runtime integrity
- execution provenance
- operator/host exposure
- auditability

### Secure Context Handoff
The system should favor a **secure context handoff envelope** containing only:
- task intent
- minimal required context
- policy metadata
- allowed capabilities
- expiry / freshness constraints
- attestation requirements
- sealed secrets released only after successful attestation

---

## 9. Potential Confidential Execution Providers / Reference Candidates

The product should remain **provider-agnostic** at the architecture level. However, it is useful to track concrete reference candidates that could accelerate practical experimentation.

### Tinfoil
Strong candidate reference provider for:
- private inference
- confidential AI workloads
- attested execution paths
- secure agent workloads over sensitive data

Suggested role:
- treat Tinfoil as a **reference implementation candidate** for confidential/private execution
- do **not** make it a conceptual dependency of the product
- use it to validate real-world feasibility of:
  - confidential delegation
  - protected expertise exchange
  - sensitive incident analysis
  - attested secure agent workloads

---

## 10. Roadmap Phases

### Phase 1 — Core Hardening
- adapter stability
- validation semantics
- explainability
- sessions/graph maturity
- docs and product clarity

### Phase 2 — Remote Execution Foundation
- node model
- connector model
- target registry
- remote dispatch
- remote session visibility

### Phase 3 — Policy and Guardrail Layer
- scopes
- capability declarations
- trust tiers
- approval workflows
- policy evaluation engine

### Phase 4 — UX Abstraction Layer
- web/TUI control surface
- team topology UX
- policy UX
- session/run visibility
- operator workflows

### Phase 5 — Federated Interconnect
- federation domains
- expertise exchange
- cross-runtime handoff
- bounded team collaboration

### Phase 6 — Confidential Computing Agents
- confidential delegation mode
- attested execution
- sealed context handoff
- high-trust execution classes

---

## 11. Final Recommendation

The strongest version of the idea is:

> **Build a secure UX abstraction and orchestration layer for distributed and federated agent teams, with runtimes acting as execution backplanes, interconnect governed by policy and trust, and confidential execution available as an optional high-trust mode for sensitive workloads.**
