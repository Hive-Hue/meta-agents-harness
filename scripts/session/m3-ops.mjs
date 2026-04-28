import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"
import YAML from "yaml"
import { RUNTIME_ADAPTERS } from "../runtime/runtime-adapters.mjs"

function normalizeCapabilityArgs(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.trim())
  if (typeof value === "string" && value.trim()) return [value]
  return []
}

function resolveRuntimeAdapter(runtimeRegistry, runtime) {
  return runtimeRegistry?.[runtime] || null
}

function resolveRuntimeRoot(runtimeRegistry, runtime) {
  const adapter = resolveRuntimeAdapter(runtimeRegistry, runtime)
  return adapter?.markerDir || `.${runtime}`
}

function appendUniqueArgs(target, extraArgs) {
  for (const token of extraArgs) {
    if (!target.includes(token)) target.push(token)
  }
}

function safeStat(targetPath) {
  try {
    return statSync(targetPath)
  } catch {
    return null
  }
}

function listSubdirs(rootPath) {
  if (!existsSync(rootPath)) return []
  const out = []
  for (const item of readdirSync(rootPath, { withFileTypes: true })) {
    if (item.isDirectory()) out.push(item.name)
  }
  return out
}

export function readMetaConfig(repoRoot) {
  const metaPath = path.join(repoRoot, "meta-agents.yaml")
  const raw = readFileSync(metaPath, "utf-8")
  return YAML.parse(raw)
}

export function collectSessions(repoRoot, { runtime = "", crew = "" } = {}, runtimeRegistry = RUNTIME_ADAPTERS) {
  const rows = []
  const normalizedRuntime = `${runtime || ""}`.trim()
  const normalizedCrew = `${crew || ""}`.trim()

  const pushRow = (entry) => {
    if (normalizedRuntime && entry.runtime !== normalizedRuntime) return
    if (normalizedCrew && entry.crew !== normalizedCrew) return
    rows.push(entry)
  }

  const collectCrewRuntime = (runtimeName, runtimeRoot) => {
    const crewRoot = path.join(repoRoot, runtimeRoot, "crew")
    if (!existsSync(crewRoot)) return
    for (const crewId of listSubdirs(crewRoot)) {
      const sessionsRoot = path.join(crewRoot, crewId, "sessions")
      if (!existsSync(sessionsRoot)) continue
      const sessionDirs = listSubdirs(sessionsRoot)
      for (const sessionId of sessionDirs) {
        const absolutePath = path.join(sessionsRoot, sessionId)
        const st = safeStat(absolutePath)
        pushRow({
          id: `${runtimeName}:${crewId}:${sessionId}`,
          runtime: runtimeName,
          crew: crewId,
          session_id: sessionId,
          source_path: absolutePath,
          started_at: st?.birthtime?.toISOString?.() || "",
          last_active_at: st?.mtime?.toISOString?.() || "",
          status: "available"
        })
      }
    }
  }

  for (const [runtimeName, adapter] of Object.entries(runtimeRegistry || {})) {
    if (!adapter?.supportsSessions) continue
    collectCrewRuntime(runtimeName, resolveRuntimeRoot(runtimeRegistry, runtimeName))

    const globalRoot = adapter?.sessionGlobalRoot
    if (!globalRoot) continue
    const absoluteGlobalRoot = path.join(repoRoot, globalRoot)
    if (!existsSync(absoluteGlobalRoot)) continue
    const st = safeStat(absoluteGlobalRoot)
    if (!st) continue
    pushRow({
      id: `${runtimeName}:global:global`,
      runtime: runtimeName,
      crew: "global",
      session_id: "global",
      source_path: absoluteGlobalRoot,
      started_at: st.birthtime?.toISOString?.() || "",
      last_active_at: st.mtime?.toISOString?.() || "",
      status: "available"
    })
  }

  rows.sort((a, b) => `${b.last_active_at}`.localeCompare(`${a.last_active_at}`))
  return rows
}

/**
 * Parse a session ID in format "runtime:crew:sessionId"
 * @param {string} sessionIdFull
 * @returns {{ runtime: string, crew: string, sessionId: string } | null}
 */
export function parseSessionId(sessionIdFull) {
  if (!sessionIdFull || typeof sessionIdFull !== "string") return null
  const parts = sessionIdFull.split(":")
  if (parts.length !== 3) return null
  const [runtime, crew, sessionId] = parts
  if (!runtime || !crew || !sessionId) return null
  return { runtime, crew, sessionId }
}

/**
 * List sessions (alias for collectSessions with filtering)
 * @param {string} repoRoot
 * @param {{ runtime?: string, crew?: string }} options
 * @returns {Array}
 */
export function listSessions(repoRoot, options = {}) {
  return collectSessions(repoRoot, options)
}

/**
 * Export session artefacts to $MAH_SESSIONS_DIR/<runtime>/<id>.tar.gz
 * @param {string} repoRoot
 * @param {string} sessionIdFull - session ID in format "runtime:crew:sessionId"
 * @returns {{ ok: boolean, path?: string, error?: string }}
 */
export function exportSession(repoRoot, sessionIdFull, runtimeRegistry = RUNTIME_ADAPTERS) {
  const parsed = parseSessionId(sessionIdFull)
  if (!parsed) {
    return { ok: false, error: `invalid session ID format: ${sessionIdFull} (expected runtime:crew:sessionId)` }
  }

  const sessionsDir = process.env.MAH_SESSIONS_DIR || path.join(repoRoot, ".mah", "sessions")
  const targetDir = path.join(sessionsDir, parsed.runtime)
  const targetFile = path.join(targetDir, `${sessionIdFull}.tar.gz`)

  // Resolve source from session inventory to support custom/global runtime layouts.
  const sessions = collectSessions(repoRoot, { runtime: parsed.runtime, crew: parsed.crew }, runtimeRegistry)
  const session = sessions.find((item) => item.id === sessionIdFull)
  const sourcePath = session?.source_path || ""
  if (!sourcePath || !existsSync(sourcePath)) {
    return { ok: false, error: `session not found: ${sessionIdFull}` }
  }

  // Create target directory
  mkdirSync(targetDir, { recursive: true })

  // Create tar.gz archive
  try {
    execSync(`tar -czf "${targetFile}" -C "${path.dirname(sourcePath)}" "${parsed.sessionId}"`, { cwd: repoRoot })
    return { ok: true, path: targetFile }
  } catch (err) {
    return { ok: false, error: `failed to create archive: ${err.message}` }
  }
}

/**
 * Delete a session with explicit confirmation
 * @param {string} repoRoot
 * @param {string} sessionIdFull - session ID in format "runtime:crew:sessionId"
 * @param {string} confirmed - confirmation string ('y' or 'Y')
 * @returns {{ ok: boolean, error?: string }}
 */
export function deleteSession(repoRoot, sessionIdFull, confirmed, runtimeRegistry = RUNTIME_ADAPTERS) {
  const parsed = parseSessionId(sessionIdFull)
  if (!parsed) {
    return { ok: false, error: `invalid session ID format: ${sessionIdFull} (expected runtime:crew:sessionId)` }
  }

  // Require explicit y or Y confirmation
  if (confirmed !== "y" && confirmed !== "Y") {
    return { ok: false, error: "confirmation required: enter 'y' or 'Y' to delete" }
  }

  // Resolve source from session inventory to support custom/global runtime layouts.
  const sessions = collectSessions(repoRoot, { runtime: parsed.runtime, crew: parsed.crew }, runtimeRegistry)
  const session = sessions.find((item) => item.id === sessionIdFull)
  const sourcePath = session?.source_path || ""
  if (!sourcePath || !existsSync(sourcePath)) {
    return { ok: false, error: `session not found: ${sessionIdFull}` }
  }

  // Remove the session directory
  try {
    rmSync(sourcePath, { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `failed to delete session: ${err.message}` }
  }
}

/**
 * Resume a session by ID - sets session ID env/flag per runtime, then invokes run
 * @param {string} repoRoot
 * @param {string} sessionIdFull - session ID in format "runtime:crew:sessionId"
 * @param {string} runtime
 * @param {Array} passthroughArgs - additional args to pass to run
 * @returns {{ ok: boolean, envOverrides?: object, args?: string[], error?: string }}
 */
export function resumeSession(repoRoot, sessionIdFull, runtime, passthroughArgs = [], runtimeRegistry = RUNTIME_ADAPTERS) {
  const parsed = parseSessionId(sessionIdFull)
  if (!parsed) {
    return { ok: false, error: `invalid session ID format: ${sessionIdFull} (expected runtime:crew:sessionId)` }
  }

  // Validate runtime matches
  if (parsed.runtime !== runtime) {
    return { ok: false, error: `session runtime '${parsed.runtime}' does not match requested runtime '${runtime}'` }
  }

  // Find the session
  const sessions = collectSessions(repoRoot, { runtime }, runtimeRegistry)
  const session = sessions.find((s) => s.id === sessionIdFull)
  if (!session) {
    return { ok: false, error: `session not found: ${sessionIdFull}` }
  }

  const adapter = resolveRuntimeAdapter(runtimeRegistry, runtime)
  const capabilities = adapter?.capabilities || {}
  if (!adapter?.supportsSessions || !capabilities.sessionModeContinue) {
    return { ok: false, error: `runtime '${runtime}' does not support resuming sessions` }
  }

  const envOverrides = {}
  const args = [...passthroughArgs]

  if (capabilities.sessionIdViaEnv) {
    envOverrides[capabilities.sessionIdViaEnv] = parsed.sessionId
  } else if (capabilities.sessionIdFlag) {
    args.push(capabilities.sessionIdFlag, parsed.sessionId)
  }
  if (capabilities.sessionRootFlag) {
    args.unshift(capabilities.sessionRootFlag, session.source_path)
  }
  appendUniqueArgs(args, normalizeCapabilityArgs(capabilities.sessionContinueArgs))

  return { ok: true, envOverrides, args }
}

/**
 * Start a new session - only on runtimes that support it (PI, Hermes)
 * @param {string} repoRoot
 * @param {string} runtime
 * @param {Array} passthroughArgs
 * @returns {{ ok: boolean, error?: string, envOverrides?: object, args?: string[] }}
 */
export function startSession(repoRoot, runtime, passthroughArgs = [], runtimeRegistry = RUNTIME_ADAPTERS) {
  const adapter = resolveRuntimeAdapter(runtimeRegistry, runtime)
  const capabilities = adapter?.capabilities || {}

  if (!adapter?.supportsSessions || !capabilities.sessionModeNew) {
    return {
      ok: false,
      error: `runtime '${runtime}' does not support starting new sessions (sessionModeNew is false)`
    }
  }

  const envOverrides = {}
  const args = [...passthroughArgs]
  args.unshift(...normalizeCapabilityArgs(capabilities.sessionNewArgs))

  return { ok: true, envOverrides, args }
}

export function appendProvenance(repoRoot, event) {
  const root = path.join(repoRoot, ".mah")
  const filePath = path.join(root, "provenance.jsonl")
  mkdirSync(root, { recursive: true })
  const payload = { ...event, at: new Date().toISOString() }
  writeFileSync(filePath, `${JSON.stringify(payload)}\n`, { flag: "a" })
  const maxLinesValue = Number.parseInt(process.env.MAH_PROVENANCE_MAX_LINES || "5000", 10)
  const maxLines = Number.isFinite(maxLinesValue) && maxLinesValue > 0 ? maxLinesValue : 5000
  const maxDaysValue = Number.parseInt(process.env.MAH_PROVENANCE_MAX_DAYS || "30", 10)
  const maxDays = Number.isFinite(maxDaysValue) && maxDaysValue > 0 ? maxDaysValue : 30
  compactProvenanceFile(filePath, { maxLines, maxDays })
  return filePath
}

function compactProvenanceFile(filePath, { maxLines, maxDays }) {
  if (!existsSync(filePath)) return
  const now = Date.now()
  const maxAgeMs = maxDays * 24 * 60 * 60 * 1000
  const filtered = readFileSync(filePath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      try {
        const parsed = JSON.parse(line)
        const at = new Date(parsed.at || 0).getTime()
        return Number.isFinite(at) && at > 0 && now - at <= maxAgeMs
      } catch {
        return false
      }
    })
  const compacted = filtered.slice(Math.max(0, filtered.length - maxLines))
  const content = compacted.length > 0 ? `${compacted.join("\n")}\n` : ""
  writeFileSync(filePath, content, "utf-8")
}

export function readProvenance(repoRoot, { limit = 200, run = "" } = {}) {
  const filePath = path.join(repoRoot, ".mah", "provenance.jsonl")
  if (!existsSync(filePath)) return []
  const lines = readFileSync(filePath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const out = []
  for (const line of lines) {
    try {
      const item = JSON.parse(line)
      if (run && item.run_id !== run) continue
      out.push(item)
    } catch {
    }
  }
  return out.slice(Math.max(0, out.length - limit))
}

const LIFECYCLE_EVENTS_DIR = '.mah/sessions/lifecycle-events'

export function recordLifecycleEvent(repoRoot, sessionIdFull, event) {
  const eventsDir = path.join(repoRoot, LIFECYCLE_EVENTS_DIR)
  if (!existsSync(eventsDir)) mkdirSync(eventsDir, { recursive: true })

  const safeId = sessionIdFull.replace(/[^a-zA-Z0-9_-]/g, '_')
  const eventFile = path.join(eventsDir, `${safeId}.json`)

  let events = []
  if (existsSync(eventFile)) {
    try { events = JSON.parse(readFileSync(eventFile, 'utf-8')) } catch {}
  }

  events.push({ ...event, timestamp: event.timestamp || new Date().toISOString() })
  writeFileSync(eventFile, JSON.stringify(events, null, 2))
}

export function getLifecycleEvents(repoRoot, sessionIdFull) {
  const safeId = sessionIdFull.replace(/[^a-zA-Z0-9_-]/g, '_')
  const eventFile = path.join(repoRoot, LIFECYCLE_EVENTS_DIR, `${safeId}.json`)
  if (!existsSync(eventFile)) return []
  try { return JSON.parse(readFileSync(eventFile, 'utf-8')) } catch { return [] }
}

export function buildCrewGraph(metaDoc, crewId) {
  const crew = (metaDoc.crews || []).find((item) => item.id === crewId) || (metaDoc.crews || [])[0]
  if (!crew) return { crew: "", nodes: [], edges: [] }
  const nodes = (crew.agents || []).map((agent) => ({
    id: agent.id,
    role: agent.role,
    team: agent.team
  }))
  const edges = []
  const orchestrator = crew.topology?.orchestrator
  for (const leadId of Object.values(crew.topology?.leads || {})) {
    edges.push({ from: orchestrator, to: leadId, type: "delegate" })
  }
  for (const [team, workers] of Object.entries(crew.topology?.workers || {})) {
    const leadId = crew.topology?.leads?.[team]
    for (const workerId of workers || []) {
      edges.push({ from: leadId || orchestrator, to: workerId, type: "delegate" })
    }
  }
  return { crew: crew.id, nodes, edges }
}

export function buildRunGraphFromProvenance(provenanceRows, { run = "" } = {}) {
  const rows = run ? provenanceRows.filter((item) => item.run_id === run) : provenanceRows
  const nodes = new Map()
  const edges = []
  for (const item of rows) {
    const source = item.runtime || "unknown"
    const target = item.command || "unknown"
    nodes.set(source, { id: source, type: "runtime" })
    nodes.set(target, { id: target, type: "command" })
    edges.push({
      from: source,
      to: target,
      type: "executed",
      at: item.at || ""
    })
  }
  return { run_id: run || "", nodes: Array.from(nodes.values()), edges }
}
