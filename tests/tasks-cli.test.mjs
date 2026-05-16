import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")

function run(args, cwd) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env: process.env,
    encoding: "utf-8"
  })
}

test("mah task list --json returns persisted tasks", () => {
  const tempWorkspace = mkdtempSync(path.join(os.tmpdir(), "mah-task-list-"))
  try {
    const create = run([
      "task",
      "create",
      "--payload",
      JSON.stringify({ id: "TASK-118", title: "List seed", missionId: "mission-1" }),
      "--json"
    ], tempWorkspace)
    assert.equal(create.status, 0, create.stderr)

    const result = run(["task", "list", "--json"], tempWorkspace)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.ok, true)
    assert.ok(Array.isArray(payload.tasks))
    assert.ok(payload.tasks.length > 0)
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})

test("mah task create persists a new task with default crew", () => {
  const tempWorkspace = mkdtempSync(path.join(os.tmpdir(), "mah-task-create-"))
  try {
    const result = run([
      "task",
      "create",
      "--payload",
      JSON.stringify({ title: "Create task via CLI", missionId: "q4-audit" }),
      "--json"
    ], tempWorkspace)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.ok, true)
    assert.equal(payload.task.title, "Create task via CLI")
    assert.equal(payload.task.crewId, "dev")
    assert.match(payload.task.command, /^mah task run --id TASK-/)
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})

test("mah task update changes state and runtime", () => {
  const tempWorkspace = mkdtempSync(path.join(os.tmpdir(), "mah-task-update-"))
  try {
    const create = run([
      "task",
      "create",
      "--payload",
      JSON.stringify({ id: "TASK-220", title: "Update me", missionId: "q4-audit" }),
      "--json"
    ], tempWorkspace)
    assert.equal(create.status, 0, create.stderr)

    const update = run([
      "task",
      "update",
      "TASK-220",
      "--payload",
      JSON.stringify({ state: "ready", runtime: "pi", crewId: "dev" }),
      "--json"
    ], tempWorkspace)
    assert.equal(update.status, 0, update.stderr)
    const payload = JSON.parse(update.stdout)
    assert.equal(payload.ok, true)
    assert.equal(payload.task.id, "TASK-220")
    assert.equal(payload.task.state, "ready")
    assert.equal(payload.task.runtime, "pi")
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})

test("mah task show returns task details", () => {
  const tempWorkspace = mkdtempSync(path.join(os.tmpdir(), "mah-task-show-"))
  try {
    const create = run([
      "task",
      "create",
      "--payload",
      JSON.stringify({ id: "TASK-118", title: "Show seed", missionId: "mission-1" }),
      "--json"
    ], tempWorkspace)
    assert.equal(create.status, 0, create.stderr)

    const result = run(["task", "show", "TASK-118", "--json"], tempWorkspace)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.ok, true)
    assert.equal(payload.task.id, "TASK-118")
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})

test("mah task delete removes a persisted task", () => {
  const tempWorkspace = mkdtempSync(path.join(os.tmpdir(), "mah-task-delete-"))
  try {
    const create = run([
      "task",
      "create",
      "--payload",
      JSON.stringify({ id: "TASK-260", title: "Delete me", missionId: "q4-audit" }),
      "--json"
    ], tempWorkspace)
    assert.equal(create.status, 0, create.stderr)

    const remove = run(["task", "delete", "TASK-260", "--json"], tempWorkspace)
    assert.equal(remove.status, 0, remove.stderr)
    const payload = JSON.parse(remove.stdout)
    assert.equal(payload.ok, true)
    assert.equal(payload.task.id, "TASK-260")
    assert.ok(!payload.tasks.some((task) => task.id === "TASK-260"))
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})

test("mah task archive hides task from default list", () => {
  const tempWorkspace = mkdtempSync(path.join(os.tmpdir(), "mah-task-archive-"))
  try {
    const create = run([
      "task",
      "create",
      "--payload",
      JSON.stringify({ id: "TASK-300", title: "Archive me", missionId: "q4-audit" }),
      "--json"
    ], tempWorkspace)
    assert.equal(create.status, 0, create.stderr)

    // Default list must include the task
    const listBefore = run(["task", "list", "--json"], tempWorkspace)
    assert.equal(listBefore.status, 0, listBefore.stderr)
    const before = JSON.parse(listBefore.stdout)
    assert.ok(before.tasks.some((t) => t.id === "TASK-300"), "task should appear before archive")

    // Archive the task
    const archive = run(["task", "archive", "TASK-300", "--json"], tempWorkspace)
    assert.equal(archive.status, 0, archive.stderr)
    const archivePayload = JSON.parse(archive.stdout)
    assert.equal(archivePayload.ok, true)
    assert.equal(archivePayload.task.id, "TASK-300")
    assert.equal(archivePayload.task.archived, true)

    // Default list must NOT include archived task
    const listAfter = run(["task", "list", "--json"], tempWorkspace)
    assert.equal(listAfter.status, 0, listAfter.stderr)
    const after = JSON.parse(listAfter.stdout)
    assert.ok(!after.tasks.some((t) => t.id === "TASK-300"), "archived task should be hidden")

    // --archived flag should reveal it
    const listArchived = run(["task", "list", "--archived", "--json"], tempWorkspace)
    assert.equal(listArchived.status, 0, listArchived.stderr)
    const archived = JSON.parse(listArchived.stdout)
    assert.ok(archived.tasks.some((t) => t.id === "TASK-300"), "archived task should appear with --archived")
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})

test("mah task unarchive restores archived task to default list", () => {
  const tempWorkspace = mkdtempSync(path.join(os.tmpdir(), "mah-task-unarchive-"))
  try {
    const create = run([
      "task",
      "create",
      "--payload",
      JSON.stringify({ id: "TASK-310", title: "Unarchive me", missionId: "q4-audit" }),
      "--json"
    ], tempWorkspace)
    assert.equal(create.status, 0, create.stderr)

    // Archive it
    const archive = run(["task", "archive", "TASK-310", "--json"], tempWorkspace)
    assert.equal(archive.status, 0, archive.stderr)

    // Verify hidden
    const listAfter = run(["task", "list", "--json"], tempWorkspace)
    assert.equal(listAfter.status, 0, listAfter.stderr)
    const after = JSON.parse(listAfter.stdout)
    assert.ok(!after.tasks.some((t) => t.id === "TASK-310"), "task should be hidden after archive")

    // Unarchive it
    const unarchive = run(["task", "unarchive", "TASK-310", "--json"], tempWorkspace)
    assert.equal(unarchive.status, 0, unarchive.stderr)
    const unarchivePayload = JSON.parse(unarchive.stdout)
    assert.equal(unarchivePayload.ok, true)
    assert.equal(unarchivePayload.task.id, "TASK-310")
    assert.equal(unarchivePayload.task.archived, false)

    // Task should be visible again
    const listRestored = run(["task", "list", "--json"], tempWorkspace)
    assert.equal(listRestored.status, 0, listRestored.stderr)
    const restored = JSON.parse(listRestored.stdout)
    assert.ok(restored.tasks.some((t) => t.id === "TASK-310"), "task should be visible after unarchive")
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})
