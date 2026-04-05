import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")

function run(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf-8"
  })
}

test("detect resolves a supported runtime in this repository", () => {
  const result = run(["detect"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /runtime=(pi|claude|opencode)/)
})

test("help returns usage", () => {
  const result = run(["--help"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage:/)
})

test("forced runtime works when flag appears before command", () => {
  const result = run(["--runtime", "opencode", "detect"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /runtime=opencode/)
  assert.match(result.stdout, /reason=forced/)
})

test("explain detect with trace returns structured output", () => {
  const result = run(["explain", "detect", "--trace"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /"command": "detect"/)
})

test("sessions command returns successfully", () => {
  const result = run(["sessions"])
  assert.equal(result.status, 0, result.stderr)
})

test("targets command returns successfully", () => {
  const result = run(["targets"])
  assert.equal(result.status, 0, result.stderr)
})
