import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import YAML from "yaml"

function toPosix(value) {
  return `${value || ""}`.replaceAll(path.sep, "/")
}

function rel(repoRoot, targetPath) {
  if (!targetPath) return ""
  return toPosix(path.relative(repoRoot, targetPath))
}

function normalizeName(value) {
  return `${value || ""}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function readJsonIfExists(targetPath) {
  if (!targetPath || !existsSync(targetPath)) return null
  try {
    return JSON.parse(readFileSync(targetPath, "utf-8"))
  } catch {
    return null
  }
}

function readYamlIfExists(targetPath) {
  if (!targetPath || !existsSync(targetPath)) return null
  try {
    return YAML.parse(readFileSync(targetPath, "utf-8"))
  } catch {
    return null
  }
}

export function buildAgentIndex(config = {}) {
  const index = {
    orchestrator: null,
    leads: [],
    workers: [],
    teams: [],
    byName: new Map()
  }

  const orchestrator = config?.orchestrator?.name
    ? {
        name: config.orchestrator.name,
        role: "orchestrator",
        team: config.orchestrator.team || "Orchestration",
        description: config.orchestrator.description || ""
      }
    : null

  if (orchestrator) {
    index.orchestrator = orchestrator
    index.byName.set(normalizeName(orchestrator.name), orchestrator)
  }

  for (const team of Array.isArray(config?.teams) ? config.teams : []) {
    const teamName = `${team?.name || ""}`.trim()
    const lead = team?.lead?.name
      ? {
          name: team.lead.name,
          role: "lead",
          team: teamName,
          description: team.lead.description || ""
        }
      : null

    const workers = Array.isArray(team?.members)
      ? team.members
          .filter((member) => member?.name)
          .map((member) => ({
            name: member.name,
            role: "worker",
            team: teamName,
            description: member.description || ""
          }))
      : []

    if (lead) {
      index.leads.push(lead)
      index.byName.set(normalizeName(lead.name), lead)
    }

    for (const worker of workers) {
      index.workers.push(worker)
      index.byName.set(normalizeName(worker.name), worker)
    }

    index.teams.push({
      name: teamName,
      lead,
      workers
    })
  }

  return index
}

function resolveCurrentAgent(index, agentName) {
  if (!agentName) return index.orchestrator
  return index.byName.get(normalizeName(agentName)) || null
}

function buildAllowedTargets(index, currentAgent) {
  if (!currentAgent) return []
  if (currentAgent.role === "worker") return []
  if (currentAgent.role === "orchestrator") {
    return index.leads.map((lead) => ({
      name: lead.name,
      role: lead.role,
      team: lead.team
    }))
  }
  const team = index.teams.find((item) => normalizeName(item.name) === normalizeName(currentAgent.team))
  return (team?.workers || []).map((worker) => ({
    name: worker.name,
    role: worker.role,
    team: worker.team
  }))
}

function resolveRequestedTarget(index, currentAgent, requestedTarget) {
  const direct = index.byName.get(normalizeName(requestedTarget))
  if (!currentAgent) {
    return {
      ok: false,
      error: "Current agent could not be resolved from active context."
    }
  }

  if (currentAgent.role === "worker") {
    return {
      ok: false,
      error: `Worker ${currentAgent.name} cannot delegate work.`
    }
  }

  if (currentAgent.role === "lead") {
    const allowed = buildAllowedTargets(index, currentAgent)
    const selected = allowed.find((item) => normalizeName(item.name) === normalizeName(requestedTarget))
    if (!selected) {
      return {
        ok: false,
        error: `Target "${requestedTarget}" is not a worker in team ${currentAgent.team}.`
      }
    }
    return {
      ok: true,
      requestedTarget,
      effectiveTarget: selected.name,
      effectiveRole: selected.role,
      rerouted: null
    }
  }

  if (!direct) {
    return {
      ok: false,
      error: `Unknown target "${requestedTarget}".`
    }
  }

  if (direct.role === "lead") {
    return {
      ok: true,
      requestedTarget,
      effectiveTarget: direct.name,
      effectiveRole: direct.role,
      rerouted: null
    }
  }

  if (direct.role === "worker") {
    const owner = index.teams.find((team) =>
      team.workers.some((worker) => normalizeName(worker.name) === normalizeName(direct.name))
    )
    if (!owner?.lead) {
      return {
        ok: false,
        error: `Could not resolve owning lead for worker "${direct.name}".`
      }
    }
    return {
      ok: true,
      requestedTarget,
      effectiveTarget: owner.lead.name,
      effectiveRole: owner.lead.role,
      rerouted: {
        originalTarget: direct.name,
        lead: owner.lead.name,
        team: owner.name,
        worker: direct.name
      }
    }
  }

  return {
    ok: false,
    error: `Target "${requestedTarget}" is not delegable from ${currentAgent.role}.`
  }
}

export function loadActiveContext(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || process.cwd())
  const activeCrewEnv = `${options.env?.MAH_ACTIVE_CREW || process.env.MAH_ACTIVE_CREW || ""}`.trim()
  const currentAgentEnv = `${options.env?.MAH_AGENT || process.env.MAH_AGENT || ""}`.trim()
  const activeCrewFile = path.join(repoRoot, ".codex", ".active-crew.json")
  const activeCrewState = readJsonIfExists(activeCrewFile)
  const crew = activeCrewEnv || `${activeCrewState?.crew || ""}`.trim()
  const configPath = crew
    ? path.join(repoRoot, ".codex", "crew", crew, "multi-team.yaml")
    : ""
  const config = readYamlIfExists(configPath)
  const index = buildAgentIndex(config || {})
  const currentAgent = resolveCurrentAgent(index, currentAgentEnv)

  return {
    ok: Boolean(crew && config && currentAgent),
    repoRoot,
    crew: crew || null,
    currentAgentName: currentAgentEnv || null,
    configPath: configPath && existsSync(configPath) ? configPath : null,
    config,
    index,
    currentAgent,
    sources: {
      env: {
        MAH_ACTIVE_CREW: activeCrewEnv || null,
        MAH_AGENT: currentAgentEnv || null
      },
      activeCrewFile: existsSync(activeCrewFile) ? rel(repoRoot, activeCrewFile) : null,
      configPath: configPath && existsSync(configPath) ? rel(repoRoot, configPath) : null
    }
  }
}

export function summarizeActiveContext(state) {
  const sprint = state?.config?.sprint_mode || null
  const currentAgent = state?.currentAgent || null
  return {
    crew: state?.crew || null,
    agent: currentAgent?.name || null,
    role: currentAgent?.role || null,
    team: currentAgent?.team || null,
    mission: state?.config?.mission || null,
    sprint: sprint
      ? {
          name: sprint.name || null,
          target_release: sprint.target_release || null,
          objective: sprint.objective || null,
          execution_mode: sprint.execution_mode || null
        }
      : null,
    config_path: state?.configPath ? rel(state.repoRoot, state.configPath) : null,
    sources: state?.sources || {}
  }
}

export function listAgentsForContext(state) {
  const index = state?.index || buildAgentIndex({})
  const currentAgent = state?.currentAgent || null
  const allowedTargets = buildAllowedTargets(index, currentAgent)
  return {
    current_agent: currentAgent
      ? {
          name: currentAgent.name,
          role: currentAgent.role,
          team: currentAgent.team
        }
      : null,
    orchestrator: index.orchestrator,
    leads: index.leads,
    workers: index.workers,
    allowed_targets: allowedTargets,
    reroute_for_workers: currentAgent?.role === "orchestrator"
      ? index.teams
          .filter((team) => team.lead)
          .map((team) => ({
            lead: team.lead.name,
            team: team.name,
            workers: team.workers.map((worker) => worker.name)
          }))
      : []
  }
}

export function resolveDelegationTarget(state, requestedTarget) {
  return resolveRequestedTarget(state?.index || buildAgentIndex({}), state?.currentAgent || null, requestedTarget)
}

export function buildDelegationTask(task, resolution) {
  if (!resolution?.rerouted) return task
  const rerouted = resolution.rerouted
  return [
    task,
    "",
    "Routing note from MAH Codex plugin:",
    `- Requested worker target: ${rerouted.worker}`,
    `- Team: ${rerouted.team}`,
    "- Delegate internally only to this worker and return worker-specific evidence."
  ].join("\n")
}

export function firstUsefulLine(output) {
  return `${output || ""}`
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) || ""
}
