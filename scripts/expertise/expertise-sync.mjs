/**
 * MAH Expertise Sync — bridge System A (agent learnings) + System C (evidence) → System B (catalog)
 * @version 0.7.0
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { loadEvidenceFor, computeMetrics } from './evidence/expertise-evidence-store.mjs'
import { computeConfidence } from './expertise-confidence.mjs'
import { buildRegistry } from './expertise-registry.mjs'
import { resolveMahHome } from '../core/mah-home.mjs'
import { resolveWorkspaceRoot } from '../core/workspace-root.mjs'

const workspaceRoot = resolveWorkspaceRoot()
const V1_FIELDS = ['id', 'schema_version', 'owner', 'capabilities', 'domains', 'input_contract', 'allowed_environments', 'validation_status', 'confidence', 'trust_tier', 'lifecycle', 'policy', 'evidence_refs', 'metadata']

// Keyword → capability mapping
const CAPABILITY_KEYWORDS = [
  { keywords: ['auth', 'jwt', 'oauth', 'session', 'password'], capability: 'api-design,security' },
  { keywords: ['database', 'sql', 'postgres', 'mysql', 'mongodb', 'redis', 'query', 'schema'], capability: 'database' },
  { keywords: ['test', 'spec', 'verify', 'qa', 'coverage'], capability: 'testing' },
  { keywords: ['refactor', 'restructure', 'cleanup'], capability: 'implementation' },
  { keywords: ['design', 'pattern', 'architecture', 'system design'], capability: 'architecture' },
  { keywords: ['security', 'vulnerability', 'xss', 'injection', 'csrf', 'sanitize'], capability: 'security-audit' },
  { keywords: ['performance', 'latency', 'optimize', 'cache', 'fast'], capability: 'performance' },
  { keywords: ['deploy', 'ci', 'cd', 'pipeline', 'release'], capability: 'devops' },
  { keywords: ['review', 'audit', 'assess', 'evaluate'], capability: 'code-review' },
  { keywords: ['frontend', 'ui', 'css', 'react', 'component', 'html'], capability: 'frontend' },
  { keywords: ['api', 'endpoint', 'rest', 'grpc', 'http'], capability: 'api-design' },
]

export function extractCapabilitiesFromSystemA(systemA) {
  const capabilities = new Set()
  const sections = ['lessons', 'decisions', 'patterns', 'risks', 'tools', 'workflows']

  for (const section of sections) {
    const items = Array.isArray(systemA?.[section]) ? systemA[section] : []
    for (const item of items) {
      const note = String(item?.note || '').toLowerCase()
      for (const { keywords, capability } of CAPABILITY_KEYWORDS) {
        for (const kw of keywords) {
          if (note.includes(kw)) {
            for (const cap of capability.split(',')) capabilities.add(cap.trim())
            break
          }
        }
      }
    }
  }

  return Array.from(capabilities)
}

export async function syncExpertiseEntry(crew, agentId, options = {}) {
  const { dryRun = false, evidenceRoot: externalEvidenceRoot } = options
  const expertiseId = `${crew}:${agentId}`

  const workspaceCatalogRoot = join(workspaceRoot, '.mah', 'expertise', 'catalog')
  const mahHomeCatalogRoot = join(resolveMahHome(), 'expertise', 'catalog')
  const catalogRoot = existsSync(join(workspaceCatalogRoot, crew, `${agentId}.yaml`))
    ? workspaceCatalogRoot
    : mahHomeCatalogRoot

  const catalogPath = join(catalogRoot, crew, `${agentId}.yaml`)
  const systemAPath = join(workspaceRoot, '.pi', 'crew', crew, 'expertise', `${agentId}-expertise-model.yaml`)

  if (!existsSync(catalogPath)) {
    return { skipped: true, reason: 'no catalog entry', changed: false, changes: [] }
  }

  const catalog = parseYaml(readFileSync(catalogPath, 'utf-8')) || {}

  const changes = []
  let changed = false

  // System C -> confidence
  const evidence = await loadEvidenceFor(expertiseId, { evidenceRoot: externalEvidenceRoot })
  if (evidence.length > 0) {
    const metrics = await computeMetrics(expertiseId, { evidenceRoot: externalEvidenceRoot })
    const confidence = computeConfidence(metrics)

    const oldScore = Number(catalog.confidence?.score || 0)
    const oldBand = catalog.confidence?.band || 'low'
    const newScore = Number(confidence.score || 0)
    const newBand = confidence.band || 'low'

    if (Math.abs(oldScore - newScore) > 0.001 || oldBand !== newBand) {
      if (!dryRun) {
        catalog.confidence = {
          score: Math.round(newScore * 100) / 100,
          band: newBand,
          evidence_count: metrics.total_invocations,
        }
        catalog.metadata = catalog.metadata || {}
        catalog.metadata.updated = new Date().toISOString()
        catalog.metadata._extra = catalog.metadata._extra || {}
        catalog.metadata._extra.last_synced = {
          at: new Date().toISOString(),
          source: 'evidence',
          total_invocations: metrics.total_invocations,
          successful_invocations: metrics.successful_invocations,
          avg_duration_ms: Math.round(metrics.avg_duration_ms),
        }
      }
      changes.push({
        type: 'confidence',
        from: { score: oldScore, band: oldBand },
        to: { score: newScore, band: newBand, invocations: metrics.total_invocations },
      })
      changed = true
    }
  }

  // System A -> capabilities
  if (existsSync(systemAPath)) {
    const systemA = parseYaml(readFileSync(systemAPath, 'utf-8')) || {}
    const extracted = extractCapabilitiesFromSystemA(systemA)

    const existingCaps = Array.isArray(catalog.capabilities) ? catalog.capabilities : []
    const newCaps = extracted.filter((c) => !existingCaps.includes(c))

    if (newCaps.length > 0) {
      if (!dryRun) {
        catalog.capabilities = [...new Set([...existingCaps, ...newCaps])].sort()
        catalog.metadata = catalog.metadata || {}
        catalog.metadata.updated = new Date().toISOString()
      }
      changes.push({ type: 'capabilities', added: newCaps })
      changed = true
    }
  }

  if (changed && !dryRun) {
    const cleanCatalog = {}
    for (const key of V1_FIELDS) {
      if (key in catalog) cleanCatalog[key] = catalog[key]
    }
    writeFileSync(catalogPath, stringifyYaml(cleanCatalog, { indent: 2, lineWidth: 0 }), 'utf-8')
  }

  return { skipped: false, changed, changes }
}

export async function syncExpertise(options = {}) {
  const { crew = 'dev', dryRun = false, evidenceRoot: externalEvidenceRoot } = options
  const errors = []
  const results = []

  const configPath = join(workspaceRoot, 'meta-agents.yaml')
  if (!existsSync(configPath)) {
    throw new Error(`meta-agents.yaml not found at ${configPath}`)
  }

  const config = parseYaml(readFileSync(configPath, 'utf-8'))
  const crewDef = (config.crews || []).find((c) => c.id === crew)
  if (!crewDef) {
    throw new Error(`Crew '${crew}' not found in meta-agents.yaml`)
  }

  for (const agent of crewDef.agents || []) {
    try {
      const result = await syncExpertiseEntry(crew, agent.id, { dryRun, evidenceRoot: externalEvidenceRoot })
      results.push({ agent: `${crew}:${agent.id}`, ...result })
    } catch (err) {
      errors.push(`${agent.id}: ${err.message}`)
    }
  }

  if (!dryRun) await buildRegistry()

  return { results, errors, dryRun }
}
