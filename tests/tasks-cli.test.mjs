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

test("mah task list --json returns seeded tasks", () => {
  const tempWorkspace = mkdtempSync(path.join(os.tmpdir(), "mah-task-list-"))
  try {
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
    const result = run(["task", "show", "TASK-118", "--json"], tempWorkspace)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.ok, true)
    assert.equal(payload.task.id, "TASK-118")
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})
