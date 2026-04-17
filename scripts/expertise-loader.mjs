/**
 * MAH Expertise Loader
 * @fileoverview Catalog reader and legacy normalizer for MAH v0.7.0 Expertise Engine (M1/S4)
 * @version 0.7.0
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, extname, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pkg from 'yaml'
const { parse: yamlParse } = pkg
import {
  EXPERTISE_SCHEMA_VERSION,
} from '../types/expertise-types.mjs'
import { validateExpertise } from './expertise-schema.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')
const DEFAULT_CATALOG_PATH = '.mah/expertise/catalog'

// SECURITY: v0.7.0-patch — catalog traversal bounds
const MAX_RECURSION_DEPTH = 5
const MAX_CATALOG_FILES = 1000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------- -----------

/**
 * Log a warning to stderr.
 * @param {...unknown} args
 */
function warn(...args) {
  console.warn('[expertise-loader]', ...args)
}

// SECURITY: v0.7.0-patch — sanitize ID segments to prevent path traversal
const ID_SEGMENT_REGEX = /^[a-z0-9._-]+$/

/**
 * Validate a single segment of an expertise ID (crew or name).
 * @param {string} segment
 * @returns {string}
 * @throws {Error}
 */
function sanitizeIdSegment(segment) {
  if (typeof segment !== 'string' || !segment) {
    throw new Error(`Invalid ID segment: must be a non-empty string, got '${segment}'`)
  }
  if (segment.includes('/') || segment.includes('\\') || segment.includes('..')) {
    throw new Error(`Invalid ID segment: path separators and '..' not allowed in '${segment}'`)
  }
  if (!ID_SEGMENT_REGEX.test(segment)) {
    throw new Error(`Invalid ID segment: must match ${ID_SEGMENT_REGEX.source}, got '${segment}'`)
  }
  return segment
}

/**
 * Recursively collect all file paths under a directory matching extensions.
 * @param {string} dir
 * @param {string[]} extensions
 * @returns {string[]}
 */
function collectFiles(dir, extensions, depth = 0) {
  /** @type {string[]} */
  const results = []
  // SECURITY: v0.7.0-patch — limit recursion depth
  if (depth >= MAX_RECURSION_DEPTH) return results
  if (!existsSync(dir)) return results
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    // SECURITY: v0.7.0-patch — skip symlinks
    if (entry.isSymbolicLink()) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, extensions, depth + 1))
    } else if (extensions.includes(extname(entry.name).toLowerCase())) {
      // SECURITY: v0.7.0-patch — limit total files
      if (results.length >= MAX_CATALOG_FILES) break
      results.push(full)
    }
    // SECURITY: v0.7.0-patch — limit total files across recursion
    if (results.length >= MAX_CATALOG_FILES) break
  }
  return results
}

/**
 * Parse file content as YAML or JSON.
 * @param {string} filePath
 * @returns {object | null}
 */
function parseFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const ext = extname(filePath).toLowerCase()
    if (ext === '.json') return JSON.parse(raw)
    return yamlParse(raw)
  } catch (err) {
    warn(`failed to parse file '${filePath}':`, err.message)
    return null
  }
}

/**
 * Derive owner string from legacy owner object.
 * @param {{ agent: string, team: string }} owner
 * @returns {'agent'|'team'|'both'}
 */
function resolveCatalogPath(catalogPath) {
  return resolve(repoRoot, catalogPath)
}

/**
 * Attach the source file path to a loaded expertise object without changing its JSON shape.
 * @param {object} expertise
 * @param {string} filePath
 * @returns {object}
 */
function attachSourceFile(expertise, filePath) {
  Object.defineProperty(expertise, '__source_file', {
    value: resolve(filePath),
    enumerable: false,
    configurable: true,
  })
  return expertise
}

// ---------------------------------------------------------------- -----------
// Public API
// ---------------------------------------------------------------- -----------

/**
 * Load all expertise entries from the catalog directory.
 * Reads .mah/expertise/catalog/{owner}/{expertise-id}.yaml (or .json)
 * @param {string} [catalogPath='.mah/expertise/catalog']
 * @returns {Promise<object[]>}
 */
export async function loadExpertiseCatalog(catalogPath = DEFAULT_CATALOG_PATH) {
  const extensions = ['.yaml', '.yml', '.json']
  const files = collectFiles(resolveCatalogPath(catalogPath), extensions)
  /** @type {object[]} */
  const results = []

  for (const file of files) {
    const expertise = await loadExpertiseFile(file)
    if (expertise) results.push(expertise)
  }

  return results
}

/**
 * Load and validate a single expertise file.
 * If the file has schema_version "mah.expertise.v1" it is validated and returned.
 * If it is a legacy format, it is normalized first.
 * Files that fail validation are skipped with a warning.
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
export async function loadExpertiseFile(filePath) {
  const resolvedFilePath = resolve(filePath)

  if (!existsSync(resolvedFilePath)) {
    warn(`file not found: '${filePath}'`)
    return null
  }

  const parsed = parseFile(resolvedFilePath)
  if (!parsed) {
    warn(`could not parse '${filePath}', skipping`)
    return null
  }

  // Already v0.7.0 format — validate and return
  if (parsed.schema_version === EXPERTISE_SCHEMA_VERSION) {
    const { valid, errors, warnings } = validateExpertise(parsed, false)
    for (const w of warnings) warn(`validation warning in '${filePath}':`, w)
    if (!valid) {
      warn(`validation failed for '${filePath}':`, errors.join('; '))
      return null
    }
    return attachSourceFile(parsed, resolvedFilePath)
  }

  // Legacy format — normalize using file path context
  // Path pattern: .mah/expertise/catalog/{owner}/{expertise-id}.yaml
  // or legacy: .hermes/crew/{crew}/expertise/{expertise-id}.yaml
  let owner = 'agent'
  let crew = 'unknown'

  const rel = relative(process.cwd(), resolvedFilePath)

  // Try to extract owner and crew from path
  const parts = rel.split(/[/\\]/)
  const mahIdx = parts.indexOf('.mah')
  const hermesIdx = parts.indexOf('.hermes')

  if (mahIdx !== -1) {
    // .mah/expertise/catalog/{owner}/{expertise-id}.yaml
    const ownerIdx = parts.indexOf('catalog') + 1
    if (ownerIdx > 0 && parts[ownerIdx]) {
      owner = parts[ownerIdx]
    }
  } else if (hermesIdx !== -1) {
    // .hermes/crew/{crew}/expertise/{expertise-id}.yaml
    const crewIdx = hermesIdx + 2
    if (parts[crewIdx]) {
      crew = parts[crewIdx]
    }
  }

  // Normalize legacy expertise
  const normalized = normalizeLegacyExpertise(parsed, owner, crew)

  // Validate the normalized result
  const { valid, errors, warnings: valWarnings } = validateExpertise(normalized, false)
  for (const w of valWarnings) warn(`normalization warning in '${filePath}':`, w)
  if (!valid) {
    warn(`normalization validation failed for '${filePath}':`, errors.join('; '))
    return null
  }

  return attachSourceFile(normalized, resolvedFilePath)
}

/**
 * Resolve a canonical expertise file path by expertise id.
 * @param {string} expertiseId
 * @param {string} [catalogPath='.mah/expertise/catalog']
 * @returns {Promise<string|null>}
 */
export async function findExpertiseFileById(expertiseId, catalogPath = DEFAULT_CATALOG_PATH) {
  const normalizedId = expertiseId.trim()
  const extensions = ['.yaml', '.yml', '.json']
  const catalogRoot = resolveCatalogPath(catalogPath)
  const [crew, name] = normalizedId.split(':')

  // SECURITY: v0.7.0-patch — validate ID segments prevent path traversal
  if (crew && name) {
    try {
      sanitizeIdSegment(crew)
      sanitizeIdSegment(name)
    } catch (err) {
      warn(`invalid expertise ID '${expertiseId}': ${err.message}`)
      return null
    }

    for (const ext of extensions) {
      const candidatePath = join(catalogRoot, crew, `${name}${ext}`)
      // SECURITY: v0.7.0-patch — verify candidate path stays under catalogRoot
      const resolvedCandidate = resolve(candidatePath)
      const resolvedRoot = resolve(catalogRoot)
      if (!resolvedCandidate.startsWith(resolvedRoot + '/') && resolvedCandidate !== resolvedRoot) {
        warn(`candidate path '${candidatePath}' escapes catalog root`)
        continue
      }
      if (!existsSync(candidatePath)) continue
      const expertise = await loadExpertiseFile(candidatePath)
      if (expertise?.id === normalizedId) return candidatePath
    }
  }

  const files = collectFiles(catalogRoot, extensions)
  for (const file of files) {
    const expertise = await loadExpertiseFile(file)
    if (expertise?.id === normalizedId) return file
  }

  return null
}

/**
 * Load a canonical expertise object by id from the catalog.
 * @param {string} expertiseId
 * @param {string} [catalogPath='.mah/expertise/catalog']
 * @returns {Promise<object|null>}
 */
export async function loadExpertiseById(expertiseId, catalogPath = DEFAULT_CATALOG_PATH) {
  const filePath = await findExpertiseFileById(expertiseId, catalogPath)
  if (!filePath) return null
  return loadExpertiseFile(filePath)
}

/**
 * Normalize a legacy YAML expertise object into v0.7.0 Expertise format.
 *
 * Legacy format example:
 * {
 *   agent: { name: "orchestrator", role: "orchestrator", team: "global" },
 *   meta: { version: "1", max_lines: "120", last_updated: "2026-04-15T15:43:54.527Z" },
 *   patterns: [{ note: "some pattern" }],
 *   risks: [{ date: "2026-04-15", note: "some risk" }],
 *   lessons: [{ note: "some lesson" }],
 *   workflows: [{ name: "workflow1", description: "wf desc" }]
 * }
 *
 * @param {object} yaml - legacy expertise YAML object
 * @param {string} owner - owner identifier (agent or team name)
 * @param {string} crew - crew/team identifier
 * @returns {object} Normalized Expertise object
 */
export function normalizeLegacyExpertise(yaml, owner = 'agent', crew = 'unknown') {
  const agent = yaml.agent || {}
  const meta = yaml.meta || {}

  // Build id: "crew:agent-name"
  const agentName = agent.name || meta.agent_name || 'unnamed'
  const id = `${crew}:${agentName}`

  // Derive capabilities from patterns[].note and agent.role
  /** @type {string[]} */
  const capabilities = []
  if (agent.role) capabilities.push(agent.role)
  if (Array.isArray(yaml.patterns)) {
    for (const p of yaml.patterns) {
      if (p && typeof p === 'object' && p.note && typeof p.note === 'string') {
        const trimmed = p.note.trim()
        if (trimmed) capabilities.push(trimmed)
      } else if (typeof p === 'string' && p.trim()) {
        capabilities.push(p.trim())
      }
    }
  }
  // Deduplicate
  const uniqueCapabilities = [...new Set(capabilities.filter(Boolean))]

  // Derive domains from agent.team and agent.role
  /** @type {string[]} */
  const domains = []
  if (agent.team) domains.push(agent.team)
  if (agent.role) domains.push(agent.role)
  const uniqueDomains = [...new Set(domains.filter(Boolean))]

  // Timestamps
  const lastUpdated = meta.last_updated || new Date().toISOString()
  const created = meta.created || lastUpdated

  // Collect extra legacy fields into metadata
  /** @type {Record<string, unknown>} */
  const extraData = {}
  const knownLegacy = new Set(['agent', 'meta', 'patterns', 'risks', 'lessons', 'workflows', 'allowed_environments'])
  for (const key of Object.keys(yaml)) {
    if (!knownLegacy.has(key)) {
      extraData[key] = yaml[key]
    }
  }

  // Build metadata
  const metadata = {
    created,
    updated: lastUpdated,
    owner_id: `${crew}/${agentName}`,
    tags: ['legacy-imported'],
    // Store legacy arrays in metadata for future processing
    ...(yaml.risks ? { risks: yaml.risks } : {}),
    ...(yaml.lessons ? { lessons: yaml.lessons } : {}),
    ...(yaml.workflows ? { workflows: yaml.workflows } : {}),
    ...(Object.keys(extraData).length > 0 ? { _extra: extraData } : {}),
  }

  // Build the normalized Expertise object
  /** @type {import('../types/expertise-types.mjs').Expertise} */
  const expertise = {
    id,
    owner: {
      agent: agentName,
      ...(agent.team ? { team: agent.team } : {}),
    },
    schema_version: EXPERTISE_SCHEMA_VERSION,
    capabilities: uniqueCapabilities.length > 0 ? uniqueCapabilities : ['general-purpose'],
    domains: uniqueDomains.length > 0 ? uniqueDomains : [crew],
    input_contract: {
      required_fields: ['task_description'],
      optional_fields: ['context'],
      field_types: {
        task_description: 'string',
        context: 'string',
      },
    },
    validation_status: 'declared',
    confidence: {
      score: 0.5,
      band: 'medium',
      evidence_count: 0,
    },
    lifecycle: 'active',
    trust_tier: 'internal',
    policy: {
      federated_allowed: false,
      allowed_domains: [],
      approval_required: false,
    },
    evidence_refs: [],
    metadata,
  }

  // Optional: allowed_environments
  if (Array.isArray(yaml.allowed_environments) && yaml.allowed_environments.length > 0) {
    expertise.allowed_environments = yaml.allowed_environments
  }

  return expertise
}

// ---------------------------------------------------------------- -----------
// Self-test when run directly
// ---------------------------------------------------------------- -----------
if (import.meta.url === `file://${process.argv[1]}`) {
  const { default: test } = await import('node:assert')

  // Smoke test: normalizeLegacyExpertise
  const legacyYaml = {
    agent: { name: 'orchestrator', role: 'orchestrator', team: 'global' },
    meta: { version: '1', max_lines: '120', last_updated: '2026-04-15T15:43:54.527Z' },
    patterns: [{ note: 'task-planning' }, { note: 'crew-coordination' }],
    risks: [{ date: '2026-04-15', note: 'overload risk' }],
    lessons: [{ note: 'lesson one' }],
    workflows: [{ name: 'wf1', description: 'desc' }],
  }

  const normalized = normalizeLegacyExpertise(legacyYaml, 'dev', 'dev')

  test.equal(normalized.id, 'dev:orchestrator')
  test.equal(normalized.schema_version, 'mah.expertise.v1')
  test.deepEqual(normalized.capabilities, ['orchestrator', 'task-planning', 'crew-coordination'])
  test.deepEqual(normalized.domains, ['global', 'orchestrator'])
  test.equal(normalized.validation_status, 'declared')
  test.equal(normalized.lifecycle, 'active')
  test.equal(normalized.trust_tier, 'internal')
  test.deepEqual(normalized.metadata.tags, ['legacy-imported'])
  test.equal(normalized.owner.agent, 'orchestrator')
  test.equal(normalized.owner.team, 'global')
  test.equal(normalized.metadata.risks[0].note, 'overload risk')
  test.equal(normalized.metadata.lessons[0].note, 'lesson one')
  test.equal(normalized.metadata.workflows[0].name, 'wf1')

  // Security: path traversal rejection tests
  console.log('\nPath traversal rejection tests:')
  const traversalIds = ['dev:../../etc', 'dev:../secret', '../:name', 'dev\\test:name']
  for (const badId of traversalIds) {
    const f = await findExpertiseFileById(badId)
    console.log(`  ${f === null ? '✓' : '✗'} '${badId}' ${f === null ? 'rejected' : `should have been rejected but returned: ${f}`}`)
  }

  console.log('=== Expertise Loader Smoke Test Passed ===')
  console.log('normalizeLegacyExpertise:', JSON.stringify(normalized, null, 2))
}
