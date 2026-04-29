import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs"
import path from "node:path"
import { execSync, spawnSync } from "node:child_process"
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

function writeSessionAliasTracking(repoRoot, runtimeRegistry, {
  runtime = "",
  crew = "",
  sessionId = "",
  sourcePath = "",
  reason = "resume"
} = {}) {
  const runtimeName = `${runtime || ""}`.trim().toLowerCase()
  const crewId = `${crew || ""}`.trim()
  const resolvedSessionId = `${sessionId || ""}`.trim()
  if (!runtimeName || !crewId || !resolvedSessionId) return

  const runtimeRoot = resolveRuntimeRoot(runtimeRegistry, runtimeName)
  const canonicalRoot = path.join(repoRoot, runtimeRoot, "crew", crewId, "sessions", resolvedSessionId)
  const resolvedSourcePath = `${sourcePath || ""}`.trim() ? path.resolve(sourcePath) : ""
  const targetRoots = new Set([canonicalRoot, resolvedSourcePath].filter(Boolean))
  const sourceRelative = resolvedSourcePath ? path.relative(repoRoot, resolvedSourcePath) : ""

  const payload = {
    runtime: runtimeName,
    crew: crewId,
    session_id: resolvedSessionId,
    source_path: sourceRelative,
    tracked_at: new Date().toISOString(),
    reason
  }
  for (const root of targetRoots) {
    mkdirSync(root, { recursive: true })
    writeFileSync(path.join(root, "session.alias.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
  }
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

function parseIsoDate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const asDate = new Date(value)
    return Number.isNaN(asDate.getTime()) ? "" : asDate.toISOString()
  }
  if (typeof value === "string" && value.trim()) {
    const asDate = new Date(value)
    return Number.isNaN(asDate.getTime()) ? "" : asDate.toISOString()
  }
  return ""
}

function parseJsonPayload(raw) {
  const input = `${raw || ""}`.trim()
  if (!input) return null
  try {
    return JSON.parse(input)
  } catch {
  }
  const starts = ["[", "{"]
  for (const token of starts) {
    const start = input.indexOf(token)
    if (start === -1) continue
    const endToken = token === "[" ? "]" : "}"
    const end = input.lastIndexOf(endToken)
    if (end === -1 || end <= start) continue
    const slice = input.slice(start, end + 1)
    try {
      return JSON.parse(slice)
    } catch {
    }
  }
  return null
}

function normalizeSessionListCommand(command) {
  if (!Array.isArray(command) || command.length === 0) return null
  if (typeof command[0] === "string") {
    return { exec: command[0], args: command.slice(1).filter((item) => typeof item === "string") }
  }
  if (!Array.isArray(command[0]) || command[0].length === 0) return null
  const [exec, args] = command[0]
  if (typeof exec !== "string" || !exec.trim()) return null
  if (Array.isArray(args)) return { exec, args: args.filter((item) => typeof item === "string") }
  return { exec, args: [] }
}

function collectSessionsFromListCommand(repoRoot, runtimeName, adapter, pushRow) {
  const normalized = normalizeSessionListCommand(adapter?.sessionListCommand)
  if (!normalized) return false
  const result = spawnSync(normalized.exec, normalized.args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000
  })
  if (result.error) return false
  if (result.status !== 0) return false
  const payload = parseJsonPayload(result.stdout)
  const sessions = Array.isArray(payload) ? payload : Array.isArray(payload?.sessions) ? payload.sessions : null
  if (!sessions) return false
  for (const item of sessions) {
    if (!item || typeof item !== "object") continue
    const sessionId = `${item.id || item.session_id || ""}`.trim()
    if (!sessionId) continue
    const directory = `${item.directory || ""}`.trim()
    if (directory) {
      const resolvedDirectory = path.resolve(directory)
      if (resolvedDirectory !== path.resolve(repoRoot)) continue
    }
    const crewId = `${item.crew || "global"}`.trim() || "global"
    const sourcePath = path.join(repoRoot, ".mah", "sessions", runtimeName, sessionId)
    pushRow({
      id: `${runtimeName}:${crewId}:${sessionId}`,
      runtime: runtimeName,
      crew: crewId,
      session_id: sessionId,
      source_path: sourcePath,
      started_at: parseIsoDate(item.created) || parseIsoDate(item.started_at),
      last_active_at: parseIsoDate(item.updated) || parseIsoDate(item.last_active_at),
      status: "available"
    })
  }
  return true
}

export function readMetaConfig(repoRoot) {
  const metaPath = path.join(repoRoot, "meta-agents.yaml")
  const raw = readFileSync(metaPath, "utf-8")
  return YAML.parse(raw)
}

export function collectSessions(repoRoot, { runtime = "", crew = "" } = {}, runtimeRegistry = RUNTIME_ADAPTERS) {
  const rows = []
  const seenIds = new Set()
  const opencodeBySession = new Map()
  const kiloBySession = new Map()
  const normalizedRuntime = `${runtime || ""}`.trim()
  const normalizedCrew = `${crew || ""}`.trim()

  const pushRow = (entry) => {
    if (normalizedRuntime && entry.runtime !== normalizedRuntime) return
    if (normalizedCrew && entry.crew !== normalizedCrew) return

    if (entry.runtime === "opencode") {
      const canonicalKey = `opencode:${entry.session_id}`
      const currentIndex = opencodeBySession.get(canonicalKey)
      if (typeof currentIndex === "number") {
        const current = rows[currentIndex]
        const currentIsGlobal = `${current?.crew || ""}` === "global"
        const nextIsGlobal = `${entry?.crew || ""}` === "global"
        if (currentIsGlobal && !nextIsGlobal) {
          seenIds.delete(current.id)
          rows[currentIndex] = entry
          seenIds.add(entry.id)
        }
        return
      }
      opencodeBySession.set(canonicalKey, rows.length)
    }

    if (entry.runtime === "kilo") {
      const canonicalKey = `kilo:${entry.session_id}`
      const currentIndex = kiloBySession.get(canonicalKey)
      if (typeof currentIndex === "number") {
        const current = rows[currentIndex]
        const currentIsGlobal = `${current?.crew || ""}` === "global"
        const nextIsGlobal = `${entry?.crew || ""}` === "global"
        if (currentIsGlobal && !nextIsGlobal) {
          seenIds.delete(current.id)
          rows[currentIndex] = entry
          seenIds.add(entry.id)
        }
        return
      }
      kiloBySession.set(canonicalKey, rows.length)
    }

    if (seenIds.has(entry.id)) return
    seenIds.add(entry.id)
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

    if (collectSessionsFromListCommand(repoRoot, runtimeName, adapter, pushRow)) continue

    const globalRoot = adapter?.sessionGlobalRoot
    if (!globalRoot) continue
    const absoluteGlobalRoot = path.join(repoRoot, globalRoot)
    if (!existsSync(absoluteGlobalRoot)) continue
    const sessionDirs = listSubdirs(absoluteGlobalRoot)
    for (const sessionId of sessionDirs) {
      const sourcePath = path.join(absoluteGlobalRoot, sessionId)
      const st = safeStat(sourcePath)
      pushRow({
        id: `${runtimeName}:global:${sessionId}`,
        runtime: runtimeName,
        crew: "global",
        session_id: sessionId,
        source_path: sourcePath,
        started_at: st?.birthtime?.toISOString?.() || "",
        last_active_at: st?.mtime?.toISOString?.() || "",
        status: "available"
      })
    }
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
  const normalized = sessionIdFull.trim()
  const parts = normalized.split(":")
  if (parts.length !== 3) return null
  const [runtimeRaw, crewRaw, sessionIdRaw] = parts
  const runtime = `${runtimeRaw || ""}`.trim().toLowerCase()
  const crew = `${crewRaw || ""}`.trim()
  const sessionId = `${sessionIdRaw || ""}`.replace(/\s+/g, "")
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
  const normalizedSessionFull = `${parsed.runtime}:${parsed.crew}:${parsed.sessionId}`
  const session = sessions.find((s) => s.id === normalizedSessionFull)
    || (runtime === "opencode"
      ? sessions.find((s) => s.runtime === "opencode" && `${s.session_id || ""}` === parsed.sessionId)
      : null)
  if (!session && runtime !== "opencode") {
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
  if (capabilities.sessionRootFlag && session?.source_path) {
    args.unshift(capabilities.sessionRootFlag, session.source_path)
  }
  appendUniqueArgs(args, normalizeCapabilityArgs(capabilities.sessionContinueArgs))

  if (session?.source_path || parsed.runtime === "claude" || parsed.runtime === "kilo") {
    writeSessionAliasTracking(repoRoot, runtimeRegistry, {
      runtime: parsed.runtime,
      crew: parsed.crew,
      sessionId: parsed.sessionId,
      sourcePath: session?.source_path || "",
      reason: "resume-session"
    })
  }

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
