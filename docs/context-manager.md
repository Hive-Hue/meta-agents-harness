# Context Manager (planned for v0.9.0)

## Status

Context Manager is an operational layer for retrieving relevant task context after expertise-based routing has selected an agent. It provides bounded, explainable, reusable operational memory without interfering with routing decisions.

This document covers the planned `v0.9.0` implementation and current unreleased behavior.

## What It Is

Context Manager answers the question: **What does this agent need to remember to execute this task well?**

It is separate from Expertise, which answers: **Which agent should receive this task?**

## Canonical Layers

| Layer | Role | CLI |
|---|---|---|
| Expertise | Who should act | mah expertise |
| Context Manager | What to remember | mah context |
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

For `planning-lead` backlog-planning specifically, the operational memory should name the ClickUp MCP path directly and keep the playbook scoped to backlog grooming, milestones, and task creation. The canonical smoke doc in this repo is `.mah/context/operational/dev/planning-lead/backlog-planning/clickup-backlog-triage.md`.

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

### mah context proposals list

List all proposals with their current status.

\u0060\u0060\u0060
mah context proposals list [--json]
\u0060\u0060\u0060

- \u0060--json\u0060 \u2014 output as JSON array
- Default: human-readable table with ID, status, proposed document ID, source

### mah context proposals show

Display full proposal metadata, rationale, and overlap detection results.

\u0060\u0060\u0060
mah context proposals show <proposal-id> [--json]
\u0060\u0060\u0060

- \u0060--json\u0060 \u2014 output as JSON object
- Includes overlap warnings for duplicate targets, same session, similar titles

### mah context proposals promote

Promote a draft proposal to the operational corpus. Validates the proposal and its proposed document before writing.

\u0060\u0060\u0060
mah context proposals promote <proposal-id> [--stability curated|draft|auto] [--force] [--json]
\u0060\u0060\u0060

- \u0060--stability\u0060 \u2014 set stability level for the promoted document (default: \u0060curated\u0060)
- \u0060--force\u0060 \u2014 proceed even if overlaps detected
- \u0060--json\u0060 \u2014 output as JSON
- Writes curated document to \u0060.mah/context/operational/<id>.md\u0060
- Updates proposal status to \u0060promoted\u0060 with timestamp
- Refuses to overwrite existing operational documents
- Refuses path traversal or unsafe filenames

### mah context proposals reject

Reject a draft proposal with a reason. The proposal file is preserved for audit.

\u0060\u0060\u0060
mah context proposals reject <proposal-id> --reason "..." [--json]
\u0060\u0060\u0060

- \u0060--reason\u0060 \u2014 **required** explanation for rejection
- \u0060--json\u0060 \u2014 output as JSON
- Updates proposal status to \u0060rejected\u0060 with reason and timestamp
- Proposal file is never deleted

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

`--with-context-memory`, `--context-limit`, and `--context-mode` are MAH-managed flags. They are consumed by the MAH bootstrap layer and stripped before the Hermes CLI is launched.

The context block is appended to the bootstrap query before "CONTEXT LOADED". If no corpus or no matches, injection is silently skipped.

The bootstrap task context comes from the current runtime args first, then falls back to mission/sprint metadata if no task text is present.

## Proposal Flow

Derived memory proposals are created from sessions:

1. mah context propose --from-session <ref>
2. Draft written to .mah/context/proposals/
3. Human reviews the proposal
4. If approved: move to .mah/context/operational/ and set stability
5. Rebuild index: mah context index --rebuild

Proposals follow a governed state machine:

- **draft** → created by \u0060mah context propose --from-session\u0060
- **draft** → \u0060promoted\u0060 via \u0060mah context proposals promote <id>\u0060 (validates, writes to operational)
- **draft** → \u0060rejected\u0060 via \u0060mah context proposals reject <id> --reason "..."\u0060 (preserves file)
- State transitions are one-way: promoted and rejected proposals cannot be re-promoted or re-rejected.

Promotion never happens automatically from \u0060propose\u0060. Every promotion requires explicit operator action.

This is governed learning, not a raw memory dump. No auto-promotion. No transcript is ingested without human review. The cycle is: session → draft proposal → human review → curate → promote → available for retrieval. Each curated proposal compounds the system's operational knowledge.

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
- Context Manager has zero role in routing decisions
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
