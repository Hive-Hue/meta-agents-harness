/**
 * Session Export Module
 * @fileoverview Structured session export for MAH cross-runtime session interoperability
 * @version 0.6.0
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
import { RUNTIME_ADAPTERS } from "./runtime-adapters.mjs"
import { parseSessionId } from "./m3-ops.mjs"
import {
  MAH_SESSION_SCHEMA_VERSION,
  FIDELITY_LEVELS,
  DEFAULT_FIDELITY_LEVEL
} from "../types/session-types.mjs"

const MAH_SESSIONS_DIR = process.env.MAH_SESSIONS_DIR || ".mah/sessions"
const EXPORTS_DIR = "exports"
const PROJECTIONS_DIR = "projections"

/**
 * Scan session directory for artifacts
 * @param {string} sessionPath
 * @returns {SessionArtifact[]}
 */
function scanSessionArtifacts(sessionPath) {
  if (!existsSync(sessionPath)) return []
  const artifacts = []
  
  function scan(dir, baseDir = dir) {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relativePath = path.relative(baseDir, fullPath)
      if (entry.isDirectory()) {
        artifacts.push({ name: entry.name, type: "directory", path: relativePath })
        scan(fullPath, baseDir)
      } else if (entry.isSymbolicLink()) {
        artifacts.push({ name: entry.name, type: "symbolic-link", path: relativePath })
      } else {
        const st = statSync(fullPath)
        artifacts.push({ name: entry.name, type: "file", path: relativePath, size_bytes: st.size })
      }
    }
  }
  
  scan(sessionPath)
  return artifacts
}

/**
 * Parse session summary from session files (best effort)
 * @param {string} sessionPath
 * @returns {string}
 */
function extractSessionSummary(sessionPath) {
  // Look for common summary indicators: README, summary.md, last-message.txt, etc.
  const summaryFiles = ["summary.md", "summary.txt", "README.md", "README.txt", ".session_summary"]
  for (const filename of summaryFiles) {
    const filePath = path.join(sessionPath, filename)
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8").trim()
        if (content.length > 0) return content.substring(0, 2000) // Cap at 2000 chars
      } catch {}
    }
  }
  return `Session at ${sessionPath}. Summary not available.`
}

/**
 * Build MahSession canonical envelope from session reference
 * @param {Object} sessionRef - from collectSessions()
 * @returns {MahSession}
 */
export function buildMahSessionEnvelope(sessionRef) {
  const sourcePath = sessionRef.source_path
  const artifacts = scanSessionArtifacts(sourcePath)
  const summary = extractSessionSummary(sourcePath)
  
  return {
    schema: MAH_SESSION_SCHEMA_VERSION,
    mah_session_id: sessionRef.id,
    runtime: sessionRef.runtime,
    runtime_session_id: sessionRef.session_id,
    crew: sessionRef.crew,
    agent: sessionRef.agent || null,
    created_at: sessionRef.started_at,
    last_active_at: sessionRef.last_active_at,
    summary,
    artifacts,
    provenance: [
      {
        event: "created",
        timestamp: sessionRef.started_at,
        details: { source: "runtime" }
      }
    ],
    context_blocks: [],
    raw_export_ref: null
  }
}

/**
 * Export session to mah-json format
 * @param {string} repoRoot
 * @param {string} sessionIdFull
 * @param {object} options
 * @returns {Promise<{ok: boolean, path?: string, error?: string}>}
 */
export async function exportSessionMahJson(repoRoot, sessionIdFull, options = {}) {
  const runtimeRegistry = options.runtimeRegistry || RUNTIME_ADAPTERS
  const { collectSessions, parseSessionId: parse } = await import("./m3-ops.mjs")
  
  const parsed = parse(sessionIdFull)
  if (!parsed) {
    return { ok: false, error: `invalid session ID format: ${sessionIdFull}` }
  }
  
  const sessions = collectSessions(repoRoot, { runtime: parsed.runtime }, runtimeRegistry)
  const sessionRef = sessions.find(s => s.id === sessionIdFull)
  if (!sessionRef) {
    return { ok: false, error: `session not found: ${sessionIdFull}` }
  }
  
  const envelope = buildMahSessionEnvelope(sessionRef)
  
  const mahJsonExport = {
    format: "mah-json",
    version: "1.0",
    session: envelope,
    exported_at: new Date().toISOString(),
    exported_by: process.env.USER || "unknown",
    mah_version: "0.6.0"
  }
  
  // Ensure exports directory exists
  const exportsPath = path.join(repoRoot, MAH_SESSIONS_DIR, EXPORTS_DIR, parsed.runtime)
  mkdirSync(exportsPath, { recursive: true })
  
  const outputFile = path.join(exportsPath, `${sessionIdFull.replace(/:/g, "_")}.mah.json`)
  writeFileSync(outputFile, JSON.stringify(mahJsonExport, null, 2), "utf-8")
  
  return { ok: true, path: outputFile, session: envelope }
}

/**
 * Export session to summary-md format
 * @param {string} repoRoot
 * @param {string} sessionIdFull
 * @returns {Promise<{ok: boolean, path?: string, error?: string}>}
 */
export async function exportSessionSummaryMd(repoRoot, sessionIdFull, options = {}) {
  const runtimeRegistry = options.runtimeRegistry || RUNTIME_ADAPTERS
  const { collectSessions, parseSessionId: parse } = await import("./m3-ops.mjs")
  
  const parsed = parse(sessionIdFull)
  if (!parsed) {
    return { ok: false, error: `invalid session ID format: ${sessionIdFull}` }
  }
  
  const sessions = collectSessions(repoRoot, { runtime: parsed.runtime }, runtimeRegistry)
  const sessionRef = sessions.find(s => s.id === sessionIdFull)
  if (!sessionRef) {
    return { ok: false, error: `session not found: ${sessionIdFull}` }
  }
  
  const envelope = buildMahSessionEnvelope(sessionRef)
  
  const summaryMd = `# Session Summary

**MAH Session ID:** ${envelope.mah_session_id}
**Runtime:** ${envelope.runtime}
**Crew:** ${envelope.crew}
**Created:** ${envelope.created_at}
**Last Active:** ${envelope.last_active_at}

## Summary

${envelope.summary}

## Artifacts (${envelope.artifacts.length})

${envelope.artifacts.map(a => `- ${a.type}: ${a.path}`).join("\n") || "_No artifacts recorded_"}

## Provenance

${envelope.provenance.map(p => `- ${p.event}: ${p.timestamp}`).join("\n")}

---
_Exported from MAH v0.6.0 at ${new Date().toISOString()}_
`
  
  const exportsPath = path.join(repoRoot, MAH_SESSIONS_DIR, EXPORTS_DIR, parsed.runtime)
  mkdirSync(exportsPath, { recursive: true })
  
  const outputFile = path.join(exportsPath, `${sessionIdFull.replace(/:/g, "_")}.summary.md`)
  writeFileSync(outputFile, summaryMd, "utf-8")
  
  return { ok: true, path: outputFile }
}

/**
 * Export session to runtime-raw tar.gz (original behavior, preserved for compatibility)
 * @param {string} repoRoot
 * @param {string} sessionIdFull
 * @returns {Promise<{ok: boolean, path?: string, error?: string}>}
 */
export async function exportSessionRaw(repoRoot, sessionIdFull, options = {}) {
  const runtimeRegistry = options.runtimeRegistry || RUNTIME_ADAPTERS
  const { exportSession } = await import("./m3-ops.mjs")
  return exportSession(repoRoot, sessionIdFull, runtimeRegistry)
}

/**
 * Unified export function - dispatches to appropriate format
 * @param {string} repoRoot
 * @param {string} sessionIdFull
 * @param {"mah-json"|"summary-md"|"runtime-raw"} format
 * @returns {Promise<{ok: boolean, path?: string, error?: string, session?: object}>}
 */
export async function exportSession(repoRoot, sessionIdFull, format = "mah-json", runtimeRegistry = RUNTIME_ADAPTERS) {
  switch (format) {
    case "mah-json":
      return exportSessionMahJson(repoRoot, sessionIdFull, { runtimeRegistry })
    case "summary-md":
      return exportSessionSummaryMd(repoRoot, sessionIdFull, { runtimeRegistry })
    case "runtime-raw":
      return exportSessionRaw(repoRoot, sessionIdFull, { runtimeRegistry })
    default:
      return { ok: false, error: `unknown export format: ${format}` }
  }
}
