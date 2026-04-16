import { spawnSync } from "node:child_process"
import {
  buildDelegationTask,
  firstUsefulLine,
  loadActiveContext,
  resolveDelegationTarget,
  summarizeActiveContext
} from "../lib/runtime-context.mjs"

function defaultExec(command, args, execOptions) {
  return spawnSync(command, args, execOptions)
}

export async function delegateAgentHandler(args = {}, options = {}) {
  const target = `${args?.target || ""}`.trim()
  const task = `${args?.task || ""}`.trim()
  const targetRuntime = `${args?.target_runtime || ""}`.trim()
  const includeFullOutput = args?.include_full_output === true
  const state = loadActiveContext({
    repoRoot: options.repoRoot,
    env: options.env
  })

  if (!state.ok) {
    return {
      ok: false,
      error: "No active Codex crew context could be resolved.",
      context: summarizeActiveContext(state)
    }
  }

  if (!target) {
    return {
      ok: false,
      error: "Parameter 'target' is required.",
      context: summarizeActiveContext(state)
    }
  }

  if (!task) {
    return {
      ok: false,
      error: "Parameter 'task' is required.",
      context: summarizeActiveContext(state)
    }
  }

  const resolution = resolveDelegationTarget(state, target)
  if (!resolution.ok) {
    return {
      ok: false,
      error: resolution.error,
      context: summarizeActiveContext(state)
    }
  }

  const effectiveTask = buildDelegationTask(task, resolution)
  const start = Date.now()
  const exec = options.exec || defaultExec
  const scriptPath = options.scriptPath || "scripts/meta-agents-harness.mjs"
  const result = exec(
    process.execPath,
    [
      scriptPath,
      "delegate",
      "--target",
      resolution.effectiveTarget,
      ...(targetRuntime ? ["--runtime", targetRuntime] : []),
      "--task",
      effectiveTask,
      "--execute"
    ],
    {
      cwd: state.repoRoot,
      env: {
        ...process.env,
        ...options.env,
        MAH_ACTIVE_CREW: state.crew
      },
      encoding: "utf-8"
    }
  )

  const elapsed = Date.now() - start
  const stdout = `${result?.stdout || ""}`.trim()
  const stderr = `${result?.stderr || ""}`.trim()
  const combinedOutput = [stdout, stderr].filter(Boolean).join("\n\n").trim()
  const exitCode = typeof result?.status === "number" ? result.status : 1
  const summary = firstUsefulLine(combinedOutput) || (exitCode === 0 ? "Delegation completed." : "Delegation failed.")

  return {
    ok: exitCode === 0,
    status: exitCode === 0 ? "done" : "error",
    elapsed_ms: elapsed,
    requested_target: target,
    effective_target: resolution.effectiveTarget,
    requested_target_runtime: targetRuntime || null,
    rerouted: resolution.rerouted,
    mechanism: "mah-cli-delegate-pipeline",
    summary,
    output: includeFullOutput ? combinedOutput : null,
    context: summarizeActiveContext(state)
  }
}
