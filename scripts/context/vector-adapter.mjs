/**
 * Vector Retrieval Adapter
 * Provides semantic search via qmd/pvector with graceful fallback to file-based retrieval.
 * 
 * Strategy:
 * 1. Check if vector store is available (qmd binary or pvector service)
 * 2. If available: query vector store for semantic matches
 * 3. If unavailable or error: fall back to file-based lexical retrieval
 * 4. Both paths return the same RetrievalResult shape
 * 
 * @version 0.10.0
 */

import { spawnSync } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { retrieveDocuments, scoreDocument } from "./context-memory-schema.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const VECTOR_STORE_AVAILABLE = false // default off until qmd/pvector installed

// ---------------------------------------------------------------------------
// Availability checking
// ---------------------------------------------------------------------------

/**
 * Check if vector store is available.
 * @param {Object} options
 * @returns {{ available: boolean, provider: string|null, reason: string }}
 */
export function checkVectorAvailability(options = {}) {
  const qmdPath = options.qmdPath || process.env.MAH_QMD_PATH || "qmd"
  const pvectorUrl = options.pvectorUrl || process.env.MAH_PVECTOR_URL || null

  // Check for qmd binary in PATH
  if (qmdPath !== "qmd" || process.env.PATH) {
    try {
      const result = spawnSync(qmdPath, ["--version"], {
        timeout: 5000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      if (result.status === 0 || result.stdout?.includes("qmd")) {
        return { available: true, provider: "qmd", reason: "qmd binary found" }
      }
    } catch {
      // not available
    }
  }

  // If pvector URL is configured, treat adapter as available.
  // Connectivity is verified during query execution (queryPvector),
  // where failures naturally fall back to file-based retrieval.
  if (pvectorUrl) {
    return { available: true, provider: "pvector", reason: "pvector url configured" }
  }

  return { available: false, provider: null, reason: "no qmd binary or pvector service found" }
}

// ---------------------------------------------------------------------------
// Retrieval with fallback
// ---------------------------------------------------------------------------

/**
 * Retrieve documents using vector search with file-based fallback.
 * @param {Object} request - { agent, task, capability_hint, top_n, crew }
 * @param {Array} index - file-based index entries (passed through to fallback)
 * @param {Object} options - { vectorFirst: boolean, timeout_ms: number }
 * @returns {Promise<{ results: Array, provider: string, fallback: boolean, elapsed_ms: number }>}
 */
export async function retrieveWithVectorFallback(request, index, options = {}) {
  const { vectorFirst = true, timeout_ms = 8000 } = options
  const startedAt = Date.now()

  // Build a fake index object for the retrieveDocuments call
  const fakeIndex = { entries: index || [] }

  // Try vector store first if enabled
  if (vectorFirst) {
    const availability = checkVectorAvailability()
    if (availability.available) {
      try {
        let results
        if (availability.provider === "qmd") {
          results = await queryQmd(request, { timeout_ms })
        } else if (availability.provider === "pvector") {
          results = await queryPvector(request, { timeout_ms })
        }
        if (results && results.length > 0) {
          return {
            results,
            provider: availability.provider,
            fallback: false,
            elapsed_ms: Date.now() - startedAt,
          }
        }
      } catch (err) {
        // Vector query failed, fall through to fallback
      }
    }
  }

  // Fallback to file-based lexical retrieval
  const lexicalResult = retrieveDocuments(request, fakeIndex)
  const elapsed_ms = Date.now() - startedAt

  return {
    results: lexicalResult.matched_docs || [],
    provider: "file-based",
    fallback: true,
    elapsed_ms,
    confidence: lexicalResult.confidence,
    summary_blocks: lexicalResult.summary_blocks,
    tool_hints: lexicalResult.tool_hints,
    skill_hints: lexicalResult.skill_hints,
    total_candidates: lexicalResult.total_candidates,
  }
}

/**
 * Score documents using file-based lexical retrieval (synchronous).
 * Provided as a utility for cases where async vector adapter is not needed.
 * @param {Object} request
 * @param {Array} indexEntries
 * @returns {Object} - same shape as retrieveDocuments output
 */
export function scoreDocumentsLexical(request, indexEntries) {
  const fakeIndex = { entries: indexEntries || [] }
  return retrieveDocuments(request, fakeIndex)
}

// ---------------------------------------------------------------------------
// qmd query
// ---------------------------------------------------------------------------

/**
 * Query qmd for semantic matches.
 * @param {Object} request
 * @param {Object} options
 * @returns {Promise<Array>} scored results in RetrievalResult format
 */
async function queryQmd(request, options = {}) {
  const { timeout_ms = 8000, qmdPath = process.env.MAH_QMD_PATH || "qmd" } = options
  const queryText = buildQueryText(request)
  const topN = Math.max(1, Number.parseInt(String(request.top_n || 5), 10) || 5)
  const commandVariants = [
    ["query", "--json", "--limit", String(topN), queryText],
    ["query", "--json", queryText],
    ["search", "--json", "--limit", String(topN), queryText],
    ["search", "--json", queryText],
  ]

  let lastErr = null
  for (const args of commandVariants) {
    const child = spawnSync(qmdPath, args, {
      timeout: timeout_ms,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    })

    if (child.status !== 0 || !child.stdout) {
      lastErr = `args=${JSON.stringify(args)} exit=${child.status}`
      continue
    }

    try {
      const parsed = JSON.parse(child.stdout)
      const items = extractQmdResults(parsed)
      if (items.length === 0) return []
      return items.map((r, idx) => {
        const sourceFile = pickFirstString(
          r?.file,
          r?.path,
          r?.filepath,
          r?.filename,
          r?.source,
          r?.document,
          r?.metadata?.file,
          r?.metadata?.path,
          r?.metadata?.filepath,
          r?.metadata?.filename,
        )
        const resolvedId = pickFirstString(
          r?.id,
          r?.doc_id,
          r?.document_id,
          sourceFile,
        ) || `qmd-result-${idx}`
        const numericScore = typeof r.score === "number"
          ? r.score
          : (typeof r.similarity === "number" ? r.similarity : 0)
        const sim = Number.isFinite(numericScore) ? numericScore.toFixed(2) : "unknown"
        return {
          id: resolvedId,
          score: numericScore,
          metadata: {
            ...(r.metadata || {}),
            ...(sourceFile ? { file: sourceFile } : {}),
          },
          reasons: r.reasons || [`similarity:${sim}`],
        }
      })
    } catch {
      lastErr = `args=${JSON.stringify(args)} parse_failed`
    }
  }

  throw new Error(`qmd query failed: ${lastErr || "no working command variant"}`)
}

// ---------------------------------------------------------------------------
// pvector query
// ---------------------------------------------------------------------------

/**
 * Query pvector REST API for semantic matches.
 * @param {Object} request
 * @param {Object} options
 * @returns {Promise<Array>} scored results in RetrievalResult format
 */
async function queryPvector(request, options = {}) {
  const { timeout_ms = 8000, pvectorUrl = process.env.MAH_PVECTOR_URL } = options

  if (!pvectorUrl) throw new Error("pvectorUrl not set")

  const queryText = buildQueryText(request)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeout_ms)

  try {
    const topN = Math.max(1, Number.parseInt(String(request.top_n || 5), 10) || 5)
    const response = await fetch(pvectorUrl + "/query", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: queryText,
        // Keep both keys for compatibility with existing and newer bridges.
        top_n: topN,
        top_k: topN,
        filters: {
          agent: request.agent || undefined,
          crew: request.crew || undefined,
        },
      }),
    })
    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`pvector returned ${response.status}`)
    }

    const payload = await response.json()
    // pvector returns { results: [{ id, score, metadata }] }
    if (!payload.results || !Array.isArray(payload.results)) {
      return []
    }
    return payload.results.map((r) => {
      const sim = (r.score ?? r.similarity)?.toFixed(2) || "unknown"
      return {
        id: r.id || r.doc_id || `pvector-result-${Math.random()}`,
        score: typeof r.score === "number" ? r.score : (r.similarity || 0),
        metadata: r.metadata || {},
        reasons: r.reasons || [`similarity:${sim}`],
      }
    })
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Query text builder
// ---------------------------------------------------------------------------

function buildQueryText(request) {
  const parts = []
  if (request.task) parts.push(request.task)
  if (request.capability_hint) parts.push(request.capability_hint)
  return parts.join(" ")
}

function extractQmdResults(parsed) {
  if (!parsed) return []
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed.results)) return parsed.results
  if (Array.isArray(parsed.matches)) return parsed.matches
  if (parsed.data && Array.isArray(parsed.data.results)) return parsed.data.results
  if (parsed.data && Array.isArray(parsed.data.matches)) return parsed.data.matches
  return []
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("=== Vector Adapter Self-Test ===\n")

  const availability = checkVectorAvailability()
  console.log("Vector availability:", JSON.stringify(availability))

  console.log("\n=== Self-Test Complete ===")
}
