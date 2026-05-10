/**
 * WebUI Session Console Tests
 * Test session management data logic (hook transforms, form validation)
 * Run: node --test tests/webui-session-console.test.mjs
 */
import { describe, test } from "node:test"
import assert from "node:assert/strict"

// ---------------------------------------------------------------------------
// Mock data: lifecycle events shape
// ---------------------------------------------------------------------------

const SESSION_EVENT_SHAPE = {
  event: "string",
  timestamp: "string",
  goal: "string|undefined",
  cost_summary: "object|undefined",
  agent: "string|undefined",
  result_code: "number|undefined",
  result_reason: "string|undefined",
  details: "object|undefined",
  source_session: "string|undefined",
}

// ---------------------------------------------------------------------------
// useSessionLifecycle transform logic
// ---------------------------------------------------------------------------

function extractGoal(events) {
  const goalEvent = Array.isArray(events) ? events.find((e) => e?.goal) : null
  return goalEvent?.goal || null
}

function extractCostSummary(events) {
  const costEvent = Array.isArray(events)
    ? events.find((e) => e?.cost_summary)
    : null
  return costEvent?.cost_summary || null
}

function deriveCurrentState(events) {
  if (!Array.isArray(events) || events.length === 0) return "queued"
  return events[events.length - 1]?.event || "queued"
}

// ---------------------------------------------------------------------------
// Session data transform
// ---------------------------------------------------------------------------

function parseSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== "string") return { runtime: null, crew: null, id: sessionId }
  const parts = sessionId.split(":")
  return {
    runtime: parts[0] || null,
    crew: parts[1] || null,
    id: sessionId,
  }
}

function mapStatusToBadgeVariant(status) {
  const map = {
    running: "running",
    completed: "completed",
    failed: "failed",
    available: "completed",
    queued: "queued",
    error: "failed",
  }
  return map[String(status).toLowerCase()] || "queued"
}

// ---------------------------------------------------------------------------
// StartRunModal validation
// ---------------------------------------------------------------------------

function validateStartRunParams(params) {
  const errors = []
  if (!params?.runtime?.trim()) errors.push("runtime required")
  if (!params?.task?.trim()) errors.push("task required")
  return errors
}

function isGoalOptional(params) {
  // goal is always optional (can be undefined or empty string)
  return params?.goal === undefined || params?.goal === "" || typeof params.goal === "string"
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WebUI Session Console", () => {

  describe("useSessionLifecycle transform", () => {

    test("goal extracted from queued lifecycle event", () => {
      const events = [
        { event: "queued", timestamp: "2026-05-09T21:00:00Z", goal: "Fix auth bug" },
        { event: "completed", timestamp: "2026-05-09T21:01:00Z", result_code: 0 },
      ]
      const goal = extractGoal(events)
      assert.strictEqual(goal, "Fix auth bug")
    })

    test("goal returns null when no goal in events", () => {
      const events = [
        { event: "queued", timestamp: "2026-05-09T21:00:00Z" },
        { event: "completed", timestamp: "2026-05-09T21:01:00Z", result_code: 0 },
      ]
      const goal = extractGoal(events)
      assert.strictEqual(goal, null)
    })

    test("cost_summary extracted from completed event", () => {
      const events = [
        { event: "queued", timestamp: "2026-05-09T21:00:00Z" },
        {
          event: "completed",
          timestamp: "2026-05-09T21:01:00Z",
          cost_summary: { duration_ms: 60000, lifecycle_events: 3 },
        },
      ]
      const cost = extractCostSummary(events)
      assert.deepStrictEqual(cost, { duration_ms: 60000, lifecycle_events: 3 })
    })

    test("cost_summary returns null when no completed event", () => {
      const events = [
        { event: "queued", timestamp: "2026-05-09T21:00:00Z" },
        { event: "running", timestamp: "2026-05-09T21:00:01Z" },
      ]
      const cost = extractCostSummary(events)
      assert.strictEqual(cost, null)
    })

    test("current state derived from last event", () => {
      const events = [
        { event: "queued", timestamp: "2026-05-09T21:00:00Z" },
        { event: "routed", timestamp: "2026-05-09T21:00:01Z" },
        { event: "running", timestamp: "2026-05-09T21:00:02Z" },
      ]
      const state = deriveCurrentState(events)
      assert.strictEqual(state, "running")
    })

    test("current state defaults to queued for empty events", () => {
      assert.strictEqual(deriveCurrentState([]), "queued")
      assert.strictEqual(deriveCurrentState(null), "queued")
      assert.strictEqual(deriveCurrentState(undefined), "queued")
    })

    test("events with only queued returns queued", () => {
      const events = [{ event: "queued", timestamp: "2026-05-09T21:00:00Z" }]
      assert.strictEqual(deriveCurrentState(events), "queued")
    })

    test("failed event as last state", () => {
      const events = [
        { event: "queued", timestamp: "2026-05-09T21:00:00Z" },
        { event: "failed", timestamp: "2026-05-09T21:00:01Z", result_code: 127 },
      ]
      assert.strictEqual(deriveCurrentState(events), "failed")
    })
  })

  describe("Session ID parsing", () => {

    test("runtime extracted from session ID prefix", () => {
      const parsed = parseSessionId("pi:dev:run-1715283600000")
      assert.strictEqual(parsed.runtime, "pi")
    })

    test("crew extracted from session ID second segment", () => {
      const parsed = parseSessionId("pi:dev:run-1715283600000")
      assert.strictEqual(parsed.crew, "dev")
    })

    test("full session ID preserved in id field", () => {
      const sid = "pi:dev:run-1715283600000"
      const parsed = parseSessionId(sid)
      assert.strictEqual(parsed.id, sid)
    })

    test("null/undefined session ID handled gracefully", () => {
      assert.strictEqual(parseSessionId(null).runtime, null)
      assert.strictEqual(parseSessionId(undefined).runtime, null)
    })

    test("short session ID handled", () => {
      const parsed = parseSessionId("pi:dev")
      assert.strictEqual(parsed.runtime, "pi")
      assert.strictEqual(parsed.crew, "dev")
    })
  })

  describe("Status badge variant mapping", () => {

    test("running maps to running variant", () => {
      assert.strictEqual(mapStatusToBadgeVariant("running"), "running")
    })

    test("completed maps to completed variant", () => {
      assert.strictEqual(mapStatusToBadgeVariant("completed"), "completed")
    })

    test("failed maps to failed variant", () => {
      assert.strictEqual(mapStatusToBadgeVariant("failed"), "failed")
    })

    test("available maps to completed variant", () => {
      assert.strictEqual(mapStatusToBadgeVariant("available"), "completed")
    })

    test("queued maps to queued variant", () => {
      assert.strictEqual(mapStatusToBadgeVariant("queued"), "queued")
    })

    test("error maps to failed variant", () => {
      assert.strictEqual(mapStatusToBadgeVariant("error"), "failed")
    })

    test("unknown status defaults to queued", () => {
      assert.strictEqual(mapStatusToBadgeVariant("xyz-unknown"), "queued")
    })
  })

  describe("StartRunModal validation", () => {

    test("empty params has two errors", () => {
      assert.deepStrictEqual(validateStartRunParams({}), ["runtime required", "task required"])
    })

    test("valid pi task has no errors", () => {
      assert.deepStrictEqual(validateStartRunParams({ runtime: "pi", task: "fix bug" }), [])
    })

    test("runtime only has one error", () => {
      const errors = validateStartRunParams({ runtime: "pi" })
      assert.ok(errors.includes("task required"))
      assert.strictEqual(errors.length, 1)
    })

    test("task only has one error", () => {
      const errors = validateStartRunParams({ task: "fix bug" })
      assert.ok(errors.includes("runtime required"))
      assert.strictEqual(errors.length, 1)
    })

    test("whitespace-only runtime fails", () => {
      assert.ok(validateStartRunParams({ runtime: "   ", task: "x" }).length > 0)
    })

    test("whitespace-only task fails", () => {
      assert.ok(validateStartRunParams({ runtime: "pi", task: "   " }).length > 0)
    })
  })

  describe("Goal field is optional", () => {

    test("no goal field is valid", () => {
      assert.strictEqual(isGoalOptional({ runtime: "pi", task: "fix" }), true)
    })

    test("empty string goal is valid", () => {
      assert.strictEqual(isGoalOptional({ runtime: "pi", task: "fix", goal: "" }), true)
    })

    test("undefined goal is valid", () => {
      assert.strictEqual(isGoalOptional({ runtime: "pi", task: "fix", goal: undefined }), true)
    })

    test("string goal is valid", () => {
      assert.strictEqual(isGoalOptional({ runtime: "pi", task: "fix", goal: "Fix the auth bug" }), true)
    })
  })

  describe("Session lifecycle event shape", () => {

    test("completed event has result_code and cost_summary", () => {
      const event = {
        event: "completed",
        timestamp: "2026-05-09T21:01:00Z",
        result_code: 0,
        result_reason: "success",
        cost_summary: { duration_ms: 60000, lifecycle_events: 3 },
      }
      assert.strictEqual(typeof event.result_code, "number")
      assert.deepStrictEqual(event.cost_summary, { duration_ms: 60000, lifecycle_events: 3 })
    })

    test("queued event has goal", () => {
      const event = {
        event: "queued",
        timestamp: "2026-05-09T21:00:00Z",
        goal: "Plan the sprint",
      }
      assert.strictEqual(event.goal, "Plan the sprint")
    })

    test("routed event has agent", () => {
      const event = {
        event: "routed",
        timestamp: "2026-05-09T21:00:01Z",
        agent: "backend-dev",
        routing_reason: "best match",
        routing_confidence: 0.85,
      }
      assert.strictEqual(event.agent, "backend-dev")
      assert.strictEqual(typeof event.routing_confidence, "number")
    })
  })
})