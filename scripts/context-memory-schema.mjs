/**
 * MAH Context Memory Schema Utilities
 * @fileoverview Parsing, ID derivation, hashing, and corpus walking utilities
 * @version 0.8.0
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname } from "node:path"
import { join, relative, extname, basename, resolve } from "path"
import { createHash } from "crypto"
import YAML from "yaml"
import {
  CONTEXT_MEMORY_INDEX_VERSION,
} from "../types/context-memory-types.mjs"

// Module-level path computation
const __schemaFilename = fileURLToPath(import.meta.url)
const __schemaDir = dirname(__schemaFilename)
const REPO_ROOT = resolve(__schemaDir, "..")

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse YAML-like frontmatter from markdown content.
 * Supports simple key: value pairs and multi-line values.
 * @param {string} content - Raw file content
 * @returns {{ frontmatter: Object, body: string } | { error: string }}
 */
export function parseFrontmatter(content) {
  // Strip leading newline if present
  const trimmed = content.replace(/^\r?\n/, "")
  if (!trimmed.startsWith("---")) {
    return { error: "no frontmatter delimiter found" }
  }
  const afterFirst = trimmed.slice(3)
  const endIdx = afterFirst.indexOf("---")
  if (endIdx < 0) {
    return { error: "frontmatter closing delimiter not found" }
  }
  const yamlContent = afterFirst.slice(0, endIdx).trim()
  const body = afterFirst.slice(endIdx + 3).trim()
  let frontmatter = {}
  try {
    frontmatter = YAML.parse(yamlContent) || {}
  } catch (e) {
    return { error: "YAML parse error: " + e.message }
  }
  return { frontmatter, body }
}

/**
 * Parse a context memory file and extract frontmatter + body.
 * @param {string} filePath - Absolute path to file
 * @returns {{ frontmatter: Object, body: string, filePath: string } | { error: string }}
 */
export function parseContextFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8")
    const result = parseFrontmatter(content)
    if (result.error) {
      return { error: result.error }
    }
    return { ...result, filePath }
  } catch (err) {
    return { error: "Failed to read file: " + err.message }
  }
}

// ---------------------------------------------------------------------------
// ID derivation
// ---------------------------------------------------------------------------

/**
 * Derive a context memory document ID from a relative file path.
 * Strips operational/ prefix and file extension.
 * @param {string} relativePath - Path relative to .mah/context/
 * @returns {string} Derived document ID (e.g., "dev/planning/backlog-triage")
 */
export function deriveDocId(relativePath) {
  let p = relativePath
  // Strip operational/ prefix for canonical context corpus
  p = p.replace(/^operational\//, "")
  // Strip tests/fixtures/context-memory/ prefix for fixture files
  p = p.replace(/^tests\/fixtures\/context-memory\//, "")
  // Remove file extension
  const ext = extname(p)
  p = ext ? p.slice(0, -ext.length) : p
  // Normalize path separators
  p = p.replace(/[\\/]+/g, "/")
  return p
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hash of a file's contents.
 * @param {string} filePath - Absolute path to file
 * @returns {string} SHA-256 hex digest (64 characters)
 */
export function computeFileHash(filePath) {
  const content = readFileSync(filePath)
  return createHash("sha256").update(content).digest("hex")
}

// ---------------------------------------------------------------------------
// Corpus walking
// ---------------------------------------------------------------------------

/**
 * Recursively walk a context corpus directory and return all .md and .qmd files.
 * @param {string} rootPath - Root directory to walk
 * @returns {string[]} Array of absolute file paths
 */
export function walkContextCorpus(rootPath) {
  /** @type {string[]} */
  const results = []

  if (!existsSync(rootPath)) {
    return results
  }

  function walk(dir) {
    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        const fullPath = join(dir, entry)
        try {
          const stat = statSync(fullPath)
          if (stat.isDirectory()) {
            // Skip hidden directories and non-context dirs
            if (!entry.startsWith(".") && entry !== "node_modules") {
              walk(fullPath)
            }
          } else if (stat.isFile()) {
            const ext = extname(entry).toLowerCase()
            if (ext === ".md" || ext === ".qmd") {
              results.push(fullPath)
            }
          }
        } catch {
          // Skip files we can't stat
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  walk(rootPath)
  return results
}

// ---------------------------------------------------------------------------
// Index entry building
// ---------------------------------------------------------------------------

/**
 * Build a ContextMemoryIndexEntry from a parsed file.
 * @param {{ frontmatter: Object, body: string, filePath: string }} parsedFile
 * @param {string} hash - SHA-256 file hash
 * @param {number} mtime - File modification timestamp (ms)
 * @returns {Object} ContextMemoryIndexEntry
 */
export function buildIndexEntry(parsedFile, hash, mtime) {
  const { frontmatter, body, filePath } = parsedFile

  // Count headings (# syntax)
  const headingMatches = body.match(/^#{1,6}\s+.+$/gm) || []
  const headingCount = headingMatches.length
  const headings = headingMatches.map(h => h.replace(/^#+\s+/, ""))

  // Estimate snippet count (paragraphs separated by blank lines)
  const snippets = body.split(/\n\s*\n/).filter(s => s.trim().length > 0)
  const snippetCount = snippets.length

  // Extract tags from frontmatter or headings
  /** @type {string[]} */
  const tags = []
  if (Array.isArray(frontmatter.tags)) {
    tags.push(...frontmatter.tags)
  }
  if (Array.isArray(frontmatter.capabilities)) {
    tags.push(...frontmatter.capabilities)
  }
  if (Array.isArray(frontmatter.domains)) {
    tags.push(...frontmatter.domains)
  }

  // Build metadata summary
  const metadata_summary = {
    kind: frontmatter.kind || "operational-memory",
    crew: frontmatter.crew,
    agent: frontmatter.agent,
    capabilities: frontmatter.capabilities || [],
    domains: frontmatter.domains || [],
    systems: frontmatter.systems || [],
    skills: frontmatter.skills || [],
    tools: frontmatter.tools || [],
    task_patterns: frontmatter.task_patterns || [],
    stability: frontmatter.stability,
    priority: frontmatter.priority,
  }

  // Derive ID from file path
  const relPath = relative(".mah/context", filePath)
  const id = deriveDocId(relPath)

  return {
    id,
    file_path: filePath,
    hash,
    mtime,
    metadata_summary,
    snippet_count: snippetCount,
    heading_count: headingCount,
    headings: headingCount > 0 ? headings : undefined,
    tags: tags.length > 0 ? [...new Set(tags)] : undefined,
  }
}



// ---------------------------------------------------------------------------
// Index persistence
// ---------------------------------------------------------------------------

/**
 * Load an existing index from disk.
 * @param {string} indexPath - Path to the index JSON file
 * @returns {Object|null} Loaded index or null if not found/error
 */
export function loadIndex(indexPath) {
  try {
    if (!existsSync(indexPath)) {
      return null
    }
    const content = readFileSync(indexPath, "utf-8")
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Save an index to disk.
 * @param {string} indexPath - Path to save the index JSON file
 * @param {Object} index - Index object to save
 */
export function saveIndex(indexPath, index) {
  const content = JSON.stringify(index, null, 2)
  writeFileSync(indexPath, content, "utf-8")
}

// ---------------------------------------------------------------------------
// Index building
// ---------------------------------------------------------------------------

/**
 * Build the full operational context index.
 * @param {string} rootPath - Path to .mah/context/ directory
 * @param {{ rebuild?: boolean }} [options]
 * @returns {{ total_documents: number, new: number, updated: number, removed: number, errors: string[], entries: Object[] }}
 */

/**
 * Build a merged index from multiple directories.
 * @param {string[]} dirs - Array of directory paths to index
 * @param {string} rootPath - Context root for relative paths
 * @returns {Object[]} Array of index entries
 */
export function buildIndexFromDirs(dirs, rootPath) {
  const entries = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const files = walkContextCorpus(dir)
    for (const file of files) {
      try {
        const rel = relative(rootPath, file)
        const hash = computeFileHash(file)
        const mtime = statSync(file).mtimeMs
        const parsed = parseContextFile(file)
        if (parsed.error) continue
        const entry = buildIndexEntry(parsed, hash, mtime)
        const id = parsed.frontmatter?.id || deriveDocId(rel)
        if (!id) continue
        entry.id = id
        entry.file_path = rel
        entries.push(entry)
      } catch {}
    }
  }
  return entries
}

/**
 * Build the full operational context index.
 * Indexes the committed operational corpus only.
 * @param {string} rootPath - Path to .mah/context/ directory
 * @param {{ rebuild?: boolean }} [options]
 * @returns {{ total_documents: number, new: number, updated: number, removed: number, errors: string[] }}
 */
export function buildOperationalIndex(rootPath, options = {}) {
  const { rebuild = false } = options
  const operationalDir = join(rootPath, "operational")
  const indexPath = join(rootPath, "index", "operational-context.index.json")

  // Load existing index for incremental mode
  let existingEntries = {}
  if (!rebuild) {
    const existing = loadIndex(indexPath)
    if (existing && existing.entries) {
      for (const entry of existing.entries) {
        existingEntries[entry.id] = entry
      }
    }
  }

  // Build from operational corpus only. Fixtures remain validation-only.
  const dirs = [operationalDir]

  const newEntriesMap = {}
  const errors = []

  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const files = walkContextCorpus(dir)
    for (const file of files) {
      try {
        const rel = relative(rootPath, file)
        const hash = computeFileHash(file)
        const mtime = statSync(file).mtimeMs

        const parsed = parseContextFile(file)
        if (parsed.error) {
          errors.push(file + ": " + parsed.error)
          continue
        }

        const id = parsed.frontmatter?.id || deriveDocId(rel)
        if (!id) continue

        // Check if unchanged
        const existingEntry = existingEntries[id]
        if (!rebuild && existingEntry && existingEntry.hash === hash && existingEntry.mtime === mtime) {
          newEntriesMap[id] = existingEntry
          delete existingEntries[id]
          continue
        }

        const entry = buildIndexEntry(parsed, hash, mtime)
        entry.id = id
        entry.file_path = rel
        newEntriesMap[id] = entry
      } catch (e) {
        errors.push(file + ": " + e.message)
      }
    }
  }

  const newEntries = Object.values(newEntriesMap)
  const removed = Object.keys(existingEntries).length

  // Count new vs updated
  let newCount = 0, updatedCount = 0
  const existingIds = new Set(Object.keys(existingEntries))
  for (const entry of newEntries) {
    if (existingIds.has(entry.id)) updatedCount++
    else newCount++
  }

  const index = {
    schema_version: "mah.context-memory.index.v1",
    generated_at: new Date().toISOString(),
    context_root: rootPath,
    total_documents: newEntries.length,
    entries: newEntries,
  }

  saveIndex(indexPath, index)

  return { total_documents: newEntries.length, new: newCount, updated: updatedCount, removed, errors, entries: newEntries }
}



// ---------------------------------------------------------------------------
// Retrieval engine
// ---------------------------------------------------------------------------

/**
 * Score a single document against a retrieval request.
 * Lexical + metadata scoring, no embeddings.
 * @param {Object} indexEntry - ContextMemoryIndexEntry
 * @param {Object} request - ContextMemoryRetrievalRequest
 * @returns {{ score: number, reasons: string[], matchedCapabilities: string[], matchedTools: string[], matchedSystems: string[] }}
 */
export function scoreDocument(indexEntry, request) {
  const reasons = []
  let score = 0
  const ms = indexEntry.metadata_summary || {}
  const tags = indexEntry.tags || []
  const headings = indexEntry.headings || []
  const taskPatterns = Array.isArray(ms.task_patterns) ? ms.task_patterns : []

  // 1. crew filter - if specified and doesn't match, reject
  if (request.crew && ms.crew !== request.crew) {
    return { score: 0, reasons: [], matchedCapabilities: [], matchedTools: [], matchedSystems: [] }
  }

  // 2. agent filter - if specified and doesn't match, reject
  if (request.agent && ms.agent !== request.agent) {
    return { score: 0, reasons: [], matchedCapabilities: [], matchedTools: [], matchedSystems: [] }
  }

  // 3. capability_hint boost
  const matchedCapabilities = []
  if (request.capability_hint && ms.capabilities) {
    if (ms.capabilities.includes(request.capability_hint)) {
      score += 0.3
      matchedCapabilities.push(request.capability_hint)
      reasons.push("capability match: " + request.capability_hint)
    }
  }

  // 4. available_tools boost (each match +0.1, max +0.3)
  const matchedTools = []
  if (request.available_tools && ms.tools) {
    for (const tool of request.available_tools) {
      if (ms.tools.includes(tool) && score < 0.6) {
        matchedTools.push(tool)
      }
    }
    const toolBoost = Math.min(matchedTools.length * 0.1, 0.3)
    score += toolBoost
    if (matchedTools.length > 0) {
      reasons.push("tool matches: " + matchedTools.join(", "))
    }
  }

  // 5. available_mcp boost (each match +0.1, max +0.3)
  const matchedSystems = []
  if (request.available_mcp && ms.systems) {
    for (const mcp of request.available_mcp) {
      if (ms.systems.includes(mcp) && score < 0.6) {
        matchedSystems.push(mcp)
      }
    }
    const mcpBoost = Math.min(matchedSystems.length * 0.1, 0.3)
    score += mcpBoost
    if (matchedSystems.length > 0) {
      reasons.push("system matches: " + matchedSystems.join(", "))
    }
  }

  // 6. Lexical match on task_patterns (each match +0.1, max +0.3)
  const taskLower = (request.task || "").toLowerCase()
  let taskPatternMatches = 0
  if (taskLower && taskPatterns.length > 0) {
    for (const pattern of taskPatterns) {
      if (pattern && taskLower.includes(pattern.toLowerCase()) && taskPatternMatches < 3) {
        taskPatternMatches++
      }
    }
    const taskPatternBoost = Math.min(taskPatternMatches * 0.1, 0.3)
    score += taskPatternBoost
    if (taskPatternMatches > 0) {
      reasons.push("task pattern matches: " + taskPatternMatches + " tokens")
    }
  }

  // 7. Lexical fallback on tags (capabilities/domains/other tags)
  let tagMatches = 0
  if (taskLower && tags.length > 0) {
    for (const tag of tags) {
      if (tag && taskLower.includes(tag.toLowerCase()) && tagMatches < 4) {
        tagMatches++
      }
    }
    const tagBoost = Math.min(tagMatches * 0.05, 0.2)
    score += tagBoost
    if (tagMatches > 0) {
      reasons.push("tag matches: " + tagMatches)
    }
  }

  // 8. Lexical match on headings (each match +0.05, max +0.2)
  let headingMatches = 0
  if (taskLower && headings.length > 0) {
    for (const h of headings) {
      if (h && taskLower.includes(h.toLowerCase()) && headingMatches < 4) {
        headingMatches++
      }
    }
    const headingBoost = Math.min(headingMatches * 0.05, 0.2)
    score += headingBoost
    if (headingMatches > 0) {
      reasons.push("heading matches: " + headingMatches)
    }
  }

  // 9. Stability adjustment
  if (ms.stability === "stable") {
    score += 0.05
    reasons.push("stability: stable (+0.05)")
  } else if (ms.stability === "draft") {
    score -= 0.1
    reasons.push("stability: draft (-0.10)")
  }

  // 10. Clamp to [0, 1]
  score = Math.max(0, Math.min(1, score))

  return { score, reasons, matchedCapabilities, matchedTools, matchedSystems }
}

/**
 * Determine retrieval confidence based on results.
 * @param {number} topScore - Score of top document
 * @param {number} totalCandidates - Total candidates considered
 * @returns {string} Confidence level
 */
function computeConfidence(topScore, totalCandidates) {
  if (totalCandidates === 0) return "none"
  if (topScore >= 0.6 && totalCandidates >= 3) return "high"
  if (topScore >= 0.3 && totalCandidates >= 1) return "medium"
  return "low"
}

/**
 * Retrieve top-N documents matching a retrieval request.
 * @param {Object} request - ContextMemoryRetrievalRequest
 * @param {Object} index - Loaded index
 * @returns {Object} ContextMemoryRetrievalResult
 */
export function retrieveDocuments(request, index) {
  const entries = index.entries || []
  const totalCandidates = entries.length

  // Score all documents
  const scored = []
  for (const entry of entries) {
    const result = scoreDocument(entry, request)
    if (result.score > 0) {
      scored.push({
        id: entry.id,
        score: result.score,
        reasons: result.reasons,
        entry,
      })
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  // Take top N
  const topN = scored.slice(0, 5)
  const topScore = topN.length > 0 ? topN[0].score : 0

  // Collect tool_hints and skill_hints from top matches
  /** @type {string[]} */
  const toolHints = []
  /** @type {string[]} */
  const skillHints = []
  for (const s of topN) {
    const tools = s.entry.metadata_summary?.tools || []
    for (const t of tools) {
      if (!toolHints.includes(t)) toolHints.push(t)
    }
    const skills = s.entry.metadata_summary?.skills || []
    for (const sk of skills) {
      if (!skillHints.includes(sk)) skillHints.push(sk)
    }
  }

  // Build summary_blocks - extract first 200 chars of body from each matched doc
  // We'll approximate by using the id and headings
  /** @type {string[]} */
  const summaryBlocks = []
  for (const s of topN.slice(0, 3)) {
    const h = s.entry.headings || []
    const firstHeading = h.length > 0 ? h[0] : s.id
    summaryBlocks.push("[" + firstHeading + "] score=" + (s.score * 100).toFixed(0) + "%")
  }

  return {
    matched_docs: topN.map(s => ({ id: s.id, score: s.score, reasons: s.reasons })),
    summary_blocks: summaryBlocks,
    tool_hints: toolHints.slice(0, 10),
    skill_hints: skillHints.slice(0, 10),
    blocked_refs: [],
    confidence: computeConfidence(topScore, totalCandidates),
    retrieved_at: new Date().toISOString(),
    total_candidates: totalCandidates,
  }
}


// ---------------------------------------------------------------------------
// Smoke test
// ---------------------------------------------------------------------------
if (import.meta.url === "file://" + process.argv[1]) {
  console.log("=== Context Memory Schema Utilities Smoke Test ===\n")

  // Test frontmatter parsing
  console.log("1. Testing frontmatter parsing (with FM)...")
  const withFm = `---
id: dev/planning/test
kind: operational-memory
crew: dev
agent: planning-lead
capabilities:
  - task-prioritization
  - scope-estimation
stability: stable
source_type: human-authored
---

# Test Document

Some content here.
`
  const r1 = parseFrontmatter(withFm)
  console.log("   frontmatter: " + JSON.stringify(r1.frontmatter))
  console.log("   body preview: " + r1.body.substring(0, 50))

  console.log("\n2. Testing frontmatter parsing (without FM)...")
  const withoutFm = "# Just a heading\n\nPlain content."
  const r2 = parseFrontmatter(withoutFm)
  console.log("   frontmatter: " + JSON.stringify(r2.frontmatter))
  console.log("   body: " + r2.body.substring(0, 50))

  console.log("\n3. Testing deriveDocId...")
  console.log("   operational/dev/planning/test.md -> " + deriveDocId("operational/dev/planning/test.md"))
  console.log("   dev/planning/test.qmd -> " + deriveDocId("dev/planning/test.qmd"))

  console.log("\n4. Testing walkContextCorpus (fixtures)...")
  const files = walkContextCorpus("tests/fixtures/context-memory")
  console.log("   Found " + files.length + " files: " + files.map(f => basename(f)).join(", "))

  if (files.length > 0) {
    console.log("\n5. Testing buildIndexEntry...")
    const hash = computeFileHash(files[0])
    const mtime = statSync(files[0]).mtimeMs
    const parsed = parseContextFile(files[0])
    if (!parsed.error) {
      const entry = buildIndexEntry(parsed, hash, mtime)
      console.log("   id: " + entry.id)
      console.log("   headings: " + (entry.headings ? entry.headings.join(", ") : "none"))
      console.log("   snippet_count: " + entry.snippet_count)
    }
  }

  console.log("\n=== Smoke Test Complete ===")
}
