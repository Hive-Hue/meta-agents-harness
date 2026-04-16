/**
 * Native Runtime Adapter — v0.6.0
 *
 * Handles same-runtime child agent delegation by invoking the MAH CLI
 * against the target runtime and logical target agent.
 */

import { SPAWN_MODES, validateChildAgentAdapter } from "./child-agent-adapter-contract.mjs"

/** @type {import('./child-agent-adapter-contract.mjs').ChildAgentAdapter} */
export const nativeRuntimeAdapter = {
  name: "native-runtime",
  sourceRuntime: "*",
  targetRuntime: "*",

  /**
   * Supports only same-runtime delegation.
   *
   * @param {import('./child-agent-adapter-contract.mjs').SpawnSupportContext} ctx
   * @returns {boolean}
   */
  supportsSpawn(ctx) {
    if (!ctx.sourceRuntime || !ctx.targetRuntime) return false
    return ctx.sourceRuntime === ctx.targetRuntime
  },

  /**
   * @param {import('./child-agent-adapter-contract.mjs').SpawnSupportContext} _ctx
   * @returns {import('./child-agent-adapter-contract.mjs').SpawnMode[]}
   */
  listSpawnModes(_ctx) {
    return [SPAWN_MODES.NATIVE_SAME_RUNTIME]
  },

  /**
   * Prepare same-runtime MAH CLI execution plan.
   *
   * @param {import('./child-agent-adapter-contract.mjs').SpawnContext} ctx
   * @returns {import('./child-agent-adapter-contract.mjs').SpawnPlanResult}
   */
  prepareSpawn(ctx) {
    if (!ctx.targetRuntime) {
      return {
        ok: false,
        mode: SPAWN_MODES.NATIVE_SAME_RUNTIME,
        exec: "",
        args: [],
        envOverrides: {},
        warnings: [],
        error: "target runtime is required for native runtime delegation"
      }
    }

    const scriptPath = "scripts/meta-agents-harness.mjs"
    const envOverrides = {
      MAH_ACTIVE_CREW: ctx.crew,
      MAH_AGENT: ctx.effectiveLogicalTarget
    }

    if (ctx.targetRuntime === "codex") {
      envOverrides.MAH_CODEX_AUTONOMOUS = "1"
    }

    return {
      ok: true,
      mode: SPAWN_MODES.NATIVE_SAME_RUNTIME,
      exec: process.execPath,
      args: [
        scriptPath,
        "run",
        "--runtime",
        ctx.targetRuntime,
        "--agent",
        ctx.effectiveLogicalTarget,
        ctx.task
      ],
      envOverrides,
      warnings: []
    }
  }
}

const _validation = validateChildAgentAdapter(nativeRuntimeAdapter)
if (!_validation.ok) {
  console.error("[child-agent-native-runtime] adapter validation failed:", _validation.errors)
}

