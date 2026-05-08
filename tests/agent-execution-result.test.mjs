import test from "node:test"
import assert from "node:assert/strict"

import { normalizeExecutionResult } from "../types/agent-execution-result.mjs"

test("normalizes full raw object and returns frozen result", () => {
  const raw = {
    runtime: "codex",
    crew: "Engineering",
    agent: "backend-dev",
    task: "build helper",
    sessionId: "sess-123",
    output: "done",
    exitCode: 0,
    elapsedMs: 42,
    artifactPath: ".mah/sessions/sess-123.json",
    metadata: { source: "adapter" }
  }

  const result = normalizeExecutionResult(raw)

  assert.deepEqual(result, raw)
  assert.equal(Object.isFrozen(result), true)
})

test("minimal raw gets defaults for required fields", () => {
  const result = normalizeExecutionResult({})

  assert.equal(result.runtime, "unknown")
  assert.equal(result.crew, "unknown")
  assert.equal(result.agent, "unknown")
  assert.equal(result.task, "")
  assert.equal(result.output, "")
  assert.equal(result.exitCode, 1)
  assert.equal(result.elapsedMs, 0)
})

test("maps raw.stdout to output when raw.output missing", () => {
  const result = normalizeExecutionResult({ stdout: "from-stdout" })
  assert.equal(result.output, "from-stdout")
})

test("maps raw.status to exitCode when raw.exitCode missing", () => {
  const result = normalizeExecutionResult({ status: 7 })
  assert.equal(result.exitCode, 7)
})

test("options override raw values", () => {
  const raw = {
    runtime: "pi",
    crew: "dev",
    agent: "ops",
    sessionId: "raw-session"
  }

  const result = normalizeExecutionResult(raw, {
    runtime: "codex",
    crew: "Engineering",
    agent: "backend-dev",
    sessionId: "opt-session"
  })

  assert.equal(result.runtime, "codex")
  assert.equal(result.crew, "Engineering")
  assert.equal(result.agent, "backend-dev")
  assert.equal(result.sessionId, "opt-session")
})

test("coerces exitCode and elapsedMs to numbers", () => {
  const result = normalizeExecutionResult({ exitCode: "0", elapsedMs: "123" })

  assert.equal(result.exitCode, 0)
  assert.equal(result.elapsedMs, 123)
})

test("passes through optional fields", () => {
  const metadata = { trace: true }
  const result = normalizeExecutionResult({
    sessionId: "sess-1",
    artifactPath: "artifacts/out.txt",
    metadata
  })

  assert.equal(result.sessionId, "sess-1")
  assert.equal(result.artifactPath, "artifacts/out.txt")
  assert.equal(result.metadata, metadata)
})

test("missing optional fields default to undefined or null", () => {
  const result = normalizeExecutionResult({})

  assert.equal(result.sessionId, null)
  assert.equal(result.artifactPath, undefined)
  assert.equal(result.metadata, undefined)
})
