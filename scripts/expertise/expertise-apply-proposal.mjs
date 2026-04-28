/**
 * MAH Expertise Apply Proposal
 * Applies an approved proposal to the catalog.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, isAbsolute, extname, sep } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { validateProposalPayload } from './expertise-proposal.mjs'
import { loadExpertiseById } from './expertise-loader.mjs'
import { buildRegistry } from './expertise-registry.mjs'
import { resolveWorkspaceRoot } from '../core/workspace-root.mjs'

const workspaceRoot = resolveWorkspaceRoot()
const ALLOWED_APPLY_ACTORS = new Set(['orchestrator', 'validation-lead'])

export async function applyProposalFromFile(proposalPath, options = {}) {
  const { force = false, actor = 'orchestrator' } = options

  const proposalsRoot = join(workspaceRoot, '.mah', 'expertise', 'proposals')
  const absoluteInputPath = isAbsolute(proposalPath) ? resolve(proposalPath) : resolve(workspaceRoot, proposalPath)
  const normalizedRoot = `${resolve(proposalsRoot)}${sep}`
  const isInsideProposalsDir = absoluteInputPath === resolve(proposalsRoot) || absoluteInputPath.startsWith(normalizedRoot)
  const ext = extname(absoluteInputPath).toLowerCase()
  if (!isInsideProposalsDir || (ext !== '.yaml' && ext !== '.yml')) {
    return { ok: false, error: 'Invalid proposal path. Only .mah/expertise/proposals/*.ya?ml is allowed.' }
  }

  if (!existsSync(absoluteInputPath)) {
    return { ok: false, error: `Proposal file not found: ${absoluteInputPath}` }
  }

  let proposal
  try {
    const raw = readFileSync(absoluteInputPath, 'utf-8')
    try {
      proposal = JSON.parse(raw)
    } catch {
      proposal = parseYaml(raw)
    }
  } catch {
    return { ok: false, error: `Invalid proposal file (JSON/YAML): ${proposalPath}` }
  }

  const validation = validateProposalPayload(proposal)
  if (!validation.valid) {
    return { ok: false, error: `Invalid proposal: ${validation.errors.join('; ')}` }
  }

  if (!ALLOWED_APPLY_ACTORS.has(actor)) {
    return { ok: false, error: `Actor '${actor}' is not authorized to apply proposals. Allowed: ${[...ALLOWED_APPLY_ACTORS].join(', ')}` }
  }

  const targetId = proposal.target_expertise_id
  const currentEntry = await loadExpertiseById(targetId)
  if (!currentEntry) {
    return { ok: false, error: `Expertise not found: ${targetId}` }
  }

  if (!force && proposal.target_snapshot) {
    const snapshotKeys = Object.keys(proposal.target_snapshot)
    for (const key of snapshotKeys) {
      if (JSON.stringify(currentEntry[key]) !== JSON.stringify(proposal.target_snapshot[key])) {
        return {
          ok: false,
          error: 'Catalog has changed since proposal was generated. Use --force to apply anyway.',
          stale: true,
          changed_field: key,
        }
      }
    }
  }

  const changes = proposal.proposed_changes || {}
  const appliedChanges = []

  for (const [key, value] of Object.entries(changes)) {
    if (key === 'confidence' || key === 'capabilities' || key === 'lifecycle' || key === 'validation_status') {
      const oldValue = currentEntry[key]
      currentEntry[key] = value
      appliedChanges.push({ field: key, from: oldValue, to: value })
    }
  }

  currentEntry.metadata = currentEntry.metadata || {}
  currentEntry.metadata.updated = new Date().toISOString()
  currentEntry.metadata._extra = currentEntry.metadata._extra || {}
  currentEntry.metadata._extra.last_applied_proposal = proposal.id

  const catalogRoot = join(workspaceRoot, '.mah', 'expertise', 'catalog')
  const [crew, name] = targetId.split(':')
  const catalogPath = join(catalogRoot, crew, `${name}.yaml`)

  writeFileSync(catalogPath, stringifyYaml(currentEntry, { indent: 2, lineWidth: 0 }), 'utf-8')

  const registry = await buildRegistry()

  const nextProposal = {
    ...proposal,
    status: 'applied',
    applied_at: new Date().toISOString(),
    applied_by: actor,
  }
  writeFileSync(absoluteInputPath, stringifyYaml(nextProposal, { indent: 2, lineWidth: 0 }), 'utf-8')

  return {
    ok: true,
    applied: appliedChanges,
    registry_entries: registry.total_count,
  }
}
