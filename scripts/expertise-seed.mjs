/**
 * MAH Expertise Seed Command
 * @fileoverview Seed expertise catalog entries from meta-agents.yaml definitions
 * @version 0.7.0
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname as pathDirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { validateExpertise } from './expertise-schema.mjs'
import { buildRegistry } from './expertise-registry.mjs'
import { resolveMahHome } from './mah-home.mjs'
import { resolveWorkspaceRoot } from './workspace-root.mjs'
import { EXPERTISE_SCHEMA_VERSION } from '../types/expertise-types.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = pathDirname(__filename)
const workspaceRoot = resolveWorkspaceRoot()

// ---------------------------------------------------------------------------
// Capability derivation mapping (role → capabilities)
// ---------------------------------------------------------------------------

const CAPABILITY_MAP = {
  orchestrator: ['task-planning', 'delegation', 'coordination', 'expertise-governance'],
  'planning-lead': ['task-planning', 'delegation', 'code-review', 'architecture'],
  'engineering-lead': ['implementation', 'code-review', 'delegation', 'architecture'],
  'validation-lead': ['testing', 'code-review', 'security-audit', 'quality-assurance'],
  'repo-analyst': ['code-analysis', 'dependency-audit', 'repository-management'],
  'solution-architect': ['architecture', 'design-patterns', 'api-design', 'system-design'],
  'frontend-dev': ['frontend', 'ui-implementation', 'css', 'react', 'testing'],
  'backend-dev': ['implementation', 'api-design', 'database', 'testing'],
  'qa-reviewer': ['testing', 'regression-testing', 'quality-assurance', 'code-review'],
  'security-reviewer': ['security-audit', 'vulnerability-assessment', 'compliance', 'code-review'],
}

// ---------------------------------------------------------------------------
// Domain derivation mapping (team → domains)
// ---------------------------------------------------------------------------

const DOMAIN_MAP = {
  orchestration: ['software-engineering', 'multi-agent-orchestration'],
  planning: ['software-engineering', 'multi-agent-orchestration', 'planning'],
  engineering: ['software-engineering', 'frontend', 'backend'],
  validation: ['software-engineering', 'quality-assurance', 'security'],
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Derive capabilities from agent role.
 * @param {string} role
 * @returns {string[]}
 */
function deriveCapabilities(role) {
  // Try exact match first
  if (CAPABILITY_MAP[role]) return CAPABILITY_MAP[role]
  // Try normalized (lowercase, hyphens)
  const normalized = role.toLowerCase().replace(/\s+/g, '-')
  if (CAPABILITY_MAP[normalized]) return CAPABILITY_MAP[normalized]
  // Fallback to implementation + testing for unknown roles
  return ['implementation', 'testing']
}

/**
 * Derive domains from team name.
 * @param {string} team
 * @returns {string[]}
 */
function deriveDomains(team) {
  if (!team) return ['software-engineering']
  const normalized = team.toLowerCase()
  if (DOMAIN_MAP[normalized]) return DOMAIN_MAP[normalized]
  // Fallback
  return ['software-engineering']
}

/**
 * Ensure a directory exists.
 * @param {string} dirPath
 */
function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * Check if an existing expertise entry has "real" data.
 * Real data = non-empty capabilities array OR non-empty evidence_refs.
 * @param {object} expertise
 * @returns {boolean}
 */
function hasRealData(expertise) {
  if (!expertise) return false
  if (Array.isArray(expertise.capabilities) && expertise.capabilities.length > 0) return true
  if (Array.isArray(expertise.evidence_refs) && expertise.evidence_refs.length > 0) return true
  return false
}

/**
 * Load meta-agents.yaml from the given path or workspace default.
 * @param {string} [configPath]
 * @returns {object}
 */
function loadMetaAgentsConfig(configPath) {
  const configFile = configPath
    ? resolve(configPath)
    : join(workspaceRoot, 'meta-agents.yaml')

  if (!existsSync(configFile)) {
    throw new Error(`meta-agents.yaml not found at '${configFile}'`)
  }

  const content = readFileSync(configFile, 'utf-8')
  return parseYaml(content)
}

/**
 * Generate a v1 expertise entry for an agent.
 * @param {object} agent - Agent definition from meta-agents.yaml
 * @param {string} crewId - Crew ID (e.g., 'dev')
 * @returns {object}
 */
function generateExpertiseEntry(agent, crewId) {
  const id = `${crewId}:${agent.id}`
  const now = new Date().toISOString()
  const role = agent.role || 'worker'
  const team = agent.team || 'engineering'
  const capabilities = deriveCapabilities(agent.id) || deriveCapabilities(role)
  const domains = deriveDomains(team)

  return {
    id,
    schema_version: EXPERTISE_SCHEMA_VERSION,
    owner: {
      agent: agent.id,
      team: team.charAt(0).toUpperCase() + team.slice(1),
    },
    capabilities,
    domains,
    input_contract: {
      required_fields: [],
      optional_fields: [],
      field_types: {},
    },
    allowed_environments: ['local', 'ci'],
    validation_status: 'declared',
    confidence: {
      score: 0.5,
      band: 'low',
      evidence_count: 0,
    },
    trust_tier: 'internal',
    lifecycle: 'active',
    policy: {
      federated_allowed: false,
      allowed_domains: [],
      approval_required: false,
    },
    evidence_refs: [],
    metadata: {
      created: now,
      updated: now,
      owner_id: `${team}/${agent.id}`,
      tags: ['generated', 'expertise-seed'],
      _extra: { source: 'meta-agents-yaml' },
    },
  }
}

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------

/**
 * Seed expertise catalog from meta-agents.yaml.
 *
 * @param {string} [configPath] - Optional path to meta-agents.yaml
 * @param {{ crew?: string, force?: boolean }} [options]
 * @returns {Promise<{ seeded: number, skipped: number, errors: string[], catalogPath: string }>}
 */
export async function seedExpertiseCatalog(configPath, options = {}) {
  const { crew: targetCrew, force = false } = options
  const errors = []
  let seeded = 0
  let skipped = 0

  // Load meta-agents.yaml
  let config
  try {
    config = loadMetaAgentsConfig(configPath)
  } catch (err) {
    errors.push(`Failed to load config: ${err.message}`)
    return { seeded: 0, skipped: 0, errors, catalogPath: '' }
  }

  const crews = config.crews || []

  // Filter to specific crew if requested
  const crewsToProcess = targetCrew
    ? crews.filter(c => c.id === targetCrew)
    : crews

  if (crewsToProcess.length === 0) {
    if (targetCrew) {
      errors.push(`Crew '${targetCrew}' not found in meta-agents.yaml`)
    }
    return { seeded: 0, skipped: 0, errors, catalogPath: '' }
  }

  // Determine catalog root (use workspace .mah directory, not global ~/.mah)
  const catalogRoot = join(workspaceRoot, '.mah', 'expertise', 'catalog')

  // Process each crew and agent
  for (const crewDef of crewsToProcess) {
    const crewId = crewDef.id
    const agents = crewDef.agents || []

    for (const agent of agents) {
      const expertiseId = `${crewId}:${agent.id}`
      const catalogDir = join(catalogRoot, crewId)
      const filePath = join(catalogDir, `${agent.id}.yaml`)

      // Check if entry already exists with real data
      if (!force && existsSync(filePath)) {
        try {
          const existingContent = readFileSync(filePath, 'utf-8')
          const existing = parseYaml(existingContent)
          if (hasRealData(existing)) {
            skipped++
            continue
          }
        } catch {
          // If we can't parse it, we'll overwrite
        }
      }

      // Even under --force, preserve entries that have been validated
      if (force && existsSync(filePath)) {
        try {
          const existingContent = readFileSync(filePath, 'utf-8')
          const existing = parseYaml(existingContent)
          if (existing?.validation_status === 'validated') {
            skipped++
            continue
          }
        } catch {
          // If we can't parse it, we'll overwrite
        }
      }

      // Generate new entry
      const expertise = generateExpertiseEntry(agent, crewId)

      // Validate
      const validation = validateExpertise(expertise)
      if (!validation.valid) {
        errors.push(`Validation failed for ${expertiseId}: ${validation.errors.join('; ')}`)
        continue
      }

      // Write file
      try {
        ensureDir(catalogDir)

        // Serialize to YAML
        const yamlContent = stringifyYaml(expertise, { indent: 2, lineWidth: 0 })

        writeFileSync(filePath, yamlContent, 'utf-8')
        seeded++
      } catch (err) {
        errors.push(`Failed to write ${filePath}: ${err.message}`)
      }
    }
  }

  return {
    seeded,
    skipped,
    errors,
    catalogPath: catalogRoot,
  }
}

// ---------------------------------------------------------------------------
// CLI smoke test
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== Expertise Seed Smoke Test ===\n')

  try {
    const result = await seedExpertiseCatalog(null, { force: true })
    console.log(`Seeded: ${result.seeded}`)
    console.log(`Skipped: ${result.skipped}`)
    console.log(`Errors: ${result.errors.length > 0 ? result.errors.join('; ') : 'none'}`)
    console.log(`Catalog path: ${result.catalogPath}`)

    if (result.seeded > 0) {
      console.log('\nRebuilding registry...')
      const registry = await buildRegistry()
      console.log(`Registry rebuilt: ${registry.total_count} entries`)
    }
  } catch (err) {
    console.error(`Error: ${err.message}`)
  }

  console.log('\n=== Smoke Test Complete ===')
}
