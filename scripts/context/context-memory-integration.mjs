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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

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

/**
 * Build a context memory block for runtime bootstrap injection.
 * Returns null if context memory is not enabled or no context found.
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

  const result = retrieveDocuments(request, index)

  if (!result.matched_docs || result.matched_docs.length === 0) {
    return null
  }

  const lines = []
  lines.push("")
  lines.push("════════════════════════════════════════════════════════════")
  lines.push("OPERATIONAL CONTEXT MEMORY")
  lines.push("════════════════════════════════════════════════════════════")
  lines.push(`Agent: ${agentCtx.agentName}`)
  lines.push(`Role: ${agentCtx.agentRole}`)
  lines.push(`Task context: ${taskDescription}`)
  lines.push(`Matched: ${result.matched_docs.length} document(s) | Confidence: ${result.confidence}`)
  lines.push("────────────────────────────────────────────────────────────")

  for (const doc of result.matched_docs.slice(0, limit)) {
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

/**
 * Build a context_memory explain payload for `mah explain run`.
 * Does NOT inject into runtime — only returns diagnostic JSON.
 * @param {string[]} args - CLI args
 * @returns {{ enabled: boolean, status: string, mode?: string, limit?: number, matched_docs?: object[], summary_blocks?: string[], error_message?: string }}
 */
export function buildContextMemoryExplainPayload(args = []) {
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
    let result = retrieveDocuments({ agent: "*", task }, index)
    if (!result.matched_docs || result.matched_docs.length === 0) {
      result = retrieveDocuments({ task }, index)
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
