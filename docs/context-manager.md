# Context Manager (planned for v0.9.0)

## Status

Context Manager is an operational layer for retrieving relevant task context after expertise-based routing has selected an agent. It provides bounded, explainable, reusable operational memory without interfering with routing decisions.

This document covers the planned `v0.9.0` implementation and current unreleased behavior.

## WebUI Operational Notes (Unreleased)

- `Tasks -> Run Task` now routes to `/run` with task prefill (`summary`, `crew`, `runtime`) and **does not auto-start** a second execution.
- Headless runs started from `/run` are protected against backlog mutation side effects (`MAH_DISABLE_TASK_MUTATIONS=1`), so ad-hoc execution does not create/update task board entries implicitly.
- Artifact collection in `/run` merges runtime session artifacts with workspace file changes detected during execution, which improves visibility for runtimes that write directly into the repository tree.
- `Settings -> Context Memory` now exposes a **Persistent Memory** panel backed by CLI:
  - read: `list`, `stats`, `search`
  - write: `add`, `replace`, `remove`, `compact`, `capture`
  - all actions are served by `/api/mah/context-memory` and execute `mah context memory ... --json` against the active workspace.

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

Persistent memory for MAH agents is implemented as an additive layer inside Context Manager:

1. **Operational corpus (`operational/`)**  
Curated playbooks/gotchas with governance (`draft/curated/stable`) and deterministic retrieval.

2. **Persistent agent memory (`persistent/agents/<crew>/<agent>.memory.json`)**  
Bounded, mutable fact store per crew/agent for durable execution facts (conventions, lessons, recurring constraints).

3. **Session-derived proposals (`proposals/`)**  
Governed path for promoting session signals into operational corpus; no auto-promotion.

### MAH-specific decisions (vs Hermes base)

- **Per-agent topology awareness**: memory is keyed by `crew + agent` (not global profile files), aligned with MAH multi-agent routing model.
- **Routing boundary preserved**: persistent memory never affects `mah expertise` selection logic; it is retrieval-only after routing.
- **Bounded store by default**: char/entry limits enforce compaction pressure (`MAH_CONTEXT_PERSISTENT_MEMORY_CHAR_LIMIT`, `MAH_CONTEXT_PERSISTENT_MEMORY_ENTRY_LIMIT`).
- **Operator-auditable CLI**: explicit `mah context memory` actions (`list/add/replace/remove/search/stats`) with deterministic substring semantics for updates.
- **Additive runtime injection**: when `--with-context-memory` is enabled, operational retrieval + relevant persistent entries are injected together.



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

### mah context memory

Manage bounded persistent memory per agent (inspired by Hermes persistent memory semantics, adapted to MAH crew/agent topology).

\`\`\`bash
# inspect
mah context memory list --crew dev --agent planning-lead
mah context memory stats --crew dev --agent planning-lead

# write operations
mah context memory add --crew dev --agent planning-lead --content "ClickUp milestones use weekly buckets." --source manual --tags clickup,planning
mah context memory replace --crew dev --agent planning-lead --old "weekly buckets" --content "ClickUp milestones use bi-weekly buckets."
mah context memory remove --crew dev --agent planning-lead --old "bi-weekly buckets"

# task-scoped recall
mah context memory search --crew dev --agent planning-lead --task "triage backlog and create milestones"

# budget management
mah context memory compact --crew dev --agent planning-lead --target-percent 70

# session-to-memory ingestion (governed, bounded)
mah context memory capture --from-session pi:dev:2026-05-15T19-32-39-841Z-4ehe7k --crew dev --agent planning-lead
\`\`\`

Rules:
- substring matching is used for `replace` and `remove` (`--old` must match exactly one entry)
- exact duplicates are ignored
- memory is bounded by char and entry limits (`MAH_CONTEXT_PERSISTENT_MEMORY_CHAR_LIMIT`, `MAH_CONTEXT_PERSISTENT_MEMORY_ENTRY_LIMIT`)
- `capture` extracts durable patterns from session artifacts (`events.jsonl`, `session_index.json`, `session.export.json`) and can evict low-value entries when `--no-compact` is not set
- `compact` evicts least-used/oldest entries until the target usage budget is reached
- persistent memory is additive; it does not override Expertise routing

### mah context propose

Create a draft memory proposal from a session.

\`\`\`bash
mah context propose --from-session hermes:dev:session-id-here
mah context propose --from-session hermes:dev:session-id-here --ai --provider openrouter --model nvidia/nemotron-3-super-120b-a12b:free
\`\`\`

Session ID format: runtime:crew:sessionId (e.g., hermes:dev:abc123)

Proposals are written to .mah/context/proposals/ with status: draft. Review and promote manually.

Optional AI rewrite mode:

- `--ai` rewrites `summary`, `rationale`, and `proposed_content` before writing
- Uses chat-completions style APIs (same direct-HTTP provider model used by bootstrap AI mode)
- Supported flags:
  - `--provider <zai|openrouter|codex-oauth|minimax>`
  - `--model <id>`
  - `--api-key <key>`
  - `--base-url <url>`
  - `--endpoint </chat/completions|/responses>`
- If AI rewrite fails or is not configured, MAH falls back to deterministic proposal text

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

When persistent memory exists for the current crew/agent, relevant entries are injected into the same bootstrap context block alongside operational docs.

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
  persistent/            Bounded persistent memory stores (per crew/agent)
    agents/
      <crew>/<agent>.memory.json
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
scripts/context/context-memory-validate.mjs
scripts/context/context-memory-schema.mjs
scripts/context/context-memory-integration.mjs
scripts/context/context-memory-proposal.mjs
CLI entry via scripts/meta-agents-harness.mjs
\`\`\`

## Related Docs

- Expertise Model Foundation ./expertise-model-foundation.md
- Sessions Interop ./sessions-interop.md
- Runtime Boundary ./runtime-boundary.md

## v0.10.0 — Vector-aware Retrieval

MAH supports optional qmd/pvector adapters for semantic retrieval. Vector retrieval is additive: when unavailable or unhealthy, MAH gracefully falls back to canonical file-based retrieval.

### Runtime Flags

- `MAH_VECTOR_RETRIEVAL=1` enables vector-first path for `mah context find`.
- `MAH_PVECTOR_URL=http://localhost:8080` points MAH to a pvector-compatible HTTP service.
- `MAH_PVECTOR_COLLECTION=mah-context` sets the collection/logical index.
- `MAH_QMD_PATH=qmd` optionally points to a qmd binary adapter.
- `MAH_PGVECTOR_DSN=postgresql://mah:mah@localhost:5432/mah_context` configures pgvector proxy DB access.
- `MAH_PGVECTOR_TABLE=context_vectors` sets the pgvector table used by the native proxy.
- `MAH_PGVECTOR_COLLECTION_MODE=none|column|payload` controls how collection filtering is applied in pgvector.
- `.env.sample` now ships these context/vector variables pre-declared so new workspaces can enable the stack without manual key discovery.

When vector path is disabled or unavailable, output still succeeds with `retrieval_provider: "file-based"` and lexical matches.

### Option A: Qdrant via Docker (Ready Path)

This repository already includes scripts for Qdrant indexing plus a pvector-compatible proxy.

1. Start Qdrant:

```bash
docker run -d \
  --name mah-qdrant \
  -p 6333:6333 \
  -p 6334:6334 \
  -v "$(pwd)/.mah/qdrant-storage:/qdrant/storage" \
  qdrant/qdrant
```

2. Install proxy dependencies:

```bash
scripts/context/pvector-setup.sh
```

3. Start pvector proxy:

```bash
uv run --project scripts/context/pvector-proxy/pyproject.toml \
  python scripts/context/pvector-proxy.py
```

4. Export runtime variables:

```bash
export MAH_VECTOR_RETRIEVAL=1
export MAH_PVECTOR_URL=http://localhost:8080
export MAH_PVECTOR_COLLECTION=mah-context
export QDRANT_URL=http://localhost:6333
```

5. Index operational corpus into Qdrant:

```bash
python scripts/context/index-to-qdrant.py
```

Note: `index-to-qdrant.py` recreates the target collection before upsert.

6. Validate retrieval:

```bash
mah context find --agent planning-lead --task "triage backlog" --json
```

### Option B: qmd CLI (Direct Adapter)

MAH can call `qmd` directly when the binary is available. The adapter tries multiple command variants (`query/search`, with and without `--limit`) for compatibility across versions.

#### Installation

1. Install a supported runtime (Node.js >= 22 or Bun):

```bash
node --version
# or
bun --version
```

2. Install qmd globally:

```bash
npm install -g @tobilu/qmd
# or
bun install -g @tobilu/qmd
```

3. Verify install:

```bash
qmd --version
```

#### Setup + Run (Quick Path)

1. Set runtime flags:

```bash
export MAH_VECTOR_RETRIEVAL=1
export MAH_QMD_PATH=qmd
```

2. Optional health/smoke check:

```bash
qmd query --json "triage backlog"
```

3. Run MAH retrieval:

```bash
mah context find --agent planning-lead --task "triage backlog" --json
```

Note:
- qmd corpus/index lifecycle is managed by qmd itself. Ensure qmd has indexed the target content before running MAH semantic retrieval.
- When qmd returns semantic hits, MAH normalizes result IDs using source filename/path metadata (for example `qmd://.../file.md`) instead of opaque fallback IDs like `qmd-result-N`.
- If qmd returns no semantic hits, MAH gracefully falls back to lexical `file-based` retrieval and still returns the canonical Context Manager response shape.

### Option C: pgvector via Docker (Native Proxy)

This repository now ships a first-party pgvector proxy with the same pvector contract expected by MAH:
- `GET /health`
- `POST /query` with `{ "query": "...", "vector": [..] | null, "top_n": 5, "collection": "..." }`

#### Installation

1. Install required tools and verify:

```bash
docker --version
python3 --version
uv --version
```

2. If `uv` is missing, install it:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

3. Ensure Docker daemon is running before setup/index/proxy commands.

#### Setup + Run (Quick Path)

1. Setup Postgres + schema + proxy dependencies:

```bash
scripts/context/pvector-pgvector-setup.sh
```

2. Set runtime flags:

```bash
export MAH_VECTOR_RETRIEVAL=1
export MAH_PVECTOR_URL=http://localhost:8080
export MAH_PVECTOR_COLLECTION=mah-context
export MAH_PGVECTOR_DSN=postgresql://mah:mah@localhost:5432/mah_context
export MAH_PGVECTOR_TABLE=context_vectors
export MAH_PGVECTOR_COLLECTION_MODE=column
```

3. Start native pgvector proxy:

```bash
uv run --project scripts/context/pvector-pgvector-proxy/pyproject.toml \
  python scripts/context/pvector-pgvector-proxy.py
```

4. Validate proxy health:

```bash
curl -s http://localhost:8080/health
```

5. Index operational corpus into pgvector:

```bash
python scripts/context/index-to-pgvector.py
```

6. Run MAH retrieval:

```bash
mah context find --agent planning-lead --task "triage backlog" --json
```

#### Manual Docker Path (Equivalent)

If you prefer manual commands instead of the setup script:

1. Start Postgres with pgvector:

```bash
docker run -d \
  --name mah-pgvector \
  -e POSTGRES_USER=mah \
  -e POSTGRES_PASSWORD=mah \
  -e POSTGRES_DB=mah_context \
  -p 5432:5432 \
  -v "$(pwd)/.mah/pgvector-data:/var/lib/postgresql/data" \
  pgvector/pgvector:pg16
```

2. Initialize extension and table:

```bash
psql "postgresql://mah:mah@localhost:5432/mah_context" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS context_vectors (
  id text PRIMARY KEY,
  collection text NOT NULL DEFAULT 'mah-context',
  embedding vector(384) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS context_vectors_embedding_idx
  ON context_vectors
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
SQL
```

3. Scoring query used by native proxy:

```sql
SELECT
  id,
  1 - (embedding <=> $1::vector) AS score,
  payload AS metadata
FROM context_vectors
ORDER BY embedding <=> $1::vector
LIMIT $2;
```

Important:
- Use the same embedding model and dimension on indexing/query paths (repo defaults to `all-MiniLM-L6-v2`, 384d).
- Point MAH to proxy URL using `MAH_PVECTOR_URL`, then enable `MAH_VECTOR_RETRIEVAL=1`.

### Benchmarks

Run benchmark script directly:

```bash
node scripts/context/retrieval-benchmark.mjs
```

### Troubleshooting

- If vector service is down, MAH should still return results via lexical fallback.
- Confirm health endpoint:
  - `curl -s http://localhost:8080/health`
- Confirm Qdrant reachable:
  - `curl -s http://localhost:6333/collections`
- If `mah context find` shows file-based provider while vector is expected, verify:
  - `MAH_VECTOR_RETRIEVAL=1`
  - `MAH_PVECTOR_URL` points to a healthy proxy/service
  - collection/index contains vectors.
