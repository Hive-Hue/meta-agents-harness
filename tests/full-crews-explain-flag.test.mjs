import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")

test("mah explain run defaults to active_crew routing scope", () => {
  const result = spawnSync(process.execPath, [
    cliPath, "--runtime", "hermes", "explain", "run", "--trace", "--crew", "dev", "test task"
  ], { cwd: repoRoot, encoding: "utf-8" })

  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.command, "run")
  assert.equal(payload.routing_scope, "active_crew")
  assert.equal(payload.source_crew, "dev")
  assert.equal(typeof payload.candidate_crews_count, "number")
  assert.equal(typeof payload.candidate_agents_count, "number")
  assert.equal(typeof payload.cooperative_ranking, "object")
})

test("mah explain run --full-crews enables cooperative routing scope metadata", () => {
  const result = spawnSync(process.execPath, [
    cliPath, "--runtime", "hermes", "explain", "run", "--trace", "--crew", "dev", "--full-crews", "test task"
  ], { cwd: repoRoot, encoding: "utf-8" })

  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.command, "run")
  assert.equal(payload.routing_scope, "full_crews")
  assert.equal(payload.source_crew, "dev")
  assert.equal(Array.isArray(payload.candidate_crews), true)
  assert.equal(payload.candidate_crews.includes("dev"), true)
  assert.ok(payload.candidate_crews_count >= 1)
  assert.equal(typeof payload.cooperative_ranking, "object")
  assert.equal(Array.isArray(payload.cooperative_ranking?.ranking), true)
})
