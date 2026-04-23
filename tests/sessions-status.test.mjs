import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

import { recordLifecycleEvent, getLifecycleEvents } from "../scripts/m3-ops.mjs"
import { getCurrentState } from "../types/lifecycle-event-types.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")
const eventsDir = path.join(repoRoot, ".mah", "sessions", "lifecycle-events")

test("sessions status: shows current state from events", () => {
  const testId = `test-s4-status-${Date.now()}`
  try {
    recordLifecycleEvent(repoRoot, testId, { event: 'queued' })
    recordLifecycleEvent(repoRoot, testId, { event: 'routed', agent: 'backend-dev', routing_confidence: 0.9 })
    recordLifecycleEvent(repoRoot, testId, { event: 'completed', result_code: 0 })

    const events = getLifecycleEvents(repoRoot, testId)
    assert.equal(getCurrentState(events), 'completed')
    assert.equal(events.length, 3)
    assert.equal(events[1].agent, 'backend-dev')
  } finally {
    const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const f = path.join(eventsDir, `${safeId}.json`)
    if (existsSync(f)) rmSync(f)
  }
})

test("sessions status: returns queued for empty session", () => {
  assert.equal(getCurrentState([]), 'queued')
})

test("sessions status: shows failed state correctly", () => {
  const testId = `test-s4-failed-${Date.now()}`
  try {
    recordLifecycleEvent(repoRoot, testId, { event: 'queued' })
    recordLifecycleEvent(repoRoot, testId, { event: 'failed', result_code: 1, result_reason: 'non-zero exit' })

    const events = getLifecycleEvents(repoRoot, testId)
    assert.equal(getCurrentState(events), 'failed')
    assert.equal(events[1].result_code, 1)
  } finally {
    const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const f = path.join(eventsDir, `${safeId}.json`)
    if (existsSync(f)) rmSync(f)
  }
})

test("mah sessions status --json returns structured output", () => {
  const testId = `test-s4-cli-${Date.now()}`
  try {
    recordLifecycleEvent(repoRoot, testId, { event: 'queued' })
    recordLifecycleEvent(repoRoot, testId, { event: 'completed', result_code: 0 })

    const result = spawnSync(process.execPath, [
      cliPath, "sessions", "status", testId, "--json"
    ], { cwd: repoRoot, encoding: "utf-8" })

    assert.equal(result.status, 0, result.stderr)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.session_id, testId)
    assert.equal(parsed.current_state, 'completed')
    assert.equal(parsed.event_count, 2)
    assert.ok(Array.isArray(parsed.timeline))
    assert.ok(Array.isArray(parsed.events))
  } finally {
    const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const f = path.join(eventsDir, `${safeId}.json`)
    if (existsSync(f)) rmSync(f)
  }
})

test("mah sessions status without session-id returns error", () => {
  const result = spawnSync(process.execPath, [
    cliPath, "sessions", "status"
  ], { cwd: repoRoot, encoding: "utf-8" })

  assert.notEqual(result.status, 0)
})
