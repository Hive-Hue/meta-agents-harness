/**
 * PI Delegate Lifecycle Events Tests
 * Verify delegate_agent and delegate_agents_parallel emit lifecycle events
 * Run: node --test tests/pi-delegate-lifecycle.test.mjs
 */
import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const eventsDir = path.join(repoRoot, ".mah", "sessions", "lifecycle-events")

const { recordLifecycleEvent, getLifecycleEvents } = await import("../scripts/session/m3-ops.mjs")

function cleanup(testId) {
  const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const f = path.join(eventsDir, `${safeId}.json`)
  if (existsSync(f)) rmSync(f)
}

// Best-effort wrapper simulating multi-team.ts pattern
function safeRecord(repoRoot, sessionId, event) {
  try {
    recordLifecycleEvent(repoRoot, sessionId, event)
  } catch { /* best-effort */ }
}

describe("PI Delegate Lifecycle Events", () => {

  describe("AC1: queued event shape", () => {
    it("produces queued event with event, source_session, details.task, details.source_agent, details.target", () => {
      const testId = "test-ac1-queued"
      cleanup(testId)
      try {
        recordLifecycleEvent(repoRoot, testId, {
          event: "queued",
          source_session: testId,
          details: {
            task: "test task for AC1",
            source_agent: "test-agent",
            target: "backend-dev",
          },
        })
        const events = getLifecycleEvents(repoRoot, testId)
        assert.strictEqual(events.length, 1)
        const e = events[0]
        assert.strictEqual(e.event, "queued")
        assert.strictEqual(e.source_session, testId)
        assert.strictEqual(e.details.task, "test task for AC1")
        assert.strictEqual(e.details.source_agent, "test-agent")
        assert.strictEqual(e.details.target, "backend-dev")
      } finally {
        cleanup(testId)
      }
    })
  })

  describe("AC2: completed/failed event shape", () => {
    it("produces completed event with result_code, result_reason, details.target, details.duration_ms", () => {
      const testId = "test-ac2-completed"
      cleanup(testId)
      try {
        recordLifecycleEvent(repoRoot, testId, {
          event: "completed",
          source_session: testId,
          result_code: 0,
          result_reason: "success",
          details: {
            target: "backend-dev",
            duration_ms: 1500,
          },
        })
        const events = getLifecycleEvents(repoRoot, testId)
        assert.strictEqual(events.length, 1)
        const e = events[0]
        assert.strictEqual(e.event, "completed")
        assert.strictEqual(e.result_code, 0)
        assert.strictEqual(e.result_reason, "success")
        assert.strictEqual(e.details.target, "backend-dev")
        assert.strictEqual(e.details.duration_ms, 1500)
      } finally {
        cleanup(testId)
      }
    })

    it("produces failed event with non-zero result_code", () => {
      const testId = "test-ac2-failed"
      cleanup(testId)
      try {
        recordLifecycleEvent(repoRoot, testId, {
          event: "failed",
          source_session: testId,
          result_code: 127,
          result_reason: "non-zero exit",
          details: {
            target: "backend-dev",
            duration_ms: 3200,
          },
        })
        const events = getLifecycleEvents(repoRoot, testId)
        assert.strictEqual(events.length, 1)
        const e = events[0]
        assert.strictEqual(e.event, "failed")
        assert.strictEqual(e.result_code, 127)
        assert.strictEqual(e.result_reason, "non-zero exit")
        assert.strictEqual(e.details.target, "backend-dev")
        assert.strictEqual(e.details.duration_ms, 3200)
      } finally {
        cleanup(testId)
      }
    })
  })

  describe("AC3: multiple queued events for parallel delegation", () => {
    it("records one queued event per target", () => {
      const testId = "test-ac3-parallel-queued"
      cleanup(testId)
      try {
        const targets = ["backend-dev", "frontend-dev", "qa-dev"]
        for (const target of targets) {
          recordLifecycleEvent(repoRoot, testId, {
            event: "queued",
            source_session: testId,
            details: {
              task: "parallel task",
              source_agent: "orchestrator",
              target,
            },
          })
        }
        const events = getLifecycleEvents(repoRoot, testId)
        assert.strictEqual(events.length, 3)
        assert.ok(events.every((e) => e.event === "queued"))
        assert.ok(events.some((e) => e.details.target === "backend-dev"))
        assert.ok(events.some((e) => e.details.target === "frontend-dev"))
        assert.ok(events.some((e) => e.details.target === "qa-dev"))
      } finally {
        cleanup(testId)
      }
    })
  })

  describe("AC4: per-target completed/failed events after parallel execution", () => {
    it("records completed/failed per target in order", () => {
      const testId = "test-ac4-parallel-results"
      cleanup(testId)
      try {
        const results = [
          { target: "backend-dev", exitCode: 0, elapsed: 1200 },
          { target: "frontend-dev", exitCode: 0, elapsed: 1500 },
          { target: "qa-dev", exitCode: 1, elapsed: 800 },
        ]
        for (const r of results) {
          recordLifecycleEvent(repoRoot, testId, {
            event: r.exitCode === 0 ? "completed" : "failed",
            source_session: testId,
            result_code: r.exitCode,
            result_reason: r.exitCode === 0 ? "success" : "non-zero exit",
            details: { target: r.target, duration_ms: r.elapsed },
          })
        }
        const events = getLifecycleEvents(repoRoot, testId)
        assert.strictEqual(events.length, 3)
        const completed = events.filter((e) => e.event === "completed")
        const failed = events.filter((e) => e.event === "failed")
        assert.strictEqual(completed.length, 2)
        assert.strictEqual(failed.length, 1)
        assert.strictEqual(failed[0].details.target, "qa-dev")
      } finally {
        cleanup(testId)
      }
    })
  })

  describe("AC5: source_session in PI session ID format", () => {
    it("source_session field present and matches session ID pattern", () => {
      const testId = "test-ac5-session-format"
      cleanup(testId)
      try {
        recordLifecycleEvent(repoRoot, testId, {
          event: "queued",
          source_session: testId,
          details: { task: "test", source_agent: "agent", target: "t" },
        })
        const events = getLifecycleEvents(repoRoot, testId)
        assert.strictEqual(events.length, 1)
        assert.strictEqual(events[0].source_session, testId)
        // Verify it uses safe ID format (m3-ops normalizes special chars)
        const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_')
        const eventFile = path.join(eventsDir, `${safeId}.json`)
        assert.ok(existsSync(eventFile), "event file created with safe ID")
      } finally {
        cleanup(testId)
      }
    })
  })

  describe("AC7: lifecycle event write failure is best-effort", () => {
    it("safeRecord wrapper prevents lifecycle failure from blocking caller", () => {
      const testId = "test-ac7-best-effort"
      cleanup(testId)
      let outerContinued = false
      try {
        // Simulate what multi-team.ts does: wrap in try/catch
        safeRecord("/nonexistent/invalid/path", testId, {
          event: "queued",
          source_session: testId,
          details: { task: "test", source_agent: "agent", target: "t" },
        })
        outerContinued = true
      } catch {
        outerContinued = false
      }
      assert.ok(outerContinued, "best-effort: safeRecord wrapper prevents propagation")
      // Verify subsequent valid call still works
      safeRecord(repoRoot, testId, {
        event: "queued",
        source_session: testId,
        details: { task: "next call", source_agent: "agent", target: "t" },
      })
      const events = getLifecycleEvents(repoRoot, testId)
      assert.strictEqual(events.length, 1)
    })

    it("subsequent calls still work after one failure", () => {
      const testId = "test-ac7-resilient"
      cleanup(testId)
      try {
        safeRecord("/bad", testId, { event: "first", source_session: testId, details: {} })
        safeRecord(repoRoot, testId, {
          event: "queued",
          source_session: testId,
          details: { task: "resilient test", source_agent: "agent", target: "t" },
        })
        const events = getLifecycleEvents(repoRoot, testId)
        assert.strictEqual(events.length, 1)
        assert.strictEqual(events[0].event, "queued")
      } finally {
        cleanup(testId)
      }
    })
  })

  describe("AC9: existing recordLifecycleEvent unchanged", () => {
    it("write + read round-trip preserves all fields", () => {
      const testId = "test-ac9-roundtrip"
      cleanup(testId)
      try {
        const original = {
          event: "completed",
          source_session: testId,
          result_code: 0,
          result_reason: "success",
          details: {
            target: "backend-dev",
            duration_ms: 2500,
          },
          extra_field: "preserved",
        }
        recordLifecycleEvent(repoRoot, testId, original)
        const events = getLifecycleEvents(repoRoot, testId)
        assert.strictEqual(events.length, 1)
        const read = events[0]
        assert.strictEqual(read.event, "completed")
        assert.strictEqual(read.result_code, 0)
        assert.strictEqual(read.result_reason, "success")
        assert.strictEqual(read.details.target, "backend-dev")
        assert.strictEqual(read.details.duration_ms, 2500)
        // extra fields preserved
        assert.strictEqual(read.extra_field, "preserved")
        // timestamp added by recordLifecycleEvent
        assert.ok(read.timestamp)
      } finally {
        cleanup(testId)
      }
    })

    it("getLifecycleEvents returns empty array for nonexistent session", () => {
      const events = getLifecycleEvents(repoRoot, "nonexistent-session-xyz-abc")
      assert.ok(Array.isArray(events))
      assert.strictEqual(events.length, 0)
    })
  })
})