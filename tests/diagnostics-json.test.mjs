import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")

function runJson(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf-8"
  })
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json: JSON.parse(result.stdout || "{}")
  }
}

test("detect --json follows diagnostics schema", () => {
  const result = runJson(["detect", "--json"])
  assert.equal(typeof result.json.schema, "string")
  assert.equal(result.json.schema, "mah.diagnostics.v1")
  assert.equal(result.json.command, "detect")
  assert.equal(typeof result.json.ok, "boolean")
  assert.equal(typeof result.json.status, "number")
})

test("validate:config --json follows diagnostics schema", () => {
  const result = runJson(["validate:config", "--json"])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.json.schema, "mah.diagnostics.v1")
  assert.equal(result.json.command, "validate:config")
  assert.equal(result.json.ok, true)
})

test("validate:sync --json follows diagnostics schema", () => {
  const result = runJson(["validate:sync", "--json"])
  assert.equal(result.json.schema, "mah.diagnostics.v1")
  assert.equal(result.json.command, "validate:sync")
  assert.equal(typeof result.json.data, "object")
})

test("plan --json and diff --json expose deterministic command envelope", () => {
  const plan = runJson(["plan", "--json"])
  const diff = runJson(["diff", "--json"])
  assert.equal(plan.json.schema, "mah.diagnostics.v1")
  assert.equal(plan.json.command, "plan")
  assert.equal(plan.json.data.mode, "plan")
  assert.equal(diff.json.schema, "mah.diagnostics.v1")
  assert.equal(diff.json.command, "diff")
  assert.equal(diff.json.data.mode, "diff")
})

test("doctor and explain detect support json envelope", () => {
  const doctor = runJson(["doctor", "--json"])
  assert.equal(doctor.json.schema, "mah.diagnostics.v1")
  assert.equal(doctor.json.command, "doctor")
  const explain = runJson(["explain", "detect", "--json"])
  assert.equal(explain.json.schema, "mah.diagnostics.v1")
  assert.equal(explain.json.command, "explain")
})
