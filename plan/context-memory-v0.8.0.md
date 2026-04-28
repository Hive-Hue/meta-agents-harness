# Execution Plan — `v0.8.0` Context Memory

## Status

- plan execution: [partially delivered]
- audit status: repo-audited against current implementation on 2026-04-22
- expected outcome:
  - MAH supports a canonical layer of **Operational Context Memory** for post-routing use
  - agents can retrieve highly relevant operational context by capability and task without degrading expertise-based routing
  - the product gains a viable base for **persistent operational memory** across sessions and runtimes
- note:
  - this feature does not replace `Expertise`, `Sessions`, `Provenance`, or `Evidence`
  - this feature complements those layers and moves MAH closer to a high-level, runtime-agnostic, reusable **assistant layer** over Hermes, OpenCode, and other runtimes

## Current Audit Summary

### Milestone Status

| Milestone | Status | Summary |
|---|---|---|
| M1 — Context Memory Foundation | delivered | Schema, validation, corpus layout, boundary docs, and canonical smoke doc exist. |
| M2 — Indexing + Retrieval MVP | delivered | Deterministic index, retrieval, and explain surfaces are implemented. |
| M3 — Runtime Injection (bounded) | partial | Hermes bootstrap injection exists, but there is still no clear operator-facing surface showing the exact retrieved context used for a run. |
| M4 — CLI + Operator UX | delivered | `mah context` namespace exists with `validate`, `list`, `show`, `index`, `find`, `explain`, and `propose`. |
| M5 — Persistent Learning Proposal Flow | partial | Session-derived proposal drafts exist, but promote/reject workflow and basic dedupe/merge are still missing. |
| M6 — Assistant Layer Base | not delivered | No canonical `assistant-state` model or operator-facing state surface exists yet. |

### Workstream Status

| Workstream | Status | Summary |
|---|---|---|
| W1 — Naming, Boundary, Product Spec | delivered | Context Memory boundary is documented and naming is stable for `v0.8.0`. |
| W2 — Modeling and Validation | delivered | Types, schema parsing, validation, and fixtures exist. |
| W3 — Parsing and Indexing | delivered | Frontmatter parsing, snippet extraction, hashing, and deterministic index building exist. |
| W4 — Retrieval Engine | delivered | Lexical and metadata-aware retrieval with explainability exists. |
| W5 — Runtime Integration | partial | Hermes integration and bounded flags exist; visibility of the injected result is still incomplete. |
| W6 — CLI and Operability | delivered | Operator CLI is implemented in `mah context`. |
| W7 — Persistent Proposal Flow | partial | Proposal generation exists; governance and promotion workflow remain incomplete. |
| W8 — Tests and Safety | partial | Core tests and bounds exist, but remaining gaps depend on M3, M5, and M6 completion. |

### Suggested Slice Status

| Slice | Status | Notes |
|---|---|---|
| PR1 — Schema + validate + storage layout | delivered | Historical slice content is consolidated in [`plan/slices/context-memory-finalization-slices.md`](./slices/context-memory-finalization-slices.md). |
| PR2 — Index + retrieval MVP | delivered | Implemented in code; no standalone slice doc was preserved. |
| PR3 — Hermes/runtime bootstrap integration | partial | Runtime injection landed, but runtime-visible retrieval trace is still missing. |
| PR4 — Persistent proposal flow | partial | Session-based draft proposal generation landed; governance workflow is still missing. |
| PR5 — Product docs + assistant-layer framing | partial | Product docs exist, but the assistant-state base remains unfinished. |

## Context

MAH already had important layers, but they were still fragmented:

- structured `Expertise` for routing, trust, validation, and policy
- `Sessions` for continuity and bounded context injection across runtimes
- `Provenance` for auditable retention
- prompts, skills, and MCPs as execution surfaces

The gap was:

- routing decides **who** should execute
- but the system still lacked a canonical, bounded layer that helps the selected agent remember **how** to execute a task well inside its expertise

Example:

- `planning-lead` may be routed for `backlog-planning`
- but the relevant operational knowledge for that task may vary:
  - using ClickUp directly through MCP
  - backlog decomposition criteria
  - milestone flow
  - use of planning or PERT skills
  - fallback paths when an expected system is not available

Before Context Memory, that knowledge tended to be scattered across:

- static agent prompts
- short-lived session memory
- ad hoc notes
- operator implicit knowledge

That limited:

- useful persistence across sessions
- transferability across runtimes
- explainability of the context used during execution
- MAH evolution as a higher-level assistant layer

## Feature Thesis

Create a new canonical layer called **Context Memory** or **Operational Context Memory**, explicitly separate from `Expertise`, to:

1. retrieve operational context after routing
2. enrich bootstrap and execution for the selected agent
3. persist curated operational memory across sessions
4. allow future MAH evolution as an **assistant substrate** above runtimes
5. keep the backlog-planning playbook explicit for ClickUp MCP without requiring a dedicated intermediate skill

Core principle:

- `Expertise` decides **who should receive the task**
- `Context Memory` decides **what that agent needs to remember to execute well**

## Product Outcome for `v0.8.0`

By the end of the release, MAH should support:

1. a versioned operational memory corpus by crew, agent, and capability
2. schema and validation for context files (`.md` and `.qmd`)
3. deterministic and bounded indexing of that corpus
4. explainable retrieval by task, agent, and capability
5. optional runtime bootstrap integration for bounded context injection
6. a proposal flow that turns session and provenance signals into curated persistent memory candidates
7. an architectural base for MAH to act as a **high-level assistance layer**, not only a dispatch surface

## Scope for `v0.8.0` (In)

- new `mah context` layer
- support for `.md` and `.qmd`
- structured frontmatter
- local deterministic index with rebuild support
- lexical and metadata-aware retrieval, bounded and explainable
- initial runtime bootstrap integration, prioritizing Hermes
- proposal flow for memory derived from sessions and provenance
- contract, integration, and regression tests
- documentation and governance for the operational corpus

## Out of Scope

- mandatory vector database
- Obsidian as a core dependency
- a full knowledge graph
- unreviewed auto-write from raw transcripts
- replacing `mah expertise recommend/explain`
- full autobiographical replay of agent memory
- unrestricted autonomy driven by unvalidated memory

## Product Problem

### Problem 1 — Post-routing without operational memory

Expertise-based routing answers:

- who is the best candidate
- who is allowed
- what confidence level applies

But it does not answer:

- which operational playbooks to use
- which MCP is the best integration point
- which skills are most relevant for this task
- which known gotchas matter for this capability

### Problem 2 — Persistent memory was poorly distributed

Useful memory was previously lost between:

- ephemeral session state
- compact expertise constrained by budget
- artifacts scattered across `docs/`, `plan/`, and `specs/`

That caused:

- repeated re-derivation of the same operational context
- dependence on the current runtime and active session
- weak transferability across operators and runtimes

### Problem 3 — MAH was not yet a complete assistant layer

For MAH to evolve from orchestration layer into a higher-level assistant layer, it must be able to:

1. decide who should act
2. retrieve useful operational context
3. retain learnings across sessions
4. inject that context in a bounded way across runtimes

Without that, the runtime remains the primary owner of practical memory.

## Proposal

Explicitly separate five layers:

1. `Expertise`
   - capability intelligence, trust, lifecycle, policy, and routing

2. `Context Memory`
   - curated operational memory by agent, capability, and task pattern

3. `Sessions`
   - continuity of recent work and cross-runtime injection

4. `Provenance`
   - auditable trail of what happened

5. `Evidence`
   - structured signals feeding expertise and proposal flows

## Boundary Principle

`Context Memory`:

- does not participate in routing ranking
- does not grant permission
- does not alter policy
- does not replace expertise
- does not ingest raw logs directly

Its role is exclusively to **enrich post-routing execution**.

## Target Architecture for `v0.8.0`

### Layers

1. `Context Corpus`
   - canonical `.md` and `.qmd` files
   - versioned in the repository
   - written for operational reuse
   - the canonical backlog-planning smoke doc in this release is `.mah/context/operational/dev/planning-lead/backlog-planning/clickup-backlog-triage.md`

2. `Context Index`
   - derived index with metadata, snippets, and search keys

3. `Retrieval Engine`
   - selects top-N relevant contexts by task, capability, and available tools

4. `Runtime Injection Layer`
   - integrates retrieved context into runtime bootstrap

5. `Proposal Layer`
   - turns session and provenance signals into draft persistent memory

### Data Structures (initial proposal)

- `types/context-memory-types.mjs`
  - `ContextMemoryDocument`
  - `ContextMemoryIndexEntry`
  - `ContextMemoryRetrievalRequest`
  - `ContextMemoryRetrievalResult`
  - `ContextMemoryProposal`

- directories:
  - `.mah/context/operational/`
  - `.mah/context/index/`
  - `.mah/context/proposals/`
  - `.mah/context/cache/`

### Content Organization

```text
.mah/context/operational/
  dev/
    planning-lead/
      backlog-planning/
        clickup-backlog-triage.md
        milestone-splitting.qmd
        acceptance-criteria-checklist.qmd
      scope-triage/
        scope-cut-heuristics.md
    engineering-lead/
      implementation-coordination/
        splitting-guidelines.md
```

### Proposed Frontmatter

```yaml
---
id: dev/planning-lead/backlog-planning/clickup-backlog-triage
kind: operational-memory
crew: dev
agent: planning-lead
capabilities:
  - backlog-planning
domains:
  - planning
systems:
  - clickup
skills:
  - agentic_pert
tools:
  - mcp_call
task_patterns:
  - "transform spec into backlog"
  - "create milestones and tasks"
  - "derive acceptance criteria"
priority: high
stability: curated
source_type: human-authored
last_reviewed_at: 2026-04-17
refs:
  - docs/expertise-catalog-governance.md
---
```

## Relationship with `Expertise`

Example:

- `planning-lead` still owns the `backlog-planning` capability in the expertise catalog
- routing uses that structured data to select the agent
- after selection, retrieval searches operational documents linked to:
  - `agent=planning-lead`
  - `capability=backlog-planning`
  - `systems=clickup`
  - `task_patterns` compatible with the task
- the retrieved playbook makes the ClickUp MCP path explicit

In other words:

- `Expertise` remains small, structured, and governed
- `Context Memory` absorbs reusable operational detail

## Relationship with Memory Persistence

### Viable Persistent Memory

This feature solves an important persistence problem:

- relevant operational memory should not depend only on the active session or runtime

Instead of persisting raw transcripts, MAH persists:

1. `curated memory`
   - playbooks, patterns, heuristics, integrations, gotchas

2. `derived memory`
   - proposals generated from sessions, provenance, and evidence

3. `ephemeral memory`
   - snippets retrieved only for the current execution

### Three-Level Persistence Model

#### N1 — Curated Operational Memory

- versioned
- auditable
- reviewable
- stable

#### N2 — Derived Memory Proposals

- generated from sessions, provenance, or evidence
- never enters the corpus automatically
- requires human review

#### N3 — Runtime Injected Memory

- result of bounded retrieval
- does not become system truth by itself

### Benefit

This gives MAH a **safe and explainable** form of useful memory persistence:

- without depending on the runtime
- without inflating the fixed prompt
- without turning logs into canonical knowledge
- without mixing capability intelligence with operational detail

## Evolution of the MAH Purpose

### Current Position

Today MAH is:

- an orchestration layer
- a runtime-agnostic control plane
- an expertise-aware routing layer
- a session and provenance bridge

### Future Position

With `Context Memory`, MAH also becomes:

- a context orchestration layer
- an operational memory layer
- an assistant state layer

That moves it closer to a higher-level product in the direction of:

- evolution beyond prior orchestration shells
- selective absorption of useful runtime patterns
- a coordinator and assistant substrate above runtimes

Without becoming:

- a fork of any specific runtime
- a runtime-opinionated shell
- a product tightly coupled to a specific UX such as Obsidian

## Milestones

## M1 — Context Memory Foundation

**Current status:** delivered

Delivery:

- operational document schema and types
- frontmatter parser for `.md` and `.qmd`
- validation rules
- canonical storage layout
- boundary and naming docs
- backlog-planning playbooks reference ClickUp MCP directly in the operational corpus

Already delivered:

- `types/context-memory-types.mjs`
- `scripts/context/context-memory-schema.mjs`
- `scripts/context/context-memory-validate.mjs`
- `.mah/context/operational/`, `.mah/context/index/`, `.mah/context/proposals/`, `.mah/context/cache/`
- canonical smoke doc at `.mah/context/operational/dev/planning-lead/backlog-planning/clickup-backlog-triage.md`
- boundary documentation in `docs/context-memory.md` and this plan

Still missing:

- none for the original M1 scope

Acceptance criteria:

- invalid documents fail in `mah context validate`
- `.md` and `.qmd` are supported equally
- the schema is stable and documented
- there is no ambiguity with `Expertise`

## M2 — Indexing + Retrieval MVP

**Current status:** delivered

Delivery:

- deterministic local index
- retrieval by `agent`, `capability`, `task`, `systems`, and `tools`
- retrieval explainability
- size, depth, and file-count limits
- backlog-planning hints point to ClickUp MCP when operational docs mention backlog grooming or task creation

Already delivered:

- `mah context index [--rebuild]`
- `mah context find --agent <name> --task "<desc>"`
- `mah context explain --agent <name> --task "<desc>"`
- retrieval scoring in `scripts/context/context-memory-schema.mjs`
- corpus-vs-fixture separation tests in `tests/context-memory.test.mjs`

Still missing:

- none for the original M2 scope

Acceptance criteria:

- `mah context find --agent planning-lead --task "<...>"` returns useful top-N results
- retrieval does not read the full corpus on every execution
- explain surfaces report why each item was selected
- retrieval is bounded by explicit limits

## M3 — Runtime Injection (bounded)

**Current status:** partial

Delivery:

- Hermes bootstrap integration
- additional operational context block in the bootstrap query
- opt-in flags and injection limits
- safe fallback when the corpus does not exist

Already delivered:

- runtime integration in `scripts/runtime/runtime-core-integrations.mjs`
- retrieval-to-bootstrap projection in `scripts/context/context-memory-integration.mjs`
- Hermes opt-in through `MAH_CONTEXT_MEMORY=1` or `--with-context-memory`
- MAH-only flags `--context-limit` and `--context-mode`
- tests proving these flags are consumed by MAH and stripped before Hermes launch

Still missing:

- a clear operator-facing surface showing the exact retrieved context used for a run
- a runtime-agnostic explanation surface equivalent to the original `mah explain run` expectation

Acceptance criteria:

- no runtime breaks without a corpus
- injected context is summarized and bounded
- `mah explain run` or an equivalent surface shows the context used
- the runtime continues to have honest semantics

## M4 — CLI + Operator UX

**Current status:** delivered

Delivery:

- `mah context` namespace
- commands:
  - `list`
  - `show <id>`
  - `find --agent --task`
  - `explain --agent --task`
  - `validate`
  - `index`
- `--json` for automation

Already delivered:

- `mah context validate`
- `mah context list`
- `mah context show`
- `mah context index`
- `mah context find`
- `mah context explain`
- `mah context propose`

Still missing:

- none for the original M4 scope

Acceptance criteria:

- the operator can answer:
  - which operational context was retrieved
  - why it was retrieved
  - which tools and systems were assumed

## M5 — Persistent Learning Proposal Flow

**Current status:** partial

Delivery:

- proposal layer sourced from:
  - `sessions`
  - `provenance`
  - `evidence`
- drafts in `.mah/context/proposals/`
- basic merge and dedupe
- governance for promotion into the curated corpus

Already delivered:

- `scripts/context/context-memory-proposal.mjs`
- `mah context propose --from-session <session-ref>`
- draft proposal writes to `.mah/context/proposals/`
- proposal schema validation support in `scripts/context/context-memory-validate.mjs`

Still missing:

- proposal generation from provenance and evidence, not only sessions
- basic dedupe and merge behavior
- operator workflow to promote or reject a proposal
- clear governance contract for promotion into the curated corpus

Acceptance criteria:

- derived memory does not enter the corpus automatically
- proposals have explainability and traceable sources
- the operator or reviewer can promote or discard learnings

## M6 — Assistant Layer Base

**Current status:** not delivered

Delivery:

- canonical MAH `assistant-state` definition
- explicit mapping between:
  - selected expertise
  - retrieved context
  - active session
  - relevant provenance
- foundation for a future MCP or CLI surface

Already delivered:

- conceptual relationship documented in plans and specs

Still missing:

- actual canonical `assistant-state` model
- structured operator surface describing the current assistance state
- runtime-agnostic implementation proving the model

Acceptance criteria:

- MAH can describe the current assistance state in structured form
- the design remains runtime-agnostic

## Technical Backlog (Workstreams)

## W1 — Naming, Boundary, and Product Spec

**Current status:** delivered

- boundary document across `Expertise`, `Context Memory`, `Sessions`, `Evidence`, and `Provenance`
- official feature naming
- document `Obsidian optional, core-independent`

## W2 — Modeling and Validation

**Current status:** delivered

- `types/context-memory-types.mjs`
- `scripts/context/context-memory-schema.mjs`
- `scripts/context/context-memory-validate.mjs`
- valid and invalid fixtures

## W3 — Parsing and Indexing

**Current status:** delivered

- frontmatter parser
- heading and snippet extraction
- canonical index at `.mah/context/index/operational-context.index.json`
- hash and mtime cache support

## W4 — Retrieval Engine

**Current status:** delivered

- lexical scoring
- metadata-aware ranking
- capability-aware filtering
- compatibility with available tools and MCP servers
- explain payload

## W5 — Runtime Integration

**Current status:** partial

- integration in `scripts/runtime/runtime-core-integrations.mjs`
- `agentCtx` enrichment
- bootstrap query with an `Operational context for this task` block
- flags:
  - `MAH_CONTEXT_MEMORY=1`
  - `--with-context-memory`
  - `--context-limit`
  - `--context-mode=summary|snippets`

Gap:

- no first-class operator surface yet shows the retrieved runtime context used during a run

## W6 — CLI and Operability

**Current status:** delivered

- `mah context list`
- `mah context show`
- `mah context find`
- `mah context explain`
- `mah context index`
- `mah context validate`

## W7 — Persistent Proposal Flow

**Current status:** partial

- `scripts/context/context-memory-proposal.mjs`
- draft generation from sessions
- basic file persistence

Gap:

- dedupe and merge basics
- promote and reject workflow
- provenance and evidence sources

## W8 — Tests and Safety

**Current status:** partial

- contract tests
- integration tests
- non-regression against `mah run`, `mah sessions`, and `mah expertise`
- traversal, file-count, and snippet-size limits
- blocks against using uncurated corpus as policy truth

Gap:

- close remaining coverage around runtime visibility, proposal governance, and assistant-state

## Minimum Functional Contract

### CLI

```bash
mah context index
mah context validate
mah context list --agent planning-lead
mah context show dev/planning-lead/backlog-planning/clickup-backlog-triage
mah context find --agent planning-lead --task "transform spec into backlog with clickup"
mah context explain --agent planning-lead --task "transform spec into backlog with clickup"
mah context propose --from-session hermes:dev:abc123
```

### Retrieval Request

```json
{
  "crew": "dev",
  "agent": "planning-lead",
  "task": "transform spec into backlog with clickup",
  "capability_hint": "backlog-planning",
  "available_tools": ["mcp_call", "read", "grep"],
  "available_mcp": ["clickup", "github", "context7"],
  "runtime": "hermes"
}
```

### Retrieval Result

```json
{
  "matched_docs": [
    {
      "id": "dev/planning-lead/backlog-planning/clickup-backlog-triage",
      "score": 0.91,
      "reasons": [
        "agent match",
        "capability match",
        "system clickup available",
        "task pattern overlap"
      ]
    }
  ],
  "summary_blocks": [
    "Use ClickUp MCP directly when the task explicitly mentions backlog grooming or milestone/task creation.",
    "Prefer milestone-first decomposition before creating individual tasks."
  ],
  "tool_hints": ["mcp_call"],
  "skill_hints": ["agentic_pert"],
  "blocked_refs": [],
  "confidence": "high"
}
```

## Retrieval Algorithm (MVP)

```text
Input: task, crew, agent, capability_hint, available_tools, available_mcp, runtime

1) Filter by crew
2) Filter by agent
3) Boost by capability_hint
4) Boost by systems/tools available in the runtime
5) Lexical match by task_patterns/tags/headings
6) Penalize long, stale, or unstable documents
7) Sort and return top-N
8) Generate explain payload and bounded summary blocks
```

## Runtime Integration

### Hermes (first target)

Integration point:

- enrich `agentCtx` before `buildHermesBootstrapQuery()`
- add an extra bootstrap block:
  - `Operational context for this task`
  - `Relevant tools/systems`
  - `Relevant docs`
  - `Bounded summary`

### Other runtimes

- Claude, OpenCode, and PI can absorb the same contract at their own `prepareRunContext` points
- the contract should stay common while the final projection respects the target runtime semantics

## Governance

### Corpus Writing Rules

- do not store raw transcripts
- do not store copied logs or command output as operational corpus
- keep documents short, specific, and reusable
- separate curated context from derived proposals
- every promotion of derived memory requires review

### Obsidian

- optional as a local editor
- no dependency in the core
- `.obsidian/` is not part of the MAH functional contract

## Release Success Metrics

1. operational efficiency
   - reduced manual re-derivation of context in repeated tasks
   - less time to useful action after routing

2. execution quality
   - more consistent use of correct tools and MCP servers by capability
   - lower divergence between agents on similar tasks

3. useful persistence
   - operational memory reused across sessions and runtimes
   - session-derived proposals with a meaningful promotion rate

4. product
   - MAH advances toward a higher-level assistant layer without losing runtime agnosticism

## Risks and Mitigations

1. corpus becoming a dumping ground
   - mitigation: strict schema, proposal flow, and mandatory review

2. prompt inflation
   - mitigation: top-N, snippet caps, summary-only by default

3. opaque retrieval
   - mitigation: explain payload is mandatory

4. coupling to Obsidian
   - mitigation: parser depends only on files and frontmatter

5. improper overlap with `Expertise`
   - mitigation: explicit boundaries and separate CLI surfaces

6. cost or performance issues from broad indexing
   - mitigation: limits, cache, incremental rebuild, and traversal guardrails

## Dependencies and Open Decisions

1. final naming:
   - `Context Memory`
   - `Operational Context Memory`
   - `Assistant Memory`

2. initial indexing mode:
   - lexical plus metadata only
   - or hybrid with optional embeddings in a future release

3. where to expose explainability:
   - `mah context explain`
   - `mah explain run`
   - both

4. proposal flow policy:
   - leads and orchestrator only
   - or workers may also propose with mandatory reviewer assignment

## Suggested PR Slices

### PR1 — Schema + validate + storage layout

**Status:** delivered

- types
- schema
- fixtures
- boundary docs

Reference:

- [`plan/slices/context-memory-finalization-slices.md`](./slices/context-memory-finalization-slices.md)

### PR2 — Index + retrieval MVP

**Status:** delivered

- index builder
- retrieval engine
- CLI `index/find/explain`

Implementation landed directly in code:

- `scripts/context/context-memory-schema.mjs`
- `scripts/meta-agents-harness.mjs`
- `tests/context-memory.test.mjs`

### PR3 — Hermes/runtime bootstrap integration

**Status:** partial

- `agentCtx` enrichment
- bounded injection
- bootstrap tests

Remainder is now tracked in:

- [`plan/slices/context-memory-finalization-slices.md`](./slices/context-memory-finalization-slices.md)

### PR4 — Persistent proposal flow

**Status:** partial

- draft generation from sessions
- governance
- docs and tests

Remainder is now tracked in:

- [`plan/slices/context-memory-finalization-slices.md`](./slices/context-memory-finalization-slices.md)

### PR5 — Product docs + assistant-layer framing

**Status:** partial

- release documentation
- relation to expertise, sessions, and provenance
- future roadmap

Remainder is now tracked in:

- [`plan/slices/context-memory-finalization-slices.md`](./slices/context-memory-finalization-slices.md)

## Next Executable Slices

The remaining work for the original `v0.8.0` plan is consolidated in:

- [`plan/slices/context-memory-finalization-slices.md`](./slices/context-memory-finalization-slices.md)

That unified slice document contains:

1. runtime visibility and explainability for injected context
2. operator-facing proposal governance and bounded promotion workflow
3. the assistant-state base

## Definition of Done

1. `mah expertise` remains semantically intact for routing.
2. `mah context` exists as a separate, operable namespace.
3. The system supports `.md` and `.qmd` as operational corpus formats.
4. The backlog-planning smoke doc uses ClickUp MCP directly and exists today as `.md`.
5. Retrieval is bounded, explainable, and respects available tools.
6. Runtime bootstrap can consume operational context without depending on a fixed prompt.
7. A proposal flow exists for persistence of derived memory.
8. The design strengthens MAH as a higher-level assistance layer without collapsing product identity into a specific runtime.
