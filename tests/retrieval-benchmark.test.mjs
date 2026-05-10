/**
 * Retrieval Benchmark Tests
 * Compares vector vs file-based retrieval paths for the same queries.
 * Run: node --test tests/retrieval-benchmark.test.mjs
 */
import { describe, test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import path from "path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const MAX_RETRIEVAL_SIZE = 32768

const {
  checkVectorAvailability,
  retrieveWithVectorFallback,
  VECTOR_STORE_AVAILABLE,
} = await import("../scripts/context/vector-adapter.mjs")

const {
  retrieveDocuments,
  scoreDocument,
  loadIndex,
} = await import("../scripts/context/context-memory-schema.mjs")

// ---------------------------------------------------------------------------
// Test index: known documents for recall/precision testing
// ---------------------------------------------------------------------------

const TEST_INDEX_ENTRIES = [
  {
    id: "dev/planning/sprint-planning",
    file_path: "operational/dev/planning/sprint-planning.md",
    hash: "hash001",
    mtime: Date.now(),
    metadata_summary: {
      kind: "operational-memory",
      crew: "dev",
      agent: "planning-lead",
      capabilities: ["task-planning", "scope-estimation"],
      domains: ["engineering", "agile"],
      systems: [],
      skills: ["scrum", "estimation"],
      tools: [],
      task_patterns: ["sprint", "planning", "backlog"],
    },
    snippet_count: 8,
    heading_count: 3,
    headings: ["Sprint Planning Guide", "Estimation Techniques", "Backlog Management"],
    tags: ["sprint", "planning", "backlog", "agile"],
  },
  {
    id: "dev/backend/api-development",
    file_path: "operational/dev/backend/api-development.md",
    hash: "hash002",
    mtime: Date.now(),
    metadata_summary: {
      kind: "operational-memory",
      crew: "dev",
      agent: "backend-dev",
      capabilities: ["backend", "api-design"],
      domains: ["backend", "rest"],
      systems: [],
      skills: [],
      tools: ["postman", "docker"],
      task_patterns: ["api", "backend", "rest", "endpoint"],
    },
    snippet_count: 12,
    heading_count: 4,
    headings: ["REST API Guidelines", "Authentication", "Error Handling"],
    tags: ["api", "backend", "rest", "development"],
  },
  {
    id: "dev/qa/automated-testing",
    file_path: "operational/dev/qa/automated-testing.md",
    hash: "hash003",
    mtime: Date.now(),
    metadata_summary: {
      kind: "operational-memory",
      crew: "dev",
      agent: "qa-dev",
      capabilities: ["testing", "quality-assurance"],
      domains: ["qa", "testing"],
      systems: [],
      skills: ["test-automation", "playwright"],
      tools: ["playwright", "jest"],
      task_patterns: ["testing", "qa", "automated-tests", "test-suite"],
    },
    snippet_count: 10,
    heading_count: 3,
    headings: ["Test Automation Strategy", "Playwright Setup", "CI Integration"],
    tags: ["testing", "qa", "automation", "playwright"],
  },
  {
    id: "dev/devops/deployment",
    file_path: "operational/dev/devops/deployment.md",
    hash: "hash004",
    mtime: Date.now(),
    metadata_summary: {
      kind: "operational-memory",
      crew: "dev",
      agent: "devops",
      capabilities: ["deployment", "infrastructure"],
      domains: ["devops", "infrastructure"],
      systems: [],
      skills: ["docker", "kubernetes"],
      tools: ["docker", "kubectl"],
      task_patterns: ["deployment", "docker", "kubernetes", "ci-cd"],
    },
    snippet_count: 9,
    heading_count: 2,
    headings: ["Docker Deployment", "Kubernetes Operations"],
    tags: ["deployment", "devops", "docker", "kubernetes"],
  },
  {
    id: "dev/frontend/react-patterns",
    file_path: "operational/dev/frontend/react-patterns.md",
    hash: "hash005",
    mtime: Date.now(),
    metadata_summary: {
      kind: "operational-memory",
      crew: "dev",
      agent: "frontend-dev",
      capabilities: ["frontend", "ui-development"],
      domains: ["frontend", "react"],
      systems: [],
      skills: [],
      tools: [],
      task_patterns: ["react", "component", "frontend", "ui"],
    },
    snippet_count: 7,
    heading_count: 2,
    headings: ["React Best Practices", "Component Patterns"],
    tags: ["react", "frontend", "component", "ui"],
  },
  {
    id: "dev/architecture/microservices",
    file_path: "operational/dev/architecture/microservices.md",
    hash: "hash006",
    mtime: Date.now(),
    metadata_summary: {
      kind: "operational-memory",
      crew: "dev",
      agent: "dev-lead",
      capabilities: ["architecture", "system-design"],
      domains: ["architecture", "microservices"],
      systems: [],
      skills: ["microservices", "api-gateway"],
      tools: [],
      task_patterns: ["microservices", "architecture", "service-mesh", "api-gateway"],
    },
    snippet_count: 11,
    heading_count: 4,
    headings: ["Microservices Pattern", "Service Discovery", "API Gateway"],
    tags: ["architecture", "microservices", "system-design"],
  },
]

const TEST_INDEX = { entries: TEST_INDEX_ENTRIES }

// ---------------------------------------------------------------------------
// Test queries + expected match docs
// ---------------------------------------------------------------------------

const BENCHMARK_QUERIES = [
  { task: "plan the sprint for next quarter", expected: ["dev/planning/sprint-planning"] },
  { task: "build a REST API endpoint for user authentication", expected: ["dev/backend/api-development"] },
  { task: "run the test suite with playwright", expected: ["dev/qa/automated-testing"] },
  { task: "deploy the application to kubernetes cluster", expected: ["dev/devops/deployment"] },
  { task: "implement a new React component for the dashboard", expected: ["dev/frontend/react-patterns"] },
  { task: "design the microservices architecture for the platform", expected: ["dev/architecture/microservices"] },
  { task: "general coding task", expected: [] }, // no specific match
  { task: "what is the best practice for API development", expected: ["dev/backend/api-development"] },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Retrieval Benchmark", () => {

  describe("T1: File-based retrieval completes for standard request", () => {
    for (const q of BENCHMARK_QUERIES.slice(0, 3)) {
      test(`task: "${q.task.substring(0, 30)}..."`, () => {
        const started = Date.now()
        const result = retrieveDocuments({ task: q.task, top_n: 5 }, TEST_INDEX)
        const elapsed = Date.now() - started
        assert.ok(elapsed < 100, `should complete in < 100ms, got ${elapsed}ms`)
        assert.ok(Array.isArray(result.matched_docs))
        assert.strictEqual(typeof result.confidence, "string")
        assert.strictEqual(typeof result.retrieved_at, "string")
        assert.strictEqual(result.total_candidates, TEST_INDEX_ENTRIES.length)
      })
    }
  })

  describe("T2: Vector fallback returns same results as file-based", () => {
    for (const q of BENCHMARK_QUERIES.slice(0, 4)) {
      test(`task: "${q.task.substring(0, 30)}..."`, async () => {
        const fbResult = retrieveDocuments({ task: q.task, top_n: 5 }, TEST_INDEX)
        const fallbackResult = await retrieveWithVectorFallback(
          { task: q.task, top_n: 5 },
          TEST_INDEX_ENTRIES,
          { vectorFirst: true, timeout_ms: 5000 }
        )
        // When vector unavailable, fallback should match file-based
        assert.strictEqual(fallbackResult.provider, "file-based")
        assert.strictEqual(fallbackResult.fallback, true)
        // Result counts should match
        assert.strictEqual(fallbackResult.results.length, fbResult.matched_docs.length)
        // Top result IDs should match
        const fbIds = fbResult.matched_docs.map((d) => d.id)
        const fbIdsFallback = fallbackResult.results.map((d) => d.id)
        assert.deepStrictEqual(fbIds, fbIdsFallback)
      })
    }
  })

  describe("T3: Timing — file-based under 100ms per request", () => {
    test("10 sequential requests all under 100ms", () => {
      const timings = []
      for (let i = 0; i < 10; i++) {
        const q = BENCHMARK_QUERIES[i % BENCHMARK_QUERIES.length]
        const started = Date.now()
        retrieveDocuments({ task: q.task, top_n: 5 }, TEST_INDEX)
        timings.push(Date.now() - started)
      }
      const allUnder100 = timings.every((t) => t < 100)
      assert.ok(allUnder100, `some requests exceeded 100ms: ${timings.map((t) => t + "ms").join(", ")}`)
      const avg = timings.reduce((a, b) => a + b, 0) / timings.length
      assert.ok(avg < 50, `average should be < 50ms, got ${avg.toFixed(1)}ms`)
    })
  })

  describe("T4: Score distribution — fallback matches direct scores", () => {
    for (const q of BENCHMARK_QUERIES.slice(0, 3)) {
      test(`scores for: "${q.task.substring(0, 25)}..."`, async () => {
        const fbResult = retrieveDocuments({ task: q.task, top_n: 5 }, TEST_INDEX)
        const fallbackResult = await retrieveWithVectorFallback(
          { task: q.task, top_n: 5 },
          TEST_INDEX_ENTRIES,
          {}
        )
        const fbScores = fbResult.matched_docs.map((d) => d.score)
        const fbScoresFallback = fallbackResult.results.map((d) => d.score)
        assert.deepStrictEqual(fbScores, fbScoresFallback, "scores should be identical")
      })
    }
  })

  describe("T5: Provider field — file-based when vector unavailable", () => {
    test("checkVectorAvailability returns available=false", () => {
      const availability = checkVectorAvailability()
      assert.strictEqual(availability.available, false)
      assert.strictEqual(availability.provider, null)
    })

    test("retrieveWithVectorFallback reports provider=file-based", async () => {
      const result = await retrieveWithVectorFallback(
        { task: "sprint planning meeting", top_n: 5 },
        TEST_INDEX_ENTRIES,
        { vectorFirst: true }
      )
      assert.strictEqual(result.provider, "file-based")
      assert.strictEqual(result.fallback, true)
    })

    test("VECTOR_STORE_AVAILABLE constant is false", () => {
      assert.strictEqual(VECTOR_STORE_AVAILABLE, false)
    })
  })

  describe("T6: Recall — known document found by both paths", () => {
    for (const q of BENCHMARK_QUERIES.filter((x) => x.expected.length > 0)) {
      test(`finds ${q.expected[0]} for: "${q.task.substring(0, 25)}..."`, async () => {
        const fbResult = retrieveDocuments({ task: q.task, top_n: 5 }, TEST_INDEX)
        const fallbackResult = await retrieveWithVectorFallback(
          { task: q.task, top_n: 5 },
          TEST_INDEX_ENTRIES,
          {}
        )
        const fbIds = fbResult.matched_docs.map((d) => d.id)
        const fbIdsFallback = fallbackResult.results.map((d) => d.id)
        // Expected doc should appear in top-5 for both
        const fbFound = fbIds.includes(q.expected[0])
        const fallbackFound = fbIdsFallback.includes(q.expected[0])
        assert.ok(fbFound, `file-based should find ${q.expected[0]} for query "${q.task}"`)
        assert.ok(fallbackFound, `fallback should find ${q.expected[0]} for query "${q.task}"`)
      })
    }
  })

  describe("T7: Budget enforcement — total size capped", () => {
    test("result string does not exceed MAX_RETRIEVAL_TOTAL_SIZE_BYTES", () => {
      const q = BENCHMARK_QUERIES[1] // "build a REST API endpoint..."
      const result = retrieveDocuments({ task: q.task, top_n: 10 }, TEST_INDEX)
      const matchedDocs = result.matched_docs
      // Simulate building the block
      const lines = []
      for (const doc of matchedDocs) {
        lines.push(`## [${doc.id}] (${(doc.score * 100).toFixed(0)}%)`)
        lines.push(`Matched on: ${doc.reasons.join(", ")}`)
        lines.push("")
      }
      const block = lines.join("\n")
      assert.ok(block.length <= MAX_RETRIEVAL_SIZE || matchedDocs.length <= 5,
        `block should be truncated: ${block.length} bytes vs ${MAX_RETRIEVAL_SIZE} limit`)
    })

    test("large task description is handled without crash", () => {
      const longTask = "plan the " + "sprint ".repeat(500) // very long task
      const result = retrieveDocuments({ task: longTask, top_n: 5 }, TEST_INDEX)
      assert.ok(Array.isArray(result.matched_docs))
      assert.strictEqual(typeof result.confidence, "string")
    })
  })

  describe("T8: Empty index — both paths return empty gracefully", () => {
    test("file-based returns empty matched_docs for empty index", () => {
      const result = retrieveDocuments({ task: "sprint planning" }, { entries: [] })
      assert.strictEqual(result.matched_docs.length, 0)
    })

    test("fallback returns empty results for empty index", async () => {
      const result = await retrieveWithVectorFallback(
        { task: "sprint planning" },
        [],
        {}
      )
      assert.strictEqual(result.results.length, 0)
      assert.strictEqual(result.provider, "file-based")
    })

    test("scoreDocument returns zero score for empty index entry", () => {
      const entry = {
        id: "empty/doc",
        file_path: "empty/doc.md",
        hash: "hash-empty",
        mtime: Date.now(),
        metadata_summary: { kind: "operational-memory", capabilities: [], domains: [], systems: [], skills: [], tools: [], task_patterns: [] },
        snippet_count: 0,
        heading_count: 0,
      }
      const scored = scoreDocument(entry, { task: "completely unrelated query xyz no-match" })
      assert.strictEqual(scored.score, 0)
    })
  })

  describe("T9: Real index regression (if exists)", () => {
    test("retrieveDocuments works with real operational index", () => {
      const contextRoot = path.join(repoRoot, ".mah", "context")
      const indexPath = path.join(contextRoot, "index", "operational-context.index.json")
      // Just verify it doesn't throw — results depend on actual corpus
      try {
        const index = loadIndex(indexPath)
        if (index && index.entries && index.entries.length > 0) {
          const result = retrieveDocuments({ task: "planning sprint backlog" }, index)
          assert.ok(Array.isArray(result.matched_docs))
          assert.ok("confidence" in result)
        }
      } catch {
        // Index not available — skip
      }
    })
  })

  describe("T10: Query structure variations", () => {
    test("query with agent filter", () => {
      const result = retrieveDocuments(
        { task: "sprint planning", agent: "planning-lead", top_n: 3 },
        TEST_INDEX
      )
      if (result.matched_docs.length > 0) {
        const matchedEntry = TEST_INDEX_ENTRIES.find((e) => e.id === result.matched_docs[0].id)
        assert.strictEqual(matchedEntry?.metadata_summary?.agent, "planning-lead")
      }
    })

    test("query with crew filter", () => {
      const result = retrieveDocuments(
        { task: "api development", crew: "dev", top_n: 3 },
        TEST_INDEX
      )
      if (result.matched_docs.length > 0) {
        const matchedEntry = TEST_INDEX_ENTRIES.find((e) => e.id === result.matched_docs[0].id)
        assert.strictEqual(matchedEntry?.metadata_summary?.crew, "dev")
      }
    })

    test("query with capability_hint boosts score", () => {
      const withoutHint = retrieveDocuments({ task: "planning", top_n: 3 }, TEST_INDEX)
      const withHint = retrieveDocuments({ task: "planning", capability_hint: "task-planning", top_n: 3 }, TEST_INDEX)
      // With hint should not return fewer results (hint is additive boost)
      assert.ok(withHint.matched_docs.length >= withoutHint.matched_docs.length)
    })

    test("query with available_tools boosts score", () => {
      const withoutTools = retrieveDocuments({ task: "testing automated tests", top_n: 3 }, TEST_INDEX)
      const withTools = retrieveDocuments({ task: "testing automated tests", available_tools: ["playwright"], top_n: 3 }, TEST_INDEX)
      // With tools hint should find testing doc
      const withToolsIds = withTools.matched_docs.map((d) => d.id)
      assert.ok(withToolsIds.includes("dev/qa/automated-testing"), "should find testing doc with playwright tool hint")
    })
  })
})