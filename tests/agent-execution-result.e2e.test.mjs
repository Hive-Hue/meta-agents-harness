import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, rmSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

import { normalizeExecutionResult } from "../types/agent-execution-result.mjs"
import { sanitizeTaskDescription } from "../scripts/task-description.mjs"
import { recordEvidence, loadEvidenceFor } from "../scripts/expertise-evidence-store.mjs"
import { recordDelegationEvidence, deriveTaskType } from "../scripts/evidence-pipeline.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

const REQUIRED_FIELDS = ["runtime", "crew", "agent", "task", "output", "exitCode", "elapsedMs"]

function makeTempEvidenceRoot(name) {
  const dir = path.join(os.tmpdir(), `mah-agent-exec-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

test("recordEvidence preserves execution_result with required fields", async () => {
  const evidenceRoot = makeTempEvidenceRoot("required-fields")
  const expertiseId = "dev:backend-dev"

  try {
    const executionResult = normalizeExecutionResult({
      runtime: "codex",
      crew: "dev",
      agent: "backend-dev",
      task: "Implement canonical execution result",
      output: "ok",
      exitCode: 0,
      elapsedMs: 25,
      sessionId: "sess-1"
    })

    const res = await recordEvidence({
      expertise_id: expertiseId,
      outcome: "success",
      task_type: "testing",
      task_description: "verify persistence",
      duration_ms: 25,
      source_agent: "backend-dev",
      source_session: "sess-1",
      execution_result: executionResult
    }, { evidenceRoot })

    assert.equal(res.ok, true)

    const events = await loadEvidenceFor(expertiseId, { evidenceRoot })
    assert.equal(events.length, 1)
    const persisted = events[0]

    assert.ok(persisted.execution_result)
    for (const field of REQUIRED_FIELDS) {
      assert.ok(field in persisted.execution_result, `missing required field: ${field}`)
    }
    assert.equal(typeof persisted.execution_result.runtime, "string")
    assert.equal(typeof persisted.execution_result.crew, "string")
    assert.equal(typeof persisted.execution_result.agent, "string")
    assert.equal(typeof persisted.execution_result.task, "string")
    assert.equal(typeof persisted.execution_result.output, "string")
    assert.equal(typeof persisted.execution_result.exitCode, "number")
    assert.equal(typeof persisted.execution_result.elapsedMs, "number")
  } finally {
    if (existsSync(evidenceRoot)) rmSync(evidenceRoot, { recursive: true, force: true })
  }
})

test("execution_result task remains sanitized when pre-sanitized before normalize", async () => {
  const evidenceRoot = makeTempEvidenceRoot("sanitized-task")
  const expertiseId = "dev:backend-dev"

  try {
    const dirtyTask = [
      "[CAVEMAN_CREW]",
      "Mode: wenyan-full",
      "[/CAVEMAN_CREW]",
      "\u001b[31mRed Text\u001b[0m",
      "Routing note from orchestrator:",
      "- test routing",
      "Delegate internally ONLY to backend-dev.",
      "Implement adapter fix"
    ].join("\n")

    const cleanTask = sanitizeTaskDescription(dirtyTask)
    const executionResult = normalizeExecutionResult({
      runtime: "codex",
      crew: "dev",
      agent: "backend-dev",
      task: cleanTask,
      output: "done",
      exitCode: 0,
      elapsedMs: 10
    })

    const res = await recordEvidence({
      expertise_id: expertiseId,
      outcome: "success",
      task_type: "code-generation",
      task_description: cleanTask,
      duration_ms: 10,
      source_agent: "backend-dev",
      source_session: "sess-2",
      execution_result: executionResult
    }, { evidenceRoot })

    assert.equal(res.ok, true)

    const events = await loadEvidenceFor(expertiseId, { evidenceRoot })
    assert.equal(events.length, 1)
    const task = events[0].execution_result.task

    assert.equal(task.includes("[CAVEMAN_CREW]"), false)
    assert.equal(task.includes("\u001b[31m"), false)
    assert.equal(task.toLowerCase().includes("routing note from orchestrator"), false)
    assert.equal(task.toLowerCase().includes("delegate internally"), false)
  } finally {
    if (existsSync(evidenceRoot)) rmSync(evidenceRoot, { recursive: true, force: true })
  }
})

test("execution_result absent when not provided", async () => {
  const evidenceRoot = makeTempEvidenceRoot("missing-optional")
  const expertiseId = "dev:backend-dev"

  try {
    const res = await recordEvidence({
      expertise_id: expertiseId,
      outcome: "success",
      task_type: "testing",
      task_description: "no execution result",
      duration_ms: 5,
      source_agent: "backend-dev",
      source_session: "sess-3"
    }, { evidenceRoot })

    assert.equal(res.ok, true)

    const events = await loadEvidenceFor(expertiseId, { evidenceRoot })
    assert.equal(events.length, 1)
    assert.equal(events[0].execution_result, undefined)
  } finally {
    if (existsSync(evidenceRoot)) rmSync(evidenceRoot, { recursive: true, force: true })
  }
})

test("PI pipeline evidence includes execution_result required fields", async () => {
  const evidenceRoot = makeTempEvidenceRoot("pi-pipeline")
  const expertiseId = "backend-dev"
  const fullExpertiseId = "dev:backend-dev"

  try {
    const prevRoot = process.env.MAH_EXPERTISE_EVIDENCE_ROOT
    process.env.MAH_EXPERTISE_EVIDENCE_ROOT = evidenceRoot

    await recordDelegationEvidence({
      crew: "dev",
      expertiseId,
      taskDescription: "implement pipeline for pi runtime",
      outcome: "success",
      durationMs: 33,
      sourceAgent: "engineering-lead",
      sessionId: "pi-session-1",
      runtime: "pi",
      output: "pipeline-ok",
      isExecuted: true
    })

    const events = await loadEvidenceFor(fullExpertiseId, { evidenceRoot })
    assert.equal(events.length, 1)
    const persisted = events[0]

    assert.ok(persisted.execution_result)
    for (const field of REQUIRED_FIELDS) {
      assert.ok(field in persisted.execution_result, `missing required field: ${field}`)
    }
    assert.equal(typeof persisted.execution_result.runtime, "string")
    assert.equal(typeof persisted.execution_result.crew, "string")
    assert.equal(typeof persisted.execution_result.agent, "string")
    assert.equal(typeof persisted.execution_result.task, "string")
    assert.equal(typeof persisted.execution_result.output, "string")
    assert.equal(typeof persisted.execution_result.exitCode, "number")
    assert.equal(typeof persisted.execution_result.elapsedMs, "number")
    assert.equal(persisted.execution_result.runtime, "pi")

    if (prevRoot === undefined) delete process.env.MAH_EXPERTISE_EVIDENCE_ROOT
    else process.env.MAH_EXPERTISE_EVIDENCE_ROOT = prevRoot
  } finally {
    if (existsSync(evidenceRoot)) rmSync(evidenceRoot, { recursive: true, force: true })
  }
})

test("deriveTaskType uses canonical superset", () => {
  assert.equal(deriveTaskType("fix the bug"), "bugfix")
  assert.equal(deriveTaskType("refactor auth module"), "refactoring")
  assert.equal(deriveTaskType("add README docs"), "documentation")
  assert.equal(deriveTaskType("check security vuln"), "security")
  assert.equal(deriveTaskType("implement feature"), "implementation")
  assert.equal(deriveTaskType("something random"), "general")
})
