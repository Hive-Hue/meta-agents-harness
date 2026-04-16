/**
 * MAH Expertise-Aware Routing Algorithm
 * @fileoverview Core routing algorithm for M2/S1 — scores and ranks candidate agents
 * @version 0.7.0
 */

/**
 * @typedef {Object} CandidateScore
 * @property {string} agent_id
 * @property {number} match_score
 * @property {number} confidence_adjustment
 * @property {number} penalty
 * @property {number} final_score
 * @property {string} [confidence_band]
 * @property {string[]} penalties_applied
 * @property {string[]} passed_filters
 * @property {string[]} blocked_filters
 */

/**
 * @typedef {Object} ExplainPayload
 * @property {string} task
 * @property {string} source_agent
 * @property {string[]} input_candidates
 * @property {number} filtered_count
 * @property {string} scoring_summary
 * @property {string} selected_reason
 * @property {boolean} fallback_triggered
 * @property {string|null} fallback_reason
 * @property {string} timestamp
 */

/**
 * @typedef {Object} RoutingResult
 * @property {string|null} selected
 * @property {Record<string, CandidateScore>} scores
 * @property {ExplainPayload} explain
 * @property {boolean} escalation
 * @property {string|null} fallback_reason
 */

/**
 * @typedef {Object} ScoreCandidatesOptions
 * @property {string[]} [allowed_environments] - active environment context
 * @property {number} [threshold] - minimum final_score to avoid escalation (default 0.3)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIDENCE_ADJUSTMENTS = {
  low: -0.3,
  medium: -0.1,
  high: 0.0,
  critical: 0.1,
}

const SCORE_EXACT_CAPABILITY = 0.3
const SCORE_DOMAIN_MATCH = 0.2
const SCORE_PARTIAL_CAPABILITY = 0.1
const SCORE_MAX = 1.0

const LIFECYCLE_PENALTY_EXPERIMENTAL = -0.15
const VALIDATION_PENALTY_OBSERVED = -0.05
const PENALTY_PER_FAILURE = -0.2
const PENALTY_MAX_FAILURES = 2 // max -0.4
const FRESHNESS_PENALTY_THRESHOLD = 3
const FRESHNESS_PENALTY = -0.1
const DEFAULT_THRESHOLD = 0.3

const BLOCKED_VALIDATION_STATUSES = ['restricted', 'revoked']

// ---------------------------------------------------------------------------
// Internal scoring helpers
// ---------------------------------------------------------------------------

/**
 * Calculate keyword-overlap match score between task and expertise.
 * Simple exact + partial token matching — no fuzzy engine in v0.7.0.
 *
 * @param {string} task - task description
 * @param {string[]} capabilities
 * @param {string[]} domains
 * @param {Object} input_contract
 * @returns {number} 0-1 score
 */
function calculateMatchScore(task, capabilities, domains, input_contract = {}) {
  const taskLower = task.toLowerCase()
  const taskTokens = taskLower.split(/\s+/).filter(Boolean)

  let score = 0.0

  // Exact capability match: +0.3 per matched capability
  for (const cap of capabilities) {
    const capLower = cap.toLowerCase()
    // Check if any task token contains the capability or vice versa
    const exactMatch = taskTokens.some(t => t === capLower || capLower.includes(t) || t.includes(capLower))
    if (exactMatch) {
      score += SCORE_EXACT_CAPABILITY
    } else {
      // Partial match: check word overlap
      const capWords = capLower.split(/\s+/)
      const partialHit = capWords.some(w => w.length > 2 && taskTokens.some(t => t.includes(w) || w.includes(t)))
      if (partialHit) {
        score += SCORE_PARTIAL_CAPABILITY
      }
    }
  }

  // Domain match: +0.2 per matched domain
  for (const domain of domains) {
    const domainLower = domain.toLowerCase()
    const domainWords = domainLower.split(/\s+/)
    const domainHit = domainWords.some(w => w.length > 2 && taskTokens.some(t => t.includes(w) || w.includes(t)))
    if (domainHit) {
      score += SCORE_DOMAIN_MATCH
    }
  }

  // Input contract overlap
  if (input_contract && typeof input_contract === 'object') {
    const requiredFields = input_contract.required_fields || []
    for (const field of requiredFields) {
      const fieldLower = field.toLowerCase()
      if (taskTokens.some(t => t.includes(fieldLower) || fieldLower.includes(t))) {
        score += SCORE_PARTIAL_CAPABILITY
      }
    }
  }

  return Math.min(score, SCORE_MAX)
}

/**
 * Compute confidence adjustment based on band and evidence count.
 * @param {Object} confidence
 * @param {number} evidence_count
 * @returns {number} adjustment in range [-0.4, +0.1]
 */
function computeConfidenceAdjustment(confidence, evidence_count) {
  const band = confidence?.band || 'medium'
  const adjustment = CONFIDENCE_ADJUSTMENTS[band] ?? 0.0

  // Freshness penalty: low evidence count
  const freshPenalty = (evidence_count < FRESHNESS_PENALTY_THRESHOLD) ? FRESHNESS_PENALTY : 0.0

  return adjustment + freshPenalty
}

/**
 * Compute all penalties for a candidate's expertise.
 * @param {Object} expertise
 * @param {string[]} [failureEvidence] - list of failure evidence ids (simulated in v0.7.0)
 * @returns {{ penalty: number, penalties_applied: string[] }}
 */
function computePenalties(expertise, failureEvidence = []) {
  /** @type {string[]} */
  const penalties_applied = []
  let penalty = 0.0

  // Lifecycle penalty
  if (expertise.lifecycle === 'experimental') {
    penalty += LIFECYCLE_PENALTY_EXPERIMENTAL
    penalties_applied.push('lifecycle:experimental')
  }

  // Validation status penalty
  if (expertise.validation_status === 'observed') {
    penalty += VALIDATION_PENALTY_OBSERVED
    penalties_applied.push('validation_status:observed')
  }

  // Failure evidence penalty
  const failureCount = Math.min(failureEvidence.length, PENALTY_MAX_FAILURES)
  for (let i = 0; i < failureCount; i++) {
    penalty += PENALTY_PER_FAILURE
    penalties_applied.push(`failure_evidence:${failureEvidence[i] || 'recent'}`)
  }

  return { penalty, penalties_applied }
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

/**
 * Check if candidate passes environment filter.
 * @param {Object} expertise
 * @param {string[]} [allowedEnvironments]
 * @returns {{ passes: boolean, reason: string|null }}
 */
function checkEnvironmentFilter(expertise, allowedEnvironments) {
  if (!allowedEnvironments || allowedEnvironments.length === 0) {
    return { passes: true, reason: null }
  }

  const expEnvs = expertise.allowed_environments
  if (!expEnvs || expEnvs.length === 0) {
    // No restriction set on expertise → passes
    return { passes: true, reason: null }
  }

  const overlap = expEnvs.some(env => allowedEnvironments.includes(env))
  if (!overlap) {
    return {
      passes: false,
      reason: `allowed_environments mismatch: candidate requires [${expEnvs.join(', ')}], task runs in [${allowedEnvironments.join(', ')}]`
    }
  }

  return { passes: true, reason: null }
}

/**
 * Check if candidate passes validation status filter.
 * @param {string} validation_status
 * @returns {{ passes: boolean, reason: string|null }}
 */
function checkValidationStatusFilter(validation_status) {
  if (BLOCKED_VALIDATION_STATUSES.includes(validation_status)) {
    return {
      passes: false,
      reason: `validation_status=${validation_status} is blocked`
    }
  }
  return { passes: true, reason: null }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Score and rank candidate expertise entries within the policy-allowed set.
 *
 * Policy/topology filtering is ALREADY DONE by delegation-resolution.
 * This function ONLY ranks within the allowed set.
 *
 * @param {Object} params
 * @param {string} params.task - task description
 * @param {string} params.sourceAgent - delegating agent id
 * @param {Array} params.candidates - array of expertise objects (already allowed)
 * @param {ScoreCandidatesOptions} [params.options]
 * @returns {RoutingResult}
 */
export function scoreCandidates({ task, sourceAgent, candidates, options = {} }) {
  const {
    allowed_environments: allowedEnvs,
    threshold = DEFAULT_THRESHOLD,
  } = options

  const inputCandidates = candidates.map(c => c.id || c.expertise_id || String(c))

  /** @type {Record<string, CandidateScore>} */
  const scores = {}
  /** @type {Array<{id: string, score: CandidateScore}>} */
  const ranked = []

  // --- Phase 1: Filter and score each candidate ---
  for (const candidate of candidates) {
    const id = candidate.id || candidate.expertise_id
    const expertise = candidate.expertise || candidate

    /** @type {string[]} */
    const passed_filters = []
    /** @type {string[]} */
    const blocked_filters = []

    // Filter 1: allowed_environments
    const envCheck = checkEnvironmentFilter(expertise, allowedEnvs)
    if (!envCheck.passes) {
      blocked_filters.push(`allowed_environments: ${envCheck.reason}`)
      scores[id] = {
        agent_id: id,
        match_score: 0,
        confidence_adjustment: 0,
        penalty: 0,
        final_score: 0,
        confidence_band: expertise.confidence?.band || 'medium',
        penalties_applied: [],
        passed_filters,
        blocked_filters,
      }
      continue
    }
    passed_filters.push('allowed_environments')

    // Filter 2: validation_status
    const valCheck = checkValidationStatusFilter(expertise.validation_status)
    if (!valCheck.passes) {
      blocked_filters.push(`validation_status: ${valCheck.reason}`)
      scores[id] = {
        agent_id: id,
        match_score: 0,
        confidence_adjustment: 0,
        penalty: 0,
        final_score: 0,
        confidence_band: expertise.confidence?.band || 'medium',
        penalties_applied: [],
        passed_filters,
        blocked_filters,
      }
      continue
    }
    passed_filters.push('validation_status')

    // Filter 3: trust_tier_required (if set in candidate expertise)
    // v0.7.0: no trust_tier_required field on candidate; skip

    // Compute match_score
    const match_score = calculateMatchScore(
      task,
      expertise.capabilities || [],
      expertise.domains || [],
      expertise.input_contract
    )

    // Compute confidence adjustment
    const evidence_count = expertise.confidence?.evidence_count ?? 0
    const confidence_adjustment = computeConfidenceAdjustment(
      expertise.confidence || {},
      evidence_count
    )

    // Compute penalties
    // In v0.7.0 evidence store is not integrated; use empty array
    const { penalty, penalties_applied } = computePenalties(expertise, [])

    // Final score
    const final_score = Math.max(0, match_score + confidence_adjustment + penalty)

    scores[id] = {
      agent_id: id,
      match_score,
      confidence_adjustment,
      penalty,
      final_score,
      confidence_band: expertise.confidence?.band || 'medium',
      penalties_applied,
      passed_filters,
      blocked_filters,
    }

    ranked.push({ id, score: scores[id] })
  }

  // --- Phase 2: Sort by final_score descending ---
  ranked.sort((a, b) => b.score.final_score - a.score.final_score)

  const filteredCount = candidates.length - ranked.length

  // --- Phase 3: Build result ---
  const top = ranked[0] || null
  const escalation = !top || top.score.final_score < threshold

  let selected = null
  let selectedReason = ''
  let fallbackReason = null

  if (!top) {
    fallbackReason = 'all-candidates-blocked'
    selectedReason = 'No candidates passed filters'
  } else if (escalation) {
    selected = top.id
    selectedReason = `top candidate ${top.id} score ${top.score.final_score.toFixed(3)} below threshold ${threshold}`
    fallbackReason = `score below threshold (${top.score.final_score.toFixed(3)} < ${threshold})`
  } else {
    selected = top.id
    selectedReason = `best match: ${top.id} with score ${top.score.final_score.toFixed(3)}`
  }

  // Build scoring summary
  const scoreLines = ranked.map(({ id, score }) => {
    const parts = [
      `${id}: match=${score.match_score.toFixed(2)}`,
      `conf_adj=${score.confidence_adjustment.toFixed(2)}`,
      `final=${score.final_score.toFixed(3)}`,
    ]
    if (score.penalties_applied.length > 0) {
      parts.push(`penalties=[${score.penalties_applied.join(', ')}]`)
    }
    return `  ${parts.join(', ')}`
  })
  const scoringSummary = scoreLines.join('\n')

  const explain = {
    task,
    source_agent: sourceAgent,
    input_candidates: inputCandidates,
    filtered_count: filteredCount,
    filters_run: ['allowed_environments', 'validation_status', 'expertise_match', 'confidence', 'lifecycle_penalties'],
    blocking: Object.fromEntries(
      Object.entries(scores)
        .filter(([, score]) => score.blocked_filters.length > 0)
        .map(([id, score]) => [id, score.blocked_filters])
    ),
    scoring_summary: scoringSummary,
    selected_reason: selectedReason,
    fallback_triggered: escalation,
    fallback_reason: fallbackReason,
    timestamp: new Date().toISOString(),
  }

  return {
    selected,
    scores,
    explain,
    escalation,
    fallback_reason: fallbackReason,
  }
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== Expertise Routing Self-Test ===\n')

  // Mock candidates representing different expertise profiles
  const mockCandidates = [
    {
      id: 'orchestrator-1',
      expertise: {
        id: 'orchestrator-1',
        capabilities: ['task-planning', 'crew-coordination', 'delegation'],
        domains: ['software-engineering', 'multi-agent-systems'],
        input_contract: { required_fields: ['task_description'], optional_fields: ['context'], field_types: {} },
        allowed_environments: ['production', 'staging'],
        validation_status: 'validated',
        lifecycle: 'active',
        confidence: { score: 0.9, band: 'high', evidence_count: 15 },
        trust_tier: 'internal',
      },
    },
    {
      id: 'dev-lead-1',
      expertise: {
        id: 'dev-lead-1',
        capabilities: ['code-review', 'task-planning', 'architecture'],
        domains: ['software-engineering'],
        input_contract: { required_fields: ['task_description'], optional_fields: [], field_types: {} },
        allowed_environments: ['production', 'staging', 'development'],
        validation_status: 'validated',
        lifecycle: 'active',
        confidence: { score: 0.75, band: 'high', evidence_count: 8 },
        trust_tier: 'internal',
      },
    },
    {
      id: 'worker-dev-1',
      expertise: {
        id: 'worker-dev-1',
        capabilities: ['coding', 'testing', 'debugging'],
        domains: ['software-engineering'],
        input_contract: { required_fields: ['task_description'], optional_fields: [], field_types: {} },
        allowed_environments: ['development'],
        validation_status: 'observed',
        lifecycle: 'active',
        confidence: { score: 0.5, band: 'medium', evidence_count: 4 },
        trust_tier: 'internal',
      },
    },
    {
      id: 'experimental-agent',
      expertise: {
        id: 'experimental-agent',
        capabilities: ['task-planning', 'crew-coordination'],
        domains: ['software-engineering'],
        input_contract: { required_fields: [], optional_fields: [], field_types: {} },
        allowed_environments: [],
        validation_status: 'declared',
        lifecycle: 'experimental',
        confidence: { score: 0.4, band: 'low', evidence_count: 1 },
        trust_tier: 'internal',
      },
    },
    {
      id: 'restricted-agent',
      expertise: {
        id: 'restricted-agent',
        capabilities: ['security-audit'],
        domains: ['security'],
        input_contract: { required_fields: [], optional_fields: [], field_types: {} },
        allowed_environments: [],
        validation_status: 'restricted',
        lifecycle: 'active',
        confidence: { score: 0.95, band: 'critical', evidence_count: 20 },
        trust_tier: 'internal',
      },
    },
  ]

  // Test 1: Normal task with production/staging environments
  console.log('Test 1: Normal task (task-planning), env=[production, staging]')
  const result1 = scoreCandidates({
    task: 'Plan the task breakdown for the new feature implementation',
    sourceAgent: 'orchestrator-1',
    candidates: mockCandidates,
    options: { allowed_environments: ['production', 'staging'] },
  })
  console.log(`  Selected: ${result1.selected}`)
  console.log(`  Escalation: ${result1.escalation}`)
  console.log(`  Scores:\n${result1.explain.scoring_summary}\n`)

  // Test 2: Development-only task
  console.log('Test 2: Development task, env=[development]')
  const result2 = scoreCandidates({
    task: 'Write unit tests for the authentication module',
    sourceAgent: 'dev-lead-1',
    candidates: mockCandidates,
    options: { allowed_environments: ['development'] },
  })
  console.log(`  Selected: ${result2.selected}`)
  console.log(`  Escalation: ${result2.escalation}`)
  console.log(`  Scores:\n${result2.explain.scoring_summary}\n`)

  // Test 3: All candidates blocked (env mismatch + restricted)
  console.log('Test 3: Task with restricted agent only (should trigger escalation + fallback)')
  const result3 = scoreCandidates({
    task: 'Perform a security audit',
    sourceAgent: 'orchestrator-1',
    candidates: [mockCandidates[4]], // restricted-agent
    options: { allowed_environments: ['production'] },
  })
  console.log(`  Selected: ${result3.selected}`)
  console.log(`  Escalation: ${result3.escalation}`)
  console.log(`  Fallback reason: ${result3.fallback_reason}`)
  console.log(`  Scores:\n${result3.explain.scoring_summary}\n`)

  // Test 4: Low confidence + experimental penalties
  console.log('Test 4: Experimental agent with low evidence')
  const result4 = scoreCandidates({
    task: 'Coordinate the crew for planning',
    sourceAgent: 'orchestrator-1',
    candidates: [mockCandidates[3]], // experimental-agent
    options: { allowed_environments: ['production'] },
  })
  console.log(`  Selected: ${result4.selected}`)
  console.log(`  Final score: ${result4.scores['experimental-agent']?.final_score.toFixed(3)}`)
  console.log(`  Penalties: ${result4.scores['experimental-agent']?.penalties_applied.join(', ')}\n`)

  // Test 5: Empty candidate list
  console.log('Test 5: Empty candidate list')
  const result5 = scoreCandidates({
    task: 'Do something',
    sourceAgent: 'orchestrator-1',
    candidates: [],
  })
  console.log(`  Selected: ${result5.selected}`)
  console.log(`  Escalation: ${result5.escalation}`)
  console.log(`  Fallback reason: ${result5.fallback_reason}\n`)

  console.log('=== All Self-Tests Passed ===')
}
