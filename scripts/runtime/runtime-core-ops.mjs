import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

function normalizeRelativePath(value) {
  return `${value || ""}`.replaceAll("\\", "/")
}

function resolveMarkerDir(adapter, runtime) {
  return adapter?.markerDir || `.${runtime}`
}

export function resolveCrewRoot(repoRoot, adapter, runtime) {
  return path.join(repoRoot, resolveMarkerDir(adapter, runtime), "crew")
}

export function resolveActiveCrewFile(repoRoot, adapter, runtime) {
  if (adapter?.activeCrewFile) {
    return path.isAbsolute(adapter.activeCrewFile)
      ? adapter.activeCrewFile
      : path.join(repoRoot, adapter.activeCrewFile)
  }
  return path.join(repoRoot, resolveMarkerDir(adapter, runtime), ".active-crew.json")
}

export function resolveCrewConfigPath(repoRoot, adapter, runtime, crewId) {
  if (!crewId) return ""
  const pattern = `${adapter?.configPattern || ""}`.trim()
  if (pattern) {
    const interpolated = pattern.replaceAll("<crew>", crewId)
    return path.isAbsolute(interpolated) ? interpolated : path.join(repoRoot, interpolated)
  }
  return path.join(resolveCrewRoot(repoRoot, adapter, runtime), crewId, "multi-team.yaml")
}

export function listRuntimeCrews(repoRoot, adapter, runtime) {
  const crewRoot = resolveCrewRoot(repoRoot, adapter, runtime)
  if (!existsSync(crewRoot)) return []
  return readdirSync(crewRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

export function readActiveCrew(repoRoot, adapter, runtime) {
  const activeCrewFile = resolveActiveCrewFile(repoRoot, adapter, runtime)
  if (!existsSync(activeCrewFile)) return null
  try {
    const raw = readFileSync(activeCrewFile, "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed?.crew || typeof parsed.crew !== "string") return null
    return parsed
  } catch {
    return null
  }
}

export function writeActiveCrew(repoRoot, adapter, runtime, crewId) {
  const activeCrewFile = resolveActiveCrewFile(repoRoot, adapter, runtime)
  const sourceConfig = resolveCrewConfigPath(repoRoot, adapter, runtime, crewId)
  const payload = {
    crew: crewId,
    source_config: normalizeRelativePath(path.relative(repoRoot, sourceConfig))
  }
  mkdirSync(path.dirname(activeCrewFile), { recursive: true })
  writeFileSync(activeCrewFile, JSON.stringify(payload, null, 2), "utf-8")
  return payload
}

export function clearActiveCrew(repoRoot, adapter, runtime) {
  const activeCrewFile = resolveActiveCrewFile(repoRoot, adapter, runtime)
  if (!existsSync(activeCrewFile)) return false
  rmSync(activeCrewFile, { force: true })
  return true
}

export function extractCrewArg(argv = []) {
  const remaining = []
  let crew = ""
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === "--crew" && argv[i + 1]) {
      crew = argv[i + 1]
      i += 1
      continue
    }
    if (token.startsWith("--crew=")) {
      crew = token.slice("--crew=".length)
      continue
    }
    remaining.push(token)
  }
  return { crew: `${crew || ""}`.trim(), remaining }
}
