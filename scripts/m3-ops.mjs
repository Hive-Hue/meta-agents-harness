import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import YAML from "yaml"

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

export function collectSessions(repoRoot, { runtime = "", crew = "" } = {}) {
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

  collectCrewRuntime("pi", ".pi")
  collectCrewRuntime("claude", ".claude")
  collectCrewRuntime("opencode", ".opencode")

  const ocGlobal = path.join(repoRoot, ".opencode", "sessions")
  if (existsSync(ocGlobal)) {
    const st = safeStat(ocGlobal)
    if (st) {
      pushRow({
        id: "opencode:global",
        runtime: "opencode",
        crew: "global",
        session_id: "global",
        source_path: ocGlobal,
        started_at: st.birthtime?.toISOString?.() || "",
        last_active_at: st.mtime?.toISOString?.() || "",
        status: "available"
      })
    }
  }

  rows.sort((a, b) => `${b.last_active_at}`.localeCompare(`${a.last_active_at}`))
  return rows
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
