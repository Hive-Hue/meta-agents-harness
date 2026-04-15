/**
 * DelegationResolution — v0.6.0
 *
 * Shared service for resolving logical delegation targets.
 * The crew topology is the AUTHORITY for "who can delegate to whom".
 * Runtime target is a SEPARATE concern from authorization.
 *
 * Rules enforced:
 *   1. Self-delegation (sourceAgent === logicalTarget) → blocked
 *   2. orchestrator → can only target leads
 *   3. lead → can only target workers in own team
 *   4. worker → cannot delegate (future capability excluded)
 */

import { readMetaConfig } from "./m3-ops.mjs"

// ---------------------------------------------------------------------------
// Agent role resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the role of an agent from the crew topology.
 *
 * @param {Object} crew - Parsed crew object from meta-agents.yaml
 * @param {string} agentId - Logical agent identifier
 * @returns {{ role: 'orchestrator'|'lead'|'worker'|null, team: string|null }}
 */
function resolveAgentRole(crew, agentId) {
  const topo = crew?.topology
  if (!topo) return { role: null, team: null }

  // Check orchestrator
  if (topo.orchestrator === agentId) {
    return { role: "orchestrator", team: "orchestration" }
  }

  // Check leads
  if (topo.leads && typeof topo.leads === "object") {
    for (const [teamName, leadId] of Object.entries(topo.leads)) {
      if (leadId === agentId) {
        return { role: "lead", team: teamName }
      }
    }
  }

  // Check workers
  if (topo.workers && typeof topo.workers === "object") {
    for (const [teamName, workers] of Object.entries(topo.workers)) {
      if (Array.isArray(workers) && workers.includes(agentId)) {
        return { role: "worker", team: teamName }
      }
    }
  }

  return { role: null, team: null }
}

/**
 * Returns the set of valid delegation targets for a given role and team.
 *
 * @param {Object} crew - Parsed crew object
 * @param {'orchestrator'|'lead'|'worker'} role
 * @param {string|null} team - Team name (relevant for leads)
 * @returns {string[]} Array of valid target agent ids
 */
function getValidTargets(crew, role, team) {
  const topo = crew?.topology
  if (!topo) return []

  if (role === "orchestrator") {
    // orchestrator can only target leads
    if (!topo.leads || typeof topo.leads !== "object") return []
    return Object.values(topo.leads)
  }

  if (role === "lead") {
    // lead can only target workers in own team
    if (!team || !topo.workers || !Array.isArray(topo.workers[team])) return []
    return topo.workers[team]
  }

  // workers cannot delegate
  return []
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves a delegation target against crew topology rules.
 *
 * @param {Object} ctx
 * @param {string} ctx.crew         - Crew identifier (e.g. "dev")
 * @param {string} ctx.sourceAgent  - Logical agent id of the delegator
 * @param {string} ctx.sourceRuntime - Runtime of the delegator (informational, not used for auth)
 * @param {string} ctx.logicalTarget - Requested logical target agent id
 * @param {string} [ctx.repoRoot]   - Repository root (defaults to process.cwd())
 *
 * @returns {{ ok: boolean, effectiveTarget: string, rerouted: boolean, mode: string|null, error: string|null }}
 */
export function resolveDelegationTarget({ crew: crewId, sourceAgent, sourceRuntime, logicalTarget, repoRoot }) {
  const root = repoRoot || process.cwd()

  // --- Load crew data ---
  let meta
  try {
    meta = readMetaConfig(root)
  } catch (err) {
    return {
      ok: false,
      effectiveTarget: "",
      rerouted: false,
      mode: null,
      error: `failed to read meta-agents.yaml: ${err.message}`
    }
  }

  const crew = meta.crews?.find(c => c.id === crewId)
  if (!crew) {
    return {
      ok: false,
      effectiveTarget: "",
      rerouted: false,
      mode: null,
      error: `crew '${crewId}' not found in meta-agents.yaml`
    }
  }

  // --- Resolve source agent role ---
  const { role, team } = resolveAgentRole(crew, sourceAgent)
  if (!role) {
    return {
      ok: false,
      effectiveTarget: "",
      rerouted: false,
      mode: null,
      error: `source agent '${sourceAgent}' not found in crew '${crewId}' topology`
    }
  }

  // --- Rule 1: self-delegation blocked ---
  if (logicalTarget === sourceAgent) {
    return {
      ok: false,
      effectiveTarget: "",
      rerouted: false,
      mode: null,
      error: "self-delegation not allowed"
    }
  }

  // --- Rule 4: workers cannot delegate ---
  if (role === "worker") {
    return {
      ok: false,
      effectiveTarget: "",
      rerouted: false,
      mode: null,
      error: "workers cannot delegate (future capability excluded)"
    }
  }

  // --- Validate target exists in topology ---
  const { role: targetRole } = resolveAgentRole(crew, logicalTarget)
  if (!targetRole) {
    return {
      ok: false,
      effectiveTarget: "",
      rerouted: false,
      mode: null,
      error: `target agent '${logicalTarget}' not found in crew '${crewId}' topology`
    }
  }

  // --- Rule 2 & 3: role-based authorization ---
  const validTargets = getValidTargets(crew, role, team)

  if (!validTargets.includes(logicalTarget)) {
    const roleDescription = role === "orchestrator"
      ? `orchestrator can only target leads: [${validTargets.join(", ")}]`
      : `lead of team '${team}' can only target own team's workers: [${validTargets.join(", ")}]`

    return {
      ok: false,
      effectiveTarget: "",
      rerouted: false,
      mode: null,
      error: `${sourceAgent} (${role}) cannot delegate to '${logicalTarget}': ${roleDescription}`
    }
  }

  // --- Determine spawn mode hint ---
  const targetRuntime = sourceRuntime || ""
  const mode = targetRuntime ? "native-same-runtime" : null

  return {
    ok: true,
    effectiveTarget: logicalTarget,
    rerouted: false,
    mode,
    error: null
  }
}

/**
 * Lists all valid delegation targets for a given source agent.
 *
 * @param {Object} ctx
 * @param {string} ctx.crew         - Crew identifier
 * @param {string} ctx.sourceAgent  - Logical agent id of the delegator
 * @param {string} [ctx.repoRoot]   - Repository root
 * @returns {{ ok: boolean, targets: string[], role: string|null, team: string|null, error: string|null }}
 */
export function listDelegationTargets({ crew: crewId, sourceAgent, repoRoot }) {
  const root = repoRoot || process.cwd()

  let meta
  try {
    meta = readMetaConfig(root)
  } catch (err) {
    return { ok: false, targets: [], role: null, team: null, error: `failed to read meta-agents.yaml: ${err.message}` }
  }

  const crew = meta.crews?.find(c => c.id === crewId)
  if (!crew) {
    return { ok: false, targets: [], role: null, team: null, error: `crew '${crewId}' not found` }
  }

  const { role, team } = resolveAgentRole(crew, sourceAgent)
  if (!role) {
    return { ok: false, targets: [], role: null, team: null, error: `agent '${sourceAgent}' not found in crew '${crewId}'` }
  }

  if (role === "worker") {
    return { ok: true, targets: [], role, team, error: null }
  }

  const targets = getValidTargets(crew, role, team)
  return { ok: true, targets, role, team, error: null }
}
