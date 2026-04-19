# Context Memory (v0.8.0)

## Status

Context Memory is an operational layer for retrieving relevant task context after expertise-based routing has selected an agent. It provides bounded, explainable, reusable operational memory without interfering with routing decisions.

This document covers the v0.8.0 implementation.

## What It Is

Context Memory answers the question: **What does this agent need to remember to execute this task well?**

It is separate from Expertise, which answers: **Which agent should receive this task?**

## Canonical Layers

| Layer | Role | CLI |
|---|---|---|
| Expertise | Who should act | mah expertise |
| Context Memory | What to remember | mah context |
| Sessions | Ephemeral continuity | mah sessions |
| Provenance | Audit trail | via sessions |
| Evidence | Structured signals | via expertise |

## Architecture



## Document Schema

Each operational memory document is a .md or .qmd file with YAML frontmatter:

\`\`\`yaml
id: dev/planning-lead/backlog-planning/clickup-backlog-triage
kind: operational-memory
crew: dev
agent: planning-lead
capabilities:
  - backlog-planning
  - scope-triage
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
priority: high
stability: curated
source_type: human-authored
last_reviewed_at: "2026-04-17"
refs:
  - docs/expertise-catalog-governance.md
\`\`\`

---

## Stability Levels

| Level | Meaning | Retrieval |
|---|---|---|
| draft | Newly created, unverified | Penalized (-0.1) |
| curated | Reviewed, operational | Normal |
| stable | Proven, high confidence | Boosted (+0.05) |

## CLI Reference

### mah context validate

Validate documents in the corpus.

\`\`\`bash
mah context validate                              # Validate .mah/context/operational/
mah context validate --path ./docs/context/       # Validate specific directory
mah context validate --strict                    # Unknown fields = errors
\`\`\`

### mah context list

List documents in the corpus.

\`\`\`bash
mah context list                                 # List all
mah context list --agent planning-lead           # Filter by agent
mah context list --capability backlog-planning   # Filter by capability
mah context list --json                         # JSON output
\`\`\`

### mah context show

Display a specific document.

\`\`\`bash
mah context show dev/planning-lead/backlog-planning/clickup-backlog-triage
mah context show dev/planning-lead/backlog-planning/clickup-backlog-triage --json
\`\`\`

### mah context index

Build or update the search index.

\`\`\`bash
mah context index                    # Incremental (mtime/hash check)
mah context index --rebuild         # Full rebuild
\`\`\`

### mah context find

Retrieve relevant context for a task.

\`\`\`bash
mah context find --agent planning-lead --task "transform spec into backlog with clickup"
mah context find --agent planning-lead --task "triage backlog" --capability backlog-planning
mah context find --agent engineering-lead --task "split task into PR slices" --json
\`\`\`

### mah context explain

Explain the retrieval reasoning for a task.

\`\`\`bash
mah context explain --agent planning-lead --task "create milestones"
mah context explain --agent planning-lead --task "triage backlog" --json
\`\`\`

### mah context propose

Create a draft memory proposal from a session.

\`\`\`bash
mah context propose --from-session hermes:dev:session-id-here
\`\`\`

Session ID format: runtime:crew:sessionId (e.g., hermes:dev:abc123)

Proposals are written to .mah/context/proposals/ with status: draft. Review and promote manually.

## Retrieval Algorithm

Input: task, agent, [capability_hint], [available_tools], [available_mcp]

1. Filter by agent (required match, reject if no match)
2. +0.3 if capability_hint exactly matches a document capability
3. +0.1 per matching tool (max +0.3)
4. +0.1 per matching system/MCP (max +0.3)
5. +0.1 per task_pattern substring match in task (max +0.3)
6. +0.05 per tag substring match in task (max +0.2)
7. +0.05 per heading substring match (max +0.2)
8. Stability: draft=-0.1, stable=+0.05
9. Clamp to [0, 1]
10. Return top-5 results

## Hermes Runtime Integration

Enable context memory injection into Hermes bootstrap:

\`\`\`bash
MAH_CONTEXT_MEMORY=1 mah run --crew dev
mah run --crew dev --with-context-memory
\`\`\`

Options:
--context-limit <n>  Number of documents to retrieve (default 5, max 10)
--context-mode summary|snippets  Output format

The context block is appended to the bootstrap query before "CONTEXT LOADED". If no corpus or no matches, injection is silently skipped.

The bootstrap task context comes from the current runtime args first, then falls back to mission/sprint metadata if no task text is present.

## Proposal Flow

Derived memory proposals are created from sessions:

1. mah context propose --from-session <ref>
2. Draft written to .mah/context/proposals/
3. Human reviews the proposal
4. If approved: move to .mah/context/operational/ and set stability
5. Rebuild index: mah context index --rebuild

## Storage Layout

\`\`\`
.mah/context/
  operational/           Curated corpus (committed to repo)
    crew/agent/capability/slug.md
  index/                 Derived index (auto-generated)
    operational-context.index.json
  proposals/             Draft proposals (review required)
    YYYY-MM-DD-cap-slug.md
  cache/                 Ephemeral (not committed)
    .gitkeep
  .gitignore
  README.md
\`\`\`

## Constraints

- No vector DB or embedding dependency
- No Obsidian dependency; Obsidian is optional as an editor only
- .md and .qmd treated identically
- Context Memory has zero role in routing decisions
- `tests/fixtures/context-memory/` is validation data only and is never part of the operational corpus
- Raw session transcripts are not automatically promoted
- All proposals require human review before corpus entry

## Canonical Implementation

\`\`\`
types/context-memory-types.mjs
scripts/context-memory-validate.mjs
scripts/context-memory-schema.mjs
scripts/context-memory-integration.mjs
scripts/context-memory-proposal.mjs
CLI entry via scripts/meta-agents-harness.mjs
\`\`\`

## Related Docs

- Expertise Model Foundation ./expertise-model-foundation.md
- Sessions Interop ./sessions-interop.md
- Runtime Boundary ./runtime-boundary.md
