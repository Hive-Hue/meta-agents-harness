/**
 * MAH Context Memory Runtime Integration
 * @fileoverview Context memory injection for runtime bootstrap
 * @version 0.8.0
 */

import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  loadIndex,
  buildOperationalIndex,
  retrieveDocuments,
} from "./context-memory-schema.mjs"
import {
  MAX_RETRIEVAL_TOTAL_SIZE_BYTES,
  DEFAULT_RETRIEVAL_TOP_N,
} from "../../types/context-memory-types.mjs"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

/**
 * Determine if context memory injection is enabled.
 * @param {string[]} args - CLI args
 * @param {Object} envOverrides - Environment overrides
 * @returns {boolean}
 */
export function isContextMemoryEnabled(args = [], envOverrides = {}) {
  const envVal = envOverrides.MAH_CONTEXT_MEMORY ?? process.env.MAH_CONTEXT_MEMORY ?? "0"
  const envEnabled = envVal.trim() === "1"
  const flagEnabled = args.includes("--with-context-memory")
  return envEnabled || flagEnabled
}

/**
 * Parse context memory options from args.
 * @param {string[]} args
 * @returns {{ limit: number, mode: "summary"|"snippets" }}
 */
export function parseContextMemoryOptions(args) {
  const limitIdx = args.indexOf("--context-limit")
  const limit = limitIdx >= 0 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : DEFAULT_RETRIEVAL_TOP_N
  const modeIdx = args.indexOf("--context-mode")
  const modeRaw = modeIdx >= 0 && args[modeIdx + 1] ? args[modeIdx + 1] : "summary"
  const mode = modeRaw === "snippets" ? "snippets" : "summary"
  return { limit: Math.max(1, Math.min(10, limit)), mode }
}

function extractTaskFromArgs(args = []) {
  if (!Array.isArray(args) || args.length === 0) return ""

  const queryFlags = new Set(["-q", "--query"])
  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`
    if (!token) continue
    if (token === "--task" && args[i + 1]) {
      return `${args[i + 1] || ""}`.trim()
    }
    if (token.startsWith("--task=")) {
      return token.slice("--task=".length).trim()
    }
    if (token.startsWith("--query=")) {
      return token.slice("--query=".length).trim()
    }
    if (queryFlags.has(token) && args[i + 1]) {
      return `${args[i + 1] || ""}`.trim()
    }
  }

  const taskTokens = []
  const flagsWithValues = new Set([
    "-r", "--resume",
    "-c", "--continue",
    "-s", "--skills",
    "-m", "--model",
    "--context-limit",
    "--context-mode",
    "--crew",
    "--agent",
    "--runtime",
    "--path",
    "--capability",
  ])

  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`
    if (!token) continue
    if (token.startsWith("-")) {
      if (token.includes("=")) continue
      if (flagsWithValues.has(token) && args[i + 1] && !`${args[i + 1] || ""}`.startsWith("-")) {
        i += 1
      }
      continue
    }
    taskTokens.push(token)
  }

  return taskTokens.join(" ").trim()
}

// ---------------------------------------------------------------------------
// Core retrieval — synchronous (used by runtime injection)
// ---------------------------------------------------------------------------

/**
 * Synchronous retrieval path used by runtime-core-integrations.mjs.
 * Always uses file-based lexical retrieval (sync, no await needed).
 * For async vector retrieval, use buildContextMemoryBlockAsync.
 * 
 * @param {Object} request
 * @param {Object} index
 * @returns {Object}
 */
function retrieveLexical(request, index) {
  return retrieveDocuments(request, index)
}

// ---------------------------------------------------------------------------
// Context memory block builder (sync — for runtime bootstrap)
// ---------------------------------------------------------------------------

/**
 * Build a context memory block for runtime bootstrap injection.
 * Returns null if context memory is not enabled or no context found.
 * 
 * NOTE: This is synchronous. For async vector retrieval, use
 * buildContextMemoryBlockAsync below, which is used by the explain endpoint.
 *
 * @param {Object} agentCtx - Agent context from readHermesAgentContext
 * @param {string[]} args - CLI args (for flag detection)
 * @param {Object} envOverrides - Environment overrides
 * @returns {string|null} Formatted context block or null
 */
export function buildContextMemoryBlock(agentCtx, args = [], envOverrides = {}) {
  if (!isContextMemoryEnabled(args, envOverrides)) {
    return null
  }

  const { limit, mode } = parseContextMemoryOptions(args)

  // Load or build index
  const contextRoot = resolve(repoRoot, ".mah", "context")
  const indexPath = resolve(contextRoot, "index", "operational-context.index.json")
  let index = loadIndex(indexPath)

  if (!index || !index.entries || index.entries.length === 0) {
    buildOperationalIndex(contextRoot, { rebuild: false })
    index = loadIndex(indexPath)
  }

  if (!index || !index.entries || index.entries.length === 0) {
    return null
  }

  const mission = (agentCtx.config?.mission || "").trim()
  const sprintName = (agentCtx.config?.sprint_mode?.name || "").trim()
  const targetRelease = (agentCtx.config?.sprint_mode?.target_release || "").trim()
  const actualTask = extractTaskFromArgs(args)
  const taskDescription = actualTask || mission || sprintName || targetRelease || `general ${agentCtx.agentRole} tasks`

  const request = {
    agent: agentCtx.agentName,
    task: taskDescription,
    capability_hint: agentCtx.agentRole !== "orchestrator" ? agentCtx.agentRole : null,
    available_tools: agentCtx.tools?.length > 0 ? agentCtx.tools : null,
    available_mcp: agentCtx.config?.mcp_servers?.length > 0 ? agentCtx.config.mcp_servers : null,
  }

  // Always use lexical retrieval for sync path (runtime injection).
  // Vector adapter is used only in the async explain path.
  const result = retrieveLexical(request, index)

  if (!result.matched_docs || result.matched_docs.length === 0) {
    return null
  }

  const matchedDocs = result.matched_docs

  const lines = []
  lines.push("")
  lines.push("════════════════════════════════════════════════════════════")
  lines.push("OPERATIONAL CONTEXT MEMORY")
  lines.push("════════════════════════════════════════════════════════════")
  lines.push(`Agent: ${agentCtx.agentName}`)
  lines.push(`Role: ${agentCtx.agentRole}`)
  lines.push(`Task context: ${taskDescription}`)
  lines.push(`Matched: ${matchedDocs.length} document(s) | Confidence: ${result.confidence}`)
  lines.push("────────────────────────────────────────────────────────────")

  for (const doc of matchedDocs.slice(0, limit)) {
    const scorePct = (doc.score * 100).toFixed(0)
    lines.push("")
    lines.push(`## [${doc.id}] (${scorePct}%)`)
    lines.push(`Matched on: ${doc.reasons.join(", ")}`)
    if (mode === "snippets" && doc.entry?.headings) {
      lines.push("Sections: " + doc.entry.headings.slice(0, 3).join(" → "))
    }
  }

  if (result.tool_hints.length > 0) {
    lines.push("────────────────────────────────────────────────────────────")
    lines.push(`Tools referenced: ${result.tool_hints.join(", ")}`)
  }

  if (result.skill_hints.length > 0) {
    lines.push(`Skills referenced: ${result.skill_hints.join(", ")}`)
  }

  lines.push("────────────────────────────────────────────────────────────")
  lines.push("Note: This context is provided for reference. Use your judgment.")
  lines.push("════════════════════════════════════════════════════════════")

  const block = lines.join("\n")
  const maxSize = MAX_RETRIEVAL_TOTAL_SIZE_BYTES
  if (block.length > maxSize) {
    return block.substring(0, maxSize - 100) + "\n... [context truncated] ..."
  }

  return block
}

// ---------------------------------------------------------------------------
// Async variant for explain endpoint (supports vector retrieval)
// ---------------------------------------------------------------------------

/**
 * Async context memory block builder with optional vector retrieval.
 * Used by buildContextMemoryExplainPayload (which can await).
 * 
 * @param {Object} agentCtx
 * @param {string[]} args
 * @param {Object} envOverrides
 * @returns {Promise<string|null>}
 */
export async function buildContextMemoryBlockAsync(agentCtx, args = [], envOverrides = {}) {
  if (!isContextMemoryEnabled(args, envOverrides)) {
    return null
  }

  const { limit, mode } = parseContextMemoryOptions(args)

  const contextRoot = resolve(repoRoot, ".mah", "context")
  const indexPath = resolve(contextRoot, "index", "operational-context.index.json")
  let index = loadIndex(indexPath)

  if (!index || !index.entries || index.entries.length === 0) {
    buildOperationalIndex(contextRoot, { rebuild: false })
    index = loadIndex(indexPath)
  }

  if (!index || !index.entries || index.entries.length === 0) {
    return null
  }

  const mission = (agentCtx.config?.mission || "").trim()
  const sprintName = (agentCtx.config?.sprint_mode?.name || "").trim()
  const targetRelease = (agentCtx.config?.sprint_mode?.target_release || "").trim()
  const actualTask = extractTaskFromArgs(args)
  const taskDescription = actualTask || mission || sprintName || targetRelease || `general ${agentCtx.agentRole} tasks`

  const request = {
    agent: agentCtx.agentName,
    task: taskDescription,
    capability_hint: agentCtx.agentRole !== "orchestrator" ? agentCtx.agentRole : null,
    available_tools: agentCtx.tools?.length > 0 ? agentCtx.tools : null,
    available_mcp: agentCtx.config?.mcp_servers?.length > 0 ? agentCtx.config.mcp_servers : null,
  }

  let result
  if (process.env.MAH_VECTOR_RETRIEVAL === "1") {
    try {
      const { retrieveWithVectorFallback } = await import("./vector-adapter.mjs")
      const retrievalResult = await retrieveWithVectorFallback(
        request,
        index.entries || [],
        { vectorFirst: true, timeout_ms: 8000 }
      )
      result = {
        matched_docs: retrievalResult.results || [],
        summary_blocks: retrievalResult.summary_blocks || [],
        tool_hints: retrievalResult.tool_hints || [],
        skill_hints: retrievalResult.skill_hints || [],
        blocked_refs: [],
        confidence: retrievalResult.confidence || "low",
        retrieved_at: new Date().toISOString(),
        total_candidates: retrievalResult.total_candidates || 0,
        retrieval_provider: retrievalResult.provider,
        retrieval_fallback: retrievalResult.fallback,
        retrieval_elapsed_ms: retrievalResult.elapsed_ms,
      }
    } catch {
      result = retrieveDocuments(request, index)
    }
  } else {
    result = retrieveDocuments(request, index)
  }

  if (!result.matched_docs || result.matched_docs.length === 0) {
    return null
  }

  const matchedDocs = result.matched_docs

  const lines = []
  lines.push("")
  lines.push("════════════════════════════════════════════════════════════")
  lines.push("OPERATIONAL CONTEXT MEMORY")
  lines.push("════════════════════════════════════════════════════════════")
  lines.push(`Agent: ${agentCtx.agentName}`)
  lines.push(`Role: ${agentCtx.agentRole}`)
  lines.push(`Task context: ${taskDescription}`)
  lines.push(`Matched: ${matchedDocs.length} document(s) | Confidence: ${result.confidence}`)
  if (result.retrieval_provider) {
    lines.push(`Retrieval: ${result.retrieval_fallback ? "vector→fallback" : result.retrieval_provider} (${result.retrieval_elapsed_ms}ms)`)
  }
  lines.push("────────────────────────────────────────────────────────────")

  for (const doc of matchedDocs.slice(0, limit)) {
    const scorePct = (doc.score * 100).toFixed(0)
    lines.push("")
    lines.push(`## [${doc.id}] (${scorePct}%)`)
    lines.push(`Matched on: ${doc.reasons.join(", ")}`)
    if (mode === "snippets" && doc.entry?.headings) {
      lines.push("Sections: " + doc.entry.headings.slice(0, 3).join(" → "))
    }
  }

  if (result.tool_hints.length > 0) {
    lines.push("────────────────────────────────────────────────────────────")
    lines.push(`Tools referenced: ${result.tool_hints.join(", ")}`)
  }

  if (result.skill_hints.length > 0) {
    lines.push(`Skills referenced: ${result.skill_hints.join(", ")}`)
  }

  lines.push("────────────────────────────────────────────────────────────")
  lines.push("Note: This context is provided for reference. Use your judgment.")
  lines.push("════════════════════════════════════════════════════════════")

  const block = lines.join("\n")
  const maxSize = MAX_RETRIEVAL_TOTAL_SIZE_BYTES
  if (block.length > maxSize) {
    return block.substring(0, maxSize - 100) + "\n... [context truncated] ..."
  }

  return block
}

// ---------------------------------------------------------------------------
// Explain payload (sync — used by mah explain run)
// ---------------------------------------------------------------------------

/**
 * Build a context_memory explain payload for `mah explain run`.
 * Does NOT inject into runtime — only returns diagnostic JSON.
 * 
 * NOTE: This uses the async variant internally so it can leverage
 * vector retrieval when MAH_VECTOR_RETRIEVAL=1.
 *
 * @param {string[]} args - CLI args
 * @returns {Promise<Object>} Explain payload
 */
export async function buildContextMemoryExplainPayload(args = []) {
  const { limit, mode } = parseContextMemoryOptions(args)
  if (!isContextMemoryEnabled(args)) {
    return { enabled: false, status: "disabled", mode, limit, matched_docs: [], summary_blocks: [] }
  }
  const contextRoot = resolve(repoRoot, ".mah", "context")
  const indexPath = resolve(contextRoot, "index", "operational-context.index.json")

  let index = loadIndex(indexPath)
  if (!index || !index.entries || index.entries.length === 0) {
    try {
      buildOperationalIndex(contextRoot, { rebuild: false })
      index = loadIndex(indexPath)
    } catch {
      index = null
    }
  }

  if (!index || !index.entries || index.entries.length === 0) {
    return { enabled: true, status: "missing-corpus", mode, limit }
  }

  try {
    const task = extractTaskFromArgs(args)
    
    // Use async variant to support vector retrieval
    const mockAgentCtx = {
      agentName: "*",
      agentRole: "",
      config: {},
      tools: [],
    }
    
    let result
    if (process.env.MAH_VECTOR_RETRIEVAL === "1") {
      try {
        const { retrieveWithVectorFallback } = await import("./vector-adapter.mjs")
        const retrievalResult = await retrieveWithVectorFallback(
          { agent: "*", task },
          index.entries || [],
          { vectorFirst: true, timeout_ms: 8000 }
        )
        result = {
          matched_docs: retrievalResult.results || [],
          confidence: retrievalResult.confidence || "low",
          total_candidates: retrievalResult.total_candidates || 0,
        }
      } catch {
        result = retrieveDocuments({ agent: "*", task }, index)
        if (!result.matched_docs || result.matched_docs.length === 0) {
          result = retrieveDocuments({ task }, index)
        }
      }
    } else {
      result = retrieveDocuments({ agent: "*", task }, index)
      if (!result.matched_docs || result.matched_docs.length === 0) {
        result = retrieveDocuments({ task }, index)
      }
    }

    if (!result.matched_docs || result.matched_docs.length === 0) {
      return { enabled: true, status: "no-match", mode, limit, matched_docs: [], summary_blocks: [] }
    }

    return {
      enabled: true,
      status: "matched",
      mode,
      limit,
      matched_docs: result.matched_docs.slice(0, limit).map((doc) => ({
        id: doc.id,
        score: doc.score,
        reasons: doc.reasons || [],
      })),
      summary_blocks: (result.summary_blocks || []).slice(0, limit),
      total_candidates: result.total_candidates,
    }
  } catch (err) {
    return {
      enabled: true,
      status: "error",
      mode,
      limit,
      error_message: err?.message || String(err),
    }
  }
}