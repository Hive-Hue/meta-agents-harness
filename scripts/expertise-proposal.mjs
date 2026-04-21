/**
 * MAH Expertise Proposal Generator
 * @fileoverview Create governed proposal artifacts for expertise catalog updates
 * @version 0.7.0
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadExpertiseById } from './expertise-loader.mjs'
import { validateExportPath } from './expertise-export.mjs'
import { loadEvidenceFor, computeMetrics } from './expertise-evidence-store.mjs'
import { resolveWorkspaceRoot } from './workspace-root.mjs'
import { PROPOSAL_SCHEMA_VERSION } from '../types/expertise-types.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const workspaceRoot = resolveWorkspaceRoot()

function nowStamp() {
  return new Date().toISOString()
}

function safeSlug(value) {
  return String(value || 'proposal')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function inferActorRole(actor) {
  if (!actor) return null
  if (actor.role) return actor.role
  const agent = String(actor.agent || actor.id || '')
  if (agent === 'orchestrator') return 'orchestrator'
  if (agent.endsWith('-lead')) return 'lead'
  return 'worker'
}

export function canGenerateProposal(actor) {
  const role = inferActorRole(actor)
  return role === 'orchestrator' || role === 'lead'
}

export function buildExpertiseProposal({
  targetExpertise,
  actor,
  summary,
  rationale = '',
  proposedChanges = {},
  evidenceRefs = [],
  reviewers = [],
}) {
  if (!targetExpertise?.id) {
    return { ok: false, error: 'targetExpertise is required' }
  }

  if (!canGenerateProposal(actor)) {
    return {
      ok: false,
      error: `proposal generation is restricted to orchestrator/leads; got role '${inferActorRole(actor) || 'none'}'`,
    }
  }

  if (typeof summary !== 'string' || !summary.trim()) {
    return { ok: false, error: 'summary is required' }
  }

  const actorRole = inferActorRole(actor)
  const actorId = actor?.agent || actor?.id || actor?.name || 'unknown'
  const targetParts = targetExpertise.id.split(':')
  const targetOwner = targetExpertise.owner && typeof targetExpertise.owner === 'object'
    ? targetExpertise.owner
    : {
        agent: targetParts[1] || targetExpertise.id,
        team: targetParts[0] || 'dev',
      }

  const proposal = {
    proposal_version: PROPOSAL_SCHEMA_VERSION,
    id: `proposal:${safeSlug(targetExpertise.id)}:${Date.now()}`,
    status: 'draft',
    generated_at: nowStamp(),
    generated_by: {
      actor: actorId,
      role: actorRole || 'lead',
      team: actor?.team || targetOwner.team || 'dev',
    },
    target_expertise_id: targetExpertise.id,
    target_owner: targetOwner,
    target_snapshot: {
      schema_version: targetExpertise.schema_version,
      validation_status: targetExpertise.validation_status,
      lifecycle: targetExpertise.lifecycle,
      trust_tier: targetExpertise.trust_tier,
      confidence: targetExpertise.confidence,
      capabilities: targetExpertise.capabilities,
      domains: targetExpertise.domains,
    },
    summary: summary.trim(),
    rationale: rationale.trim(),
    proposed_changes: proposedChanges && typeof proposedChanges === 'object' ? proposedChanges : {},
    evidence_refs: Array.isArray(evidenceRefs) ? evidenceRefs : [],
    reviewers: Array.isArray(reviewers) ? reviewers : [],
    governance: {
      generated_by_roles: ['orchestrator', 'lead'],
      review_required_by: ['validation-lead', 'security-reviewer'],
      auto_apply: false,
    },
    source: {
      catalog_path: targetExpertise.__source_file ? targetExpertise.__source_file : null,
    },
  }

  return { ok: true, proposal }
}

function summarizeRecentEvidence(events = [], limit = 5) {
  const recent = Array.isArray(events) ? events.slice(-limit) : []
  if (recent.length === 0) return 'No recent evidence available.'

  const outcomeCounts = recent.reduce((acc, ev) => {
    const key = ev.outcome || 'unknown'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const taskTypes = [...new Set(recent.map(ev => ev.task_type).filter(Boolean))]
  const latest = recent[recent.length - 1]
  const parts = [
    `${recent.length} recent evidence event(s)`,
    `outcomes: ${Object.entries(outcomeCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`,
  ]
  if (taskTypes.length > 0) parts.push(`task types: ${taskTypes.join(', ')}`)
  if (latest?.task_description) parts.push(`latest: ${latest.task_description}`)
  return parts.join(' | ')
}

function deriveProposalChangesFromEvidence(targetExpertise, metrics, recentEvents = []) {
  const changes = {}
  const reviewRate = metrics?.review_pass_rate ?? 0
  const evidenceCount = metrics?.evidence_count ?? 0
  const hasStrongEvidence = evidenceCount >= 3 && reviewRate >= 0.8

  if (hasStrongEvidence && targetExpertise.validation_status !== 'validated') {
    changes.validation_status = 'validated'
  }

  if (evidenceCount > 0) {
    const currentConfidence = targetExpertise.confidence || {}
    const computedScore = Math.min(0.95, Math.max(currentConfidence.score || 0, 0.5 + Math.min(reviewRate, 1) * 0.4))
    changes.confidence = {
      score: Number(computedScore.toFixed(2)),
      band: computedScore >= 0.85 ? 'high' : computedScore >= 0.6 ? 'medium' : 'low',
      evidence_count: evidenceCount,
    }
  }

  if (recentEvents.length > 0) {
    const tags = new Set([...(targetExpertise.metadata?.tags || [])])
    tags.add('evidence-backed')
    changes.metadata = {
      tags: [...tags],
      lessons: [
        {
          summary: `Derived from ${recentEvents.length} recent evidence event(s)`,
          source: 'evidence-store',
        },
      ],
    }
  }

  return changes
}

export function validateProposalPayload(payload) {
  const errors = []
  if (!payload || typeof payload !== 'object') {
    errors.push('proposal payload must be an object')
    return { valid: false, errors }
  }
  if (payload.proposal_version !== PROPOSAL_SCHEMA_VERSION) {
    errors.push(`proposal_version must be '${PROPOSAL_SCHEMA_VERSION}'`)
  }
  if (typeof payload.id !== 'string' || !payload.id) errors.push('id is required')
  if (typeof payload.target_expertise_id !== 'string' || !payload.target_expertise_id) errors.push('target_expertise_id is required')
  if (typeof payload.summary !== 'string' || !payload.summary.trim()) errors.push('summary is required')
  if (!payload.generated_by || typeof payload.generated_by !== 'object') errors.push('generated_by is required')
  if (!payload.governance || typeof payload.governance !== 'object') errors.push('governance is required')
  return { valid: errors.length === 0, errors }
}

export function writeProposalToFile(proposal, outputPath) {
  const validation = validateProposalPayload(proposal)
  if (!validation.valid) {
    return { ok: false, errors: validation.errors }
  }

  const safe = validateExportPath(workspaceRoot, outputPath)
  if (!safe.ok) {
    return { ok: false, errors: [safe.error] }
  }

  const dir = dirname(safe.resolvedPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(safe.resolvedPath, JSON.stringify(proposal, null, 2) + '\n', 'utf-8')
  return { ok: true, path: safe.resolvedPath }
}

export function loadProposalFile(filePath) {
  const resolved = resolvePath(workspaceRoot, filePath)
  if (!existsSync(resolved)) return { ok: false, error: `proposal file not found: ${filePath}` }
  try {
    const payload = JSON.parse(readFileSync(resolved, 'utf-8'))
    const validation = validateProposalPayload(payload)
    if (!validation.valid) return { ok: false, errors: validation.errors, payload }
    return { ok: true, payload }
  } catch (err) {
    return { ok: false, error: `failed to read proposal file: ${err.message}` }
  }
}

export async function generateProposalById({
  targetId,
  crew = 'dev',
  actor,
  summary,
  rationale = '',
  proposedChanges = {},
  evidenceRefs = [],
  reviewers = [],
}) {
  const resolvedId = targetId?.includes(':') ? targetId : `${crew}:${targetId}`
  const targetExpertise = await loadExpertiseById(resolvedId)
  if (!targetExpertise) {
    return { ok: false, error: `expertise '${resolvedId}' not found` }
  }
  return buildExpertiseProposal({
    targetExpertise,
    actor,
    summary,
    rationale,
    proposedChanges,
    evidenceRefs,
    reviewers,
  })
}

export async function generateProposalFromEvidenceById({
  targetId,
  crew = 'dev',
  actor,
  limit = 5,
  reviewers = [],
}) {
  const resolvedId = targetId?.includes(':') ? targetId : `${crew}:${targetId}`
  const targetExpertise = await loadExpertiseById(resolvedId)
  if (!targetExpertise) {
    return { ok: false, error: `expertise '${resolvedId}' not found` }
  }

  const [recentEvents, metrics] = await Promise.all([
    loadEvidenceFor(resolvedId, { limit }),
    computeMetrics(resolvedId),
  ])

  const summary = `Draft proposal based on ${metrics.evidence_count || recentEvents.length} evidence event(s) for ${resolvedId}`
  const rationale = summarizeRecentEvidence(recentEvents, limit)
  const proposedChanges = deriveProposalChangesFromEvidence(targetExpertise, metrics, recentEvents)
  const evidenceRefs = recentEvents.map(ev => ev.id).filter(Boolean)

  return buildExpertiseProposal({
    targetExpertise,
    actor,
    summary,
    rationale,
    proposedChanges,
    evidenceRefs,
    reviewers,
  })
}
