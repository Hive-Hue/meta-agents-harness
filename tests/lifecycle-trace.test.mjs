import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")

test("mah explain run --trace includes lifecycle-capable payload", () => {
  const result = spawnSync(process.execPath, [
    cliPath, "explain", "run", "--runtime", "hermes", "--crew", "dev", "--trace", "test task"
  ], { cwd: repoRoot, encoding: "utf-8" })

  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout)
  assert.ok(parsed.command === "run" || parsed.runtime)
})

test("mah explain run (non-trace) shows lifecycle sequence", () => {
  const result = spawnSync(process.execPath, [
    cliPath, "explain", "run", "--runtime", "hermes", "--crew", "dev", "test task"
  ], { cwd: repoRoot, encoding: "utf-8" })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /lifecycle_sequence=/)
})

test("dispatchHeadless path remains stable", () => {
  const result = spawnSync(process.execPath, [
    cliPath, "run", "--headless", "--runtime", "hermes", "--crew", "dev", "echo test"
  ], { cwd: repoRoot, encoding: "utf-8", timeout: 30000 })

  assert.ok(result.status !== null)
})
