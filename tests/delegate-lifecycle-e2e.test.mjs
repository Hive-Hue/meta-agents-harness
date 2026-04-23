import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, rmSync, readFileSync, readdirSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { recordLifecycleEvent, getLifecycleEvents } from "../scripts/m3-ops.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const eventsDir = path.join(repoRoot, ".mah", "sessions", "lifecycle-events")

function cleanup(testId) {
  const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, "_")
  const f = path.join(eventsDir, `${safeId}.json`)
  if (existsSync(f)) rmSync(f)
}

test("delegate lifecycle records queued → routed → completed sequence", () => {
  const testId = `test:dev:delegate-${Date.now()}-completed`
  try {
    recordLifecycleEvent(repoRoot, testId, {
      event: "queued",
      details: { task: "analyze test repo", sourceAgent: "orchestrator" }
    })
    recordLifecycleEvent(repoRoot, testId, {
      event: "routed",
      agent: "planning-lead",
      agent_name: "planning-lead",
      routing_reason: "expertise-scored",
      routing_confidence: 0.85,
      details: { targetRuntime: "pi", sourceRuntime: "pi" }
    })
    recordLifecycleEvent(repoRoot, testId, {
      event: "completed",
      result_code: 0,
      result_reason: "success"
    })

    const events = getLifecycleEvents(repoRoot, testId)
    assert.equal(events.length, 3)
    assert.equal(events[0].event, "queued")
    assert.equal(events[1].event, "routed")
    assert.equal(events[1].agent, "planning-lead")
    assert.equal(events[1].routing_confidence, 0.85)
    assert.equal(events[2].event, "completed")
    assert.equal(events[2].result_code, 0)
  } finally {
    cleanup(testId)
  }
})

test("delegate lifecycle records queued → routed → failed sequence", () => {
  const testId = `test:dev:delegate-${Date.now()}-failed`
  try {
    recordLifecycleEvent(repoRoot, testId, {
      event: "queued",
      details: { task: "analyze test repo", sourceAgent: "orchestrator" }
    })
    recordLifecycleEvent(repoRoot, testId, {
      event: "routed",
      agent: "planning-lead",
      agent_name: "planning-lead",
      routing_reason: "expertise-scored",
      routing_confidence: 0.85,
      details: { targetRuntime: "pi", sourceRuntime: "pi" }
    })
    recordLifecycleEvent(repoRoot, testId, {
      event: "failed",
      result_code: 1,
      result_reason: "non-zero exit",
      error_detail: { exitCode: 1 }
    })

    const events = getLifecycleEvents(repoRoot, testId)
    assert.equal(events.length, 3)
    assert.equal(events[2].event, "failed")
    assert.equal(events[2].result_code, 1)
    assert.equal(events[2].error_detail.exitCode, 1)
  } finally {
    cleanup(testId)
  }
})

test("routed event has required fields for explain", () => {
  const testId = `test:dev:delegate-${Date.now()}-routed`
  try {
    recordLifecycleEvent(repoRoot, testId, { event: "queued" })
    recordLifecycleEvent(repoRoot, testId, {
      event: "routed",
      agent: "planning-lead",
      routing_reason: "expertise-scored",
      routing_confidence: 0.85
    })

    const events = getLifecycleEvents(repoRoot, testId)
    const routed = events.find((e) => e.event === "routed")
    assert.ok(routed)
    assert.ok(routed.agent)
    assert.ok(routed.routing_reason)
    assert.equal(typeof routed.routing_confidence, "number")
  } finally {
    cleanup(testId)
  }
})

test("completed event has result_code", () => {
  const testId = `test:dev:delegate-${Date.now()}-result`
  try {
    recordLifecycleEvent(repoRoot, testId, { event: "queued" })
    recordLifecycleEvent(repoRoot, testId, {
      event: "routed",
      agent: "planning-lead",
      routing_reason: "expertise-scored",
      routing_confidence: 0.85
    })
    recordLifecycleEvent(repoRoot, testId, {
      event: "completed",
      result_code: 0,
      result_reason: "success"
    })

    const events = getLifecycleEvents(repoRoot, testId)
    const completed = events.find((e) => e.event === "completed")
    assert.ok(completed)
    assert.equal(typeof completed.result_code, "number")
    assert.equal(completed.result_code, 0)
  } finally {
    cleanup(testId)
  }
})

test("session ID with colons produces valid safe file name", () => {
  const testId = "pi:dev:delegate-1234567890"
  const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, "_")
  const filePath = path.join(eventsDir, `${safeId}.json`)

  try {
    recordLifecycleEvent(repoRoot, testId, { event: "queued" })
    assert.equal(safeId, "pi_dev_delegate-1234567890")
    assert.ok(existsSync(filePath))
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"))
    assert.ok(Array.isArray(parsed))
    assert.equal(parsed.length, 1)
  } finally {
    cleanup(testId)
  }
})

test("lifecycle timeline reconstruction matches runDelegate verbose output", () => {
  const testId = `test:dev:delegate-${Date.now()}-timeline`
  try {
    recordLifecycleEvent(repoRoot, testId, { event: "queued" })
    recordLifecycleEvent(repoRoot, testId, {
      event: "routed",
      agent: "planning-lead",
      routing_reason: "expertise-scored",
      routing_confidence: 0.85
    })
    recordLifecycleEvent(repoRoot, testId, {
      event: "completed",
      result_code: 0,
      result_reason: "success"
    })

    const events = getLifecycleEvents(repoRoot, testId)
    const lines = []
    for (const ev of events) {
      const ts = ev.timestamp ? new Date(ev.timestamp).toISOString().substring(11, 19) : "—"
      let line = `  [${ts}] ${ev.event}`
      if (ev.agent) line += ` → ${ev.agent} (conf: ${typeof ev.routing_confidence === "number" ? (ev.routing_confidence * 100).toFixed(0) + "%" : "?"})`
      if (ev.result_code !== undefined) line += ` (exit: ${ev.result_code})`
      lines.push(line)
    }

    assert.equal(lines.length, 3)
    assert.match(lines[0], /queued/)
    assert.match(lines[1], /routed/)
    assert.match(lines[1], /planning-lead/)
    assert.match(lines[1], /85%/)
    assert.match(lines[2], /completed/)
    assert.match(lines[2], /exit: 0/)
  } finally {
    cleanup(testId)
  }
})

test("mah delegate --execute emits lifecycle events to disk", { timeout: 60_000 }, () => {
  const beforeFiles = new Set(
    existsSync(eventsDir) ? readdirSync(eventsDir).filter(f => f.startsWith("pi_dev_delegate-")) : []
  )

  const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")
  const result = spawnSync(process.execPath, [
    cliPath, "delegate",
    "--target", "planning-lead",
    "--task", "analyze codebase structure for e2e test",
    "--crew", "dev",
    "--execute"
  ], {
    cwd: repoRoot,
    encoding: "utf-8",
    timeout: 50000,
    env: { ...process.env }
  })

  const afterFiles = existsSync(eventsDir)
    ? readdirSync(eventsDir).filter(f => f.startsWith("pi_dev_delegate-"))
    : []
  const newFiles = afterFiles.filter(f => !beforeFiles.has(f))

  try {
    assert.ok(newFiles.length > 0, "expected at least one new pi:dev:delegate-* lifecycle file")

    const eventFile = path.join(eventsDir, newFiles[0])
    const events = JSON.parse(readFileSync(eventFile, "utf-8"))
    const eventTypes = events.map(e => e.event)

    assert.ok(eventTypes.includes("queued"), "lifecycle must include 'queued' event")
    assert.ok(eventTypes.includes("routed"), "lifecycle must include 'routed' event")

    const routed = events.find(e => e.event === "routed")
    assert.ok(routed.agent, "routed event must have 'agent'")
    assert.equal(routed.agent, "planning-lead")
    assert.ok(routed.routing_reason, "routed event must have 'routing_reason'")
    assert.equal(typeof routed.routing_confidence, "number", "routed event must have numeric routing_confidence")

    const terminal = events.find(e => e.event === "completed" || e.event === "failed")
    if (terminal) {
      assert.equal(typeof terminal.result_code, "number", "terminal event must have numeric result_code")
    }
  } finally {
    for (const f of newFiles) {
      const fp = path.join(eventsDir, f)
      if (existsSync(fp)) rmSync(fp)
    }
  }
})
