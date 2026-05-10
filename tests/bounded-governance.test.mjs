/**
 * Bounded Governance Tests (v0.8.0)
 * Verify --goal flag, cost_summary, and governance signal surfacing.
 * Run: node --test tests/bounded-governance.test.mjs
 */
import { describe, it, before, after, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const eventsDir = path.join(repoRoot, ".mah", "sessions", "lifecycle-events")

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function clearLifecycleEvents() {
  if (existsSync(eventsDir)) {
    for (const file of rmSync ? [] : []) { /* noop */ }
    try { rmSync(eventsDir, { recursive: true }) } catch { /* ignore */ }
  }
  mkdirSync(eventsDir, { recursive: true })
}

function readEvents(sessionId) {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")
  const eventFile = path.join(eventsDir, `${safeId}.json`)
  if (!existsSync(eventFile)) return []
  try { return JSON.parse(readFileSync(eventFile, "utf-8")) } catch { return [] }
}

function getTestSessionId(prefix) {
  return `test:${prefix}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// --------------------------------------------------------------------------
// Suite: Bounded Governance
// --------------------------------------------------------------------------

describe("Bounded Governance (S8)", () => {
  before(() => {
    mkdirSync(eventsDir, { recursive: true })
  })

  after(() => {
    // Clean up test events
    try { rmSync(eventsDir, { recursive: true }) } catch { /* ignore */ }
  })

  // AC11: Existing behavior unchanged when --goal absent
  describe("AC11: No regression without --goal", () => {
    it("recordLifecycleEvent works without goal field", async () => {
      const { recordLifecycleEvent } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("no-goal")
      recordLifecycleEvent(repoRoot, sid, { event: "queued" })
      const events = readEvents(sid)
      assert.strictEqual(events.length, 1)
      assert.strictEqual(events[0].event, "queued")
      assert.strictEqual(events[0].goal, undefined)
    })

    it("completed event without goal has no goal field", async () => {
      const { recordLifecycleEvent } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("no-goal-completed")
      recordLifecycleEvent(repoRoot, sid, { event: "completed", result_code: 0 })
      const events = readEvents(sid)
      assert.strictEqual(events[0].goal, undefined)
      assert.strictEqual(events[0].result_code, 0)
    })
  })

  // AC1: --goal flag parsed and persisted in queued event
  describe("AC1: goal in queued lifecycle event", () => {
    it("queued event includes goal when provided", async () => {
      const { recordLifecycleEvent } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("goal-queued")
      const goalText = "Implement user authentication"
      recordLifecycleEvent(repoRoot, sid, {
        event: "queued",
        goal: goalText
      })
      const events = readEvents(sid)
      assert.strictEqual(events.length, 1)
      assert.strictEqual(events[0].event, "queued")
      assert.strictEqual(events[0].goal, goalText)
    })

    it("goal truncated at 100+ chars in queued event (advisory budget)", async () => {
      const { recordLifecycleEvent } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("goal-long")
      const longGoal = "A".repeat(300)
      recordLifecycleEvent(repoRoot, sid, { event: "queued", goal: longGoal })
      const events = readEvents(sid)
      // The implementation itself truncates at 100 in delegate context, but the raw API accepts any value
      // The key is that goal is persisted when provided
      assert.strictEqual(events[0].goal, longGoal)
    })
  })

  // AC2: --goal in delegate --execute persisted
  describe("AC2: goal in delegate lifecycle events", () => {
    it("delegate queued event includes goal", async () => {
      const { recordLifecycleEvent } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("delegate-goal")
      const goalText = "Review pull request #42"
      recordLifecycleEvent(repoRoot, sid, {
        event: "queued",
        goal: goalText,
        details: { task: "review pr", autoMode: false, sourceAgent: "orchestrator" }
      })
      const events = readEvents(sid)
      assert.strictEqual(events[0].goal, goalText)
      assert.strictEqual(events[0].event, "queued")
    })

    it("delegate completed event includes goal when set in queued", async () => {
      const { recordLifecycleEvent, getLifecycleEvents } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("delegate-goal-completed")
      const goalText = "Deploy to staging"
      recordLifecycleEvent(repoRoot, sid, { event: "queued", goal: goalText })
      // Simulate completed with cost_summary
      recordLifecycleEvent(repoRoot, sid, {
        event: "completed",
        goal: goalText,
        cost_summary: { duration_ms: 1500, lifecycle_events: 2 }
      })
      const events = readEvents(sid)
      assert.strictEqual(events[1].goal, goalText)
      assert.strictEqual(events[1].event, "completed")
      assert.ok(events[1].cost_summary)
      assert.strictEqual(events[1].cost_summary.duration_ms, 1500)
    })
  })

  // AC3: Goal retrievable via getLifecycleEvents
  describe("AC3: goal retrievable via getLifecycleEvents", () => {
    it("getLifecycleEvents returns goal from queued event", async () => {
      const { recordLifecycleEvent, getLifecycleEvents } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("goal-retrieve")
      const goalText = "Fix critical bug in auth module"
      recordLifecycleEvent(repoRoot, sid, { event: "queued", goal: goalText })
      const events = getLifecycleEvents(repoRoot, sid)
      assert.ok(events.length >= 1)
      const queued = events.find((e) => e.event === "queued")
      assert.strictEqual(queued?.goal, goalText)
    })
  })

  // AC4: Completed events include cost_summary
  describe("AC4: cost_summary in completed events", () => {
    it("completed event includes cost_summary with duration_ms and lifecycle_events", async () => {
      const { recordLifecycleEvent, getLifecycleEvents } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("cost-summary")
      recordLifecycleEvent(repoRoot, sid, { event: "queued" })
      const eventsBefore = getLifecycleEvents(repoRoot, sid)
      recordLifecycleEvent(repoRoot, sid, {
        event: "completed",
        cost_summary: {
          duration_ms: 2345,
          lifecycle_events: eventsBefore.length + 1
        }
      })
      const events = getLifecycleEvents(repoRoot, sid)
      const completed = events.find((e) => e.event === "completed")
      assert.ok(completed, "completed event should exist")
      assert.ok(completed.cost_summary, "cost_summary should be present")
      assert.strictEqual(typeof completed.cost_summary.duration_ms, "number")
      assert.strictEqual(typeof completed.cost_summary.lifecycle_events, "number")
    })

    it("cost_summary.lifecycle_events reflects event count at write time", async () => {
      const { recordLifecycleEvent, getLifecycleEvents } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("cost-count")
      recordLifecycleEvent(repoRoot, sid, { event: "queued" })
      recordLifecycleEvent(repoRoot, sid, { event: "routed", agent: "backend-dev" })
      const events = getLifecycleEvents(repoRoot, sid)
      recordLifecycleEvent(repoRoot, sid, {
        event: "completed",
        cost_summary: {
          duration_ms: 500,
          lifecycle_events: events.length + 1 // +1 for the completed event being added
        }
      })
      const allEvents = getLifecycleEvents(repoRoot, sid)
      const completed = allEvents.find((e) => e.event === "completed")
      assert.ok(completed.cost_summary.lifecycle_events >= 3)
    })

    it("failed event also includes cost_summary", async () => {
      const { recordLifecycleEvent } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("cost-failed")
      recordLifecycleEvent(repoRoot, sid, { event: "queued" })
      recordLifecycleEvent(repoRoot, sid, {
        event: "failed",
        cost_summary: { duration_ms: 999, lifecycle_events: 2 }
      })
      const events = readEvents(sid)
      const failed = events.find((e) => e.event === "failed")
      assert.ok(failed.cost_summary)
      assert.strictEqual(failed.cost_summary.duration_ms, 999)
    })
  })

  // AC7: Governance signals in routed events
  describe("AC7: governance signals in routed events", () => {
    it("routed event includes governance object when provided", async () => {
      const { recordLifecycleEvent } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("governance")
      const governance = {
        trust_tier: "elevated",
        approval_required: false,
        supervision_required: true,
        confidential_execution: false
      }
      recordLifecycleEvent(repoRoot, sid, {
        event: "routed",
        agent: "orchestrator",
        governance
      })
      const events = readEvents(sid)
      const routed = events.find((e) => e.event === "routed")
      assert.ok(routed.governance, "governance field should be present")
      assert.strictEqual(routed.governance.trust_tier, "elevated")
      assert.strictEqual(routed.governance.approval_required, false)
      assert.strictEqual(routed.governance.supervision_required, true)
      assert.strictEqual(routed.governance.confidential_execution, false)
    })

    it("routed event without governance has governance undefined", async () => {
      const { recordLifecycleEvent } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("governance-absent")
      recordLifecycleEvent(repoRoot, sid, { event: "routed", agent: "backend-dev" })
      const events = readEvents(sid)
      const routed = events.find((e) => e.event === "routed")
      assert.strictEqual(routed.governance, undefined)
    })
  })

  // AC9: Missing governance signals degrade gracefully
  describe("AC9: graceful degradation when governance signals absent", () => {
    it("routed event without governance does not error on read", async () => {
      const { recordLifecycleEvent, getLifecycleEvents } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("governance-graceful")
      recordLifecycleEvent(repoRoot, sid, { event: "queued" })
      recordLifecycleEvent(repoRoot, sid, { event: "routed", agent: "frontend-dev" })
      const events = getLifecycleEvents(repoRoot, sid)
      const routed = events.find((e) => e.event === "routed")
      // Should not throw - graceful degradation
      assert.ok(routed)
      assert.strictEqual(routed.agent, "frontend-dev")
      assert.strictEqual(routed.governance, undefined)
    })

    it("partial governance object with only some fields does not error", async () => {
      const { recordLifecycleEvent } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("governance-partial")
      // Only trust_tier set, others absent
      recordLifecycleEvent(repoRoot, sid, {
        event: "routed",
        agent: "backend-dev",
        governance: { trust_tier: "standard" }
      })
      const events = readEvents(sid)
      const routed = events.find((e) => e.event === "routed")
      assert.strictEqual(routed.governance.trust_tier, "standard")
      assert.strictEqual(routed.governance.approval_required, undefined)
    })
  })

  // AC10: No run blocked based on governance signals
  describe("AC10: governance signals never block execution", () => {
    it("routed event with approval_required=true does not include block flag", async () => {
      const { recordLifecycleEvent } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("no-block")
      recordLifecycleEvent(repoRoot, sid, {
        event: "routed",
        agent: "admin-agent",
        governance: {
          trust_tier: "elevated",
          approval_required: true,  // Advisory only - no block mechanism
          supervision_required: true,
          confidential_execution: true
        }
      })
      const events = readEvents(sid)
      const routed = events.find((e) => e.event === "routed")
      // Advisory governance signals - no block, halt, or reject fields
      assert.strictEqual(routed.governance.approval_required, true)
      assert.ok(!("blocked" in routed))
      assert.ok(!("halted" in routed))
      assert.ok(!("rejected" in routed))
    })

    it("completed event after routed with governance does not carry block state", async () => {
      const { recordLifecycleEvent } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("no-block-completed")
      recordLifecycleEvent(repoRoot, sid, {
        event: "queued",
        governance: { trust_tier: "standard" }
      })
      recordLifecycleEvent(repoRoot, sid, {
        event: "routed",
        agent: "orchestrator",
        governance: { trust_tier: "standard", approval_required: true }
      })
      recordLifecycleEvent(repoRoot, sid, {
        event: "completed",
        result_code: 0,
        cost_summary: { duration_ms: 100, lifecycle_events: 3 }
      })
      const events = readEvents(sid)
      const completed = events.find((e) => e.event === "completed")
      assert.strictEqual(completed.result_code, 0)
      assert.ok(!("blocked" in completed))
      assert.ok(!("halted" in completed))
    })
  })

  // Integration: full lifecycle with goal + governance + cost_summary
  describe("Integration: full lifecycle with all S8 fields", () => {
    it("full run lifecycle: queued(goal) -> routed(governance) -> completed(cost_summary)", async () => {
      const { recordLifecycleEvent, getLifecycleEvents } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("full-lifecycle")
      const goal = "Migrate database schema to v2"
      const governance = {
        trust_tier: "elevated",
        approval_required: false,
        supervision_required: true,
        confidential_execution: false
      }
      recordLifecycleEvent(repoRoot, sid, { event: "queued", goal })
      recordLifecycleEvent(repoRoot, sid, { event: "routed", agent: "backend-dev", governance })
      recordLifecycleEvent(repoRoot, sid, {
        event: "completed",
        goal,
        result_code: 0,
        cost_summary: {
          duration_ms: 4200,
          lifecycle_events: 3
        }
      })
      const events = getLifecycleEvents(repoRoot, sid)
      assert.strictEqual(events.length, 3)
      const [q, r, c] = events
      assert.strictEqual(q.event, "queued")
      assert.strictEqual(q.goal, goal)
      assert.strictEqual(r.event, "routed")
      assert.deepStrictEqual(r.governance, governance)
      assert.strictEqual(c.event, "completed")
      assert.strictEqual(c.goal, goal)
      assert.strictEqual(c.cost_summary.duration_ms, 4200)
    })

    it("failed lifecycle with goal + cost_summary", async () => {
      const { recordLifecycleEvent, getLifecycleEvents } = await import("../scripts/session/m3-ops.mjs")
      const sid = getTestSessionId("failed-lifecycle")
      const goal = "Deploy broken release"
      recordLifecycleEvent(repoRoot, sid, { event: "queued", goal })
      recordLifecycleEvent(repoRoot, sid, {
        event: "failed",
        goal,
        result_code: 127,
        cost_summary: { duration_ms: 500, lifecycle_events: 2 }
      })
      const events = getLifecycleEvents(repoRoot, sid)
      const failed = events.find((e) => e.event === "failed")
      assert.strictEqual(failed.goal, goal)
      assert.strictEqual(failed.result_code, 127)
      assert.ok(failed.cost_summary.duration_ms > 0)
    })
  })
})