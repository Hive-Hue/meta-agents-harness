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

test("mah mission list --json returns seeded missions", () => {
  const tempWorkspace = mkdtempSync(path.join(os.tmpdir(), "mah-mission-list-"))
  try {
    const result = run(["mission", "list", "--json"], tempWorkspace)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.ok, true)
    assert.ok(Array.isArray(payload.missions))
    assert.ok(payload.missions.length > 0)
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})

test("mah mission create persists mission with normalized id", () => {
  const tempWorkspace = mkdtempSync(path.join(os.tmpdir(), "mah-mission-create-"))
  try {
    const result = run([
      "mission",
      "create",
      "--payload",
      JSON.stringify({ name: "Release Readiness", objective: "Prepare launch" }),
      "--json"
    ], tempWorkspace)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.ok, true)
    assert.equal(payload.mission.id, "release-readiness")
    assert.match(payload.mission.command, /^mah mission show /)
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})

test("mah mission commit-scope activates mission", () => {
  const tempWorkspace = mkdtempSync(path.join(os.tmpdir(), "mah-mission-commit-"))
  try {
    const create = run([
      "mission",
      "create",
      "--payload",
      JSON.stringify({ id: "audit-wave", name: "Audit Wave", progress: 0 }),
      "--json"
    ], tempWorkspace)
    assert.equal(create.status, 0, create.stderr)

    const commit = run(["mission", "commit-scope", "--id", "audit-wave", "--json"], tempWorkspace)
    assert.equal(commit.status, 0, commit.stderr)
    const payload = JSON.parse(commit.stdout)
    assert.equal(payload.ok, true)
    assert.equal(payload.mission.status, "active")
    assert.equal(payload.mission.health, "Scope committed")
    assert.ok(payload.mission.progress >= 5)
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})

test("mah mission replan returns updated mission and tasks", () => {
  const tempWorkspace = mkdtempSync(path.join(os.tmpdir(), "mah-mission-replan-"))
  try {
    const result = run(["mission", "replan", "--id", "q4-audit", "--json"], tempWorkspace)
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.ok, true)
    assert.equal(payload.mission.id, "q4-audit")
    assert.ok(Array.isArray(payload.tasks))
    assert.match(payload.summary, /TASK-142/)
  } finally {
    rmSync(tempWorkspace, { recursive: true, force: true })
  }
})
