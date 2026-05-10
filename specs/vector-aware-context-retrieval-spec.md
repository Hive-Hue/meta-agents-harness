# Vector-Aware Context Memory Retrieval — Design Specification

**Document type:** Feature design specification
**Status:** Proposed (v0.10.0)
**Target:** v0.10.0 Pillar 1 — Vector-aware Context Memory
**Audience:** Architecture, backend, CLI, validation
**Sprint task:** v0.10.0-T1

---

## 1. Executive Summary

Context memory retrieval in MAH is currently lexical and metadata-based (`scoreDocument` in `context-memory-schema.mjs`). It matches documents by token overlap, capability hints, agent/crew filters, and tag matching. This works well for structured operational memory but cannot capture semantic similarity between task descriptions and document content.

This spec adds an **optional vector-aware retrieval layer** that plugs into the existing retrieval pipeline via an adapter interface. When a vector adapter is available (qmd embedded vectors or external pvector store), retrieval uses semantic similarity scoring. When no adapter is available, the system falls back transparently to the existing lexical scorer — zero behavior change for operators who do not configure vector storage.

Key properties:

- **Optional and additive** — no mandatory vector store dependency
- **Graceful fallback** — vector unavailable → file-based lexical scoring, transparent to operator
- **Bounded** — same retrieval budgets (top-N, total size) enforced across both paths
- **Runtime-agnostic** — pure Node.js, no runtime-specific imports
- **Expertise-first routing preserved** — context memory never overrides agent routing

---

## 2. Current State

### 2.1 Existing Retrieval Pipeline

The current pipeline is:

```
buildContextMemoryBlock()
  → loadIndex() / buildOperationalIndex()
  → retrieveDocuments(request, index)
    → scoreDocument(entry, request)  // lexical + metadata scoring
    → sort by score descending
    → take top N (default 5)
  → format matched docs into bootstrap block
```

**Key functions** (in `scripts/context/context-memory-schema.mjs`):

| Function | Role |
|----------|------|
| `walkContextCorpus(rootPath)` | Recursively find `.md` and `.qmd` files |
| `parseFrontmatter(content)` | Parse YAML frontmatter from markdown |
| `buildIndexEntry(parsedFile, hash, mtime)` | Build index entry with metadata_summary, tags, headings |
| `buildOperationalIndex(contextRoot)` | Build/update operational index |
| `scoreDocument(indexEntry, request)` | Lexical + metadata scoring per document |
| `retrieveDocuments(request, index)` | Score all entries, sort, return top-N |

**Retrieval request shape:**
```javascript
{
  agent: "planning-lead",
  task: "triage backlog using ClickUp",
  capability_hint: "planning-lead",
  available_tools: [...],
  available_mcp: [...]
}
```

**Retrieval result shape:**
```javascript
{
  matched_docs: [{ id, score, reasons, entry }],
  summary_blocks: [...],
  tool_hints: [...],
  skill_hints: [...],
  confidence: "high" | "medium" | "low" | "none",
  retrieved_at: ISO timestamp,
  total_candidates: number
}
```

**Constants** (from `types/context-memory-types.mjs`):
- `DEFAULT_RETRIEVAL_TOP_N = 5`
- `MAX_RETRIEVAL_TOTAL_SIZE_BYTES = 32768`
- `MAX_CONTEXT_DOCUMENT_SIZE_BYTES = 65536`

### 2.2 qmd Support

The corpus walker already accepts `.qmd` files:
```javascript
if (ext === ".md" || ext === ".qmd") {
  results.push(fullPath)
}
```

But `.qmd` files are currently parsed identically to `.md` — no vector extraction or semantic scoring occurs.

---

## 3. VectorAdapter Interface

### 3.1 Contract Definition

All vector adapters must conform to this interface:

```javascript
/**
 * @typedef {Object} VectorAdapter
 * @property {string} name - Adapter identifier (e.g., "qmd", "pvector")
 * @property {() => boolean} isAvailable - Check if adapter can perform vector operations
 * @property {(query: VectorQuery) => Promise<VectorResult[]>} query - Execute vector search
 * @property {(docs: IndexEntry[]) => Promise<IndexEntry[]>} enrichIndex - Optional: pre-compute vectors for index entries
 */

/**
 * @typedef {Object} VectorQuery
 * @property {string} text - Query text (task description)
 * @property {string} [agent] - Agent filter
 * @property {string} [capability_hint] - Capability hint
 * @property {string} [crew] - Crew filter
 * @property {number} topN - Maximum results to return
 */

/**
 * @typedef {Object} VectorResult
 * @property {string} id - Document ID (matches index entry ID)
 * @property {number} score - Similarity score 0-1
 * @property {string[]} reasons - Match explanation strings
 * @property {Object} [entry] - Full index entry (if available)
 */
```

### 3.2 Interface Methods

| Method | Purpose | Returns |
|--------|---------|---------|
| `isAvailable()` | Can this adapter perform vector operations right now? | `boolean` |
| `query(query)` | Execute vector similarity search | `Promise<VectorResult[]>` |
| `enrichIndex(entries)` | Pre-compute vectors/embeddings for index entries | `Promise<IndexEntry[]>` |

### 3.3 Lifecycle

1. At retrieval time, `retrieveDocuments` checks adapter availability via `isAvailable()`
2. If available, vector path is used for primary scoring
3. If unavailable or returns zero results, fallback to lexical scoring
4. Adapter failure is caught and logged — never blocks retrieval

---

## 4. qmd Adapter

### 4.1 Purpose

Read `.qmd` (quad-encoded markdown) files that contain embedded vector data in their frontmatter. This adapter requires no external service — vectors are pre-computed and stored in the files themselves.

### 4.2 qmd File Format

A `.qmd` file is markdown with extended frontmatter containing an embedded vector:

```markdown
---
id: dev/planning/backlog-triage
kind: operational-memory
crew: dev
agent: planning-lead
capabilities:
  - backlog-planning
  - clickup-integration
vector:
  model: "text-embedding-3-small"
  dimensions: 1536
  data: [0.0123, -0.0456, 0.0789, ...]
  computed_at: "2026-05-09T20:00:00.000Z"
---

# Backlog Triage Playbook

Use ClickUp MCP directly when the task explicitly mentions backlog grooming...
```

### 4.3 Adapter Behavior

```
isAvailable():
  → scan .mah/context/operational/ for .qmd files
  → return true if any .qmd file has vector.data in frontmatter
  → cache result for 60 seconds

query({ text, agent, capability_hint, crew, topN }):
  1. Load index entries that have vector.data
  2. Compute query embedding (using same model specified in vector.model)
     - If embedding computation is not available locally, fall back to lexical matching on .qmd files
     - Embedding computation is optional — adapter can work with pre-computed vectors only
  3. For each indexed .qmd document:
     a. Compute cosine similarity between query embedding and stored vector
     b. Apply metadata filters (agent, crew, capability_hint)
     c. Return scored results
  4. Sort by similarity score descending, take topN
  5. Return VectorResult[]
```

### 4.4 Graceful Degradation

| Condition | Behavior |
|-----------|----------|
| No `.qmd` files in corpus | `isAvailable()` returns `false` |
| `.qmd` files exist but no `vector.data` | Parse as regular `.md` — lexical only |
| Embedding model not available | Skip vector scoring, use lexical match on `.qmd` content |
| Vector dimensions mismatch | Skip that document, log warning |
| Vector decode error | Skip that document, log warning |

### 4.5 Configuration

No configuration required. The adapter auto-detects `.qmd` files with embedded vectors.

Optional environment variables:
- `MAH_QMD_ADAPTER_ENABLED` — `"0"` to disable even when `.qmd` vectors exist (default: `"1"`)
- `MAH_QMD_CACHE_TTL` — availability cache TTL in seconds (default: `60`)

---

## 5. pvector Adapter

### 5.1 Purpose

Connect to an external pvector-compatible vector store for semantic retrieval. This adapter requires configuration and an available pvector service.

### 5.2 Configuration

```yaml
# .mah/context/vector-config.yaml (optional)
adapter: pvector
pvector:
  url: "http://localhost:8787"
  collection: "mah-context-memory"
  timeout_ms: 2000
  api_key: ""  # optional, from env MAH_PVECTOR_API_KEY
```

Configuration is loaded from:
1. `.mah/context/vector-config.yaml` (if exists)
2. Environment variable overrides:
   - `MAH_PVECTOR_URL`
   - `MAH_PVECTOR_COLLECTION`
   - `MAH_PVECTOR_API_KEY`
   - `MAH_PVECTOR_TIMEOUT_MS`

### 5.3 Adapter Behavior

```
isAvailable():
  → check vector-config.yaml exists and adapter=pvector
  → attempt HTTP GET to pvector health endpoint
  → return true only if pvector responds within timeout
  → cache result for 30 seconds

query({ text, agent, capability_hint, crew, topN }):
  1. Send query to pvector /query endpoint
     POST { collection, query_text: text, top_k: topN, filters: { agent, crew } }
  2. Parse response into VectorResult[]
  3. If HTTP error or timeout, throw — caught by retrieval pipeline, triggers fallback
```

### 5.4 Graceful Degradation

| Condition | Behavior |
|-----------|----------|
| No `vector-config.yaml` | Adapter not loaded — never attempted |
| `adapter` field not `"pvector"` | Adapter not loaded |
| pvector health check fails | `isAvailable()` returns `false` |
| Query times out | Caught, logged, fallback to lexical |
| Query returns malformed response | Caught, logged, fallback to lexical |
| pvector returns 0 results | Return empty array — pipeline may try lexical fallback |

### 5.5 API Contract

The pvector adapter expects a minimal REST API:

```
GET  /health              → { "status": "ok" }
POST /query               → { results: [{ id, score, metadata }] }
POST /upsert              → { "ok": true }
DELETE /collection/{name}  → { "ok": true }
```

**Query request:**
```json
{
  "collection": "mah-context-memory",
  "query_text": "triage backlog using ClickUp",
  "top_k": 5,
  "filters": {
    "agent": "planning-lead",
    "crew": "dev"
  }
}
```

**Query response:**
```json
{
  "results": [
    {
      "id": "dev/planning/backlog-triage",
      "score": 0.92,
      "metadata": {
        "agent": "planning-lead",
        "capabilities": ["backlog-planning", "clickup-integration"]
      }
    }
  ]
}
```

---

## 6. Fallback Chain

### 6.1 Retrieval Flow

```
retrieveDocuments(request, index)
  │
  ├─ adapter = resolveAdapter()  // check config, availability
  │
  ├─ if adapter.isAvailable():
  │    ├─ try: vectorResults = adapter.query(request)
  │    │    ├─ if vectorResults.length > 0:
  │    │    │    return mergeWithLexical(vectorResults, index, request)
  │    │    └─ if vectorResults.length === 0:
  │    │         return lexicalFallback(request, index)
  │    └─ catch (error):
  │         log.warn("Vector adapter failed: " + error.message)
  │         return lexicalFallback(request, index)
  │
  └─ else:
       return lexicalFallback(request, index)
```

### 6.2 resolveAdapter Logic

```javascript
function resolveAdapter() {
  const config = loadVectorConfig()  // from .mah/context/vector-config.yaml
  
  if (config?.adapter === "pvector" && pvectorAdapter.isAvailable()) {
    return pvectorAdapter
  }
  
  if (qmdAdapter.isAvailable()) {
    return qmdAdapter
  }
  
  return null  // no adapter available, lexical only
}
```

Priority: **pvector > qmd > lexical-only** (configurable).

### 6.3 mergeWithLexical

When vector results exist, merge with lexical scores for robustness:

```
final_score = W_vector × vector_score + W_lexical × lexical_score
```

| Weight | Default |
|--------|---------|
| `W_vector` | 0.7 |
| `W_lexical` | 0.3 |

If no lexical score exists for a document (e.g., vector-only document), use vector score alone.

### 6.4 Retrieval Metadata

Every retrieval result includes metadata about the path used:

```javascript
{
  // ... existing fields ...
  retrieval_metadata: {
    adapter_used: "qmd" | "pvector" | "lexical-only",
    vector_available: true | false,
    vector_results_count: 3,
    lexical_results_count: 5,
    merge_weights: { vector: 0.7, lexical: 0.3 },
    fallback_triggered: false,
    fallback_reason: null  // or "adapter_unavailable" | "zero_results" | "adapter_error: ..."
  }
}
```

### 6.5 Transparency

- `mah context find` shows which adapter was used
- `mah explain run` includes retrieval metadata in explain output
- `--json` output includes full `retrieval_metadata` block
- Default text output shows adapter name in result header: `Matched: 3 document(s) via qmd | Confidence: high`

---

## 7. Retrieval Benchmarks

### 7.1 Benchmark Contract

A benchmark command compares vector vs file-based retrieval paths:

```bash
mah context benchmark --queries .mah/context/benchmark-queries.json [--json]
```

### 7.2 Benchmark Query Format

```json
[
  {
    "query": "triage backlog using ClickUp",
    "agent": "planning-lead",
    "expected_ids": ["dev/planning/backlog-triage"]
  },
  {
    "query": "fix authentication timeout bug",
    "agent": "backend-dev",
    "expected_ids": ["dev/backend/auth-timeout-playbook"]
  }
]
```

### 7.3 Metrics Collected

| Metric | Description |
|--------|-------------|
| `latency_ms` | Time from query to result for each path |
| `precision@k` | Fraction of top-k results in expected_ids |
| `recall@k` | Fraction of expected_ids found in top-k results |
| `mrr` | Mean reciprocal rank of first expected result |
| `fallback_rate` | Percentage of queries that fell back to lexical |
| `adapter_available_rate` | Percentage of queries where adapter was available |

### 7.4 Output Format

```
Context Memory Retrieval Benchmark
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Queries: 10 | Adapter: qmd

Latency (ms):
  vector:   avg=12.3  min=8.1  max=45.2
  lexical:  avg=3.2   min=2.1  max=8.4

Precision@5:
  vector:   0.82
  lexical:  0.64
  delta:    +0.18

MRR:
  vector:   0.91
  lexical:  0.73

Fallback rate: 10% (1/10 queries)
```

---

## 8. Changed Files

| File | Action | Reason |
|------|--------|--------|
| `scripts/context/vector-adapter.mjs` | **Create** | `VectorAdapter` interface, `resolveAdapter()`, adapter registry |
| `scripts/context/qmd-adapter.mjs` | **Create** | qmd adapter implementation — parse `.qmd` vectors, cosine similarity |
| `scripts/context/pvector-adapter.mjs` | **Create** | pvector adapter implementation — HTTP client for pvector API |
| `scripts/context/context-memory-schema.mjs` | **Edit** | Modify `retrieveDocuments` to use fallback chain with adapter resolution |
| `scripts/context/context-memory-integration.mjs` | **Edit** | Pass retrieval metadata through to bootstrap block and explain output |
| `scripts/context/context-benchmark.mjs` | **Create** | Benchmark command for vector vs lexical comparison |
| `scripts/meta-agents-harness.mjs` | **Edit** | Add `mah context benchmark` subcommand, update `mah context find` to show adapter info |
| `types/context-memory-types.mjs` | **Edit** | Add vector-related type constants and JSDoc typedefs |
| `.mah/context/vector-config.example.yaml` | **Create** | Example pvector configuration file |
| `docs/context-memory.md` | **Edit** | Document vector adapters, fallback chain, benchmark command |
| `tests/` | **Add/Edit** | Tests for adapter interface, qmd parsing, pvector client, fallback chain, benchmark |

---

## 9. Acceptance Criteria

| # | Criterion | Status |
|---|-----------|--------|
| AC1 | `VectorAdapter` interface defined with `query`, `isAvailable`, `enrichIndex` methods | [ ] |
| AC2 | qmd adapter parses `.qmd` files with embedded vectors and scores by cosine similarity | [ ] |
| AC3 | pvector adapter connects to external pvector store when configured via `vector-config.yaml` | [ ] |
| AC4 | Fallback chain works: vector → lexical when adapter unavailable or returns zero results | [ ] |
| AC5 | Fallback is transparent — operator receives results regardless of which path was used | [ ] |
| AC6 | `mah context find` and explain output show which adapter path was used | [ ] |
| AC7 | No mandatory external dependency — core retrieval works without any vector store or config | [ ] |
| AC8 | `mah context benchmark` compares vector vs file-based retrieval paths with latency and precision metrics | [ ] |
| AC9 | Existing file-based retrieval is unchanged when no vector adapter is configured — same scores, same results | [ ] |
| AC10 | Bounded retrieval budgets (`DEFAULT_RETRIEVAL_TOP_N`, `MAX_RETRIEVAL_TOTAL_SIZE_BYTES`) preserved across both paths | [ ] |
| AC11 | Adapter errors are caught, logged, and never block retrieval | [ ] |
| AC12 | `retrieval_metadata` included in JSON output with adapter name, fallback status, result counts | [ ] |
| AC13 | pvector adapter health check has configurable timeout and does not block startup | [ ] |

---

## 10. Constraints

| Constraint | Enforcement |
|------------|-------------|
| No mandatory vector store | `resolveAdapter()` returns `null` when no config/data exists — lexical path unchanged |
| Graceful fallback always works | Every vector path wrapped in try/catch with lexical fallback |
| Bounded retrieval budgets | Same `topN` and `MAX_RETRIEVAL_TOTAL_SIZE_BYTES` applied to vector results |
| Runtime-agnostic | No runtime-specific imports; pure Node.js ESM |
| Expertise-first routing preserved | Context memory retrieval runs after routing; never influences agent selection |
| No vector store as routing authority | Vector scores only affect context document ranking, never agent routing |
| No automatic vector computation | Vectors must be pre-computed and embedded (qmd) or stored (pvector); MAH does not run embedding models |
| Conservative rollout | Vector adapter off by default; requires explicit config or `.qmd` files with vectors |

---

## 11. Out of Scope

- Automatic embedding computation (MAH does not bundle embedding models)
- Vector-based routing (expertise routing remains file-based)
- Real-time vector index updates on document change
- Multi-model embedding support (single model per corpus)
- WebUI for vector configuration
- Hybrid sparse-dense retrieval algorithms beyond simple weighted merge
- Vector store management (create/delete collections, upsert operations in CLI)

---

## 12. Dependencies

- Existing retrieval pipeline (`scripts/context/context-memory-schema.mjs`)
- Existing integration layer (`scripts/context/context-memory-integration.mjs`)
- Existing type definitions (`types/context-memory-types.mjs`)
- No new mandatory external dependencies
- pvector service only needed if pvector adapter is configured

---

## 13. Exit Condition

This spec is implemented when:
1. An operator can place `.qmd` files with embedded vectors in `.mah/context/operational/` and get semantic retrieval automatically
2. An operator can configure pvector in `vector-config.yaml` and get external vector retrieval
3. An operator with no vector configuration gets identical behavior to today's lexical retrieval
4. All three paths are measurable via `mah context benchmark`
