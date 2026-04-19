/**
 * MAH Context Memory CLI
 * @fileoverview CLI subcommands for mah context namespace
 * @version 0.8.0
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative, extname, basename, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import YAML from "yaml"
import {
  STABILITY_LEVELS,
  SOURCE_TYPES,
  DOCUMENT_KINDS,
  DEFAULT_RETRIEVAL_TOP_N,
} from "../types/context-memory-types.mjs"
import {
  validateContextMemoryDocument,
  validateContextMemoryIndexEntry,
  validateContextMemoryRetrievalRequest,
  validateContextMemoryRetrievalResult,
} from "./context-memory-validate.mjs"
import {
  parseFrontmatter,
  parseContextFile,
  deriveDocId,
  computeFileHash,
  walkContextCorpus,
} from "./context-memory-schema.mjs"

const repoRoot = resolve(import.meta.url, "..", "..")

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

function getContextRoot() {
  return join(repoRoot, ".mah", "context")
}

function getOperationalRoot() {
  return join(getContextRoot(), "operational")
}

function getIndexPath() {
  return join(getContextRoot(), "index", "operational-context.index.json")
}

function parseArgs(argv) {
  const json = argv.includes("--json")
  const strict = argv.includes("--strict")
  const pathIdx = argv.indexOf("--path")
  const path = pathIdx >= 0 ? argv[pathIdx + 1] : null
  const agentIdx = argv.indexOf("--agent")
  const agent = agentIdx >= 0 ? argv[agentIdx + 1] : null
  const capIdx = argv.indexOf("--capability")
  const cap = capIdx >= 0 ? argv[capIdx + 1] : null
  const taskIdx = argv.indexOf("--task")
  const task = taskIdx >= 0 ? argv[taskIdx + 1] : null
  return { json, strict, path, agent, cap, task }
}

function findDocById(docId) {
  const root = getOperationalRoot()
  // Search for file matching docId
  const entries = walkContextCorpus(root)
  for (const filePath of entries) {
    const derived = deriveDocId(relative(root, filePath))
    if (derived === docId || derived.endsWith(docId) || docId.endsWith(derived)) {
      const result = parseContextFile(filePath)
      if (!result.error) return { ...result, filePath }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Subcommand: validate
// ---------------------------------------------------------------------------

async function runValidate(argv) {
  const { json, strict, path } = parseArgs(argv)
  const targetPath = path
    ? resolve(process.cwd(), path)
    : getOperationalRoot()

  if (!existsSync(targetPath)) {
    if (json) {
      console.log(JSON.stringify({ valid: false, error: "Path does not exist: " + targetPath }))
    } else {
      console.error("Error: Path does not exist:", targetPath)
    }
    return 1
  }

  const files = path
    ? [targetPath].filter(f => extname(f) === ".md" || extname(f) === ".qmd")
    : walkContextCorpus(targetPath).filter(f => extname(f) === ".md" || extname(f) === ".qmd")

  const results = []
  let validCount = 0
  let invalidCount = 0

  for (const file of files) {
    const parsed = parseContextFile(file)
    if (parsed.error) {
      results.push({ file: relative(repoRoot, file), valid: false, errors: [parsed.error], warnings: [] })
      invalidCount++
      continue
    }
    const validation = validateContextMemoryDocument(parsed.frontmatter, strict)
    if (!validation.valid && validation.errors.length > 0) invalidCount++
    else validCount++
    results.push({
      file: relative(repoRoot, file),
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
    })
  }

  if (json) {
    console.log(JSON.stringify({
      files_checked: files.length,
      valid: validCount,
      invalid: invalidCount,
      results,
    }, null, 2))
  } else {
    console.log("=== Context Memory Validation ===")
    console.log("Files checked:", files.length, " Valid:", validCount, " Invalid:", invalidCount)
    console.log()
    for (const r of results) {
      const icon = r.valid ? "PASS" : "FAIL"
      console.log("[" + icon + "] " + r.file)
      if (r.errors.length > 0) {
        for (const e of r.errors) console.log("  ERROR:", e)
      }
      if (r.warnings.length > 0) {
        for (const w of r.warnings) console.log("  WARN:", w)
      }
    }
  }

  return invalidCount > 0 ? 1 : 0
}

// ---------------------------------------------------------------------------
// Subcommand: list
// ---------------------------------------------------------------------------

async function runList(argv) {
  const { json, agent, cap } = parseArgs(argv)
  const root = getOperationalRoot()

  if (!existsSync(root)) {
    if (json) console.log(JSON.stringify({ documents: [] }))
    else console.log("No operational corpus found at", root)
    return 0
  }

  const files = walkContextCorpus(root).filter(f => extname(f) === ".md" || extname(f) === ".qmd")
  const docs = []

  for (const file of files) {
    const parsed = parseContextFile(file)
    if (parsed.error) continue
    const fm = parsed.frontmatter
    if (agent && fm.agent !== agent) continue
    if (cap && fm.capabilities && !fm.capabilities.includes(cap)) continue
    docs.push({
      id: fm.id || deriveDocId(relative(root, file)),
      kind: fm.kind || "unknown",
      stability: fm.stability || "draft",
      priority: fm.priority || "medium",
      last_reviewed_at: fm.last_reviewed_at || null,
      agent: fm.agent || "unknown",
      file: relative(repoRoot, file),
    })
  }

  if (json) {
    console.log(JSON.stringify({ documents: docs, count: docs.length }, null, 2))
  } else {
    console.log("=== Context Memory Documents ===")
    console.log("Total:", docs.length)
    if (docs.length === 0) {
      console.log("(no documents match filter)")
      return 0
    }
    console.log()
    console.log("ID".padEnd(50), "Kind".padEnd(20), "Stability".padEnd(12), "Agent")
    console.log("-".repeat(50), "-".repeat(20), "-".repeat(12), "-".repeat(15))
    for (const d of docs.sort((a, b) => a.id.localeCompare(b.id))) {
      console.log(
        d.id.padEnd(50),
        d.kind.padEnd(20),
        d.stability.padEnd(12),
        d.agent
      )
    }
  }
  return 0
}

// ---------------------------------------------------------------------------
// Subcommand: show
// ---------------------------------------------------------------------------

async function runShow(argv) {
  const { json } = parseArgs(argv)
  const docId = argv[0]

  if (!docId) {
    console.error("Error: show requires a document ID")
    console.error("Usage: mah context show <id>")
    return 1
  }

  const found = findDocById(docId)
  if (!found) {
    if (json) {
      console.log(JSON.stringify({ error: "Document not found: " + docId }))
    } else {
      console.error("Document not found:", docId)
    }
    return 1
  }

  if (json) {
    console.log(JSON.stringify({
      document: {
        frontmatter: found.frontmatter,
        body: found.body,
        file_path: relative(repoRoot, found.filePath),
      }
    }, null, 2))
  } else {
    console.log("=== " + docId + " ===")
    console.log()
    console.log("---")
    // Re-serialize frontmatter
    const fm = found.frontmatter
    for (const [k, v] of Object.entries(fm)) {
      if (Array.isArray(v)) {
        console.log(k + ":")
        for (const item of v) console.log("  - " + item)
      } else {
        console.log(k + ": " + v)
      }
    }
    console.log("---")
    console.log()
    console.log(found.body)
  }
  return 0
}

// ---------------------------------------------------------------------------
// Subcommand: index (stub - PR2)
// ---------------------------------------------------------------------------

async function runIndex(argv) {
  console.log("mah context index: not yet implemented (see PR2)")
  return 0
}

// ---------------------------------------------------------------------------
// Subcommand: find (stub - PR2)
// ---------------------------------------------------------------------------

async function runFind(argv) {
  console.log("mah context find: not yet implemented (see PR2)")
  return 0
}

// ---------------------------------------------------------------------------
// Subcommand: explain (stub - PR2)
// ---------------------------------------------------------------------------

async function runExplain(argv) {
  console.log("mah context explain: not yet implemented (see PR2)")
  return 0
}

// ---------------------------------------------------------------------------
// Subcommand: propose (stub - PR4)
// ---------------------------------------------------------------------------

async function runPropose(argv) {
  console.log("mah context propose: not yet implemented (see PR4)")
  return 0
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runContext(argv, jsonMode = false) {
  const sub = argv[0]

  // Handle --help early
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp()
    return 0
  }

  switch (sub) {
    case "validate": return runValidate(argv.slice(1))
    case "list": return runList(argv.slice(1))
    case "show": return runShow(argv.slice(1))
    case "index": return runIndex(argv.slice(1))
    case "find": return runFind(argv.slice(1))
    case "explain": return runExplain(argv.slice(1))
    case "propose": return runPropose(argv.slice(1))
    default:
      if (sub) {
        console.error("Unknown subcommand:", sub)
      }
      printHelp()
      return 1
  }
}

function printHelp() {
  console.log("Usage: mah context <subcommand> [options]")
  console.log("")
  console.log("Context Memory - operational context retrieval for MAH agents")
  console.log("")
  console.log("Subcommands:")
  console.log("  validate [--strict] [--path <dir>]  Validate context memory documents")
  console.log("  list [--agent <name>] [--capability]  List context memory documents")
  console.log("  show <id>                       Show a specific context document")
  console.log("  index [--rebuild]               Build or update the context index")
  console.log("  find --agent <name> --task "<desc>"  Find relevant context for a task")
  console.log("  explain --agent <name> --task "<desc>"  Explain retrieval reasoning")
  console.log("  propose --from-session <ref>   Create memory proposal from session")
  console.log("")
  console.log("Options:")
  console.log("  --json        JSON output mode")
  console.log("  --strict      Strict validation (unknown fields = errors)")
  console.log("  --help, -h    Show this help message")
}
