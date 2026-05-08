const BLOCKED_VALIDATION_STATUSES = new Set(["restricted", "revoked"])

const DEFAULT_WEIGHTS = {
  expertise: 0.6,
  context: 0.1,
  continuity: 0.1,
  activeCrewPreference: 0.1,
  domainFit: 0.1
}

function tokenize(text = "") {
  return `${text || ""}`
    .toLowerCase()
    .split(/[^a-z0-9._-]+/)
    .filter(Boolean)
}

function overlapScore(taskTokens, values = []) {
  if (!taskTokens.length || !values.length) return 0
  const terms = values.flatMap((value) => tokenize(value))
  if (!terms.length) return 0
  const matched = terms.filter((term) => taskTokens.some((token) => token.includes(term) || term.includes(token)))
  return Math.min(1, matched.length / Math.max(1, terms.length))
}

function resolveExpertiseScore(candidate, registryEntry, taskTokens) {
  const capabilityScore = overlapScore(taskTokens, registryEntry?.capabilities || [])
  const domainScore = overlapScore(taskTokens, registryEntry?.domains || [])
  const confidenceScore = typeof registryEntry?.confidence?.score === "number" ? registryEntry.confidence.score : 0.5
  const blended = (capabilityScore * 0.5) + (domainScore * 0.25) + (confidenceScore * 0.25)
  return Math.max(0, Math.min(1, blended))
}

function resolveDomainFit(candidate, requiredDomainProfiles = []) {
  if (!requiredDomainProfiles.length) return 1
  const candidateProfiles = Array.isArray(candidate?.domainProfiles) ? candidate.domainProfiles : []
  return candidateProfiles.some((item) => requiredDomainProfiles.includes(item)) ? 1 : 0
}

function rankValue(value, weight) {
  return Number((value * weight).toFixed(6))
}

export function rankCooperativeCandidates({
  task = "",
  candidates = [],
  sourceCrew = "",
  expertiseById = {},
  weights = {},
  requiredDomainProfiles = []
} = {}) {
  const selectedWeights = { ...DEFAULT_WEIGHTS, ...(weights || {}) }
  const taskTokens = tokenize(task)

  const scored = []
  const excluded = []

  for (const candidate of candidates) {
    const agentId = `${candidate?.agent || ""}`.trim()
    if (!agentId) continue
    if (candidate?.runtimeCompatible === false) {
      excluded.push({ agent: agentId, crew: candidate?.crew || "", reason: "runtime_incompatible" })
      continue
    }

    const expertiseId = `${candidate?.crew || ""}:${agentId}`
    const registryEntry = expertiseById[expertiseId] || null
    const validationStatus = `${registryEntry?.validation_status || "declared"}`.trim()
    if (BLOCKED_VALIDATION_STATUSES.has(validationStatus)) {
      excluded.push({ agent: agentId, crew: candidate?.crew || "", reason: `validation_status:${validationStatus}` })
      continue
    }

    const domainFitValue = resolveDomainFit(candidate, requiredDomainProfiles)
    if (domainFitValue <= 0) {
      excluded.push({ agent: agentId, crew: candidate?.crew || "", reason: "domain_profile_mismatch" })
      continue
    }

    const expertiseValue = resolveExpertiseScore(candidate, registryEntry, taskTokens)
    const contextValue = 0.5
    const continuityValue = 0.5
    const activeCrewPreferenceValue = candidate?.crew === sourceCrew ? 1 : 0

    const components = {
      expertise: rankValue(expertiseValue, selectedWeights.expertise),
      context: rankValue(contextValue, selectedWeights.context),
      continuity: rankValue(continuityValue, selectedWeights.continuity),
      activeCrewPreference: rankValue(activeCrewPreferenceValue, selectedWeights.activeCrewPreference),
      domainFit: rankValue(domainFitValue, selectedWeights.domainFit)
    }
    const total = Object.values(components).reduce((sum, value) => sum + value, 0)

    scored.push({
      ...candidate,
      expertiseId,
      validationStatus,
      components,
      score: Number(total.toFixed(6))
    })
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    if (right.components.expertise !== left.components.expertise) {
      return right.components.expertise - left.components.expertise
    }
    if (right.components.activeCrewPreference !== left.components.activeCrewPreference) {
      return right.components.activeCrewPreference - left.components.activeCrewPreference
    }
    return `${left.crew}:${left.agent}`.localeCompare(`${right.crew}:${right.agent}`)
  })

  return {
    selected: scored[0] ? { crew: scored[0].crew, agent: scored[0].agent, score: scored[0].score } : null,
    ranking: scored,
    excluded,
    weights: selectedWeights
  }
}
