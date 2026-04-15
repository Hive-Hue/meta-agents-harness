/**
 * Child Agent Spawn Strategy — v0.6.0 (Slice 2)
 *
 * Strategy layer that combines logical delegation resolution with
 * operational spawn planning. This module is the central orchestrator
 * for cross-runtime child agent spawning.
 *
 * Invariant: resolveDelegationTarget() is ALWAYS called before any
 * spawn preparation. Authorization is never bypassed.
 */

import { SPAWN_MODES } from "./child-agent-adapter-contract.mjs"
import { resolveDelegationTarget } from "./delegation-resolution.mjs"

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

/** @type {import('./child-agent-adapter-contract.mjs').ChildAgentAdapter[]} */
const registeredAdapters = []

/**
 * Register a child agent adapter.
 *
 * @param {import('./child-agent-adapter-contract.mjs').ChildAgentAdapter} adapter
 */
export function registerChildAgentAdapter(adapter) {
  registeredAdapters.push(adapter)
}

/**
 * Returns a shallow copy of currently registered adapters.
 *
 * @returns {import('./child-agent-adapter-contract.mjs').ChildAgentAdapter[]}
 */
export function getRegisteredAdapters() {
  return [...registeredAdapters]
}

/**
 * Clear all registered adapters (useful for testing).
 */
export function clearAdapters() {
  registeredAdapters.length = 0
}

// ---------------------------------------------------------------------------
// Spawn mode determination
// ---------------------------------------------------------------------------

/**
 * Determine spawn mode based on source vs target runtime.
 *
 * @param {string} sourceRuntime - Runtime of the parent agent
 * @param {string} targetRuntime - Runtime where the child will execute
 * @returns {import('./child-agent-adapter-contract.mjs').SpawnMode}
 */
export function determineSpawnMode(sourceRuntime, targetRuntime) {
  if (sourceRuntime === targetRuntime) {
    return SPAWN_MODES.NATIVE_SAME_RUNTIME
  }
  return SPAWN_MODES.CROSS_RUNTIME_SIDECAR
}

// ---------------------------------------------------------------------------
// Adapter selection
// ---------------------------------------------------------------------------

/**
 * Select the best adapter for a given spawn support context.
 * Iterates registered adapters and returns the first match.
 *
 * @param {import('./child-agent-adapter-contract.mjs').SpawnSupportContext} ctx
 * @returns {import('./child-agent-adapter-contract.mjs').ChildAgentAdapter|null}
 */
export function selectAdapter(ctx) {
  for (const adapter of registeredAdapters) {
    // Check sourceRuntime compatibility
    const sourceMatch = adapter.sourceRuntime === "*" || adapter.sourceRuntime === ctx.sourceRuntime
    if (!sourceMatch) continue

    // NEW: Check targetRuntime compatibility
    const targetMatch = adapter.targetRuntime === ctx.targetRuntime
    if (!targetMatch) continue

    // Check if adapter supports this spawn
    if (adapter.supportsSpawn(ctx)) {
      return adapter
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Spawn context building
// ---------------------------------------------------------------------------

/**
 * Build full SpawnContext by combining delegation resolution with runtime info.
 *
 * This is the primary entry point for the strategy layer. It:
 *   1. Resolves logical delegation (authorization)
 *   2. Determines spawn mode (operational)
 *   3. Returns a complete SpawnContext ready for adapter selection
 *
 * @param {Object} params
 * @param {string} params.crew          - Crew identifier
 * @param {string} params.sourceAgent   - Delegator agent id
 * @param {string} params.sourceRuntime - Runtime of the delegator
 * @param {string} params.targetRuntime - Runtime where child will execute
 * @param {string} params.logicalTarget - Requested target agent
 * @param {string} params.task          - Task description
 * @param {string} [params.repoRoot]    - Repository root
 * @returns {{ ok: boolean, context?: import('./child-agent-adapter-contract.mjs').SpawnContext, resolution?: Object, warnings?: string[], error?: string }}
 */
export function buildSpawnContext({ crew, sourceAgent, sourceRuntime, targetRuntime, logicalTarget, task, repoRoot }) {
  // Step 1: Resolve logical delegation — MUST be called before any spawn prep
  const resolution = resolveDelegationTarget({
    crew,
    sourceAgent,
    sourceRuntime,
    logicalTarget,
    repoRoot
  })

  if (!resolution.ok) {
    return { ok: false, error: resolution.error }
  }

  // Step 2: Determine spawn mode
  const mode = determineSpawnMode(sourceRuntime, targetRuntime)

  // Step 3: Build complete spawn context
  /** @type {import('./child-agent-adapter-contract.mjs').SpawnContext} */
  const context = {
    crew,
    sourceRuntime,
    targetRuntime,
    sourceAgent,
    logicalTarget,
    effectiveLogicalTarget: resolution.effectiveTarget,
    task,
    mode
  }

  return {
    ok: true,
    context,
    resolution,
    warnings: resolution.rerouted
      ? [`logical target was rerouted from '${logicalTarget}' to '${resolution.effectiveTarget}'`]
      : []
  }
}

// ---------------------------------------------------------------------------
// Full spawn plan
// ---------------------------------------------------------------------------

/**
 * Execute the full delegation → spawn pipeline:
 *   1. Resolve delegation (authorization)
 *   2. Build spawn context
 *   3. Select adapter
 *   4. Prepare spawn plan
 *
 * @param {Object} params
 * @param {string} params.crew
 * @param {string} params.sourceAgent
 * @param {string} params.sourceRuntime
 * @param {string} params.targetRuntime
 * @param {string} params.logicalTarget
 * @param {string} params.task
 * @param {string} [params.repoRoot]
 * @returns {{ ok: boolean, plan?: import('./child-agent-adapter-contract.mjs').SpawnPlanResult, context?: import('./child-agent-adapter-contract.mjs').SpawnContext, adapter?: string, warnings?: string[], error?: string }}
 */
export function prepareChildSpawn({ crew, sourceAgent, sourceRuntime, targetRuntime, logicalTarget, task, repoRoot }) {
  // Step 1-2: Build spawn context (includes delegation resolution)
  const built = buildSpawnContext({ crew, sourceAgent, sourceRuntime, targetRuntime, logicalTarget, task, repoRoot })
  if (!built.ok) {
    return { ok: false, error: built.error }
  }

  const { context, warnings: buildWarnings } = built

  // Step 3: Select adapter
  const adapter = selectAdapter({
    crew: context.crew,
    sourceRuntime: context.sourceRuntime,
    targetRuntime: context.targetRuntime,
    sourceAgent: context.sourceAgent,
    logicalTarget: context.effectiveLogicalTarget
  })

  if (!adapter) {
    return {
      ok: false,
      context,
      error: `no child agent adapter found for source='${sourceRuntime}' target='${targetRuntime}' logicalTarget='${logicalTarget}'`
    }
  }

  // Step 4: Prepare spawn plan via adapter
  const plan = adapter.prepareSpawn(context)
  if (!plan.ok) {
    return {
      ok: false,
      context,
      adapter: adapter.name,
      error: plan.error || `adapter '${adapter.name}' returned ok=false with no error message`
    }
  }

  // Merge warnings, deduplicating by string value
  const allWarnings = [...(buildWarnings || [])]
  for (const w of (plan.warnings || [])) {
    if (!allWarnings.includes(w)) allWarnings.push(w)
  }

  return {
    ok: true,
    plan,
    context,
    adapter: adapter.name,
    warnings: allWarnings
  }
}

// ---------------------------------------------------------------------------
// Explainability
// ---------------------------------------------------------------------------

/**
 * Produce an explainability summary for a delegation+spawn resolution.
 * Returns a human-readable breakdown of the full pipeline result.
 *
 * @param {ReturnType<typeof prepareChildSpawn>} result - Result from prepareChildSpawn
 * @returns {string}
 */
export function explainChildSpawn(result) {
  const lines = []
  lines.push("=== Child Agent Spawn Explanation ===")

  if (!result.ok) {
    lines.push(`Status: BLOCKED`)
    lines.push(`Error: ${result.error}`)
    return lines.join("\n")
  }

  const ctx = result.context
  const plan = result.plan

  lines.push(`Status: OK`)
  lines.push(``)
  lines.push(`--- Logical Resolution ---`)
  lines.push(`  Crew:              ${ctx.crew}`)
  lines.push(`  Source Agent:      ${ctx.sourceAgent}`)
  lines.push(`  Requested Target:  ${ctx.logicalTarget}`)
  lines.push(`  Effective Target:  ${ctx.effectiveLogicalTarget}`)
  lines.push(`  Rerouted:          ${ctx.logicalTarget !== ctx.effectiveLogicalTarget ? "yes" : "no"}`)
  lines.push(``)
  lines.push(`--- Operational Resolution ---`)
  lines.push(`  Source Runtime:    ${ctx.sourceRuntime}`)
  lines.push(`  Target Runtime:    ${ctx.targetRuntime}`)
  lines.push(`  Spawn Mode:        ${ctx.mode}`)
  lines.push(`  Adapter:           ${result.adapter}`)
  lines.push(``)
  lines.push(`--- Execution Plan ---`)
  lines.push(`  Exec:              ${plan.exec}`)
  lines.push(`  Args:              ${plan.args.join(" ")}`)
  lines.push(`  Env Overrides:     ${Object.keys(plan.envOverrides).length > 0 ? Object.entries(plan.envOverrides).map(([k, v]) => `${k}=${v}`).join(", ") : "(none)"}`)

  if (result.warnings?.length) {
    lines.push(``)
    lines.push(`--- Warnings ---`)
    for (const w of result.warnings) {
      lines.push(`  ⚠ ${w}`)
    }
  }

  return lines.join("\n")
}
