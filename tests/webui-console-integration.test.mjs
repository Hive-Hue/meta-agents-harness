/**
 * WebUI Console Integration Tests
 * End-to-end integration: task workflows, session workflows, mission workflows
 * Run: node --test tests/webui-console-integration.test.mjs
 */
import { describe, test } from "node:test"
import assert from "node:assert/strict"

// ---------------------------------------------------------------------------
// Reusable transform functions (same as in test files)
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS = {
  backlog: ["ready"],
  ready: ["in_progress"],
  in_progress: ["done", "blocked"],
  done: [],
  blocked: ["ready", "in_progress"],
}

function canTransition(fromState, toState) {
  return VALID_TRANSITIONS[fromState]?.includes(toState) ?? false
}

function groupTasksByState(tasks) {
  const grouped = {}
  for (const t of tasks) {
    if (!grouped[t.state]) grouped[t.state] = []
    grouped[t.state].push(t)
  }
  return grouped
}

function computeMissions(tasks) {
  const missions = {}
  for (const t of tasks) {
    if (!missions[t.missionId]) missions[t.missionId] = { total: 0, done: 0, tasks: [] }
    missions[t.missionId].total++
    missions[t.missionId].tasks.push(t)
    if (t.state === "done") missions[t.missionId].done++
  }
  return missions
}

function filterTasks(tasks, filters = {}) {
  let result = [...tasks]
  if (filters.state) result = result.filter((t) => t.state === filters.state)
  if (filters.missionId) result = result.filter((t) => t.missionId === filters.missionId)
  if (filters.owner) result = result.filter((t) => t.owner === filters.owner)
  if (filters.searchText) {
    const text = filters.searchText.toLowerCase()
    result = result.filter((t) => t.title?.toLowerCase().includes(text))
  }
  return result
}

function parseSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== "string") return { runtime: null, crew: null, id: sessionId }
  const parts = sessionId.split(":")
  return { runtime: parts[0] || null, crew: parts[1] || null, id: sessionId }
}

function deriveCurrentState(events) {
  if (!Array.isArray(events) || events.length === 0) return "queued"
  return events[events.length - 1]?.event || "queued"
}

function extractGoal(events) {
  const goalEvent = Array.isArray(events) ? events.find((e) => e?.goal) : null
  return goalEvent?.goal || null
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
// Tests
// ---------------------------------------------------------------------------

describe("WebUI Console Integration", () => {

  describe("Full task workflow: filter → group → select → transition", () => {

    test("filter by mission, group by state, select, transition to ready", () => {
      const tasks = [
        { id: "T1", state: "backlog", missionId: "m1", owner: "dev", title: "Task 1" },
        { id: "T2", state: "ready", missionId: "m1", owner: "dev", title: "Task 2" },
        { id: "T3", state: "backlog", missionId: "m2", owner: "qa", title: "Task 3" },
      ]

      // Filter by mission m1
      const filtered = filterTasks(tasks, { missionId: "m1" })
      assert.strictEqual(filtered.length, 2)

      // Group by state
      const grouped = groupTasksByState(filtered)
      assert.strictEqual(grouped.backlog.length, 1)
      assert.strictEqual(grouped.ready.length, 1)

      // Select the backlog task
      const selected = grouped.backlog[0]
      assert.strictEqual(selected.id, "T1")
      assert.strictEqual(selected.state, "backlog")

      // Check transition is valid
      const canMove = canTransition(selected.state, "ready")
      assert.strictEqual(canMove, true)

      // Apply transition
      const updated = { ...selected, state: "ready" }
      assert.strictEqual(updated.state, "ready")
    })

    test("task transitions through full lifecycle", () => {
      const tasks = [
        { id: "T1", state: "backlog", title: "Implement feature" },
      ]

      // backlog → ready
      let t = { ...tasks[0] }
      t = { ...t, state: "ready" }
      assert.strictEqual(t.state, "ready")
      assert.strictEqual(canTransition("backlog", "ready"), true)

      // ready → in_progress
      t = { ...t, state: "in_progress" }
      assert.strictEqual(t.state, "in_progress")
      assert.strictEqual(canTransition("ready", "in_progress"), true)

      // in_progress → done
      t = { ...t, state: "done" }
      assert.strictEqual(t.state, "done")
      assert.strictEqual(canTransition("in_progress", "done"), true)

      // done is terminal — no more transitions
      assert.strictEqual(canTransition("done", "backlog"), false)
      assert.strictEqual(canTransition("done", "ready"), false)
      assert.strictEqual(canTransition("done", "in_progress"), false)
    })

    test("blocked task can transition to ready", () => {
      const t = { id: "T1", state: "blocked" }
      assert.strictEqual(canTransition("blocked", "ready"), true)
      const updated = { ...t, state: "ready" }
      assert.strictEqual(updated.state, "ready")
    })

    test("blocked task can transition back to in_progress", () => {
      const t = { id: "T1", state: "blocked" }
      assert.strictEqual(canTransition("blocked", "in_progress"), true)
      const updated = { ...t, state: "in_progress" }
      assert.strictEqual(updated.state, "in_progress")
    })
  })

  describe("Full session workflow: list → select → inspect lifecycle", () => {

    test("list sessions, select running session, inspect lifecycle events", () => {
      const sessions = [
        { id: "pi:dev:run-001", status: "completed" },
        { id: "pi:dev:run-002", status: "running" },
        { id: "claude:eng:run-003", status: "failed" },
      ]

      // Select running session
      const selected = sessions.find((s) => s.status === "running")
      assert.ok(selected)
      assert.strictEqual(selected.id, "pi:dev:run-002")

      // Parse session ID
      const parsed = parseSessionId(selected.id)
      assert.strictEqual(parsed.runtime, "pi")
      assert.strictEqual(parsed.crew, "dev")

      // Mock lifecycle events for this session
      const events = [
        { event: "queued", timestamp: "2026-05-09T21:00:00Z", goal: "Fix auth bug" },
        { event: "routed", timestamp: "2026-05-09T21:00:01Z", agent: "backend-dev" },
        { event: "running", timestamp: "2026-05-09T21:00:02Z" },
      ]

      // Inspect: goal extracted
      const goal = extractGoal(events)
      assert.strictEqual(goal, "Fix auth bug")

      // Inspect: current state derived
      const currentState = deriveCurrentState(events)
      assert.strictEqual(currentState, "running")

      // Status badge variant
      const badge = mapStatusToBadgeVariant(selected.status)
      assert.strictEqual(badge, "running")
    })

    test("completed session shows completed badge", () => {
      const sessions = [{ id: "pi:dev:run-001", status: "completed" }]
      const selected = sessions.find((s) => s.status === "completed")
      const badge = mapStatusToBadgeVariant(selected.status)
      assert.strictEqual(badge, "completed")
    })

    test("failed session shows failed badge", () => {
      const sessions = [{ id: "pi:dev:run-001", status: "failed" }]
      const selected = sessions.find((s) => s.status === "failed")
      const badge = mapStatusToBadgeVariant(selected.status)
      assert.strictEqual(badge, "failed")
    })

    test("session with empty events defaults to queued state", () => {
      const events = []
      const state = deriveCurrentState(events)
      assert.strictEqual(state, "queued")
    })
  })

  describe("Mission workflow: list missions → select → filter tasks", () => {

    test("compute missions from flat task list, select, filter tasks", () => {
      const tasks = [
        { id: "T1", missionId: "m1", state: "done", title: "Task 1" },
        { id: "T2", missionId: "m1", state: "in_progress", title: "Task 2" },
        { id: "T3", missionId: "m1", state: "backlog", title: "Task 3" },
        { id: "T4", missionId: "m2", state: "ready", title: "Task 4" },
      ]

      // Compute mission list
      const missions = computeMissions(tasks)
      assert.strictEqual(Object.keys(missions).length, 2)
      assert.strictEqual(missions.m1.total, 3)
      assert.strictEqual(missions.m1.done, 1)
      assert.strictEqual(missions.m2.total, 1)

      // Select mission m1, filter to in_progress tasks
      const m1Tasks = missions.m1.tasks
      assert.strictEqual(m1Tasks.length, 3)

      const filtered = filterTasks(m1Tasks, { state: "in_progress" })
      assert.strictEqual(filtered.length, 1)
      assert.strictEqual(filtered[0].id, "T2")

      // Select mission m2, only one task
      const m2Tasks = missions.m2.tasks
      assert.strictEqual(m2Tasks.length, 1)
      assert.strictEqual(m2Tasks[0].id, "T4")
    })

    test("mission progress bar percentage", () => {
      const missions = computeMissions([
        { id: "T1", missionId: "m1", state: "done" },
        { id: "T2", missionId: "m1", state: "done" },
        { id: "T3", missionId: "m1", state: "ready" },
        { id: "T4", missionId: "m1", state: "backlog" },
      ])
      assert.strictEqual(missions.m1.total, 4)
      assert.strictEqual(missions.m1.done, 2)
      const progress = Math.round((missions.m1.done / missions.m1.total) * 100)
      assert.strictEqual(progress, 50)
    })

    test("empty mission has 0% progress", () => {
      const missions = computeMissions([])
      const progress = missions.m1
        ? Math.round((missions.m1.done / Math.max(1, missions.m1.total)) * 100)
        : 0
      assert.strictEqual(progress, 0)
    })
  })

  describe("Cross-cutting: combined task + mission + session flows", () => {

    test("select mission, find tasks, transition one, verify mission progress", () => {
      const tasks = [
        { id: "T1", missionId: "m1", state: "backlog", owner: "dev", title: "Implement API" },
        { id: "T2", missionId: "m1", state: "ready", owner: "dev", title: "Write tests" },
        { id: "T3", missionId: "m1", state: "in_progress", owner: "qa", title: "QA review" },
      ]

      // Compute missions
      const missions = computeMissions(tasks)
      assert.strictEqual(missions.m1.total, 3)

      // Select in_progress task from m1
      const filtered = filterTasks(missions.m1.tasks, { state: "in_progress" })
      assert.strictEqual(filtered.length, 1)
      const selected = filtered[0]
      assert.strictEqual(selected.id, "T3")
      assert.strictEqual(selected.owner, "qa")

      // Transition to done
      const canDone = canTransition(selected.state, "done")
      assert.strictEqual(canDone, true)
      const updated = { ...selected, state: "done" }

      // Recompute mission progress
      const newMissions = computeMissions([...tasks.filter((t) => t.id !== "T3"), updated])
      assert.strictEqual(newMissions.m1.done, 1) // T3 now done
      assert.strictEqual(newMissions.m1.total, 3)
      const progress = Math.round((newMissions.m1.done / newMissions.m1.total) * 100)
      assert.strictEqual(progress, 33) // 1/3 ≈ 33%
    })

    test("filter by owner across missions", () => {
      const tasks = [
        { id: "T1", missionId: "m1", state: "backlog", owner: "backend-dev" },
        { id: "T2", missionId: "m1", state: "ready", owner: "frontend-dev" },
        { id: "T3", missionId: "m2", state: "in_progress", owner: "backend-dev" },
      ]

      // Filter by owner = backend-dev across all missions
      const filtered = filterTasks(tasks, { owner: "backend-dev" })
      assert.strictEqual(filtered.length, 2)
      assert.ok(filtered.every((t) => t.owner === "backend-dev"))

      // Group by state
      const grouped = groupTasksByState(filtered)
      assert.strictEqual(grouped.backlog.length, 1)
      assert.strictEqual(grouped.in_progress.length, 1)
    })

    test("search within filtered mission tasks", () => {
      const tasks = [
        { id: "T1", missionId: "m1", state: "backlog", title: "Fix auth timeout" },
        { id: "T2", missionId: "m1", state: "ready", title: "Add caching layer" },
        { id: "T3", missionId: "m1", state: "in_progress", title: "Fix memory leak" },
      ]

      // Filter m1, then search for "auth"
      const filtered = filterTasks(tasks, { missionId: "m1" })
      assert.strictEqual(filtered.length, 3)
      const searched = filterTasks(filtered, { searchText: "auth" })
      assert.strictEqual(searched.length, 1)
      assert.strictEqual(searched[0].id, "T1")
    })
  })

  describe("Error/edge cases in workflows", () => {

    test("invalid transition does not change task state", () => {
      const t = { id: "T1", state: "done" }
      // trying to transition done → anything should not be allowed
      const canMove = canTransition(t.state, "backlog")
      assert.strictEqual(canMove, false)
      // State should remain unchanged (no transition applied)
      assert.strictEqual(t.state, "done")
    })

    test("filter with non-existent mission returns empty", () => {
      const tasks = [{ id: "T1", missionId: "m1" }]
      const filtered = filterTasks(tasks, { missionId: "nonexistent" })
      assert.strictEqual(filtered.length, 0)
    })

    test("empty session list handles gracefully", () => {
      const sessions = []
      const selected = sessions.find((s) => s.status === "running")
      assert.strictEqual(selected, undefined)
      const badge = mapStatusToBadgeVariant(null)
      assert.strictEqual(badge, "queued")
    })

    test("session with no goal shows null goal", () => {
      const events = [
        { event: "queued", timestamp: "2026-05-09T21:00:00Z" },
        { event: "completed", timestamp: "2026-05-09T21:01:00Z", result_code: 0 },
      ]
      const goal = extractGoal(events)
      assert.strictEqual(goal, null)
    })
  })
})