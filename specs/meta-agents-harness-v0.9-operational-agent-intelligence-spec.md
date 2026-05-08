# Meta Agents Harness
## v0.9 Release Specification
### Operational Agent Intelligence

**Document type:** Release feature specification
**Status:** Future design spec
**Audience:** Product, architecture, platform, runtime integration, future maintainers

---

## 1. Executive Summary

Meta Agents Harness v0.9 should turn the current unified runtime control layer into a more legible and sellable product category:

**Operational Agent Intelligence**

The release thesis is:

> Route the right agent, load the right context, show the work happening.

This is not a pivot away from MAH's identity.
It is a productization step that makes the existing architecture more visible, more explainable, and easier to operate.

The system already has the right foundations:

- expertise-backed routing
- bounded context retrieval after routing
- unified runtime execution through one CLI
- explainability and validation primitives
- sessions, provenance, and audit surfaces

v0.9 should package these into an operator-facing release with a coherent narrative:

- **Expertise decides who should handle work**
- **Context Manager supplies bounded operational recall**
- **Lifecycle surfaces execution progress and state transitions**
- **Evidence strengthens routing and reusable operating knowledge over time**

This preserves MAH as a runtime-agnostic orchestration intelligence layer rather than turning it into a heavyweight managed agents platform.

---

## 2. Product Headline and Positioning

### Headline

**Route the right agent, load the right context, show the work happening.**

### Positioning

Meta Agents Harness is the orchestration intelligence layer for agent runtimes.
Policy and topology bound the system, expertise decides who should handle work, context memory supplies bounded operational recall, and the runtime layer executes through a unified CLI.

### Short Form

**From unified runtime control to operational agent intelligence.**

### Market Boundary

MAH should not position itself as:

- a managed agents SaaS
- a project management board
- an agent workforce simulator
- a company operating system

MAH should position itself as:

- the intelligence and control layer above agent runtimes
- the CLI-first orchestration layer for multi-agent execution
- the place where routing, bounded memory, policy, and runtime portability meet

---

## 3. Competitive Framing

### 3.1 What MAH should learn from Multica

Multica communicates several ideas clearly:

- visible task lifecycle
- agents as assignable operators
- progress and blockers as first-class signals
- skill compounding as an operator benefit

These are strong operator-facing concepts and are worth adapting into MAH.

### 3.2 What MAH should learn from Paperclip

Paperclip communicates several valuable operational concepts:

- goals and accountability matter
- governance boundaries matter
- cost and budget awareness matter
- orchestration value is more than prompt execution

These should influence MAH, but only in bounded CLI-first form.

### 3.3 What MAH should not copy

MAH should explicitly avoid converging on:

- a heavy web dashboard as a product requirement
- a daemon-first architecture
- company/org simulation
- board-centric workflow as the primary operator model
- deep HR-style agent personification

The advantage of MAH is that it can deliver high operator value without becoming a platform that must own the entire runtime and collaboration stack.

---

## 4. Current State and Product Gap

As of the current codebase direction:

- `mah expertise recommend --task "..."` already exists
- `mah expertise explain --task "..."` already exists
- `mah context find`, `mah context explain`, `mah context propose`, and `mah run --with-context-memory` already exist as subsystem surfaces
- `mah explain`, `mah sessions`, `mah graph`, provenance, and trace already exist in partial form

The gap is not core invention.
The gap is product framing, operator cohesion, and consistent visibility.

Today the system can do important things, but they are still experienced as separate mechanisms:

- expertise feels like a technical foundation
- context memory feels like an internal subsystem
- runtime execution visibility is fragmented
- progress signals are not yet a clean operator story

v0.9 should close that gap.

---

## 5. Design Goals

### G1 - Make routing explainable at operator level

The operator should be able to ask:

- why this agent?
- why not another one?
- what evidence supports this choice?

### G2 - Make context retrieval a first-class subsystem

The operator should see Context Manager as a named capability, not just hidden retrieval logic.

### G3 - Make execution progress visible without building a board product

The operator should be able to inspect lifecycle state and execution history from the CLI.

### G4 - Turn skill reuse into expertise-backed compounding

The system should strengthen future routing and context through evidence-backed curation, not just by accumulating playbooks.

### G5 - Make bootstrap tell the value story

The first-run experience should communicate that MAH sets up:

- agent topology
- expertise-aware routing
- bounded context support
- visible execution

### G6 - Preserve MAH identity

All additions must remain:

- CLI-first
- runtime-agnostic
- bounded by topology and policy
- lightweight enough to avoid becoming a full management platform

---

## 6. Non-Goals

### NG1

No Kanban board or project-management UI as part of v0.9.

### NG2

No daemon-first control plane requirement.

### NG3

No attempt to become a "managed agents platform" in the Multica sense.

### NG4

No company simulation, org governance engine, or autonomous workforce product in the Paperclip sense.

### NG5

No social/team features as primary product surface.

### NG6

No vector database or heavyweight memory infrastructure requirement for Context Manager.

---

## 7. Release Pillars

## 7.1 Pillar A - Explainable Task Routing

### Thesis

Expertise must be a visible feature of the release, not just an implementation foundation.

### Operator Promise

**The system can explain why a task was routed to a given agent.**

### Public Commands

```bash
mah expertise recommend --task "..."
mah expertise explain --task "..."
mah expertise explain --agent <agent> --task "..."
```

### Required Output Shape

The default text output should be short and operator-friendly:

- selected agent
- capability match summary
- confidence score
- evidence summary
- important constraints or penalties

Example:

```text
recommended_agent=planning-lead
confidence=0.82
why=matched backlog-planning, clickup, milestone decomposition
evidence=14 observed runs, 0.86 review pass rate, stable context available
constraints=topology-allowed, trust-tier-satisfied
```

### Product Requirement

The default output should answer "why this agent?" in less than 5 lines unless `--json` or `--verbose` is requested.

### Acceptance Criteria

- `mah expertise recommend` returns a short operator-facing recommendation by default
- `mah expertise explain` returns ranked candidates plus score components
- optional `--agent` scope allows asking "why this agent for this task?"
- routing explanation references capability fit, trust/policy fit, and evidence

---

## 7.2 Pillar B - Context Manager

### Thesis

Context Memory should become a public subsystem with a stable operator-facing name:

**Context Manager**

### Operator Promise

**Once the right agent is chosen, MAH can retrieve the bounded operational memory needed to execute well.**

### Public Commands

```bash
mah context find --agent <agent> --task "..."
mah context explain --agent <agent> --task "..."
mah context propose --from-session <session-ref>
mah run --with-context-memory
```

### Naming Requirement

Public docs, changelog, and release copy should consistently refer to the subsystem as **Context Manager** while retaining `mah context` as the CLI namespace.

### Product Requirement

The docs must make the layer boundary explicit:

- expertise chooses the agent
- context manager helps the chosen agent execute
- sessions provide ephemeral continuity
- evidence improves expertise and context over time

### Acceptance Criteria

- release docs use "Context Manager" as the public name
- `mah context explain` provides short retrieval reasoning by default
- `mah run --with-context-memory` is documented as a primary v0.9 operator flow
- context outputs remain bounded and do not interfere with routing

---

## 7.3 Pillar C - Lightweight Task Lifecycle

### Thesis

MAH should adopt visible progress from Multica's strengths without becoming a board product.

### Operator Promise

**Every run has a visible lifecycle.**

### Canonical Lifecycle

```text
queued -> routed -> context-loaded -> running -> blocked -> completed
queued -> routed -> context-loaded -> running -> failed
```

### Public Commands

```bash
mah run --trace -- "..."
mah sessions status <session-id>
mah sessions status <session-id> --json
```

### Required Timeline Output

The operator should be able to see:

- current state
- state transition timestamps
- routing decision summary
- context-loading summary
- blocked reason if present
- completion or failure result

Example:

```text
session=pi:dev:abc123
state=running
timeline=queued -> routed -> context-loaded -> running
routed_to=engineering-lead
routing_reason=frontend api integration matched capability profile
context=2 docs loaded, stable
last_update=2026-04-22T20:14:11Z
```

### Data Requirement

Lifecycle events should be recorded as lightweight provenance/session records, not as a separate service.

### Acceptance Criteria

- `mah sessions status` exists as an operator-facing read model
- `mah run --trace` shows lifecycle transitions in textual form
- blocked state has a structured reason field
- lifecycle data can be exported in JSON for automation

---

## 7.4 Pillar D - Expertise-Backed Skill Compounding

### Thesis

MAH should respond to the "compound skills" narrative with a more defensible claim:

**compound expertise-backed skills**

### Operator Promise

**Successful sessions improve future routing confidence and context quality through curated evidence, not uncontrolled transcript hoarding.**

### Public Commands

```bash
mah expertise sync
mah context propose --from-session <session-ref>
```

### Product Requirement

The v0.9 narrative should explicitly describe the loop:

```text
session learnings -> curated context -> stronger routing confidence
```

### Operating Model

- sessions produce evidence
- evidence can strengthen expertise confidence
- sessions can produce context proposals
- proposals require review before becoming operational memory
- stronger expertise and context improve later runs

### Acceptance Criteria

- docs clearly show how sessions feed expertise and context
- `mah expertise sync` is documented as a compounding mechanism, not just maintenance
- `mah context propose` is presented as a governed learning flow
- release copy distinguishes curation from naive memory accumulation

---

## 7.5 Pillar E - Value-Oriented Bootstrap

### Thesis

Bootstrap should not only create config files.
It should explain what the operator is getting.

### Operator Promise

**Configure your agent mesh in minutes, then run with expertise, context, and visible execution.**

### Public Commands

```bash
mah init --yes
mah init --yes --crew bootstrap-config
```

### Required Bootstrap Story

The bootstrap flow should frame:

- crew topology
- expertise support
- context manager availability
- lifecycle visibility
- optional AI-assisted setup

### Desired Config Behavior

The generated `meta-agents.yaml` should support enabling or seeding expertise/context features from the start, while remaining minimal by default.

### Acceptance Criteria

- bootstrap docs explicitly mention expertise, context, and lifecycle value
- AI-assisted bootstrap is positioned as an optional acceleration path
- generated config remains simple enough for manual editing

---

## 8. Paperclip-Inspired Features That Fit MAH

Paperclip contributes useful operational concepts.
MAH should support the bounded subset that aligns with its identity.

## 8.1 Goal Binding

MAH should allow runs and sessions to carry an explicit goal or objective reference.

Examples:

- sprint objective
- mission slice
- explicit operator-provided goal string

Possible surfaces:

```bash
mah run --goal "prepare v0.9 release scope"
mah sessions status <id>
```

This gives the run a clearer accountability envelope without introducing company simulation.

## 8.2 Budget Awareness

MAH should support lightweight budget and cost-awareness signals:

- estimated token budget
- elapsed time budget
- high-cost warning
- cost summary in session status

This should remain:

- advisory by default
- CLI-visible
- attached to runs, not companies

MAH should not become a finance or workforce budgeting platform.

## 8.3 Governance Hooks

MAH should allow high-risk expertise or run modes to express:

- supervision required
- approval required
- confidential execution required

This extends existing policy and trust-tier boundaries without requiring a heavyweight governance product.

---

## 9. CLI Contract Changes for v0.9

### New or elevated primary commands

```bash
mah expertise recommend --task "..."
mah expertise explain --task "..."
mah expertise explain --agent <agent> --task "..."
mah context find --agent <agent> --task "..."
mah context explain --agent <agent> --task "..."
mah context propose --from-session <session-ref>
mah run --with-context-memory
mah run --trace -- "..."
mah sessions status <session-id>
```

### Output Principles

- default output should be concise and operator-readable
- `--json` should provide structured automation output
- `--verbose` should provide score details and internal trace when needed
- the short path should be good enough for daily operation

---

## 10. Lifecycle Event Model

Each run/session should emit a bounded lifecycle record.

### Event types

- `queued`
- `routed`
- `context_loaded`
- `running`
- `blocked`
- `completed`
- `failed`

### Minimum event fields

```yaml
event: routed
timestamp: "2026-04-22T20:14:11Z"
session_id: pi:dev:abc123
agent: engineering-lead
task_summary: implement auth guard
reason:
  type: expertise-routing
  summary: matched api-auth and middleware capability profile
metadata:
  confidence: 0.82
  evidence_count: 14
```

### Storage Principle

Persist in session/provenance infrastructure already owned by MAH.
Do not require a daemon, broker, or separate event service.

---

## 11. Documentation and Changelog Requirements

### Changelog Themes

#### Added

- explainable expertise routing
- Context Manager operator flows
- run/session lifecycle timeline
- expertise-backed skill compounding
- AI-assisted bootstrap improvements

#### Improved

- `mah explain`
- `mah sessions`
- `mah graph`
- validation flows for expertise, context, and bootstrap
- plugin/runtime consistency

#### Positioning

- from unified runtime control to operational agent intelligence

### Release Copy

```text
MAH v0.9 turns unified runtime control into operational agent intelligence.
It routes work with evidence-backed expertise, loads bounded context for execution, and makes agent runs visible through a lightweight lifecycle, all from one CLI.
```

---

## 12. Success Metrics

v0.9 should be considered successful if it improves both product clarity and operator usability.

### Product clarity signals

- operators can explain MAH in one sentence without referring only to runtime unification
- release messaging is understandable without reading architecture internals
- expertise and context are perceived as product features rather than hidden mechanics

### Operator signals

- route/explain/context/status workflows are usable without reading internal code
- default command output is short enough for daily use
- blocked or failed runs are easier to inspect
- bootstrap more clearly communicates value on first run

---

## 13. Risks and Mitigations

### Risk R1 - Product sprawl

Adding too much lifecycle and governance language may push MAH toward platform sprawl.

**Mitigation:** keep everything CLI-first and grounded in current MAH primitives.

### Risk R2 - Narrative mismatch

If v0.9 messaging overpromises managed-agent behavior, user expectations will exceed the actual product.

**Mitigation:** describe MAH as orchestration intelligence, not agent workforce management.

### Risk R3 - Feature fragmentation

If expertise, context, and lifecycle are still documented separately without a common release story, the release will feel incoherent.

**Mitigation:** ship a unified v0.9 release narrative and operator journey.

### Risk R4 - Output noise

If explain/trace/status surfaces become too verbose, the operator benefit will be lost.

**Mitigation:** optimize for concise default output with structured expansion paths.

---

## 14. Recommended Scope Cut for v0.9

If scope must be reduced, keep these items:

1. concise explainable expertise routing
2. Context Manager naming and docs uplift
3. lightweight session lifecycle with `mah sessions status`
4. compounding story via `expertise sync` and `context propose`
5. bootstrap messaging improvements

If more cuts are required, defer:

- budget warnings
- explicit goal binding
- advanced governance hooks

These are valuable, but not required for the core v0.9 narrative.

---

## 15. Final Product Thesis

MAH should not try to win by becoming a heavier platform than Multica or Paperclip.

It should win by being:

- more technically coherent
- more runtime-portable
- more policy-aware
- more explainable
- lighter to adopt

The strongest v0.9 story is:

**MAH helps operators route the right work to the right agent, load the right bounded context, and inspect execution through a lightweight lifecycle, without locking them into a single runtime or platform model.**
