import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")

test("E2E: explain run --full-crews returns cooperative routing payload", () => {
  const result = spawnSync(process.execPath, [
    cliPath,
    "--runtime", "hermes",
    "explain",
    "run",
    "--trace",
    "--crew", "dev",
    "--full-crews",
    "--task", "end-to-end cooperative explain"
  ], { cwd: repoRoot, encoding: "utf-8" })

  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.command, "run")
  assert.equal(payload.routing_scope, "full_crews")
  assert.equal(typeof payload.source_crew, "string")
  assert.equal(Array.isArray(payload.candidate_crews), true)
  assert.equal(typeof payload.candidate_agents_count, "number")
  assert.equal(typeof payload.cooperative_ranking, "object")
})

test("E2E: explain run without flag stays active_crew", () => {
  const result = spawnSync(process.execPath, [
    cliPath,
    "--runtime", "hermes",
    "explain",
    "run",
    "--trace",
    "--crew", "dev",
    "--task", "end-to-end single crew explain"
  ], { cwd: repoRoot, encoding: "utf-8" })

  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.command, "run")
  assert.equal(payload.routing_scope, "active_crew")
})
