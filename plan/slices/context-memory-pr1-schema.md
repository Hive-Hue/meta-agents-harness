# Context Memory PR1 — Schema, Validation, Storage Layout

**Version:** 0.8.0-draft
**Status:** spec
**Slice:** PR1 (M4 → M1)
**Blocks:** M1 (Context Memory Foundation)

## 1. Overview

Context Memory is a new canonical layer in MAH that provides **operational context retrieval** for agents after expertise-based routing. Expertise decides WHO should execute; Context Memory provides WHAT the selected agent needs to remember to execute well.

This slice defines:
- Type definitions (`types/context-memory-types.mjs`)
- Validation logic contract (`scripts/context-memory-validate.mjs`)
- Canonical storage layout (`.mah/context/`)
- Boundary document (Context Memory vs Expertise vs Sessions vs Provenance vs Evidence)
- Test fixtures
- CLI contract (`mah context` subcommand)

### Constraints
- No vector DB dependency — lexical + metadata retrieval only
- No Obsidian dependency
- `.md` and `.qmd` treated equally
- Must be runtime-agnostic
- Must not interfere with `mah expertise` routing
- Frontmatter uses YAML between `---` delimiters
- All documents are versioned in-repo (curated corpus) or in `.mah/context/` (derived)

---

## 2. Type Definitions — `types/context-memory-types.mjs`

Follow the exact same style as `types/expertise-types.mjs`: JSDoc `@typedef` annotations, exported string constants for schema version and enums, no runtime logic.

### 2.1 Exports

```javascript
/**
 * MAH Context Memory v1 Schema
 * @fileoverview Canonical context memory types for MAH v0.8.0 Context Memory (M4/M1)
 * @version 0.8.0
 */

/** @type {string} */
export const CONTEXT_MEMORY_SCHEMA_VERSION = "mah.context-memory.v1"

/** @type {string[]} */
export const STABILITY_LEVELS = ["draft", "curated", "stable"]

/** @type {string[]} */
export const SOURCE_TYPES = ["human-authored", "derived", "imported"]

/** @type {string[]} */
export const DOCUMENT_KINDS = ["operational-memory", "playbook", "gotcha", "integration-guide", "reference"]

/** @type {string[]} */
export const RETRIEVAL_CONFIDENCE_LEVELS = ["high", "medium", "low", "none"]

/** @type {number} */
export const DEFAULT_RETRIEVAL_TOP_N = 5

/** @type {number} */
export const MAX_CONTEXT_DOCUMENT_SIZE_BYTES = 65536 // 64 KB per document

/** @type {number} */
export const MAX_RETRIEVAL_TOTAL_SIZE_BYTES = 32768 // 32 KB total retrieval payload
```

### 2.2 ContextMemoryDocument

```javascript
/**
 * @typedef {Object} ContextMemoryDocument
 * @property {string} id - Unique document ID matching path: "crew/agent/capability/slug"
 * @property {DocumentKind} kind - Document classification
 * @property {string} crew - Crew this document belongs to (e.g., "dev")
 * @property {string} agent - Agent name this document targets (e.g., "planning-lead")
 * @property {string[]} capabilities - Capabilities this document is relevant to
 * @property {string[]} [domains] - Subject area domains
 * @property {string[]} [systems] - External systems referenced (e.g., "clickup", "github")
 * @property {string[]} [skills] - Relevant MAH skills
 * @property {string[]} [tools] - Relevant tools (e.g., "mcp_call", "read")
 * @property {string[]} [task_patterns] - Natural language task descriptions this document matches
 * @property {Priority} [priority] - Relevance priority: "critical" | "high" | "medium" | "low"
 * @property {StabilityLevel} stability - Document stability level
 * @property {SourceType} source_type - How this document was created
 * @property {string} [last_reviewed_at] - ISO date of last human review
 * @property {string[]} [refs] - Cross-references to other documents or resources
 */
```

### 2.3 ContextMemoryIndexEntry

```javascript
/**
 * @typedef {Object} ContextMemoryIndexEntry
 * @property {string} id - Document ID (same as ContextMemoryDocument.id)
 * @property {string} file_path - Relative path from context root (e.g., "operational/dev/planning-lead/backlog-planning/clickup-backlog-triage.md")
 * @property {string} hash - SHA-256 hex digest of file content for change detection
 * @property {number} mtime - File modification timestamp (ms since epoch)
 * @property {Object} metadata_summary - Subset of frontmatter: { crew, agent, capabilities, systems, tools, stability, priority }
 * @property {number} snippet_count - Number of extracted snippets (code blocks, important paragraphs)
 * @property {number} heading_count - Number of headings in the document body
 * @property {string[]} [headings] - First N heading texts for lexical matching
 * @property {string[]} [tags] - Extracted tags from task_patterns + domains
 */
```

### 2.4 ContextMemoryRetrievalRequest

```javascript
/**
 * @typedef {Object} ContextMemoryRetrievalRequest
 * @property {string} [crew] - Filter by crew
 * @property {string} [agent] - Filter by agent name
 * @property {string} task - Task description to match against
 * @property {string} [capability_hint] - Suggested capability to boost
 * @property {string[]} [available_tools] - Tools available in current runtime
 * @property {string[]} [available_mcp] - MCP servers available in current runtime
 * @property {string} [runtime] - Current runtime identifier
 */
```

### 2.5 ContextMemoryRetrievalResult

```javascript
/**
 * @typedef {Object} ContextMemoryRetrievalMatch
 * @property {string} id - Document ID
 * @property {number} score - Relevance score 0-1
 * @property {string[]} reasons - Explainable reasons for the match
 */

/**
 * @typedef {Object} ContextMemoryRetrievalResult
 * @property {ContextMemoryRetrievalMatch[]} matched_docs - Ranked list of matches (up to top-N)
 * @property {string[]} summary_blocks - Bounded text summaries from matched docs
 * @property {string[]} tool_hints - Tools suggested by matched documents
 * @property {string[]} skill_hints - Skills suggested by matched documents
 * @property {string[]} blocked_refs - References that exist but were excluded (stability/permission)
 * @property {RetrievalConfidence} confidence - Overall confidence in retrieval quality
 * @property {string} retrieved_at - ISO timestamp of retrieval
 * @property {number} total_candidates - Total number of candidate documents considered
 */
```

### 2.6 ContextMemoryProposal

```javascript
/**
 * @typedef {Object} ContextMemoryProposal
 * @property {"mah.context-memory.proposal.v1"} proposal_version
 * @property {string} id - Proposal unique ID
 * @property {"draft"|"reviewed"|"approved"|"rejected"|"promoted"} status
 * @property {string} generated_at - ISO timestamp
 * @property {string} source_type - "session" | "provenance" | "evidence"
 * @property {string} source_ref - Reference to source (session ID, provenance entry, etc.)
 * @property {string} proposed_document_id - Target document ID if promoted
 * @property {ContextMemoryDocument} proposed_frontmatter - Draft frontmatter
 * @property {string} proposed_content - Draft body content
 * @property {string} summary - Human-readable summary of what this proposal adds
 * @property {string} rationale - Why this memory is worth persisting
 * @property {string[]} reviewers - Roles/agents that should review
 * @property {string[]} [existing_refs] - IDs of existing documents this would supplement
 */
```

### 2.7 Type Aliases

```javascript
/**
 * @typedef {"draft"|"curated"|"stable"} StabilityLevel
 * @typedef {"human-authored"|"derived"|"imported"} SourceType
 * @typedef {"operational-memory"|"playbook"|"gotcha"|"integration-guide"|"reference"} DocumentKind
 * @typedef {"critical"|"high"|"medium"|"low"} Priority
 * @typedef {"high"|"medium"|"low"|"none"} RetrievalConfidence
 */
```

---

## 3. Validation Rules — `scripts/context-memory-validate.mjs`

Follow the same validation style as `scripts/expertise-schema.mjs`:
- Pure functions that accept an object + optional `strict` flag
- Return `{ valid: boolean, errors: string[], warnings: string[] }`
- Internal `err(path, msg)` and `warn(path, msg)` helpers
- `checkUnknown()` for strict mode unknown field detection

### 3.1 Main Validator: `validateContextMemoryDocument(obj, strict = false)`

**Required fields for ALL document kinds:**
| Field | Type | Validation |
|-------|------|-----------|
| `id` | string | Required. Must be non-empty. Must match pattern `^[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*){2,}$` (at least 3 slash-separated segments: `crew/agent/...`) |
| `kind` | string | Required. Must be one of `DOCUMENT_KINDS` |
| `crew` | string | Required. Non-empty string |
| `agent` | string | Required. Non-empty string |
| `capabilities` | string[] | Required. Non-empty array of non-empty strings |
| `stability` | string | Required. Must be one of `STABILITY_LEVELS` |
| `source_type` | string | Required. Must be one of `SOURCE_TYPES` |

**Optional fields:**
| Field | Type | Validation |
|-------|------|-----------|
| `domains` | string[] | If present, non-empty array of non-empty strings |
| `systems` | string[] | If present, array of non-empty strings |
| `skills` | string[] | If present, array of non-empty strings |
| `tools` | string[] | If present, array of non-empty strings |
| `task_patterns` | string[] | If present, array of non-empty strings |
| `priority` | string | If present, one of `"critical"`, `"high"`, `"medium"`, `"low"` |
| `last_reviewed_at` | string | If present, must be valid ISO date (YYYY-MM-DD or full ISO) |
| `refs` | string[] | If present, array of non-empty strings. **Warning** (not error) if ref does not resolve to an existing file |

**ID ↔ Path consistency rule:**
- If the document has an associated file path, the ID should match the relative path under the context root minus extension
- Example: file `operational/dev/planning-lead/backlog-planning/clickup-backlog-triage.md` → ID `dev/planning-lead/backlog-planning/clickup-backlog-triage`
- **Warning** if ID does not match path (not an error — allows renames)

**Content validation:**
- Body must be non-empty (at least one non-whitespace character after frontmatter)
- **Warning** if no headings found (suggests poor structure)
- **Warning** if body exceeds `MAX_CONTEXT_DOCUMENT_SIZE_BYTES`

### 3.2 Index Entry Validator: `validateContextMemoryIndexEntry(obj, strict = false)`

Required: `id`, `file_path`, `hash`, `mtime`, `metadata_summary`, `snippet_count`, `heading_count`

### 3.3 Retrieval Request Validator: `validateContextMemoryRetrievalRequest(obj, strict = false)`

Required: `task` (non-empty string)
All other fields optional with type validation.

### 3.4 Retrieval Result Validator: `validateContextMemoryRetrievalResult(obj, strict = false)`

Required: `matched_docs` (array), `summary_blocks` (array), `confidence` (enum), `retrieved_at`, `total_candidates`
Each `matched_docs` entry requires: `id`, `score` (number 0-1), `reasons` (non-empty array)

### 3.5 Proposal Validator: `validateContextMemoryProposal(obj, strict = false)`

Required: `proposal_version` (must equal `"mah.context-memory.proposal.v1"`), `id`, `status`, `generated_at`, `source_type`, `source_ref`, `proposed_frontmatter`, `proposed_content`, `summary`, `rationale`, `reviewers`

### 3.6 CLI File-Level Validation

The `validate` CLI command reads `.md`/`.qmd` files from disk and:
1. Parses YAML frontmatter from between `---` delimiters
2. Validates the parsed frontmatter as a `ContextMemoryDocument`
3. Validates the body content (non-empty, heading structure)
4. Reports per-file results with aggregate summary

---

## 4. Storage Layout

### 4.1 Canonical Directory Structure

```
.mah/context/
├── operational/           # Curated operational memory corpus
│   └── <crew>/
│       └── <agent>/
│           └── <capability>/
│               ├── <slug>.md
│               └── <slug>.qmd
├── index/                 # Derived index files (auto-generated)
│   └── operational-context.index.json
├── proposals/             # Derived memory drafts pending review
│   └── <YYYY-MM-DD>-<short-hash>.md
├── cache/                 # Ephemeral retrieval cache
│   └── .gitkeep
├── .gitignore             # Per-subdirectory ignore rules
└── README.md              # Context memory governance docs
```

### 4.2 Operational Corpus Layout Detail

```
.mah/context/operational/
└── dev/
    ├── planning-lead/
    │   ├── backlog-planning/
    │   │   ├── clickup-backlog-triage.qmd
    │   │   ├── milestone-splitting.qmd
    │   │   └── acceptance-criteria-checklist.md
    │   └── scope-triage/
    │       └── scope-cut-heuristics.md
    ├── engineering-lead/
    │   └── implementation-coordination/
    │       ├── splitting-guidelines.md
    │       └── test-coverage-standards.md
    └── orchestrator/
        └── crew-coordination/
            └── multi-team-sync.md
```

### 4.3 Index File Format — `operational-context.index.json`

```json
{
  "schema_version": "mah.context-memory.index.v1",
  "generated_at": "2026-04-18T12:00:00Z",
  "context_root": ".mah/context",
  "total_documents": 8,
  "entries": [
    {
      "id": "dev/planning-lead/backlog-planning/clickup-backlog-triage",
      "file_path": "operational/dev/planning-lead/backlog-planning/clickup-backlog-triage.qmd",
      "hash": "sha256:<hex>",
      "mtime": 1745000000000,
      "metadata_summary": {
        "crew": "dev",
        "agent": "planning-lead",
        "capabilities": ["backlog-planning"],
        "systems": ["clickup"],
        "tools": ["mcp_call"],
        "stability": "curated",
        "priority": "high"
      },
      "snippet_count": 4,
      "heading_count": 5,
      "headings": ["ClickUp Backlog Triage", "Pre-conditions", "Step-by-step", "Common Pitfalls", "Fallback"],
      "tags": ["clickup", "backlog", "planning", "milestone", "task"]
    }
  ]
}
```

### 4.4 `.gitignore` Rules

For `.mah/context/.gitignore`:
```gitignore
# Cache is ephemeral — never commit
cache/*
!cache/.gitkeep

# Proposals are review-state — commit only reviewed ones
# (proposals with status=draft may be local-only)

# Index is derived — can be regenerated but committed for offline use
# (uncomment to exclude from tracking if preferred)
# index/*
```

### 4.5 Governance README

`.mah/context/README.md` should explain:
- Purpose of each subdirectory
- How to add new operational memory documents
- Stability promotion rules (draft → curated → stable)
- Review requirements for promotion
- What NOT to store (raw transcripts, unfiltered logs, policy statements)

---

## 5. Boundary Document

### 5.1 Layer Comparison Table

| Aspect | Expertise | Context Memory | Sessions | Provenance | Evidence |
|--------|-----------|---------------|----------|------------|----------|
| **Purpose** | Routing, capability, trust, policy | Operational detail, playbooks, gotchas | Continuity, ephemeral state | Audit trail | Structured signals |
| **Answers** | WHO should act? | WHAT to remember for execution? | WHEN did this happen recently? | WHAT HAPPENED? | WHAT SIGNALS support capability claims? |
| **Format** | YAML catalog (`.mah/expertise/catalog/`) | MD/QMD corpus (`.mah/context/`) | JSON session files (`.mah/sessions/`) | Provenance entries within sessions | JSON evidence files (`.mah/expertise/evidence/`) |
| **Lifecycle** | declared → validated → active/restricted | draft → curated → stable | Ephemeral (per-run) | Immutable append-only | Accumulated metrics |
| **Write authority** | Sync + expertise proposals | Human-authored or reviewed promotion | Runtime auto-creation | Runtime auto-creation | Runtime auto-creation |
| **Retrieval** | `mah expertise recommend/explain` | `mah context find/explain` | `mah sessions list/resume` | Via session provenance entries | Via expertise metrics |
| **Routing role** | **PRIMARY** — source of truth | **NONE** — post-routing only | Supplemental context | No routing role | Feeds expertise scoring |
| **Size budget** | Compact (per-agent metadata) | Bounded (top-N, snippets) | Configurable fidelity | Compact entries | Structured records |

### 5.2 Explicit Boundaries

**Context Memory MUST NOT:**
1. Influence expertise routing decisions — it has no role in `mah expertise recommend` or agent selection
2. Grant or deny permissions — that is expertise policy
3. Alter trust tiers or confidence scores — that is expertise evidence
4. Replace the expertise catalog as source of truth for capability declarations
5. Receive raw session transcripts — proposals must be curated
6. Act as a vector DB or embedding store — lexical + metadata only
7. Depend on Obsidian or any specific editor — `.md`/`.qmd` files only

**Context Memory MAY:**
1. Be injected into runtime bootstrap as bounded operational context
2. Be queried by agents during execution for playbook/gotcha lookup
3. Generate proposals from session/provenance signals (with mandatory review)
4. Cache retrieval results for performance
5. Supplement (never replace) agent prompts with operational detail

**Context Memory MUST:**
1. Report explainable reasons for every retrieval match
2. Respect stability levels — never use `draft` documents for policy-adjacent decisions
3. Honor retrieval size budgets (MAX_RETRIEVAL_TOTAL_SIZE_BYTES)
4. Maintain clean separation from expertise data structures
5. Fail safely when no corpus exists (graceful degradation)

---

## 6. Test Fixtures

### 6.1 Fixture 1: Valid Planning Lead Document (planning-lead-backlog-planning.md)

```markdown
---
id: dev/planning-lead/backlog-planning/clickup-backlog-triage
kind: operational-memory
crew: dev
agent: planning-lead
capabilities:
  - backlog-planning
  - scope-triage
domains:
  - planning
  - project-management
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
  - "triage incoming feature requests"
priority: high
stability: curated
source_type: human-authored
last_reviewed_at: "2026-04-17"
refs:
  - docs/expertise-catalog-governance.md
  - dev/planning-lead/backlog-planning/milestone-splitting
---

# ClickUp Backlog Triage

## Pre-conditions

- ClickUp MCP server is connected and responsive
- The spec or feature request document is available in the workspace

## Step-by-step Process

1. **Read the source spec** — Use `read` tool to consume the full specification
2. **Identify milestones** — Decompose into logical delivery milestones using PERT heuristics
3. **Create ClickUp milestones** — Use `mcp_call` to `clickup.create_folder` for each milestone
4. **Derive tasks** — Under each milestone, create tasks with acceptance criteria
5. **Set priorities** — Apply MoSCoW prioritization based on spec requirements

## Common Pitfalls

- Don't create tasks without acceptance criteria
- Don't skip milestone decomposition — flat task lists lose ordering information
- Verify ClickUp workspace ID before creating folders

## Fallback

If ClickUp MCP is unavailable:
1. Write the backlog decomposition to `plan/progress/` as a markdown file
2. Tag the file for later ClickUp import
3. Notify the operator about the manual sync requirement
```

### 6.2 Fixture 2: Valid Engineering Lead Document (engineering-lead-splitting-guidelines.md)

```markdown
---
id: dev/engineering-lead/implementation-coordination/splitting-guidelines
kind: playbook
crew: dev
agent: engineering-lead
capabilities:
  - implementation-coordination
  - code-review
domains:
  - software-engineering
systems:
  - github
tools:
  - mcp_call
  - read
  - grep
  - find
task_patterns:
  - "split a task into PR-sized slices"
  - "coordinate implementation across workers"
  - "define acceptance criteria for code changes"
priority: critical
stability: stable
source_type: human-authored
last_reviewed_at: "2026-04-15"
refs:
  - dev/engineering-lead/implementation-coordination/test-coverage-standards
---

# PR Splitting Guidelines

## Principles

1. **One concern per PR** — Each PR should address a single slice of work
2. **Testable in isolation** — Each PR must pass its own tests without depending on subsequent PRs
3. **Bounded size** — Target 200-400 lines of meaningful changes per PR

## Splitting Heuristics

### By Layer
- Types/Schema → Validation → Core Logic → CLI → Tests → Docs
- Never mix type definitions with runtime logic in the same PR

### By Feature
- Each new file type gets its own slice
- Cross-cutting changes (e.g., shared utilities) come first

### By Risk
- Low-risk mechanical changes (renames, formatting) can be batched
- High-risk semantic changes (new validation rules, new types) get dedicated PRs

## Anti-patterns

- Don't split a single function's implementation across multiple PRs
- Don't create "mega PRs" that touch 10+ files across unrelated concerns
- Don't defer all tests to a final "test PR"
```

### 6.3 Fixture 3: Invalid Document (missing required fields, wrong stability)

```markdown
---
id: dev/planning-lead/notes/incomplete-doc
kind: operational-memory
crew: dev
stability: provisional
source_type: auto-generated
---

# Incomplete Document

This document is missing several required fields:
- No `agent` field
- No `capabilities` field
- `stability` value "provisional" is not in the allowed enum
- `source_type` value "auto-generated" is not in the allowed enum
- No content structure (no headings below this one)
```

**Expected validation errors:**
- `ContextMemoryDocument.agent: required field missing or empty`
- `ContextMemoryDocument.capabilities: must be a non-empty array`
- `ContextMemoryDocument.stability: must be one of draft, curated, stable, got 'provisional'`
- `ContextMemoryDocument.source_type: must be one of human-authored, derived, imported, got 'auto-generated'`

**Expected validation warnings:**
- `ContextMemoryDocument.body: no headings found (consider adding structure)`

### 6.4 Fixture 4: Minimal Valid Document (edge case)

```markdown
---
id: dev/orchestrator/coordination/basic-sync
kind: operational-memory
crew: dev
agent: orchestrator
capabilities:
  - crew-coordination
stability: draft
source_type: derived
---

# Basic Multi-Team Sync

When coordinating across teams, always check expertise routing first before delegating.
```

This document has only required fields and no optional fields — it should validate successfully.

### 6.5 Fixture 5: QMD Format Document (planning-lead-scope-triage.qmd)

```markdown
---
id: dev/planning-lead/scope-triage/scope-cut-heuristics
kind: gotcha
crew: dev
agent: planning-lead
capabilities:
  - scope-triage
  - backlog-planning
domains:
  - planning
task_patterns:
  - "reduce scope for v0.x release"
  - "triage features by priority"
  - "cut features from milestone"
priority: medium
stability: draft
source_type: human-authored
---

# Scope Cut Heuristics

## When to Cut

- Features without acceptance criteria → cut first
- Features depending on unimplemented infrastructure → defer
- Features with high uncertainty → move to exploration milestone

## How to Cut

1. Tag the feature as `[deferred]` in the backlog
2. Document the deferral rationale in the plan file
3. Create a follow-up task in the next milestone
4. Update CHANGELOG with "Removed" or "Deferred" section

## Gotchas

- Don't cut features that are already referenced by other features' acceptance criteria
- Don't confuse "deferred" with "rejected" — deferred features have a planned revisit milestone
```

---

## 7. CLI Contract — `mah context` Subcommand

### 7.1 Integration Point

Add a new `context` first-level command in `scripts/meta-agents-harness.mjs` `main()` function, following the same pattern as `expertise` and `sessions`:

```javascript
if (first === "context") {
  ;(async () => {
    process.exitCode = await runContext(argv.slice(1), jsonMode)
  })()
  return
}
```

### 7.2 Subcommand Specification

#### `mah context validate [--strict] [--path <dir>]`
- Validates all `.md` and `.qmd` files under the context root (default: `.mah/context/`)
- `--strict`: unknown fields become errors instead of warnings
- `--path <dir>`: validate a specific directory instead of the full context root
- Output: per-file pass/fail with error/warning counts
- JSON mode: `{ "files_checked": N, "valid": N, "invalid": N, "results": [{ file, valid, errors, warnings }] }`
- Exit code: 0 if all valid, 1 if any invalid

#### `mah context index [--rebuild]`
- Builds or updates the index at `.mah/context/index/operational-context.index.json`
- `--rebuild`: force full rebuild (ignore cache/mtime)
- Default: incremental update based on mtime/hash comparison
- Output: document count, new/updated/removed entries
- JSON mode: `{ "total_documents": N, "new": N, "updated": N, "removed": N, "errors": [] }`
- Exit code: 0 on success, 1 on error

#### `mah context list [--agent <name>] [--capability <cap>] [--json]`
- Lists documents in the operational corpus
- `--agent <name>`: filter by agent name
- `--capability <cap>`: filter by capability
- `--json`: JSON output
- Table output columns: ID, Kind, Stability, Priority, Last Reviewed
- JSON mode: `{ "documents": [{ id, kind, stability, priority, last_reviewed_at }] }`

#### `mah context show <id> [--json]`
- Shows a specific context memory document
- `<id>`: full document ID (e.g., `dev/planning-lead/backlog-planning/clickup-backlog-triage`)
- Displays frontmatter + formatted body
- `--json`: `{ "document": { frontmatter, body, file_path, index_entry } }`
- Exit code: 0 if found, 1 if not found

#### `mah context find --agent <name> --task "<desc>" [--capability <cap>] [--json]`
- Performs context retrieval for a given task and agent
- `--agent <name>`: target agent (required)
- `--task "<desc>"`: task description (required)
- `--capability <cap>`: optional capability hint
- Returns top-N matches with scores and reasons
- JSON mode: full `ContextMemoryRetrievalResult` object
- Human mode: formatted table of matches with score and reasons

#### `mah context explain --agent <name> --task "<desc>" [--json]`
- Like `find` but with detailed explanation of the retrieval process
- Shows: total candidates, filtering steps, scoring breakdown, confidence assessment
- JSON mode: `{ "retrieval_result": {...}, "explanation": { steps, filters_applied, scoring_details } }`

#### `mah context propose --from-session <session-ref>`
- Creates a memory proposal from a session reference
- `--from-session <session-ref>`: session ID or reference
- Generates a draft proposal in `.mah/context/proposals/`
- Proposal status: `draft` — requires human review before promotion
- Output: proposal file path and summary
- Exit code: 0 on success, 1 on error (session not found, insufficient signals)

### 7.3 Help Text

```
Usage: mah context <subcommand> [options]

Context Memory — operational context retrieval for MAH agents

Subcommands:
  validate [--strict] [--path <dir>]   Validate context memory documents
  index [--rebuild]                    Build or update the context index
  list [--agent <name>] [--capability] List context memory documents
  show <id>                            Show a specific context document
  find --agent <name> --task "<desc>"  Find relevant context for a task
  explain --agent <name> --task "<desc>" Explain retrieval reasoning
  propose --from-session <ref>         Create memory proposal from session

Options:
  --json        JSON output mode
  --strict      Strict validation (unknown fields = errors)
  --help, -h    Show this help message

Context Memory is separate from Expertise routing. It provides operational
detail, playbooks, and gotchas for agents AFTER routing decisions are made.
```

---

## 8. Acceptance Criteria for PR1

- [ ] `types/context-memory-types.mjs` exists with all typedefs and constants
- [ ] `scripts/context-memory-validate.mjs` exists with all validators returning `{ valid, errors, warnings }`
- [ ] Validation rejects all fixture invalid documents with correct errors
- [ ] Validation accepts all fixture valid documents (including minimal edge case)
- [ ] `.md` and `.qmd` files are treated identically in all operations
- [ ] Storage layout is documented and matches spec
- [ ] Boundary document clearly separates Context Memory from Expertise, Sessions, Provenance, Evidence
- [ ] CLI contract specifies all 7 subcommands with flags and output formats
- [ ] No vector DB dependency
- [ ] No Obsidian dependency
- [ ] No impact on `mah expertise` routing behavior
- [ ] All types use JSDoc `@typedef` style matching existing patterns
- [ ] All validators use `{ valid, errors, warnings }` return style matching existing patterns

---

## 9. Implementation Notes

### 9.1 Frontmatter Parsing
- Use a simple `---` delimiter parser (split on first two `---` occurrences)
- Parse the YAML block between delimiters using a lightweight YAML parser
- The body is everything after the second `---`
- Support both `.md` and `.qmd` extensions transparently

### 9.2 Index Rebuild Strategy
- Full rebuild: walk `.mah/context/operational/`, parse every file, compute hashes
- Incremental: compare mtime and hash against existing index entries
- Skip files matching `.gitignore` patterns
- Skip files larger than `MAX_CONTEXT_DOCUMENT_SIZE_BYTES`

### 9.3 ID Generation
- IDs are derived from the file's relative path under `operational/`, minus the extension
- Example: `operational/dev/planning-lead/backlog-planning/clickup-backlog-triage.qmd` → `dev/planning-lead/backlog-planning/clickup-backlog-triage`
- The `id` in frontmatter SHOULD match the derived ID; warn on mismatch

### 9.4 Proposal Flow (Deferred to PR4)
- The `propose` CLI command is specified here but implementation is PR4
- PR1 should define the `ContextMemoryProposal` type and validator only
- No proposal generation logic needed in PR1

---

END OF SPECIFICATION.
