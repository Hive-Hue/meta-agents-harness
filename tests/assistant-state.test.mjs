import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildAssistantStatePayload } from "../scripts/runtime/assistant-state.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")

test("buildAssistantStatePayload returns valid structure with minimal input", () => {
  const result = buildAssistantStatePayload({
    repoRoot,
    crew: "dev",
    agent: "",
    task: "",
    runtime: "hermes"
  })
  assert.ok(result.crew)
  assert.ok(result.expertise)
  assert.ok(result.context_memory)
  assert.ok(result.session)
  assert.ok(result.provenance)
  assert.ok(result.readiness)
  assert.ok(Array.isArray(result.readiness.notes))
})

test("buildAssistantStatePayload with task triggers expertise routing", () => {
  const result = buildAssistantStatePayload({
    repoRoot,
    crew: "dev",
    agent: "planning-lead",
    task: "triage backlog with clickup",
    runtime: "hermes"
  })
  assert.equal(result.crew, "dev")
  assert.equal(result.agent, "planning-lead")
  assert.equal(result.runtime, "hermes")
  assert.ok(result.expertise)
  assert.ok(result.context_memory.status)
  assert.ok(result.readiness.status)
})

test("buildAssistantStatePayload with empty crew returns unknown crew", () => {
  const result = buildAssistantStatePayload({
    repoRoot,
    crew: "",
    agent: "",
    task: "",
    runtime: ""
  })
  assert.equal(result.crew, "unknown")
  assert.equal(result.agent, "unknown")
})

test("mah explain state --crew dev --agent planning-lead --task 'test' --json returns valid JSON", () => {
  const result = spawnSync(process.execPath, [
    cliPath,
    "explain",
    "state",
    "--crew",
    "dev",
    "--agent",
    "planning-lead",
    "--task",
    "triage backlog",
    "--json"
  ], { cwd: repoRoot, encoding: "utf-8" })

  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout)
  const payload = parsed?.data?.payload
  assert.ok(payload)
  assert.ok(payload.crew)
  assert.ok(payload.expertise)
  assert.ok(payload.context_memory)
  assert.ok(payload.session)
  assert.ok(payload.provenance)
  assert.ok(payload.readiness)
})
