import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { sanitizeTaskDescription } = require("./task-description.mjs");
import { normalizeExecutionResult } from "../types/agent-execution-result.mjs"

/**
 * Derive task type from task description keywords.
 * Canonical superset (PI's richer version).
 * @param {string} task
 * @returns {string}
 */
export function deriveTaskType(task) {
  const t = (task || "").toLowerCase()
  if (t.includes("fix") || t.includes("bug")) return "bugfix"
  if (t.includes("doc") || t.includes("readme") || t.includes("comment")) return "documentation"
  if (t.includes("security") || t.includes("vuln")) return "security"
  if (t.includes("implement") || t.includes("build") || t.includes("write") || t.includes("add") || t.includes("create")) return "implementation"
  if (t.includes("test") || t.includes("verify") || t.includes("check")) return "testing"
  if (t.includes("review") || t.includes("audit")) return "review"
  if (t.includes("refactor")) return "refactoring"
  if (t.includes("deploy") || t.includes("release")) return "deployment"
  if (t.includes("plan") || t.includes("design") || t.includes("architecture")) return "planning"
  return "general"
}

/**
 * Record delegation evidence to evidence store.
 * Shared pipeline for both CLI and PI runtimes.
 * @param {Object} params
 * @param {string} params.crew
 * @param {string} params.expertiseId
 * @param {string} params.taskDescription
 * @param {string} params.outcome
 * @param {number} params.durationMs
 * @param {string} params.sourceAgent
 * @param {string|null} [params.sessionId]
 * @param {boolean} [params.isExecuted]
 * @param {string} [params.runtime] - Runtime identifier (defaults to env or 'cli')
 * @param {string} [params.output] - Execution output for execution_result
 */
export async function recordDelegationEvidence({ crew, expertiseId, taskDescription, outcome, durationMs, sourceAgent, sessionId, isExecuted, runtime, output }) {
  try {
    const { recordEvidence } = await import("./expertise-evidence-store.mjs")
    const { randomUUID } = await import("node:crypto")
    const sanitizedTaskDescription = sanitizeTaskDescription(taskDescription)
    const taskType = deriveTaskType(sanitizedTaskDescription)
    const effectiveRuntime = runtime || process.env.MAH_RUNTIME || "cli"
    const effectiveSessionId = sessionId || process.env.MAH_SESSION_ID || null

    const evidence = {
      id: `ev-${Date.now()}-${randomUUID().slice(0, 8)}`,
      expertise_id: `${crew}:${expertiseId}`,
      outcome,
      task_type: taskType,
      task_description: sanitizedTaskDescription,
      duration_ms: durationMs,
      quality_signals: {
        review_pass: outcome === "success" && isExecuted ? true : undefined,
        rejection_count: outcome === "failure" ? 1 : 0
      },
      source_agent: sourceAgent,
      source_session: effectiveSessionId || "unknown",
      recorded_at: new Date().toISOString()
    }

    evidence.execution_result = normalizeExecutionResult({
      runtime: effectiveRuntime,
      crew,
      agent: expertiseId,
      task: taskDescription,
      output: output || outcome,
      exitCode: outcome === "success" ? 0 : 1,
      elapsedMs: durationMs,
      sessionId: effectiveSessionId
    })

    await recordEvidence(evidence)
  } catch (err) {
    console.error(`[expertise-evidence] failed to record evidence: ${err.message}`)
  }
}
