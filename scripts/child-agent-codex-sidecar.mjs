/**
 * Codex Sidecar Adapter — v0.6.0 (Slice 3)
 *
 * First cross-runtime sidecar adapter for child agent spawning.
 * Spawns child agents in Codex via `codex exec --full-auto "<prompt>"`.
 *
 * Uses codex exec --full-auto for non-interactive execution.
 * sourceRuntime="*" means this adapter works regardless of the parent's runtime.
 */

import { SPAWN_MODES, validateChildAgentAdapter } from "./child-agent-adapter-contract.mjs"

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

/** @type {import('./child-agent-adapter-contract.mjs').ChildAgentAdapter} */
export const codexSidecarAdapter = {
  name: "codex-sidecar",
  sourceRuntime: "*",    // works from any source runtime
  targetRuntime: "codex",

  /**
   * Whether this adapter can handle a spawn for the given context.
   * Supports cross-runtime sidecar when targeting Codex runtime or
   * when the logical target looks like a dev/reviewer worker.
   *
   * @param {import('./child-agent-adapter-contract.mjs').SpawnSupportContext} ctx
   * @returns {boolean}
   */
  supportsSpawn(ctx) {
    // Must be targeting codex
    if (ctx.targetRuntime !== "codex") return false

    // Primary: cross-runtime from non-codex to codex
    if (ctx.sourceRuntime && ctx.sourceRuntime !== "codex") {
      return true
    }
    // Same-runtime codex → codex is NOT a sidecar concern
    if (ctx.sourceRuntime === "codex") {
      return false
    }
    // Fallback: if no source runtime specified, accept
    return true
  },

  /**
   * Lists the spawn modes this adapter supports.
   *
   * @param {import('./child-agent-adapter-contract.mjs').SpawnSupportContext} _ctx
   * @returns {import('./child-agent-adapter-contract.mjs').SpawnMode[]}
   */
  listSpawnModes(_ctx) {
    return [SPAWN_MODES.CROSS_RUNTIME_SIDECAR]
  },

  /**
   * Prepares the execution plan for a Codex sidecar spawn.
   * This is side-effect free — no process is created.
   *
   * Builds: `codex exec --cd <repo> --full-auto "<prompt>"`
   *
   * @param {import('./child-agent-adapter-contract.mjs').SpawnContext} ctx
   * @returns {import('./child-agent-adapter-contract.mjs').SpawnPlanResult}
   */
  prepareSpawn(ctx) {
    const repoRoot = ctx.repoRoot || process.cwd()

    // Build prompt: include crew context and task
    const prompt = `[Crew: ${ctx.crew}] [Agent: ${ctx.effectiveLogicalTarget}] Task: ${ctx.task}`

    return {
      ok: true,
      mode: SPAWN_MODES.CROSS_RUNTIME_SIDECAR,
      exec: "codex",
      args: ["exec", "--cd", repoRoot, "--full-auto", prompt],
      envOverrides: {
        MAH_ACTIVE_CREW: ctx.crew
      },
      warnings: ["Codex sidecar runs non-interactively via codex exec --full-auto"]
    }
  }
}

// ---------------------------------------------------------------------------
// Self-validation at module load time
// ---------------------------------------------------------------------------

const _validation = validateChildAgentAdapter(codexSidecarAdapter)
if (!_validation.ok) {
  console.error("[child-agent-codex-sidecar] adapter validation failed:", _validation.errors)
}
