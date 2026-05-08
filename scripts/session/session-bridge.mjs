/**
 * Session Bridge Module
 * @fileoverview High-level session bridge for MAH cross-runtime session transfer
 * @version 0.6.0
 */

import { injectSessionContext } from "./session-injection.mjs"
import { exportSession } from "./session-export.mjs"
import { collectSessions, parseSessionId } from "./m3-ops.mjs"
import { RUNTIME_ADAPTERS } from "../runtime/runtime-adapters.mjs"

/**
 * Bridge session from source to target runtime
 * 
 * This is a convenience operation that:
 * 1. Exports the source session
 * 2. Projects context for target runtime
 * 3. Returns explainable payload
 * 
 * @param {string} repoRoot
 * @param {string} sourceSessionId - MAH session ID (runtime:crew:sessionId)
 * @param {string} targetRuntime - Target runtime name
 * @param {object} options
 * @param {string} [options.fidelityLevel] - 'full', 'contextual', or 'summary-only'
 * @param {string} [options.targetCrew] - Target crew name
 * @param {string} [options.targetAgent] - Target agent name
 * @returns {Promise<{ ok: boolean, result?: object, explain?: string, error?: string }>}
 */
export async function bridgeSession(repoRoot, sourceSessionId, targetRuntime, options = {}) {
  const { fidelityLevel = "contextual", targetCrew, targetAgent } = options
  const runtimeRegistry = options.runtimeRegistry || RUNTIME_ADAPTERS
  
  // Parse source session ID
  const parsed = parseSessionId(sourceSessionId)
  if (!parsed) {
    return { ok: false, error: `invalid session ID format: ${sourceSessionId}` }
  }
  
  // Get source session reference
  const sessions = collectSessions(repoRoot, { runtime: parsed.runtime }, runtimeRegistry)
  const sessionRef = sessions.find(s => s.id === sourceSessionId)
  if (!sessionRef) {
    return { ok: false, error: `source session not found: ${sourceSessionId}` }
  }
  
  // Verify target runtime is valid
  const targetAdapter = runtimeRegistry[targetRuntime]
  if (!targetAdapter) {
    return { ok: false, error: `unknown target runtime: ${targetRuntime}` }
  }
  
  // Step 1: Export source session (mah-json)
  const exportResult = await exportSession(repoRoot, sourceSessionId, "mah-json", runtimeRegistry)
  if (!exportResult.ok) {
    return { ok: false, error: `export failed: ${exportResult.error}` }
  }
  
  // Step 2: Build injection payload
  const injectResult = await injectSessionContext(
    repoRoot,
    exportResult.session,
    targetRuntime,
    fidelityLevel,
    { runtimeRegistry }
  )
  if (!injectResult.ok) {
    return { ok: false, error: `injection failed: ${injectResult.error}` }
  }
  
  // Step 3: Build explainability summary
  const explain = buildBridgeExplainability(sourceSessionId, targetRuntime, injectResult)
  
  return {
    ok: true,
    result: {
      exported_to: exportResult.path,
      projected_to: injectResult.path,
      target_runtime: targetRuntime,
      target_adapter: targetAdapter.name,
      fidelity_level: injectResult.fidelity_level,
      strategy: injectResult.strategy,
      warnings: injectResult.warnings,
      target_crew: targetCrew || parsed.crew,
      target_agent: targetAgent || null
    },
    explain
  }
}

/**
 * Build human-readable explainability for bridge operation
 * @param {string} sourceSessionId
 * @param {string} targetRuntime
 * @param {object} injectResult
 * @returns {string}
 */
function buildBridgeExplainability(sourceSessionId, targetRuntime, injectResult) {
  const lines = [
    `# Session Bridge Report`,
    ``,
    `**Source:** ${sourceSessionId}`,
    `**Target:** ${targetRuntime}`,
    `**Fidelity Level:** ${injectResult.fidelity_level}`,
    `**Strategy Used:** ${injectResult.strategy}`,
    ``,
    `## Warnings`,
    ``
  ]
  
  if (injectResult.warnings.length === 0) {
    lines.push("_No warnings_")
  } else {
    for (const warning of injectResult.warnings) {
      lines.push(`⚠️ ${warning}`)
    }
  }
  
  lines.push(``)
  lines.push(`## Context Blocks Generated`)
  lines.push(`**Count:** ${injectResult.payload?.context_blocks?.length || 0}`)
  lines.push(``)
  lines.push(`## Fidelity Explanation`)
  
  if (injectResult.strategy === "full-replay") {
    lines.push(`The target runtime supports full session replay. The session can be continued directly.`)
  } else if (injectResult.strategy === "context-injection") {
    lines.push(`Context was projected from summary and artifacts. The target runtime does not support full replay.`)
    lines.push(`A new session will be started with injected context blocks.`)
  } else {
    lines.push(`Only a text summary was projected. No session continuity is preserved.`)
  }
  
  return lines.join("\n")
}
