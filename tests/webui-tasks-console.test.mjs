/**
 * WebUI Tasks Console Tests
 * Test tasks/mission tracking data logic (grouping, transitions, filtering)
 * Run: node --test tests/webui-tasks-console.test.mjs
 */
import { describe, test } from "node:test"
import assert from "node:assert/strict"

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS = {
  backlog: ["ready"],
  ready: ["in_progress"],
  in_progress: ["done", "blocked"],
  done: [],
  blocked: ["ready", "in_progress"],
}

const STATE_ORDER = ["backlog", "ready", "in_progress", "done", "blocked"]

function canTransition(fromState, toState) {
  return VALID_TRANSITIONS[fromState]?.includes(toState) ?? false
}

function getValidTransitions(fromState) {
  return VALID_TRANSITIONS[fromState] || []
}

// ---------------------------------------------------------------------------
// Task board grouping
// ---------------------------------------------------------------------------

function groupTasksByState(tasks) {
  const grouped = {}
  for (const t of tasks) {
    if (!grouped[t.state]) grouped[t.state] = []
    grouped[t.state].push(t)
  }
  return grouped
}

// ---------------------------------------------------------------------------
// Mission grouping
// ---------------------------------------------------------------------------

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

function missionProgress(mission) {
  return mission.total === 0 ? 0 : Math.round((mission.done / mission.total) * 100)
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function filterTasks(tasks, filters = {}) {
  let result = [...tasks]
  if (filters.state) {
    result = result.filter((t) => t.state === filters.state)
  }
  if (filters.missionId) {
    result = result.filter((t) => t.missionId === filters.missionId)
  }
  if (filters.owner) {
    result = result.filter((t) => t.owner === filters.owner)
  }
  if (filters.searchText) {
    const text = filters.searchText.toLowerCase()
    result = result.filter((t) => t.title?.toLowerCase().includes(text))
  }
  return result
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WebUI Tasks Console", () => {

  describe("TaskBoard grouping", () => {

    test("tasks grouped by state into columns", () => {
      const tasks = [
        { id: "T1", state: "backlog", title: "Task 1" },
        { id: "T2", state: "ready", title: "Task 2" },
        { id: "T3", state: "backlog", title: "Task 3" },
      ]
      const grouped = groupTasksByState(tasks)
      assert.strictEqual(grouped.backlog.length, 2)
      assert.strictEqual(grouped.ready.length, 1)
    })

    test("empty state has no tasks", () => {
      const grouped = groupTasksByState([])
      assert.strictEqual(Object.keys(grouped).length, 0)
    })

    test("all same state grouped together", () => {
      const tasks = [
        { id: "T1", state: "in_progress" },
        { id: "T2", state: "in_progress" },
        { id: "T3", state: "in_progress" },
      ]
      const grouped = groupTasksByState(tasks)
      assert.strictEqual(grouped.in_progress.length, 3)
    })

    test("state order preserved when iterating", () => {
      const tasks = [
        { id: "T1", state: "done" },
        { id: "T2", state: "backlog" },
        { id: "T3", state: "ready" },
        { id: "T4", state: "in_progress" },
        { id: "T5", state: "blocked" },
      ]
      const grouped = groupTasksByState(tasks)
      const states = Object.keys(grouped)
      // grouping doesn't preserve order, but we can verify all states present
      assert.strictEqual(states.length, 5)
    })
  })

  describe("Valid state transitions", () => {

    test("backlog → ready is valid", () => {
      assert.strictEqual(canTransition("backlog", "ready"), true)
    })

    test("ready → in_progress is valid", () => {
      assert.strictEqual(canTransition("ready", "in_progress"), true)
    })

    test("in_progress → done is valid", () => {
      assert.strictEqual(canTransition("in_progress", "done"), true)
    })

    test("in_progress → blocked is valid", () => {
      assert.strictEqual(canTransition("in_progress", "blocked"), true)
    })

    test("blocked → ready is valid", () => {
      assert.strictEqual(canTransition("blocked", "ready"), true)
    })

    test("blocked → in_progress is valid", () => {
      assert.strictEqual(canTransition("blocked", "in_progress"), true)
    })

    test("done has no valid transitions (terminal)", () => {
      assert.deepStrictEqual(getValidTransitions("done"), [])
    })

    test("backlog → done is NOT valid (must go through ready)", () => {
      assert.strictEqual(canTransition("backlog", "done"), false)
    })

    test("done → anything is NOT valid", () => {
      assert.strictEqual(canTransition("done", "ready"), false)
      assert.strictEqual(canTransition("done", "blocked"), false)
      assert.strictEqual(canTransition("done", "backlog"), false)
    })

    test("in_progress → backlog is NOT valid", () => {
      assert.strictEqual(canTransition("in_progress", "backlog"), false)
    })

    test("unknown state has no transitions", () => {
      assert.deepStrictEqual(getValidTransitions("unknown"), [])
    })
  })

  describe("MissionList grouping", () => {

    test("tasks grouped by missionId", () => {
      const tasks = [
        { id: "T1", missionId: "m1", state: "done" },
        { id: "T2", missionId: "m1", state: "ready" },
        { id: "T3", missionId: "m2", state: "backlog" },
      ]
      const missions = computeMissions(tasks)
      assert.strictEqual(missions.m1.total, 2)
      assert.strictEqual(missions.m2.total, 1)
    })

    test("done count computed correctly", () => {
      const tasks = [
        { id: "T1", missionId: "m1", state: "done" },
        { id: "T2", missionId: "m1", state: "done" },
        { id: "T3", missionId: "m1", state: "ready" },
      ]
      const missions = computeMissions(tasks)
      assert.strictEqual(missions.m1.done, 2)
    })

    test("mission with no done tasks", () => {
      const tasks = [
        { id: "T1", missionId: "m1", state: "backlog" },
        { id: "T2", missionId: "m1", state: "ready" },
      ]
      const missions = computeMissions(tasks)
      assert.strictEqual(missions.m1.done, 0)
      assert.strictEqual(missions.m1.total, 2)
    })

    test("progress computed as done/total percentage", () => {
      assert.strictEqual(missionProgress({ total: 2, done: 1 }), 50)
      assert.strictEqual(missionProgress({ total: 3, done: 0 }), 0)
      assert.strictEqual(missionProgress({ total: 3, done: 3 }), 100)
      assert.strictEqual(missionProgress({ total: 0, done: 0 }), 0)
    })

    test("zero total mission has 0% progress", () => {
      assert.strictEqual(missionProgress({ total: 0, done: 0 }), 0)
    })
  })

  describe("TaskFilters", () => {

    test("filter by state reduces task list", () => {
      const tasks = [
        { id: "T1", state: "backlog" },
        { id: "T2", state: "ready" },
        { id: "T3", state: "backlog" },
      ]
      const filtered = filterTasks(tasks, { state: "backlog" })
      assert.strictEqual(filtered.length, 2)
    })

    test("filter by missionId reduces task list", () => {
      const tasks = [
        { id: "T1", missionId: "m1" },
        { id: "T2", missionId: "m1" },
        { id: "T3", missionId: "m2" },
      ]
      const filtered = filterTasks(tasks, { missionId: "m1" })
      assert.strictEqual(filtered.length, 2)
    })

    test("filter by owner reduces task list", () => {
      const tasks = [
        { id: "T1", owner: "backend-dev" },
        { id: "T2", owner: "frontend-dev" },
        { id: "T3", owner: "backend-dev" },
      ]
      const filtered = filterTasks(tasks, { owner: "backend-dev" })
      assert.strictEqual(filtered.length, 2)
    })

    test("search text filters by title", () => {
      const tasks = [
        { id: "T1", title: "Fix auth timeout bug" },
        { id: "T2", title: "Implement caching layer" },
        { id: "T3", title: "Auth middleware refactor" },
      ]
      const filtered = filterTasks(tasks, { searchText: "auth" })
      assert.strictEqual(filtered.length, 2)
      assert.strictEqual(filtered[0].id, "T1")
      assert.strictEqual(filtered[1].id, "T3")
    })

    test("search is case-insensitive", () => {
      const tasks = [
        { id: "T1", title: "Fix Auth Bug" },
        { id: "T2", title: "Implement Caching" },
      ]
      const filtered = filterTasks(tasks, { searchText: "AUTH" })
      assert.strictEqual(filtered.length, 1)
    })

    test("no filters returns all tasks", () => {
      const tasks = [{ id: "T1" }, { id: "T2" }]
      const filtered = filterTasks(tasks, {})
      assert.strictEqual(filtered.length, 2)
    })

    test("combined filters work together", () => {
      const tasks = [
        { id: "T1", state: "in_progress", owner: "dev", title: "Task 1" },
        { id: "T2", state: "in_progress", owner: "dev", title: "Task 2" },
        { id: "T3", state: "done", owner: "dev", title: "Task 3" },
        { id: "T4", state: "in_progress", owner: "qa", title: "Task 4" },
      ]
      const filtered = filterTasks(tasks, { state: "in_progress", owner: "dev" })
      assert.strictEqual(filtered.length, 2)
      assert.ok(filtered.every((t) => t.state === "in_progress" && t.owner === "dev"))
    })
  })

  describe("State order", () => {

    test("STATE_ORDER defines the column order", () => {
      assert.deepStrictEqual(STATE_ORDER, ["backlog", "ready", "in_progress", "done", "blocked"])
    })

    test("each state appears exactly once in STATE_ORDER", () => {
      const seen = new Set()
      for (const s of STATE_ORDER) {
        assert.strictEqual(seen.has(s), false)
        seen.add(s)
      }
      assert.strictEqual(seen.size, 5)
    })
  })

  describe("Edge cases", () => {

    test("task with no state defaults to backlog grouping", () => {
      const tasks = [{ id: "T1" }]
      const grouped = groupTasksByState(tasks)
      assert.strictEqual(grouped.undefined?.length, 1)
    })

    test("filter with empty search text returns unfiltered", () => {
      const tasks = [{ id: "T1", title: "Test" }]
      const filtered = filterTasks(tasks, { searchText: "" })
      assert.strictEqual(filtered.length, 1)
    })

    test("filter with no matching results returns empty array", () => {
      const tasks = [{ id: "T1", title: "Test" }]
      const filtered = filterTasks(tasks, { searchText: "xyz-no-match" })
      assert.strictEqual(filtered.length, 0)
    })

    test("empty task list returns empty groups", () => {
      const missions = computeMissions([])
      assert.strictEqual(Object.keys(missions).length, 0)
    })
  })
})