# Dev Run Sprint — `v0.4.0` Hermes with MAH Itself  
## Refined Plan

## Status

- implementação da sprint: [done]
- evidência:
  - runtime Hermes entregue em `v0.4.0`
  - fases e slices abaixo concluídos
  - critérios de boundary preservados no release
  - documentação, testes e changelog já incorporados ao repositório

## 1. Objective

Execute a first delivery sprint for `v0.4.0` using Meta Agents Harness itself as the **canonical team for coordination, analysis, execution, and review**.

The sprint should validate simultaneously:

1. that the Hermes support spec is implementable in small bounded slices;
2. that MAH is already useful as a real multi-agent coordination layer for technical delivery;
3. that the canonical team topology, roles, and delegation limits are sufficient for a concrete implementation sprint.

---

## 2. Sprint Thesis

The sprint must prove three things at once.

### T1 — Delivery bounded
The `v0.4.0` Hermes plan is executable without dragging in broader `v0.5.0+` architecture.

### T2 — Canonical team usefulness
The MAH canonical team is not just documentation — it is useful in practice for real delivery.

### T3 — Runtime-agnostic discipline
Even while integrating a strong runtime like Hermes, MAH preserves its identity as an orchestration layer instead of being captured by runtime-specific semantics.

---

## 3. Operating Principle

The sprint should use the **existing canonical `dev` crew**, but with an explicit **sprint mode overlay**.

This means:

- use the real configured crew
- keep the real topology
- define a clear sprint mission
- enforce scope gates
- work in small slices
- require verifiable outputs at each phase

### Central rule
The crew must not improvise a new product direction.

It must operate as:

> **spec-bound, slice-driven, release-disciplined implementation team**

---

## 4. Recommended Crew

## 4.1 Base
Use the **current canonical `dev` crew**.

This is better than creating a new crew because it:

- avoids unnecessary organizational modeling overhead
- tests what already exists in the product
- makes the experiment more honest and product-relevant

## 4.2 Sprint mode directives
The sprint should run with these explicit directives:

- spec-bound execution
- no architecture-wave expansion
- no `v0.5.0+` scope
- PR-sized slices
- mandatory validation at each slice
- explicit deferred list for anything outside `v0.4.0`

---

## 5. Role of Each Agent in the Sprint

## 5.1 Orchestrator

### Agent
- `orchestrator`

### Responsibilities
- control sprint scope
- distribute slices
- consolidate decisions
- prevent runtime capture by Hermes
- decide when something must be marked as deferred
- keep the mission aligned with the spec and the release framing

### Rule
Any proposal that touches:
- remote execution foundation
- policy engine
- federation/interconnect
- confidential execution
- global adapter contract redesign

must be automatically classified as:

**DEFERRED — OUT OF SPRINT**

---

## 5.2 Planning Layer

### `planning-lead`
Responsible for:
- translating the spec into executable backlog
- ordering slices
- keeping dependencies clear
- preventing backlog inflation

### `repo-analyst`
Responsible for:
- mapping real codebase integration points
- locating affected files
- identifying reuse paths
- surfacing regression and coupling risks

### `solution-architect`
Responsible for:
- defining the adapter approach
- defining minimal compatibility with `meta-agents.yaml`
- identifying the smallest technically correct slice
- proposing explicit implementation boundaries

---

## 5.3 Engineering Layer

### `engineering-lead`
Responsible for:
- coordinating implementation
- splitting work into reviewable changesets
- ensuring the right boundary between adapter, dispatcher, and config

### `backend-dev`
Responsible for:
- runtime adapter
- dispatcher integration
- config compatibility
- artifact/sync behavior
- Hermes-aware runtime behavior

### `frontend-dev`
Responsible for:
- CLI/help surfaces
- docs/help text changes
- UX-related explainability/diagnostics surfaces when there is operator-facing impact

---

## 5.4 Validation Layer

### `validation-lead`
Responsible for:
- defining phase gates
- validating spec adherence
- blocking changes that escape release boundary

### `qa-reviewer`
Responsible for:
- smoke tests
- diagnostics tests
- contract tests
- sync consistency

### `security-reviewer`
Responsible for:
- reviewing runtime boundary and unsafe coupling
- checking “Hermes becoming the architecture” risks
- flagging contamination from future remote/policy/federation layers

---

## 6. Recommended Models

The current model catalog remains well-suited for this sprint.

### Orchestrator
- `zai/glm-4.7`

Use for:
- coordination
- synthesis
- scope discipline
- defer decisions

### Leads
- `openrouter/nvidia/nemotron-3-super-120b-a12b:free`

Use for:
- alternative comparison
- backlog slicing
- technical writing
- architectural/textual review

### Workers
- `zai/glm-5-turbo`

Use for:
- fast execution
- incremental patch generation
- tests
- small refactors

### Fallbacks
Keep the existing configured fallbacks from the current catalog.

---

## 7. Sprint Mission Prompt

The crew should operate under an explicit mission.

## Mission
Implement the `v0.4.0` Hermes runtime spec inside Meta Agents Harness using bounded, release-disciplined execution with the canonical `dev` crew.

## Primary rule
Do not transform `v0.4.0` into a broader architecture wave. Hermes support must be deep but bounded.

## Must deliver
- Hermes command/reality discovery
- compatibility matrix
- adapter skeleton
- bounded dispatcher/config integration plan
- diagnostics/explainability impact plan
- test plan
- small implementation-ready slices

## Must not deliver
- full Hermes parity
- remote execution foundation
- policy engine
- federation/interconnect
- confidential execution
- runtime contract redesign driven by Hermes
- MAH becoming Hermes-shaped

## Output discipline
- small slices
- explicit gates
- explicit deferred list
- reviewable changes
- changelog-aligned scope

---

## 8. Sprint Phases

## Phase 1 — Analysis / Discovery [done]

### Primary owners
- `planning-lead`
- `repo-analyst`
- `solution-architect`

### Inputs
- `v0.4.0` spec
- execution plan
- current codebase
- changelog direction

### Mandatory outputs
- Hermes command matrix
- list of confirmed unknowns
- runtime compatibility assessment
- affected file map
- gap list versus current runtime-adapter-contract
- realistic minimum support recommendation

### Exit gate
Do not begin implementation before closing:
- real CLI name
- expected wrapper
- marker/config root
- minimum session semantics
- command support reality check

---

## Phase 2 — Sprint Architecture Decision [done]

### Primary owners
- `solution-architect`
- `engineering-lead`
- `orchestrator`

### Mandatory outputs
- adapter approach decision
- additive `meta-agents.yaml` compatibility decision
- boundary decision:
  - what belongs in adapter
  - what belongs in dispatcher
  - what stays out of this sprint
- explicit deferred items list

### Exit gate
Nothing starts if:
- the approach requires core redesign
- the approach requires a new abstraction family
- the approach depends on full Hermes feature parity

---

## Phase 3 — Implementation Slice 1 [done]

### Goal
Create the minimum Hermes runtime foundation inside the runtime portfolio.

### Owners
- `engineering-lead`
- `backend-dev`

### Scope
- add Hermes in `runtime-adapters.mjs`
- expand `RUNTIME_ORDER`
- add minimum contract fields
- support:
  - `mah detect`
  - `mah check:runtime`
  - `mah validate:runtime`

### Gate
No Hermes logic should spread outside the necessary boundary.

---

## Phase 4 — Implementation Slice 2 [done]

### Goal
Make Hermes operationally visible and explainable.

### Owners
- `backend-dev`
- `frontend-dev`

### Scope
- `mah explain detect`
- `mah explain run`
- `mah doctor`
- honest partial/unsupported messaging
- diagnostics output compatible with the existing envelope

### Gate
Do not promise behavior the runtime does not actually support.

---

## Phase 5 — Implementation Slice 3 [done]

### Goal
Establish minimum `meta-agents.yaml` compatibility and runtime-aware projection.

### Owners
- `backend-dev`
- `solution-architect`

### Scope
- minimal additive config support, if needed
- Hermes root/config pattern
- generated artifact projection notes
- compatibility with sync/check philosophy

### Gate
Do not reinvent the canonical config model.

---

## Phase 6 — Validation and Review [done]

### Owners
- `validation-lead`
- `qa-reviewer`
- `security-reviewer`

### Scope
- Hermes smoke tests
- Hermes contract tests
- Hermes-aware diagnostics tests
- boundary review
- changelog wording review
- spec adherence review

### Gate
If any sign of:
- remote execution foundation
- policy engine
- federation
- confidential execution
- global redesign

appears, cut scope immediately.

---

## 9. Refined Initial Backlog

### Slice 0 — Hermes Discovery [done]
- confirm CLI
- confirm wrapper
- confirm root/marker
- confirm reality of:
  - `list:crews`
  - `use`
  - `clear`
  - `run`
  - `doctor`
  - `check:runtime`

### Slice 1 — Adapter foundation [done]
- add runtime `hermes`
- minimum contract
- forced detection
- marker/CLI detection

### Slice 2 — Diagnostics and explainability [done]
- `mah explain detect`
- `mah explain run`
- `mah doctor`
- `mah validate:runtime`

### Slice 3 — Config compatibility [done]
- additive config support
- root/pattern compatibility
- sync/check alignment notes

### Slice 4 — Tests [done]
- Hermes smoke
- Hermes contract
- Hermes-aware diagnostics

### Slice 5 — Release boundary review [done]
- explicitly confirm what stays out
- prepare changelog draft
- record deferred list

---

## 10. Suggested Commands

### Current state understanding
```bash
mah detect
mah explain detect --trace
mah graph --crew dev --mermaid --mermaid-level detailed --mermaid-capabilities
mah validate:all
```

### During implementation
```bash
mah explain run --trace
npm run test:smoke
npm run test:contract
npm run test:diagnostics
npm run validate:runtime
npm run validate:all
```

### For config and artifacts
```bash
npm run sync:meta
npm run check:meta-sync
mah plan --json
mah diff --json
```

---

## 11. Success Criteria

### Success criteria
- the sprint produces a realistic, non-speculative Hermes matrix
- the adapter skeleton becomes clear and implementable
- Hermes enters the runtime portfolio with honest boundary
- the `v0.4.0` backlog becomes executable in small PRs
- using MAH as sprint coordinator proves useful
- the sprint does not pull `v0.5.0+` scope

### Failure criteria
- trying to solve Hermes + remote execution at the same time
- redesigning the whole product around Hermes
- producing a huge non-reviewable PR
- requiring full Hermes parity to validate the sprint
- allowing the runtime to dictate the architecture

---

## 12. Final Recommendation

Yes, it is highly valuable to run this first delivery sprint using MAH itself.

But the right way to do it is:

- use the **canonical `dev` crew**
- add an explicit **sprint mode**
- work in **small slices**
- validate after each phase
- treat Hermes as a strong runtime expansion
- preserve MAH as an **orchestration layer**, not a runtime product
