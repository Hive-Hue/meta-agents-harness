import { sanitizeTaskDescription } from "../../core/task-description.mjs";
import { normalizeExecutionResult } from "../../../types/agent-execution-result.mjs";
import { recordEvidence } from "./expertise-evidence-store.mjs";
import { randomUUID } from "node:crypto";

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
 * @param {{ passed: boolean, verifier: string, evidence: string, artifactRef?: string }} [params.verification]
 * @param {{ accepted: boolean, actor: string, evidence: string, artifactRef?: string }} [params.humanAcceptance]
 * @param {string} [params.evidenceRoot] - Explicit evidence store root, useful for isolated callers
 */
export async function recordDelegationEvidence({ crew, expertiseId, taskDescription, outcome, durationMs, sourceAgent, sessionId, isExecuted, runtime, output, verification, humanAcceptance, evidenceRoot }) {
  try {
    const sanitizedTaskDescription = sanitizeTaskDescription(taskDescription)
    const taskType = deriveTaskType(sanitizedTaskDescription)
    const effectiveRuntime = runtime || process.env.MAH_RUNTIME || "cli"
    const effectiveSessionId = sessionId || process.env.MAH_SESSION_ID || null

    const review = normalizeAssessment(verification, "passed", "verifier")
    const acceptance = normalizeAssessment(humanAcceptance, "accepted", "actor")

    const evidence = {
      id: `ev-${Date.now()}-${randomUUID().slice(0, 8)}`,
      expertise_id: `${crew}:${expertiseId}`,
      outcome,
      task_type: taskType,
      task_description: sanitizedTaskDescription,
      duration_ms: durationMs,
      quality_signals: {
        execution_succeeded: isExecuted === true ? outcome === "success" : null,
        verification_passed: review?.passed ?? null,
        human_accepted: acceptance?.accepted ?? null,
        // Keep the legacy metric field, but populate it only from an explicit,
        // attributable verification assessment. Process exit status is separate.
        review_pass: review?.passed ?? null,
        rejection_count: outcome === "failure" ? 1 : 0
      },
      ...(review ? { verification: review } : {}),
      ...(acceptance ? { human_acceptance: acceptance } : {}),
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

    await recordEvidence(evidence, { evidenceRoot })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[expertise-evidence] failed to record evidence: ${message}`)
  }
}

/**
 * Accept an assessment only when its result, actor, and evidence reference are
 * all explicit. Missing or malformed assessments remain unknown.
 * @param {unknown} value
 * @param {"passed"|"accepted"} resultKey
 * @param {"verifier"|"actor"} actorKey
 * @returns {{ passed?: boolean, accepted?: boolean, verifier?: string, actor?: string, evidence: string, artifact_ref?: string }|null}
 */
function normalizeAssessment(value, resultKey, actorKey) {
  if (!value || typeof value !== "object") return null
  const input = /** @type {Record<string, unknown>} */ (value)
  const result = input[resultKey]
  const actor = typeof input[actorKey] === "string" ? input[actorKey].trim() : ""
  const evidence = typeof input.evidence === "string" ? input.evidence.trim() : ""
  if (typeof result !== "boolean" || !actor || !evidence) return null

  const artifactRef = typeof input.artifactRef === "string" ? input.artifactRef.trim() : ""
  return {
    [resultKey]: result,
    [actorKey]: actor,
    evidence,
    ...(artifactRef ? { artifact_ref: artifactRef } : {})
  }
}
