import { acquireTaskRun, finishTaskRun, normalizeTaskRuntime } from "./tasks-store.mjs"

export function sessionIdFromRun(task, payload = {}) {
  const raw = `${payload.session_id || payload.sessionId || ""}`.trim()
  if (!raw) return ""
  const runtime = normalizeTaskRuntime(task.runtime)
  const crew = `${task.crewId || "dev"}`.trim() || "dev"
  return raw.includes(":") ? raw : `${runtime}:${crew}:${raw}`
}

export async function executeTaskAttempt(repoRoot, taskId, run) {
  const task = acquireTaskRun(repoRoot, taskId)
  let runResult
  try { runResult = await run(task) } catch (error) { runResult = { ok: false, error: error.message || String(error) } }
  if (!runResult || typeof runResult !== "object") runResult = { ok: false, error: "runtime returned no result" }
  const sessionId = runResult.ok ? sessionIdFromRun(task, runResult.payload) : ""
  const finished = finishTaskRun(repoRoot, task.id, task.attemptId, { ok: runResult.ok, sessionId, error: runResult.error })
  return { ...runResult, task: finished, sessionId }
}
