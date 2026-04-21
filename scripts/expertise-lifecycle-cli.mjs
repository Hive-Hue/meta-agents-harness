/**
 * MAH Expertise Lifecycle CLI
 * Direct lifecycle state transitions for expertise entries.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { canTransition, isAuthorizedTransition, LIFECYCLE_TRANSITIONS } from './expertise-lifecycle.mjs'
import { loadExpertiseById } from './expertise-loader.mjs'
import { buildRegistry } from './expertise-registry.mjs'
import { resolveWorkspaceRoot } from './workspace-root.mjs'
import { computeMetrics } from './expertise-evidence-store.mjs'
import { computeConfidence } from './expertise-confidence.mjs'

const workspaceRoot = resolveWorkspaceRoot()

const VALIDATION_REQUIREMENTS = {
  evidence_count_min: 5,
  review_pass_rate_min: 0.8,
}

function checkTransitionRequirements(_expertise, metrics, from, to) {
  const errors = []

  if (from === 'active' && to === 'validated') {
    const evidenceCount = metrics?.total_invocations || 0
    const reviewPassRate = metrics?.review_pass_rate || 0

    if (evidenceCount < VALIDATION_REQUIREMENTS.evidence_count_min) {
      errors.push(`evidence_count (${evidenceCount}) must be >= ${VALIDATION_REQUIREMENTS.evidence_count_min}`)
    }
    if (reviewPassRate < VALIDATION_REQUIREMENTS.review_pass_rate_min) {
      errors.push(`review_pass_rate (${(reviewPassRate * 100).toFixed(0)}%) must be >= ${(VALIDATION_REQUIREMENTS.review_pass_rate_min * 100).toFixed(0)}%`)
    }
  }

  return { ok: errors.length === 0, errors }
}

export async function transitionLifecycle(id, targetState, options = {}) {
  const { actor = 'orchestrator', reason = '' } = options

  const resolvedId = id?.includes(':') ? id : `dev:${id}`
  const entry = await loadExpertiseById(resolvedId)

  if (!entry) return { ok: false, error: `Expertise not found: ${resolvedId}` }

  const currentState = entry.lifecycle

  if (!canTransition(currentState, targetState)) {
    const allowed = LIFECYCLE_TRANSITIONS[currentState] || []
    return { ok: false, error: `Invalid transition: ${currentState} → ${targetState}`, allowed_transitions: allowed }
  }

  const auth = isAuthorizedTransition({ agent: actor, role: actor }, currentState, targetState)
  if (!auth.authorized) return { ok: false, error: `Unauthorized: ${auth.reason}` }

  const metrics = await computeMetrics(resolvedId)
  computeConfidence(metrics)
  const reqCheck = checkTransitionRequirements(entry, metrics, currentState, targetState)

  if (!reqCheck.ok) {
    return { ok: false, error: `Requirements not met: ${reqCheck.errors.join('; ')}`, requirements: VALIDATION_REQUIREMENTS }
  }

  entry.lifecycle = targetState
  entry.metadata = entry.metadata || {}
  entry.metadata.updated = new Date().toISOString()
  entry.metadata.last_lifecycle_change = {
    from: currentState,
    to: targetState,
    actor,
    reason,
    at: new Date().toISOString(),
  }

  const catalogRoot = join(workspaceRoot, '.mah', 'expertise', 'catalog')
  const [crew, name] = resolvedId.split(':')
  const catalogPath = join(catalogRoot, crew, `${name}.yaml`)

  writeFileSync(catalogPath, stringifyYaml(entry, { indent: 2, lineWidth: 0 }), 'utf-8')

  const registry = await buildRegistry()

  return {
    ok: true,
    changed: { from: currentState, to: targetState },
    registry_entries: registry.total_count,
  }
}
