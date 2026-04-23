import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, rmSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { LIFECYCLE_STATES, getCurrentState } from "../types/lifecycle-event-types.mjs"
import { recordLifecycleEvent, getLifecycleEvents } from "../scripts/m3-ops.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const eventsDir = path.join(repoRoot, ".mah", "sessions", "lifecycle-events")

test("LIFECYCLE_STATES contains canonical states in order", () => {
  assert.deepEqual(LIFECYCLE_STATES, ['queued', 'routed', 'context_loaded', 'running', 'blocked', 'completed', 'failed'])
})

test("getCurrentState returns queued for empty events", () => {
  assert.equal(getCurrentState([]), 'queued')
  assert.equal(getCurrentState(null), 'queued')
  assert.equal(getCurrentState(undefined), 'queued')
})

test("getCurrentState returns last event state", () => {
  const events = [{ event: 'queued' }, { event: 'routed' }, { event: 'completed' }]
  assert.equal(getCurrentState(events), 'completed')
})

test("recordLifecycleEvent writes event file", () => {
  const testId = `test-lifecycle-unit-${Date.now()}`
  try {
    recordLifecycleEvent(repoRoot, testId, { event: 'queued', details: { task: 'test' } })
    const events = getLifecycleEvents(repoRoot, testId)
    assert.equal(events.length, 1)
    assert.equal(events[0].event, 'queued')
    assert.ok(events[0].timestamp)
  } finally {
    const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const f = path.join(eventsDir, `${safeId}.json`)
    if (existsSync(f)) rmSync(f)
  }
})

test("recordLifecycleEvent appends to existing events", () => {
  const testId = `test-lifecycle-append-${Date.now()}`
  try {
    recordLifecycleEvent(repoRoot, testId, { event: 'queued' })
    recordLifecycleEvent(repoRoot, testId, { event: 'routed', agent: 'test-agent', routing_confidence: 0.85 })
    recordLifecycleEvent(repoRoot, testId, { event: 'completed', result_code: 0 })

    const events = getLifecycleEvents(repoRoot, testId)
    assert.equal(events.length, 3)
    assert.equal(events[0].event, 'queued')
    assert.equal(events[1].event, 'routed')
    assert.equal(events[1].agent, 'test-agent')
    assert.equal(events[1].routing_confidence, 0.85)
    assert.equal(events[2].event, 'completed')
    assert.equal(events[2].result_code, 0)
  } finally {
    const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const f = path.join(eventsDir, `${safeId}.json`)
    if (existsSync(f)) rmSync(f)
  }
})

test("getLifecycleEvents returns empty array for non-existent session", () => {
  const events = getLifecycleEvents(repoRoot, `nonexistent-${Date.now()}`)
  assert.deepEqual(events, [])
})

test("lifecycle event file is valid JSON array", () => {
  const testId = `test-lifecycle-json-${Date.now()}`
  try {
    recordLifecycleEvent(repoRoot, testId, { event: 'running' })
    const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const f = path.join(eventsDir, `${safeId}.json`)
    assert.ok(existsSync(f))
    const parsed = JSON.parse(readFileSync(f, 'utf-8'))
    assert.ok(Array.isArray(parsed))
    assert.equal(parsed.length, 1)
  } finally {
    const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const f = path.join(eventsDir, `${safeId}.json`)
    if (existsSync(f)) rmSync(f)
  }
})
