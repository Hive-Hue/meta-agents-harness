import path from "node:path"
import { existsSync } from "node:fs"
import { readMetaConfig } from "../session/m3-ops.mjs"

function resolveCrewConfigPath(repoRoot, runtimeProfile = {}, crewId = "", runtime = "") {
  if (!crewId || !runtime) return ""
  const configPattern = `${runtimeProfile?.configPattern || ""}`.trim()
  if (configPattern) {
    const interpolated = configPattern.replaceAll("<crew>", crewId)
    return path.isAbsolute(interpolated) ? interpolated : path.join(repoRoot, interpolated)
  }
  const markerDir = `${runtimeProfile?.markerDir || `.${runtime}`}`.trim()
  return path.join(repoRoot, markerDir, "crew", crewId, "multi-team.yaml")
}

function isRuntimeCompatible({ repoRoot, runtime, runtimeProfile, crew }) {
  if (!runtime || !crew?.id) return false
  const sourceConfig = `${crew?.source_configs?.[runtime] || ""}`.trim()
  if (sourceConfig) {
    const absolute = path.isAbsolute(sourceConfig) ? sourceConfig : path.join(repoRoot, sourceConfig)
    return existsSync(absolute)
  }
  const defaultPath = resolveCrewConfigPath(repoRoot, runtimeProfile, crew.id, runtime)
  return !!defaultPath && existsSync(defaultPath)
}

function normalizeCandidate(crew, agent, runtimeCompatible) {
  return {
    crew: `${crew?.id || ""}`.trim(),
    agent: `${agent?.id || ""}`.trim(),
    role: `${agent?.role || ""}`.trim(),
    team: `${agent?.team || ""}`.trim(),
    skills: Array.isArray(agent?.skills) ? agent.skills.filter(Boolean) : [],
    domainProfiles: [
      ...new Set(
        [agent?.domain_profile, ...(Array.isArray(agent?.domain_profiles) ? agent.domain_profiles : [])]
          .filter((item) => typeof item === "string" && item.trim())
      )
    ],
    runtimeCompatible
  }
}

export function resolveWorkspaceCandidates({
  repoRoot,
  runtime,
  sourceCrew = "",
  routingScope = "active_crew",
  runtimeProfile = {}
} = {}) {
  const meta = readMetaConfig(repoRoot)
  const allCrews = Array.isArray(meta?.crews) ? meta.crews : []
  const resolvedSourceCrew = `${sourceCrew || allCrews?.[0]?.id || ""}`.trim()

  const scopedCrews = routingScope === "full_crews"
    ? allCrews
    : allCrews.filter((crew) => `${crew?.id || ""}`.trim() === resolvedSourceCrew)

  const candidateCrews = []
  const candidates = []

  for (const crew of scopedCrews) {
    const runtimeCompatible = isRuntimeCompatible({ repoRoot, runtime, runtimeProfile, crew })
    if (!runtimeCompatible) continue
    candidateCrews.push(`${crew?.id || ""}`.trim())

    for (const agent of Array.isArray(crew?.agents) ? crew.agents : []) {
      const candidate = normalizeCandidate(crew, agent, runtimeCompatible)
      if (!candidate.agent) continue
      candidates.push(candidate)
    }
  }

  return {
    routingScope,
    sourceCrew: resolvedSourceCrew,
    candidateCrews,
    candidates
  }
}
