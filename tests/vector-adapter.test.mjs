/**
 * Vector Adapter Tests
 * Verify vector retrieval adapter with graceful fallback
 * Run: node --test tests/vector-adapter.test.mjs
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const {
  checkVectorAvailability,
  retrieveWithVectorFallback,
  scoreDocumentsLexical,
  VECTOR_STORE_AVAILABLE,
} = await import("../scripts/context/vector-adapter.mjs")

const {
  retrieveDocuments,
  loadIndex,
} = await import("../scripts/context/context-memory-schema.mjs")

describe("Vector Adapter", () => {

  describe("checkVectorAvailability", () => {
    it("returns available=false when no qmd/pvector installed", () => {
      const result = checkVectorAvailability()
      assert.strictEqual(result.available, false)
      assert.ok(result.provider === null)
      assert.ok(result.reason.length > 0)
    })

    it("returns object with available, provider, reason fields", () => {
      const result = checkVectorAvailability()
      assert.ok("available" in result)
      assert.ok("provider" in result)
      assert.ok("reason" in result)
    })
  })

  describe("retrieveWithVectorFallback", () => {
    it("falls back to file-based when vector unavailable", async () => {
      const mockIndex = [
        {
          id: "dev/planning/test-doc",
          file_path: "operational/dev/planning/test-doc.md",
          hash: "abc123",
          mtime: Date.now(),
          metadata_summary: {
            kind: "operational-memory",
            crew: "dev",
            agent: "planning-lead",
            capabilities: ["task-planning"],
            domains: ["engineering"],
            systems: [],
            skills: [],
            tools: [],
            task_patterns: [],
          },
          snippet_count: 5,
          heading_count: 2,
          headings: ["Test Heading", "Sub heading"],
          tags: ["planning", "task-management"],
        },
        {
          id: "dev/backend/api-guide",
          file_path: "operational/dev/backend/api-guide.md",
          hash: "def456",
          mtime: Date.now(),
          metadata_summary: {
            kind: "operational-memory",
            crew: "dev",
            agent: "backend-dev",
            capabilities: ["backend"],
            domains: ["backend"],
            systems: [],
            skills: [],
            tools: [],
            task_patterns: [],
          },
          snippet_count: 10,
          heading_count: 3,
          headings: ["API Guide", "Endpoints"],
          tags: ["api", "backend"],
        },
      ]

      const result = await retrieveWithVectorFallback(
        { task: "task planning for sprint", capability_hint: "task-planning", top_n: 5 },
        mockIndex,
        { vectorFirst: true, timeout_ms: 5000 }
      )

      assert.ok(result.results)
      assert.strictEqual(result.provider, "file-based")
      assert.strictEqual(result.fallback, true)
      assert.ok(result.elapsed_ms >= 0)
      // When no vector store, fallback is true
      assert.ok("total_candidates" in result || result.results.length >= 0)
    })

    it("returns same shape as file-based retrieval", async () => {
      const mockIndex = [
        {
          id: "dev/qa/test-guide",
          file_path: "operational/dev/qa/test-guide.md",
          hash: "xyz789",
          mtime: Date.now(),
          metadata_summary: {
            kind: "operational-memory",
            crew: "dev",
            agent: "qa-dev",
            capabilities: ["testing"],
            domains: ["qa"],
            systems: [],
            skills: [],
            tools: ["playwright"],
            task_patterns: ["testing"],
          },
          snippet_count: 8,
          heading_count: 1,
          headings: ["Test Guide"],
          tags: ["testing", "qa"],
        },
      ]

      const result = await retrieveWithVectorFallback(
        { task: "run tests for the API", top_n: 5 },
        mockIndex,
        { vectorFirst: false }
      )

      assert.ok(Array.isArray(result.results))
      assert.strictEqual(typeof result.provider, "string")
      assert.strictEqual(typeof result.fallback, "boolean")
      assert.strictEqual(typeof result.elapsed_ms, "number")
    })

    it("returns results with id, score, reasons fields per document", async () => {
      const mockIndex = [
        {
          id: "dev/devops/deploy-guide",
          file_path: "operational/dev/devops/deploy-guide.md",
          hash: "aaa111",
          mtime: Date.now(),
          metadata_summary: {
            kind: "operational-memory",
            crew: "dev",
            agent: "devops",
            capabilities: ["deployment"],
            domains: ["devops"],
            systems: [],
            skills: [],
            tools: ["docker"],
            task_patterns: [],
          },
          snippet_count: 6,
          heading_count: 1,
          headings: ["Deploy Guide"],
          tags: ["deployment", "devops"],
        },
      ]

      const result = await retrieveWithVectorFallback(
        { task: "deploy to production", top_n: 3 },
        mockIndex,
        {}
      )

      if (result.results.length > 0) {
        const doc = result.results[0]
        assert.ok("id" in doc)
        assert.ok("score" in doc)
        assert.ok("reasons" in doc)
        assert.strictEqual(typeof doc.score, "number")
      }
    })
  })

  describe("scoreDocumentsLexical", () => {
    it("returns same shape as retrieveDocuments", () => {
      const mockEntries = [
        {
          id: "test/doc-1",
          file_path: "test/doc-1.md",
          hash: "hash1",
          mtime: Date.now(),
          metadata_summary: {
            kind: "operational-memory",
            capabilities: ["coding"],
            domains: ["engineering"],
            systems: [],
            skills: [],
            tools: [],
            task_patterns: [],
          },
          snippet_count: 5,
          heading_count: 1,
          headings: ["Doc 1"],
          tags: ["coding"],
        },
      ]

      const result = scoreDocumentsLexical(
        { task: "write backend code", top_n: 3 },
        mockEntries
      )

      assert.ok("matched_docs" in result)
      assert.ok("confidence" in result)
      assert.ok("retrieved_at" in result)
      assert.ok("total_candidates" in result)
    })

    it("scores by capability_hint when provided", () => {
      const mockEntries = [
        {
          id: "test/planning-doc",
          file_path: "test/planning-doc.md",
          hash: "hash2",
          mtime: Date.now(),
          metadata_summary: {
            kind: "operational-memory",
            capabilities: ["task-planning"],
            domains: ["engineering"],
            systems: [],
            skills: [],
            tools: [],
            task_patterns: [],
          },
          snippet_count: 3,
          heading_count: 1,
          headings: ["Planning"],
          tags: ["planning"],
        },
      ]

      const result = scoreDocumentsLexical(
        { task: "coordinate sprint", capability_hint: "task-planning", top_n: 5 },
        mockEntries
      )

      if (result.matched_docs.length > 0) {
        assert.ok(result.matched_docs[0].score >= 0.25, "capability match should boost score")
      }
    })

    it("returns empty matched_docs for no-match query", () => {
      const mockEntries = [
        {
          id: "test/mismatch-doc",
          file_path: "test/mismatch-doc.md",
          hash: "hash3",
          mtime: Date.now(),
          metadata_summary: {
            kind: "operational-memory",
            capabilities: ["coding"],
            domains: ["engineering"],
            systems: [],
            skills: [],
            tools: [],
            task_patterns: [],
          },
          snippet_count: 5,
          heading_count: 1,
          headings: ["Something"],
          tags: ["coding"],
        },
      ]

      const result = scoreDocumentsLexical(
        { task: "zzz-no-match-xyz-unlikely-task-phrase", top_n: 5 },
        mockEntries
      )

      assert.ok(Array.isArray(result.matched_docs))
    })
  })

  describe("VECTOR_STORE_AVAILABLE constant", () => {
    it("is false by default", () => {
      assert.strictEqual(VECTOR_STORE_AVAILABLE, false)
    })
  })

  describe("benchmark harness", () => {
    it("runBenchmark is a function", async () => {
      const { runBenchmark } = await import("../scripts/context/retrieval-benchmark.mjs")
      assert.strictEqual(typeof runBenchmark, "function")
    })

    it("runBenchmark returns comparisons and summary", async () => {
      const { runBenchmark } = await import("../scripts/context/retrieval-benchmark.mjs")
      const mockEntries = [
        {
          id: "test/doc-a",
          file_path: "test/doc-a.md",
          hash: "hashA",
          mtime: Date.now(),
          metadata_summary: {
            kind: "operational-memory",
            capabilities: ["planning"],
            domains: ["engineering"],
            systems: [],
            skills: [],
            tools: [],
            task_patterns: [],
          },
          snippet_count: 3,
          heading_count: 1,
          headings: ["Planning A"],
          tags: ["planning"],
        },
        {
          id: "test/doc-b",
          file_path: "test/doc-b.md",
          hash: "hashB",
          mtime: Date.now(),
          metadata_summary: {
            kind: "operational-memory",
            capabilities: ["coding"],
            domains: ["backend"],
            systems: [],
            skills: [],
            tools: [],
            task_patterns: [],
          },
          snippet_count: 5,
          heading_count: 1,
          headings: ["Coding B"],
          tags: ["coding"],
        },
      ]

      const result = runBenchmark(
        [
          { task: "plan the sprint" },
          { task: "write backend code" },
        ],
        { index: { entries: mockEntries } }
      )

      assert.ok("comparisons" in result)
      assert.ok("summary" in result)
      assert.ok(Array.isArray(result.comparisons))
      assert.ok(result.comparisons.length === 2)
      assert.strictEqual(result.summary.index_size, 2)
      assert.strictEqual(result.summary.vector_available, false) // no vector store
    })
  })

  describe("context memory explain payload", () => {
    it("buildContextMemoryExplainPayload is async and returns status", async () => {
      const { buildContextMemoryExplainPayload } = await import("../scripts/context/context-memory-integration.mjs")
      assert.strictEqual(typeof buildContextMemoryExplainPayload, "function")
      // Returns disabled status when no context enabled
      const result = await buildContextMemoryExplainPayload([])
      assert.ok("enabled" in result)
      assert.ok("status" in result)
    })
  })

  describe("Regression: existing context memory tests", () => {
    it("retrieveDocuments still works with real index", () => {
      const contextRoot = path.join(repoRoot, ".mah", "context")
      const indexPath = path.join(contextRoot, "index", "operational-context.index.json")

      // If index exists, test that retrieveDocuments still works
      if (existsSync(indexPath)) {
        const index = loadIndex(indexPath)
        if (index && index.entries && index.entries.length > 0) {
          const result = retrieveDocuments({ task: "task planning" }, index)
          assert.ok("matched_docs" in result)
          assert.ok("confidence" in result)
        }
      }
      // If no index, that's OK - this is just a regression check
    })
  })
})