/**
 * MAH Expertise Export/Import Contract (M5)
 * @fileoverview Bounded export/import for MAH v0.7.0 Expertise Engine
 * @version 0.7.0
 * 
 * Scope (v0.7.0):
 * - Export with field allowlist and redaction
 * - Policy flag enforcement (federated_allowed, allowed_domains, approval_required)
 * - Import with schema/version compatibility check
 * - --dry-run mode for safe validation before committing
 * 
 * Out of scope:
 * - Full cross-org federation handshake
 * - Auto-approval workflows
 * - UI dashboard
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, isAbsolute } from 'path'
import { EXPERTISE_SCHEMA_VERSION, VALIDATION_STATUSES, LIFECYCLE_STATES, TRUST_TIERS } from '../types/expertise-types.mjs'
import { validateExpertise } from './expertise-schema.mjs'

// ---------------------------------------------------------------------------
// Export contract: allowed fields
// ---------------------------------------------------------------------------

/**
 * Fields that MAY appear in an exported expertise payload.
 * Fields not in this list are redacted.
 * @type {string[]}
 */
const EXPORT_ALLOWED_FIELDS = [
  'id',
  'owner',
  'schema_version',
  'capabilities',
  'domains',
  'input_contract',
  'allowed_environments',
  'validation_status',
  'confidence',
  'trust_tier',
  'lifecycle',
  'policy',
  'metadata',
]

/**
 * Metadata sub-fields that are safe to export.
 * owner_id and internal fields are redacted.
 * @type {Set<string>}
 */
const EXPORTABLE_METADATA_FIELDS = new Set(['created', 'updated', 'tags'])

// ---------------------------------------------------------------------------
// Redaction helpers
// ---------------------------------------------------------------------------

/**
 * Redact non-exportable fields from an expertise object.
 * Returns a clean export payload.
 * 
 * @param {Object} expertise - Full expertise object
 * @returns {Object} Redacted export payload
 */
export function redactExpertise(expertise) {
  /** @type {Object} */
  const exported = {}

  for (const field of EXPORT_ALLOWED_FIELDS) {
    if (!(field in expertise)) continue

    if (field === 'metadata') {
      // Redact owner_id from metadata; keep created, updated, tags
      const meta = expertise.metadata || {}
      /** @type {Object} */
      const safeMeta = {}
      for (const k of EXPORTABLE_METADATA_FIELDS) {
        if (k in meta) safeMeta[k] = meta[k]
      }
      if (Object.keys(safeMeta).length > 0) exported.metadata = safeMeta
      continue
    }

    if (field === 'policy') {
      // Policy is exported as-is; consumer must honor federated_allowed/allowed_domains/approval_required
      exported.policy = { ...expertise.policy }
      continue
    }

    exported[field] = expertise[field]
  }

  return exported
}

/**
 * Apply policy-based export restrictions.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 * 
 * @param {Object} expertise
 * @param {{ domain?: string }} [options]
 * @returns {{ allowed: boolean, reason?: string, warning?: string }}
 */
export function checkExportPolicy(expertise, options = {}) {
  const policy = expertise.policy || {}

  // Check federated_allowed flag
  if (policy.federated_allowed === false) {
    return {
      allowed: false,
      reason: `expertise '${expertise.id}' has federated_allowed=false — export blocked by policy`,
    }
  }

  // Check allowed_domains restriction — only when domain is explicitly specified
  if (options.domain && Array.isArray(policy.allowed_domains) && policy.allowed_domains.length > 0) {
    const domainAllowed = policy.allowed_domains.some(d => d === options.domain || d === '*')
    if (!domainAllowed) {
      return {
        allowed: false,
        reason: `expertise '${expertise.id}' allows export only to domains [${policy.allowed_domains.join(', ')}], not '${options.domain}'`,
      }
    }
  }

  // Warning if approval is required (does not block, just warns)
  if (policy.approval_required === true) {
    return {
      allowed: true,
      warning: `expertise '${expertise.id}' requires approval before use in target domain`,
    }
  }

  return { allowed: true }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Export a single expertise entry to a portable JSON object.
 * Applies redaction and policy checks.
 * 
 * @param {Object} expertise - Full expertise object (from registry/catalog)
 * @param {{ domain?: string, skipPolicy?: boolean }} [options]
 * @returns {{ ok: boolean, payload?: Object, error?: string, warnings?: string[] }}
 */
export function exportExpertise(expertise, options = {}) {
  /** @type {string[]} */
  const warnings = []

  if (!expertise?.id) {
    return { ok: false, error: 'expertise is missing required field: id' }
  }

  // Validate structure before export
  const validation = validateExpertise(expertise, false)
  if (!validation.valid) {
    return {
      ok: false,
      error: `expertise '${expertise.id}' is invalid and cannot be exported: ${validation.errors.join('; ')}`,
    }
  }

  // Policy check (unless skipped)
  if (!options.skipPolicy) {
    const policyResult = checkExportPolicy(expertise, { domain: options.domain })
    if (!policyResult.allowed) {
      return { ok: false, error: policyResult.reason }
    }
    if (policyResult.warning) {
      warnings.push(policyResult.warning)
    }
  }

  // Redact
  const payload = redactExpertise(expertise)

  // Stamp with export metadata
  payload._export = {
    exported_at: new Date().toISOString(),
    exported_by: process.env.MAH_AGENT || process.env.USER || 'unknown',
    schema_version: EXPERTISE_SCHEMA_VERSION,
    policy_snapshot: {
      federated_allowed: payload.policy?.federated_allowed ?? false,
      allowed_domains: payload.policy?.allowed_domains ?? [],
      approval_required: payload.policy?.approval_required ?? false,
    },
  }

  return { ok: true, payload, warnings }
}

/**
 * Export multiple expertise entries to a bundle.
 * 
 * @param {Object[]} expertiseList
 * @param {{ domain?: string }} [options]
 * @returns {{ ok: boolean, bundle?: Object, errors: string[], exported: Object[] }}
 */
export function exportExpertiseBundle(expertiseList, options = {}) {
  /** @type {Object[]} */
  const exported = []
  /** @type {string[]} */
  const errors = []

  for (const exp of expertiseList) {
    const result = exportExpertise(exp, options)
    if (result.ok) {
      exported.push(result.payload)
      if (result.warnings?.length) errors.push(...result.warnings)
    } else {
      errors.push(result.error)
    }
  }

  if (exported.length === 0 && expertiseList.length > 0) {
    return { ok: false, errors, exported: [] }
  }

  const bundle = {
    schema_version: EXPERTISE_SCHEMA_VERSION,
    bundle_version: 'v1',
    exported_at: new Date().toISOString(),
    count: exported.length,
    entries: exported,
  }

  return { ok: true, bundle, errors, exported }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Validate import payload schema and compatibility.
 * Does NOT grant any permissions — caller must apply policy.
 * Uses targeted field-level validation (does NOT call validateExpertise)
 * because owner_id is redacted during import and validateExpertise
 * requires owner_id to be a string.
 * 
 * @param {Object} payload - Raw imported JSON (will NOT be mutated)
 * @param {{ strict?: boolean, skipValidation?: boolean }} [options]
 * @returns {{ valid: boolean, errors: string[], warnings: string[], normalized?: Object }}
 */
export function validateImportPayload(payload, options = {}) {
  /** @type {string[]} */
  const errors = []
  /** @type {string[]} */
  const warnings = []

  // Must be an object
  if (!payload || typeof payload !== 'object') {
    errors.push('import payload must be a non-null object')
    return { valid: false, errors, warnings }
  }

  // Check if it's a bundle
  if (Array.isArray(payload) || payload.entries) {
    return validateImportBundle(payload, options)
  }

  // --- Single expertise validation ---
  
  // schema_version check
  if (payload.schema_version !== EXPERTISE_SCHEMA_VERSION) {
    if (payload.schema_version === undefined) {
      errors.push('import payload missing required field: schema_version')
    } else {
      errors.push(`import payload schema_version '${payload.schema_version}' is not compatible with '${EXPERTISE_SCHEMA_VERSION}'`)
    }
  }

  // id check
  if (!payload.id || typeof payload.id !== 'string') {
    errors.push('import payload missing required string field: id')
  }

  // owner check
  if (!payload.owner || typeof payload.owner !== 'object' || (!payload.owner?.agent && !payload.owner?.team)) {
    errors.push('import payload missing or invalid field: owner (must be object with agent and/or team)')
  }

  // capabilities: must be non-empty array of strings
  if (!Array.isArray(payload.capabilities) || payload.capabilities.length === 0) {
    errors.push('import payload missing or invalid field: capabilities (must be non-empty array of strings)')
  } else {
    for (const cap of payload.capabilities) {
      if (typeof cap !== 'string') {
        errors.push('import payload capabilities must be array of strings')
        break
      }
    }
  }

  // domains: must be non-empty array of strings
  if (!Array.isArray(payload.domains) || payload.domains.length === 0) {
    errors.push('import payload missing or invalid field: domains (must be non-empty array of strings)')
  } else {
    for (const dom of payload.domains) {
      if (typeof dom !== 'string') {
        errors.push('import payload domains must be array of strings')
        break
      }
    }
  }

  // validation_status: must be one of VALIDATION_STATUSES
  if (payload.validation_status && !VALIDATION_STATUSES.includes(payload.validation_status)) {
    errors.push(`import payload validation_status '${payload.validation_status}' is not valid (must be one of: ${VALIDATION_STATUSES.join(', ')})`)
  }

  // trust_tier: must be one of TRUST_TIERS
  if (payload.trust_tier && !TRUST_TIERS.includes(payload.trust_tier)) {
    errors.push(`import payload trust_tier '${payload.trust_tier}' is not valid (must be one of: ${TRUST_TIERS.join(', ')})`)
  }

  // lifecycle: must be one of LIFECYCLE_STATES
  if (payload.lifecycle && !LIFECYCLE_STATES.includes(payload.lifecycle)) {
    errors.push(`import payload lifecycle '${payload.lifecycle}' is not valid (must be one of: ${LIFECYCLE_STATES.join(', ')})`)
  }

  // policy: if present, validate federated_allowed (bool), allowed_domains (array of strings), approval_required (bool)
  if (payload.policy) {
    if (typeof payload.policy.federated_allowed !== 'boolean') {
      errors.push('import payload policy.federated_allowed must be boolean')
    }
    if (!Array.isArray(payload.policy.allowed_domains)) {
      errors.push('import payload policy.allowed_domains must be array of strings')
    } else {
      for (const d of payload.policy.allowed_domains) {
        if (typeof d !== 'string') {
          errors.push('import payload policy.allowed_domains must be array of strings')
          break
        }
      }
    }
    if (typeof payload.policy.approval_required !== 'boolean') {
      errors.push('import payload policy.approval_required must be boolean')
    }
  }

  // metadata: if present, validate created (string), updated (string), tags (array of strings)
  // Note: owner_id is REDACTED before import - if present, strip it with a warning
  if (payload.metadata) {
    if (payload.metadata.created && typeof payload.metadata.created !== 'string') {
      errors.push('import payload metadata.created must be string')
    }
    if (payload.metadata.updated && typeof payload.metadata.updated !== 'string') {
      errors.push('import payload metadata.updated must be string')
    }
    if (payload.metadata.tags) {
      if (!Array.isArray(payload.metadata.tags)) {
        errors.push('import payload metadata.tags must be array of strings')
      } else {
        for (const t of payload.metadata.tags) {
          if (typeof t !== 'string') {
            errors.push('import payload metadata.tags must be array of strings')
            break
          }
        }
      }
    }
    // owner_id is redacted during import - if present, warn but don't error (strip it)
    if ('owner_id' in payload.metadata) {
      warnings.push('import payload metadata.owner_id will be redacted (owner_id is set by the importing organization)')
    }
  }

  // Add _export as warning (not an error) — extract without mutation
  if (payload._export) {
    warnings.push("Expertise: unknown field '_export' — this is an export stamp, not a canonical field")
  }

  // Warn about unknown fields (but don't error — forward compatibility)
  const known = new Set([
    'id', 'owner', 'schema_version', 'capabilities', 'domains',
    'input_contract', 'allowed_environments', 'validation_status',
    'confidence', 'trust_tier', 'lifecycle', 'policy',
    'evidence_refs', 'metadata', '_export',
  ])
  for (const key of Object.keys(payload)) {
    if (!known.has(key)) {
      warnings.push(`import payload contains unknown field '${key}' — this may not be supported in v0.7.0`)
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings }
  }

  // Return normalized payload (deep copy to avoid mutation of original)
  const normalized = { ...payload }
  if (payload.metadata) {
    normalized.metadata = { ...payload.metadata }
    // Ensure owner_id is not present in normalized output
    if ('owner_id' in normalized.metadata) {
      delete normalized.metadata.owner_id
    }
  }

  return { valid: true, errors, warnings, normalized }
}

/**
 * Validate an import bundle (multiple entries).
 * Does NOT mutate original bundle items.
 * @param {Object} bundle
 * @param {Object} [options]
 * @returns {{ valid: boolean, errors: string[], warnings: string[], entries: Object[] }}
 */
export function validateImportBundle(bundle, options = {}) {
  /** @type {string[]} */
  const errors = []
  /** @type {string[]} */
  const warnings = []
  /** @type {Object[]} */
  const entries = []

  if (bundle.schema_version !== EXPERTISE_SCHEMA_VERSION) {
    errors.push(`bundle schema_version '${bundle.schema_version}' does not match '${EXPERTISE_SCHEMA_VERSION}'`)
  }

  const itemList = bundle.entries || []
  if (!Array.isArray(itemList) || itemList.length === 0) {
    errors.push('bundle has no entries to import')
    return { valid: false, errors, warnings, entries: [] }
  }

  for (let i = 0; i < itemList.length; i++) {
    // Pass shallow copy to avoid mutation of original bundle items
    const itemCopy = { ...itemList[i] }
    if (itemCopy.metadata) {
      itemCopy.metadata = { ...itemCopy.metadata }
    }
    const itemResult = validateImportPayload(itemCopy, options)
    if (!itemResult.valid) {
      errors.push(`bundle entry [${i}] '${itemList[i].id || 'unknown'}': ${itemResult.errors.join('; ')}`)
    } else {
      entries.push(itemResult.normalized)
    }
    warnings.push(...itemResult.warnings)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    entries,
  }
}

/**
 * Import an expertise payload (dry-run or commit).
 * In v0.7.0, import is metadata-only — it does NOT write to the catalog.
 * Caller must handle file I/O.
 * 
 * @param {Object} payload - Validated import payload
 * @param {{ dryRun?: boolean, targetPath?: string }} [options]
 * @returns {{ ok: boolean, imported?: Object, message: string }}
 */
export function importExpertise(payload, options = {}) {
  if (options.dryRun) {
    return {
      ok: true,
      imported: payload,
      message: `dry-run: would import expertise '${payload.id}' (not written to disk)`,
    }
  }

  // In v0.7.0, we do not auto-write to catalog.
  // Caller must handle the actual write to avoid bypassing governance.
  return {
    ok: true,
    imported: payload,
    message: `expertise '${payload.id}' validated and ready for catalog write (caller must handle I/O)`,
  }
}

// ---------------------------------------------------------------------------
// File-based export/import helpers
// ---------------------------------------------------------------------------

/**
 * Export expertise from file path and write to output file.
 * 
 * @param {string} expertiseId - ID to look up in registry
 * @param {string} outputPath - Output .json file path
 * @param {{ domain?: string }} [options]
 * @returns {Promise<{ ok: boolean, written?: number, errors: string[] }>}
 */
export async function exportExpertiseToFile(expertiseId, outputPath, options = {}) {
  const { loadExpertiseById } = await import('./expertise-loader.mjs')
  const { writeFileSync, mkdirSync } = await import('fs')

  const entry = await loadExpertiseById(expertiseId) || await loadExpertiseById(`dev:${expertiseId}`)

  if (!entry) {
    return { ok: false, errors: [`expertise '${expertiseId}' not found in catalog`] }
  }

  const result = exportExpertise(entry, options)
  if (!result.ok) {
    return { ok: false, errors: [result.error] }
  }

  // Write to file
  const outputDir = outputPath.substring(0, outputPath.lastIndexOf('/'))
  if (outputDir) mkdirSync(outputDir, { recursive: true })
  writeFileSync(outputPath, JSON.stringify(result.payload, null, 2), 'utf-8')

  return { ok: true, written: 1, errors: result.warnings || [] }
}

/**
 * Load and validate an import file.
 * 
 * @param {string} filePath
 * @param {{ strict?: boolean, dryRun?: boolean }} [options]
 * @returns {Promise<{ valid: boolean, payload?: Object, errors: string[], warnings: string[] }>}
 */
export async function loadImportFile(filePath, options = {}) {
  if (!existsSync(filePath)) {
    return { valid: false, errors: [`import file not found: '${filePath}'`] }
  }

  let raw
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch (err) {
    return { valid: false, errors: [`failed to read import file: ${err.message}`] }
  }

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return { valid: false, errors: [`import file is not valid JSON: '${filePath}'`] }
  }

  const validation = validateImportPayload(payload, options)
  if (!validation.valid) {
    return { valid: false, errors: validation.errors, warnings: validation.warnings }
  }

  return {
    valid: true,
    payload: validation.normalized,
    errors: [],
    warnings: validation.warnings,
  }
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

/**
 * Format export policy summary for display.
 * @param {Object} expertise
 * @returns {string}
 */
export function formatExportPolicySummary(expertise) {
  const policy = expertise.policy || {}
  const lines = [
    `  federated_allowed:  ${policy.federated_allowed ?? false}`,
    `  allowed_domains:   [${(policy.allowed_domains || []).join(', ') || 'none'}]`,
    `  approval_required: ${policy.approval_required ?? false}`,
  ]
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== Expertise Export/Import Self-Test ===\n')

  // Mock expertise with various policy configurations
  const mockExpertise = {
    id: 'dev:backend-dev',
    owner: { agent: 'backend-dev', team: 'dev' },
    schema_version: 'mah.expertise.v1',
    capabilities: ['api-design', 'database-optimization', 'node.js'],
    domains: ['backend', 'databases'],
    input_contract: { required_fields: ['task_description'], optional_fields: ['context'], field_types: {} },
    allowed_environments: ['production', 'staging', 'development'],
    validation_status: 'validated',
    confidence: { score: 0.85, band: 'high', evidence_count: 12 },
    trust_tier: 'internal',
    lifecycle: 'active',
    policy: {
      federated_allowed: false,
      allowed_domains: ['engineering'],
      approval_required: true,
    },
    metadata: {
      created: '2026-03-01T10:00:00Z',
      updated: '2026-04-01T10:00:00Z',
      owner_id: 'agent:backend-dev:internal',
      tags: ['api', 'database', 'nodejs'],
    },
    evidence_refs: ['ev-001', 'ev-002'],
  }

  // Test 1: Export with policy check
  console.log('Test 1: Export with federated_allowed=false')
  const result1 = exportExpertise(mockExpertise)
  if (result1.ok) {
    console.log('  ✓ export allowed')
    console.log(`  payload._export: ${JSON.stringify(result1.payload._export.policy_snapshot)}`)
    console.log(`  evidence_refs redacted: ${'evidence_refs' in result1.payload ? 'NO (ERROR)' : 'YES'}`)
    console.log(`  owner_id redacted: ${result1.payload.metadata?.owner_id !== undefined ? 'NO (ERROR)' : 'YES'}`)
  } else {
    console.log(`  ✗ blocked: ${result1.error}`)
  }
  console.log('')

  // Test 2: Export with federated_allowed=true
  console.log('Test 2: Export with federated_allowed=true')
  const allowedExp = { ...mockExpertise, policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: false } }
  const result2 = exportExpertise(allowedExp)
  if (result2.ok) {
    console.log('  ✓ export allowed')
    console.log(`  warnings: ${result2.warnings?.join(', ') || 'none'}`)
  } else {
    console.log(`  ✗ blocked: ${result2.error}`)
  }
  console.log('')

  // Test 3: Import validation
  console.log('Test 3: Import validation (valid payload)')
  const importPayload = {
    id: 'dev:new-dev',
    owner: { team: 'dev' },
    schema_version: 'mah.expertise.v1',
    capabilities: ['coding', 'testing'],
    domains: ['software-engineering'],
    validation_status: 'declared',
    trust_tier: 'internal',
    lifecycle: 'active',
    policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: false },
  }
  const importResult = validateImportPayload(importPayload)
  console.log(`  valid: ${importResult.valid}`)
  if (!importResult.valid) console.log(`  errors: ${importResult.errors.join('; ')}`)
  console.log('')

  // Test 4: Import validation (invalid schema version)
  console.log('Test 4: Import validation (wrong schema version)')
  const badPayload = { ...importPayload, schema_version: 'mah.expertise.v2' }
  const badResult = validateImportPayload(badPayload)
  console.log(`  valid: ${badResult.valid}`)
  console.log(`  errors: ${badResult.errors.join('; ')}`)
  console.log('')

  // Test 5: Bundle export
  console.log('Test 5: Bundle export')
  const bundleResult = exportExpertiseBundle([allowedExp, { ...allowedExp, id: 'dev:frontend-dev', policy: { federated_allowed: false } }])
  console.log(`  ok: ${bundleResult.ok}`)
  console.log(`  exported count: ${bundleResult.exported.length}`)
  console.log(`  errors: ${bundleResult.errors.join(', ') || 'none'}`)

  console.log('\n=== Self-Test Complete ===')
}
