import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"

const repoRoot = path.resolve("/home/alysson/Github/hivehue-multi-agents")
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
