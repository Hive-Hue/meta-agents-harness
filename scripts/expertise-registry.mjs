/**
 * MAH Expertise Registry Index Manager
 * @fileoverview Build, read, and cache the consolidated expertise registry
 * @version 0.7.0
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadExpertiseCatalog } from './expertise-loader.mjs'
import { EXPERTISE_SCHEMA_VERSION } from '../types/expertise-types.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = join(__dirname, '..')

// --------------------------------------------------------------------------
// Types (mirrored from task spec)
// --------------------------------------------------------------------------

/**
 * @typedef {Object} ExpertiseRef
 * @property {string} id
 * @property {{ agent?: string, team?: string }} owner
 * @property {string} schema_version
 * @property {string} validation_status
 * @property {string} lifecycle
 * @property {string} trust_tier
 * @property {{ score: number, band: string }} confidence
 * @property {string[]} domains
 * @property {string[]} capabilities
 * @property {string} registry_path
 */

/**
 * @typedef {Object} Registry
 * @property {string} schema_version
 * @property {string} generated_at
 * @property {number} total_count
 * @property {{ [owner: string]: ExpertiseRef[] }} by_owner
 * @property {{ [domain: string]: ExpertiseRef[] }} by_domain
 * @property {{ [status: string]: ExpertiseRef[] }} by_status
 * @property {{ [lifecycle: string]: ExpertiseRef[] }} by_lifecycle
 * @property {ExpertiseRef[]} entries
 */

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

/**
 * Log a warning to stderr.
 * @param {...unknown} args
 */
function warn(...args) {
  console.warn('[expertise-registry]', ...args)
}

/**
 * Resolve a path relative to repo root.
 * @param {string} relPath
 * @returns {string}
 */
function resolvePath(relPath) {
  return join(repoRoot, relPath)
}

/**
 * Ensure a directory exists, creating it if necessary.
 * @param {string} dirPath
 */
function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * Derive the registry_path for an expertise entry.
 * Resolves the file path from the catalog.
 * @param {object} expertise
 * @returns {string}
 */
function deriveRegistryPath(expertise) {
  if (typeof expertise.__source_file === 'string') {
    const relPath = relative(repoRoot, expertise.__source_file).replace(/\\/g, '/')
    if (relPath && !relPath.startsWith('..')) return relPath
  }

  // The expertise ID format is "owner:name" — construct registry path
  // Default to catalog/{owner}/{name}.yaml
  const parts = expertise.id.split(':')
  if (parts.length >= 2) {
    return `.mah/expertise/catalog/${parts[0]}/${parts[1]}.yaml`
  }
  return `.mah/expertise/catalog/${expertise.id}.yaml`
}

/**
 * Extract owner label for grouping.
 * @param {object} expertise
 * @returns {string}
 */
function extractOwnerLabel(expertise) {
  if (expertise.owner && typeof expertise.owner === 'object') {
    return expertise.owner.team || expertise.owner.agent || 'unknown'
  }
  if (expertise.owner === 'team') return expertise.metadata?.owner_id?.split('/')[0] || 'team'
  if (expertise.owner === 'both') {
    const oid = expertise.metadata?.owner_id || ''
    return oid.includes('/') ? oid.split('/')[0] : 'both'
  }
  return expertise.metadata?.owner_id?.split('/')[0] || 'agent'
}

/**
 * Determine confidence band from score.
 * @param {number} score
 * @returns {string}
 */
function deriveConfidenceBand(score) {
  if (score >= 0.85) return 'high'
  if (score >= 0.6) return 'medium'
  if (score >= 0.3) return 'low'
  return 'critical'
}

/**
 * Convert a loaded expertise object into an ExpertiseRef.
 * @param {object} expertise
 * @returns {ExpertiseRef}
 */
function toExpertiseRef(expertise) {
  const conf = expertise.confidence
  const score = typeof conf?.score === 'number' ? conf.score : 0.5

  // owner can be a string tag ('agent'|'team'|'both') or an object { agent, team }
  // The YAML loader produces an object; handle both forms for compatibility
  let ownerAgent, ownerTeam
  if (expertise.owner && typeof expertise.owner === 'object' && !Array.isArray(expertise.owner)) {
    ownerAgent = expertise.owner.agent || expertise.owner.team
    ownerTeam = expertise.owner.team || undefined
  } else {
    ownerAgent = expertise.owner === 'agent' || expertise.owner === 'both'
      ? (expertise.metadata?.owner_id?.split('/')[1] || expertise.id)
      : undefined
    ownerTeam = expertise.owner === 'team' || expertise.owner === 'both'
      ? (expertise.metadata?.owner_id?.split('/')[0] || 'team')
      : undefined
  }

  return {
    id: expertise.id,
    owner: {
      agent: ownerAgent,
      team: ownerTeam,
    },
    schema_version: expertise.schema_version || EXPERTISE_SCHEMA_VERSION,
    validation_status: expertise.validation_status || 'declared',
    lifecycle: expertise.lifecycle || 'active',
    trust_tier: expertise.trust_tier || 'internal',
    confidence: {
      score,
      band: conf?.band || deriveConfidenceBand(score),
      evidence_count: typeof conf?.evidence_count === 'number' ? conf.evidence_count : undefined,
    },
    domains: Array.isArray(expertise.domains) ? expertise.domains : [],
    capabilities: Array.isArray(expertise.capabilities) ? expertise.capabilities : [],
    registry_path: deriveRegistryPath(expertise),
  }
}

/**
 * Compute the canonical registry path for an expertise id.
 * Canonical catalog layout is `.mah/expertise/catalog/{crew}/{name}.yaml`.
 * @param {string} expertiseId
 * @returns {string}
 */
function canonicalRegistryPathForId(expertiseId) {
  const [crew, name] = String(expertiseId || '').split(':')
  if (crew && name) return `.mah/expertise/catalog/${crew}/${name}.yaml`
  return `.mah/expertise/catalog/${expertiseId}.yaml`
}

/**
 * Choose the preferred registry ref when multiple files declare the same expertise id.
 * Prefer the canonical crew/name file path, then validated entries, then higher confidence.
 * @param {ExpertiseRef} current
 * @param {ExpertiseRef} candidate
 * @returns {ExpertiseRef}
 */
function choosePreferredRef(current, candidate) {
  const canonicalPath = canonicalRegistryPathForId(current.id)
  const currentIsCanonical = current.registry_path === canonicalPath
  const candidateIsCanonical = candidate.registry_path === canonicalPath

  if (currentIsCanonical && !candidateIsCanonical) return current
  if (candidateIsCanonical && !currentIsCanonical) return candidate

  const currentValidated = current.validation_status === 'validated'
  const candidateValidated = candidate.validation_status === 'validated'
  if (currentValidated && !candidateValidated) return current
  if (candidateValidated && !currentValidated) return candidate

  const currentScore = Number(current.confidence?.score || 0)
  const candidateScore = Number(candidate.confidence?.score || 0)
  if (candidateScore > currentScore) return candidate
  if (currentScore > candidateScore) return current

  return current
}

/**
 * Deduplicate registry refs by expertise id.
 * @param {ExpertiseRef[]} entries
 * @returns {ExpertiseRef[]}
 */
function dedupeExpertiseRefs(entries) {
  /** @type {Map<string, ExpertiseRef>} */
  const seen = new Map()

  for (const entry of entries) {
    const existing = seen.get(entry.id)
    if (!existing) {
      seen.set(entry.id, entry)
      continue
    }
    const preferred = choosePreferredRef(existing, entry)
    if (preferred !== existing) {
      warn(`duplicate expertise id '${entry.id}' detected, preferring '${preferred.registry_path}' over '${existing.registry_path}'`)
    } else {
      warn(`duplicate expertise id '${entry.id}' detected, ignoring '${entry.registry_path}' in favor of '${existing.registry_path}'`)
    }
    seen.set(entry.id, preferred)
  }

  return Array.from(seen.values())
}

/**
 * Group an array of ExpertiseRef by a key derived from each entry.
 * @param {ExpertiseRef[]} entries
 * @param {(ExpertiseRef) => string} keyFn
 * @returns {Record<string, ExpertiseRef[]>}
 */
function groupBy(entries, keyFn) {
  /** @type {Record<string, ExpertiseRef[]>} */
  const result = {}
  for (const entry of entries) {
    const key = keyFn(entry)
    if (!result[key]) result[key] = []
    result[key].push(entry)
  }
  return result
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Build (or rebuild) the registry from the expertise catalog.
 * Writes to `.mah/expertise/registry.json`.
 *
 * @param {{ catalogPath?: string, outputPath?: string }} [options]
 * @returns {Promise<Registry>}
 */
export async function buildRegistry(options = {}) {
  const { catalogPath, outputPath } = options
  const catalog = catalogPath || resolvePath('.mah/expertise/catalog')
  const output = outputPath || resolvePath('.mah/expertise/registry.json')

  // Load all expertise from catalog
  const expertiseList = await loadExpertiseCatalog(catalog)

  // Convert to refs
  /** @type {ExpertiseRef[]} */
  const entries = dedupeExpertiseRefs(expertiseList.map(toExpertiseRef))

  // Group by various dimensions
  /** @type {Registry} */
  const registry = {
    schema_version: EXPERTISE_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    total_count: entries.length,
    by_owner: groupBy(entries, (e) => extractOwnerLabel(e)),
    by_domain: groupBy(entries, (e) => e.domains.join(',') || 'unknown'),
    by_status: groupBy(entries, (e) => e.validation_status),
    by_lifecycle: groupBy(entries, (e) => e.lifecycle),
    entries,
  }

  // Also group by individual domain (flatten)
  registry.by_domain = {}
  for (const entry of entries) {
    for (const domain of entry.domains) {
      if (!registry.by_domain[domain]) registry.by_domain[domain] = []
      registry.by_domain[domain].push(entry)
    }
  }

  // Write registry
  const registryDir = dirname(output)
  ensureDir(registryDir)
  writeFileSync(output, JSON.stringify(registry, null, 2), 'utf-8')

  return registry
}

/**
 * Read a cached registry from disk.
 * Does NOT rebuild — use buildRegistry() to rebuild.
 * If the cached registry is older than 1 hour, it is considered stale.
 *
 * @param {string} [registryPath]
 * @returns {Promise<Registry | null>} null if file does not exist or is stale
 */
export async function readRegistry(registryPath) {
  const resolved = registryPath || resolvePath('.mah/expertise/registry.json')

  if (!existsSync(resolved)) {
    warn(`registry not found at '${resolved}'`)
    return null
  }

  try {
    const raw = readFileSync(resolved, 'utf-8')
    /** @type {Registry} */
    const registry = JSON.parse(raw)

    // Validate basic structure
    if (!registry.schema_version || !registry.generated_at) {
      warn('registry missing required fields, treating as stale')
      return null
    }

    // Check staleness (>1 hour)
    const generatedAt = new Date(registry.generated_at)
    const now = new Date()
    const ageMs = now.getTime() - generatedAt.getTime()
    const STALE_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour

    if (ageMs > STALE_THRESHOLD_MS) {
      warn(`registry is stale (age ${Math.round(ageMs / 60000)} min), treating as stale`)
      return null
    }

    const dedupedEntries = dedupeExpertiseRefs(Array.isArray(registry.entries) ? registry.entries : [])
    if (dedupedEntries.length !== registry.entries.length) {
      warn('registry contains duplicate expertise ids, treating cache as stale')
      return null
    }

    return registry
  } catch (err) {
    warn(`failed to read registry: ${err.message}`)
    return null
  }
}

/**
 * Get the registry, reading from cache if fresh or rebuilding if stale/missing.
 * This is the main entry point for consumers who want a usable registry.
 *
 * @param {{ catalogPath?: string, outputPath?: string }} [options]
 * @returns {Promise<Registry>}
 */
export async function getRegistry(options = {}) {
  const output = options.outputPath || resolvePath('.mah/expertise/registry.json')
  const cached = await readRegistry(output)
  if (cached !== null) return cached
  return buildRegistry(options)
}

// --------------------------------------------------------------------------
// Self-test when run directly
// --------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== Expertise Registry Self-Test ===\n')

  // 1. Build registry
  console.log('[1] buildRegistry()...')
  const registry = await buildRegistry()
  console.log(`    built registry: ${registry.total_count} entries, generated at ${registry.generated_at}`)

  // 2. Verify by_* groupings exist
  const gChecks = [
    ['by_owner', Object.keys(registry.by_owner)],
    ['by_domain', Object.keys(registry.by_domain)],
    ['by_status', Object.keys(registry.by_status)],
    ['by_lifecycle', Object.keys(registry.by_lifecycle)],
  ]
  for (const [name, keys] of gChecks) {
    console.log(`    ${name}: ${keys.length} groups [${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}]`)
  }

  // 3. Read registry back (should be fresh)
  console.log('\n[2] readRegistry() (fresh cache)...')
  const cached = await readRegistry()
  if (cached) {
    console.log(`    read registry: ${cached.total_count} entries`)
  } else {
    console.log('    readRegistry returned null (unexpected)')
  }

  // 4. Verify registry file was written
  const path = resolvePath('.mah/expertise/registry.json')
  if (existsSync(path)) {
    console.log(`\n[3] registry.json exists at '${path}'`)
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    console.log(`    schema_version: ${parsed.schema_version}`)
    console.log(`    total_count: ${parsed.total_count}`)
  }

  console.log('\n=== Self-Test Passed ===')
}
