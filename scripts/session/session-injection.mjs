/**
 * Session Injection Module
 * @fileoverview Context projection for MAH cross-runtime session interoperability
 * @version 0.6.0
 */

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { RUNTIME_ADAPTERS } from "../runtime/runtime-adapters.mjs"
import {
  FIDELITY_LEVELS,
  DEFAULT_FIDELITY_LEVEL
} from "../../types/session-types.mjs"

const MAH_SESSIONS_DIR = process.env.MAH_SESSIONS_DIR || ".mah/sessions"
const PROJECTIONS_DIR = "projections"

/**
 * Determine the injection strategy based on fidelity level and target runtime capabilities
 * @param {"full"|"contextual"|"summary-only"} fidelityLevel
 * @param {string} targetRuntime
 * @param {object} targetAdapter
 * @returns {{ strategy: string, warnings: string[] }}
 */
export function determineInjectionStrategy(fidelityLevel, targetRuntime, targetAdapter) {
  const warnings = []
  let strategy = "context-injection"
  
  if (fidelityLevel === "full") {
    if (targetAdapter?.capabilities?.supportsFullReplay) {
      strategy = "full-replay"
    } else {
      warnings.push(`Target runtime '${targetRuntime}' does not support full replay. Falling back to 'contextual'.`)
      fidelityLevel = "contextual"
      strategy = "context-injection"
    }
  }
  
  if (fidelityLevel === "summary-only") {
    strategy = "summary-only"
  }
  
  // Warn about cross-runtime limitations
  if (fidelityLevel === "contextual") {
    warnings.push("Context injection reconstructs session context from summary and artifacts.")
    warnings.push("Full transcript replay is NOT guaranteed across runtimes.")
  }
  
  return { strategy, warnings }
}

/**
 * Build context blocks from MahSession for injection
 * @param {MahSession} session
 * @param {"full"|"contextual"|"summary-only"} fidelityLevel
 * @returns {ContextBlock[]}
 */
export function buildContextBlocks(session, fidelityLevel) {
  const blocks = []
  
  // System context block with session provenance
  blocks.push({
    type: "system",
    content: `[Session Context]
MAH Session ID: ${session.mah_session_id}
Source Runtime: ${session.runtime}
Crew: ${session.crew}
Agent: ${session.agent || "unknown"}
Created: ${session.created_at}
Last Active: ${session.last_active_at}

--- Proceeding with ${fidelityLevel} fidelity level ---`,
    role: "system",
    timestamp: new Date().toISOString()
  })
  
  if (fidelityLevel === "summary-only") {
    // Just the summary as a user block
    blocks.push({
      type: "user",
      content: `[Prior Session Summary]
${session.summary}`,
      role: "user",
      timestamp: new Date().toISOString()
    })
    return blocks
  }
  
  // Contextual level: include summary and artifacts info
  blocks.push({
    type: "user",
    content: `[Prior Session Summary]
${session.summary}

[Session Artifacts]
${session.artifacts.length > 0 
  ? session.artifacts.map(a => `- ${a.type}: ${a.path}`).join("\n")
  : "_No artifacts recorded_"}`,
    role: "user",
    timestamp: new Date().toISOString()
  })
  
  // Add provenance as metadata block
  if (session.provenance.length > 0) {
    blocks.push({
      type: "metadata",
      content: `[Session Provenance]
${session.provenance.map(p => `- ${p.event}: ${p.timestamp}`).join("\n")}`,
      timestamp: new Date().toISOString()
    })
  }
  
  return blocks
}

/**
 * Build injection payload for target runtime
 * @param {string} repoRoot
 * @param {MahSession} sourceSession
 * @param {string} targetRuntime
 * @param {"full"|"contextual"|"summary-only"} fidelityLevel
 * @param {object} options
 * @returns {Promise<InjectionPayload>}
 */
export async function buildInjectionPayload(
  repoRoot,
  sourceSession,
  targetRuntime,
  fidelityLevel = DEFAULT_FIDELITY_LEVEL,
  options = {}
) {
  const runtimeRegistry = options.runtimeRegistry || RUNTIME_ADAPTERS
  const targetAdapter = runtimeRegistry[targetRuntime]
  
  if (!targetAdapter) {
    throw new Error(`Unknown target runtime: ${targetRuntime}`)
  }
  
  const { strategy, warnings } = determineInjectionStrategy(fidelityLevel, targetRuntime, targetAdapter)
  const contextBlocks = buildContextBlocks(sourceSession, fidelityLevel)
  
  const payload = {
    target_runtime: targetRuntime,
    source_session: sourceSession,
    fidelity_level: fidelityLevel,
    strategy,
    warnings,
    context_blocks: contextBlocks,
    generated_at: new Date().toISOString()
  }
  
  return payload
}

/**
 * Save injection projection to disk
 * @param {string} repoRoot
 * @param {InjectionPayload} payload
 * @returns {{ ok: boolean, path?: string, error?: string }}
 */
export function saveProjection(repoRoot, payload) {
  try {
    const projectionsPath = path.join(repoRoot, MAH_SESSIONS_DIR, PROJECTIONS_DIR, payload.target_runtime)
    mkdirSync(projectionsPath, { recursive: true })
    
    const filename = `${payload.source_session.mah_session_id.replace(/:/g, "_")}_to_${payload.target_runtime}.projection.json`
    const outputFile = path.join(projectionsPath, filename)
    
    writeFileSync(outputFile, JSON.stringify(payload, null, 2), "utf-8")
    return { ok: true, path: outputFile }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * Inject session context into target runtime (high-level operation)
 * @param {string} repoRoot
 * @param {MahSession} sourceSession
 * @param {string} targetRuntime
 * @param {"full"|"contextual"|"summary-only"} fidelityLevel
 * @param {object} options
 * @returns {Promise<{ ok: boolean, payload?: InjectionPayload, path?: string, error?: string }>}
 */
export async function injectSessionContext(
  repoRoot,
  sourceSession,
  targetRuntime,
  fidelityLevel = DEFAULT_FIDELITY_LEVEL,
  options = {}
) {
  try {
    const payload = await buildInjectionPayload(repoRoot, sourceSession, targetRuntime, fidelityLevel, options)
    const saveResult = saveProjection(repoRoot, payload)
    
    return {
      ok: true,
      payload,
      path: saveResult.path,
      strategy: payload.strategy,
      fidelity_level: payload.fidelity_level,
      warnings: payload.warnings
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}
