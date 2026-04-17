/**
 * MAH Expertise v1 Validation Schema
 * @fileoverview Pure validation logic for all MAH expertise types
 * @version 0.7.0
 */

import {
  EXPERTISE_SCHEMA_VERSION,
  CONFIDENCE_BANDS,
  VALIDATION_STATUSES,
  LIFECYCLE_STATES,
  TRUST_TIERS,
  EVIDENCE_TYPES,
  OUTCOMES,
} from '../types/expertise-types.mjs'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} path - dotted path to field
 * @param {string} msg - error message
 * @returns {string} formatted error
 */
function err(path, msg) {
  return `${path}: ${msg}`
}

/**
 * @param {string} path - dotted path to field
 * @param {string} msg - warning message
 * @returns {string} formatted warning
 */
function warn(path, msg) {
  return `${path}: ${msg}`
}

/**
 * Check unknown fields against a known set.
 * @param {Object} obj
 * @param {Set<string>} known
 * @param {string} path
 * @param {boolean} strict
 * @param {string[]} errors
 * @param {string[]} warnings
 */
function checkUnknown(obj, known, path, strict, errors, warnings) {
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) {
      const msg = `unknown field '${key}'`
      if (strict) {
        errors.push(warn(path, msg))
      } else {
        warnings.push(warn(path, msg))
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Named validators
// ---------------------------------------------------------------------------

/**
 * @typedef {'agent'|'team'|'both'} OwnerType
 * @typedef {'low'|'medium'|'high'|'critical'} ConfidenceBand
 * @typedef {'declared'|'observed'|'validated'|'restricted'|'revoked'} ValidationStatus
 * @typedef {'draft'|'active'|'experimental'|'restricted'|'deprecated'} LifecycleState
 * @typedef {'internal'|'team'|'org'|'federated'} TrustTier
 * @typedef {'execution'|'review'|'cost'|'latency'} EvidenceType
 * @typedef {'success'|'failure'|'partial'} Outcome
 */

/**
 * Validate an ExpertiseEvidence object.
 * @param {Object} obj
 * @param {boolean} [strict=false]
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateExpertiseEvidence(obj, strict = false) {
  /** @type {string[]} */
  const errors = []
  /** @type {string[]} */
  const warnings = []

  if (!obj || typeof obj !== 'object') {
    errors.push('ExpertiseEvidence: must be a non-null object')
    return { valid: false, errors, warnings }
  }

  const known = new Set([
    'id', 'expertise_id', 'type', 'outcome', 'timestamp',
    'task_context', 'evidence_data', 'recorded_by',
  ])

  // Required: id
  if (typeof obj.id !== 'string' || obj.id.trim() === '') {
    errors.push(err('ExpertiseEvidence.id', 'required field missing or empty'))
  }

  // Required: expertise_id
  if (typeof obj.expertise_id !== 'string' || obj.expertise_id.trim() === '') {
    errors.push(err('ExpertiseEvidence.expertise_id', 'required field missing or empty'))
  }

  // Required: type
  if (!EVIDENCE_TYPES.includes(obj.type)) {
    errors.push(err(`ExpertiseEvidence.type`, `must be one of ${EVIDENCE_TYPES.join(', ')}, got '${obj.type}'`))
  }

  // Required: outcome
  if (!OUTCOMES.includes(obj.outcome)) {
    errors.push(err(`ExpertiseEvidence.outcome`, `must be one of ${OUTCOMES.join(', ')}, got '${obj.outcome}'`))
  }

  // Required: timestamp
  if (typeof obj.timestamp !== 'string' || obj.timestamp.trim() === '') {
    errors.push(err('ExpertiseEvidence.timestamp', 'required field missing or empty'))
  }

  // Required: task_context
  if (typeof obj.task_context !== 'string' || obj.task_context.trim() === '') {
    errors.push(err('ExpertiseEvidence.task_context', 'required field missing or empty'))
  }

  // Required: recorded_by
  if (typeof obj.recorded_by !== 'string' || obj.recorded_by.trim() === '') {
    errors.push(err('ExpertiseEvidence.recorded_by', 'required field missing or empty'))
  }

  // Optional: evidence_data
  if (obj.evidence_data !== undefined) {
    if (typeof obj.evidence_data !== 'object' || obj.evidence_data === null) {
      errors.push(err('ExpertiseEvidence.evidence_data', 'must be an object if present'))
    } else {
      const edKnown = new Set(['latency_ms', 'cost_units', 'review_pass', 'error_type'])
      checkUnknown(obj.evidence_data, edKnown, 'ExpertiseEvidence.evidence_data', strict, errors, warnings)
      if (obj.evidence_data.latency_ms !== undefined && typeof obj.evidence_data.latency_ms !== 'number') {
        errors.push(err('ExpertiseEvidence.evidence_data.latency_ms', `must be number, got ${typeof obj.evidence_data.latency_ms}`))
      }
      if (obj.evidence_data.cost_units !== undefined && typeof obj.evidence_data.cost_units !== 'number') {
        errors.push(err('ExpertiseEvidence.evidence_data.cost_units', `must be number, got ${typeof obj.evidence_data.cost_units}`))
      }
      if (obj.evidence_data.review_pass !== undefined && typeof obj.evidence_data.review_pass !== 'boolean') {
        errors.push(err('ExpertiseEvidence.evidence_data.review_pass', `must be boolean, got ${typeof obj.evidence_data.review_pass}`))
      }
      if (obj.evidence_data.error_type !== undefined && typeof obj.evidence_data.error_type !== 'string') {
        errors.push(err('ExpertiseEvidence.evidence_data.error_type', `must be string, got ${typeof obj.evidence_data.error_type}`))
      }
    }
  }

  checkUnknown(obj, known, 'ExpertiseEvidence', strict, errors, warnings)

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate an ExpertiseMetrics object.
 * @param {Object} obj
 * @param {boolean} [strict=false]
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateExpertiseMetrics(obj, strict = false) {
  /** @type {string[]} */
  const errors = []
  /** @type {string[]} */
  const warnings = []

  if (!obj || typeof obj !== 'object') {
    errors.push('ExpertiseMetrics: must be a non-null object')
    return { valid: false, errors, warnings }
  }

  const known = new Set([
    'expertise_id', 'total_invocations', 'successful_invocations', 'failed_invocations',
    'avg_duration_ms', 'p95_duration_ms', 'total_cost_units',
    'review_pass_rate', 'rejection_rate',
    'last_invoked', 'last_successful', 'last_failed',
    'evidence_count', 'window_start', 'window_end',
  ])

  // Required: expertise_id
  if (typeof obj.expertise_id !== 'string' || obj.expertise_id.trim() === '') {
    errors.push(err('ExpertiseMetrics.expertise_id', 'required field missing or empty'))
  }

  // Required: total_invocations
  if (typeof obj.total_invocations !== 'number' || obj.total_invocations < 0) {
    errors.push(err('ExpertiseMetrics.total_invocations', `must be number >= 0, got '${obj.total_invocations}'`))
  }

  if (typeof obj.successful_invocations !== 'number' || obj.successful_invocations < 0) {
    errors.push(err('ExpertiseMetrics.successful_invocations', `must be number >= 0, got '${obj.successful_invocations}'`))
  }

  if (typeof obj.failed_invocations !== 'number' || obj.failed_invocations < 0) {
    errors.push(err('ExpertiseMetrics.failed_invocations', `must be number >= 0, got '${obj.failed_invocations}'`))
  }

  if (typeof obj.avg_duration_ms !== 'number' || obj.avg_duration_ms < 0) {
    errors.push(err('ExpertiseMetrics.avg_duration_ms', `must be number >= 0, got '${obj.avg_duration_ms}'`))
  }

  if (typeof obj.p95_duration_ms !== 'number' || obj.p95_duration_ms < 0) {
    errors.push(err('ExpertiseMetrics.p95_duration_ms', `must be number >= 0, got '${obj.p95_duration_ms}'`))
  }

  if (typeof obj.total_cost_units !== 'number' || obj.total_cost_units < 0) {
    errors.push(err('ExpertiseMetrics.total_cost_units', `must be number >= 0, got '${obj.total_cost_units}'`))
  }

  if (typeof obj.review_pass_rate !== 'number' || obj.review_pass_rate < 0 || obj.review_pass_rate > 1) {
    errors.push(err('ExpertiseMetrics.review_pass_rate', `must be number 0-1, got '${obj.review_pass_rate}'`))
  }

  if (typeof obj.rejection_rate !== 'number' || obj.rejection_rate < 0 || obj.rejection_rate > 1) {
    errors.push(err('ExpertiseMetrics.rejection_rate', `must be number 0-1, got '${obj.rejection_rate}'`))
  }

  if (typeof obj.evidence_count !== 'number' || obj.evidence_count < 0) {
    errors.push(err('ExpertiseMetrics.evidence_count', `must be number >= 0, got '${obj.evidence_count}'`))
  }

  for (const field of ['last_invoked', 'last_successful', 'last_failed', 'window_start', 'window_end']) {
    if (obj[field] !== null && obj[field] !== undefined && typeof obj[field] !== 'string') {
      errors.push(err(`ExpertiseMetrics.${field}`, `must be string or null, got '${typeof obj[field]}'`))
    }
  }

  checkUnknown(obj, known, 'ExpertiseMetrics', strict, errors, warnings)

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate an ExpertiseValidationState object.
 * @param {Object} obj
 * @param {boolean} [strict=false]
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateExpertiseValidationState(obj, strict = false) {
  /** @type {string[]} */
  const errors = []
  /** @type {string[]} */
  const warnings = []

  if (!obj || typeof obj !== 'object') {
    errors.push('ExpertiseValidationState: must be a non-null object')
    return { valid: false, errors, warnings }
  }

  const known = new Set([
    'status', 'last_validated', 'validated_by', 'restrictions', 'revocation_reason',
  ])

  // Required: status
  if (!VALIDATION_STATUSES.includes(obj.status)) {
    errors.push(err(`ExpertiseValidationState.status`, `must be one of ${VALIDATION_STATUSES.join(', ')}, got '${obj.status}'`))
  }

  // Required: last_validated
  if (typeof obj.last_validated !== 'string' || obj.last_validated.trim() === '') {
    errors.push(err('ExpertiseValidationState.last_validated', 'required field missing or empty'))
  }

  // Required: validated_by
  if (typeof obj.validated_by !== 'string' || obj.validated_by.trim() === '') {
    errors.push(err('ExpertiseValidationState.validated_by', 'required field missing or empty'))
  }

  // Required: restrictions (array)
  if (!Array.isArray(obj.restrictions)) {
    errors.push(err('ExpertiseValidationState.restrictions', 'must be an array'))
  } else {
    for (let i = 0; i < obj.restrictions.length; i++) {
      if (typeof obj.restrictions[i] !== 'string') {
        errors.push(err(`ExpertiseValidationState.restrictions[${i}]`, `must be string, got ${typeof obj.restrictions[i]}`))
      }
    }
  }

  // Optional: revocation_reason
  if (obj.revocation_reason !== undefined && typeof obj.revocation_reason !== 'string') {
    errors.push(err('ExpertiseValidationState.revocation_reason', `must be string, got ${typeof obj.revocation_reason}`))
  }

  checkUnknown(obj, known, 'ExpertiseValidationState', strict, errors, warnings)

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate an Expertise object.
 * @param {Object} obj
 * @param {boolean} [strict=false]
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateExpertise(obj, strict = false) {
  /** @type {string[]} */
  const errors = []
  /** @type {string[]} */
  const warnings = []

  if (!obj || typeof obj !== 'object') {
    errors.push('Expertise: must be a non-null object')
    return { valid: false, errors, warnings }
  }

  const known = new Set([
    'id', 'owner', 'schema_version', 'capabilities', 'domains',
    'input_contract', 'allowed_environments', 'validation_status',
    'confidence', 'trust_tier', 'lifecycle', 'policy',
    'evidence_refs', 'metadata',
  ])

  // Required: id
  if (typeof obj.id !== 'string' || obj.id.trim() === '') {
    errors.push(err('Expertise.id', 'required field missing or empty'))
  }

  // Required: owner — must be non-null object with agent and/or team
  if (
    typeof obj.owner !== 'object' ||
    obj.owner === null ||
    (!obj.owner?.agent && !obj.owner?.team)
  ) {
    errors.push(err('Expertise.owner', `must be non-null object with agent and/or team, got '${JSON.stringify(obj.owner)}'`))
  }

  // Required: schema_version — must equal "mah.expertise.v1"
  if (obj.schema_version !== EXPERTISE_SCHEMA_VERSION) {
    if (obj.schema_version === undefined) {
      errors.push(err('Expertise.schema_version', `required field missing; must be '${EXPERTISE_SCHEMA_VERSION}'`))
    } else {
      errors.push(err('Expertise.schema_version', `must be '${EXPERTISE_SCHEMA_VERSION}', got '${obj.schema_version}'`))
    }
  }

  // Required: capabilities (non-empty array)
  if (!Array.isArray(obj.capabilities) || obj.capabilities.length === 0) {
    errors.push(err('Expertise.capabilities', 'must be a non-empty array'))
  } else {
    for (let i = 0; i < obj.capabilities.length; i++) {
      if (typeof obj.capabilities[i] !== 'string') {
        errors.push(err(`Expertise.capabilities[${i}]`, `must be string, got ${typeof obj.capabilities[i]}`))
      }
    }
  }

  // Required: domains (non-empty array)
  if (!Array.isArray(obj.domains) || obj.domains.length === 0) {
    errors.push(err('Expertise.domains', 'must be a non-empty array'))
  } else {
    for (let i = 0; i < obj.domains.length; i++) {
      if (typeof obj.domains[i] !== 'string') {
        errors.push(err(`Expertise.domains[${i}]`, `must be string, got ${typeof obj.domains[i]}`))
      }
    }
  }

  // Required: validation_status
  if (!VALIDATION_STATUSES.includes(obj.validation_status)) {
    errors.push(err(`Expertise.validation_status`, `must be one of ${VALIDATION_STATUSES.join(', ')}, got '${obj.validation_status}'`))
  }

  // Required: lifecycle
  if (!LIFECYCLE_STATES.includes(obj.lifecycle)) {
    errors.push(err(`Expertise.lifecycle`, `must be one of ${LIFECYCLE_STATES.join(', ')}, got '${obj.lifecycle}'`))
  }

  // Required: trust_tier
  if (!TRUST_TIERS.includes(obj.trust_tier)) {
    errors.push(err(`Expertise.trust_tier`, `must be one of ${TRUST_TIERS.join(', ')}, got '${obj.trust_tier}'`))
  }

  // Optional: allowed_environments
  if (obj.allowed_environments !== undefined) {
    if (!Array.isArray(obj.allowed_environments)) {
      errors.push(err('Expertise.allowed_environments', 'must be an array if present'))
    } else if (obj.allowed_environments.length === 0) {
      errors.push(err('Expertise.allowed_environments', 'must be non-empty if present'))
    } else {
      for (let i = 0; i < obj.allowed_environments.length; i++) {
        if (typeof obj.allowed_environments[i] !== 'string') {
          errors.push(err(`Expertise.allowed_environments[${i}]`, `must be string, got ${typeof obj.allowed_environments[i]}`))
        }
      }
    }
  }

  // Optional: policy
  if (obj.policy !== undefined) {
    if (typeof obj.policy !== 'object' || obj.policy === null) {
      errors.push(err('Expertise.policy', 'must be an object if present'))
    } else {
      const policyKnown = new Set(['federated_allowed', 'allowed_domains', 'approval_required'])
      checkUnknown(obj.policy, policyKnown, 'Expertise.policy', strict, errors, warnings)
      if (typeof obj.policy.federated_allowed !== 'boolean') {
        errors.push(err('Expertise.policy.federated_allowed', `must be boolean, got ${typeof obj.policy.federated_allowed}`))
      }
      if (!Array.isArray(obj.policy.allowed_domains)) {
        errors.push(err('Expertise.policy.allowed_domains', `must be array, got ${typeof obj.policy.allowed_domains}`))
      } else {
        for (let i = 0; i < obj.policy.allowed_domains.length; i++) {
          if (typeof obj.policy.allowed_domains[i] !== 'string') {
            errors.push(err(`Expertise.policy.allowed_domains[${i}]`, `must be string`))
          }
        }
      }
      if (typeof obj.policy.approval_required !== 'boolean') {
        errors.push(err('Expertise.policy.approval_required', `must be boolean, got ${typeof obj.policy.approval_required}`))
      }
    }
  }

  // Optional: confidence
  if (obj.confidence !== undefined) {
    if (typeof obj.confidence !== 'object' || obj.confidence === null) {
      errors.push(err('Expertise.confidence', 'must be an object if present'))
    } else {
      const confKnown = new Set(['score', 'band', 'evidence_count'])
      checkUnknown(obj.confidence, confKnown, 'Expertise.confidence', strict, errors, warnings)
      if (typeof obj.confidence.score !== 'number' || obj.confidence.score < 0 || obj.confidence.score > 1) {
        errors.push(err('Expertise.confidence.score', `must be number 0-1, got ${obj.confidence.score}`))
      }
      if (!CONFIDENCE_BANDS.includes(obj.confidence.band)) {
        errors.push(err(`Expertise.confidence.band`, `must be one of ${CONFIDENCE_BANDS.join(', ')}, got '${obj.confidence.band}'`))
      }
      if (typeof obj.confidence.evidence_count !== 'number' || obj.confidence.evidence_count < 0) {
        errors.push(err('Expertise.confidence.evidence_count', `must be number >= 0, got ${obj.confidence.evidence_count}`))
      }
    }
  }

  // Optional: input_contract
  if (obj.input_contract !== undefined) {
    if (typeof obj.input_contract !== 'object' || obj.input_contract === null) {
      errors.push(err('Expertise.input_contract', 'must be an object if present'))
    } else {
      const icKnown = new Set(['required_fields', 'optional_fields', 'field_types'])
      checkUnknown(obj.input_contract, icKnown, 'Expertise.input_contract', strict, errors, warnings)
      if (!Array.isArray(obj.input_contract.required_fields)) {
        errors.push(err('Expertise.input_contract.required_fields', 'must be array'))
      }
      if (!Array.isArray(obj.input_contract.optional_fields)) {
        errors.push(err('Expertise.input_contract.optional_fields', 'must be array'))
      }
      if (typeof obj.input_contract.field_types !== 'object') {
        errors.push(err('Expertise.input_contract.field_types', 'must be record'))
      }
    }
  }

  // Optional: evidence_refs
  if (obj.evidence_refs !== undefined) {
    if (!Array.isArray(obj.evidence_refs)) {
      errors.push(err('Expertise.evidence_refs', 'must be an array if present'))
    } else {
      for (let i = 0; i < obj.evidence_refs.length; i++) {
        if (typeof obj.evidence_refs[i] !== 'string') {
          errors.push(err(`Expertise.evidence_refs[${i}]`, `must be string`))
        }
      }
    }
  }

  // Optional: metadata
  if (obj.metadata !== undefined) {
    if (typeof obj.metadata !== 'object' || obj.metadata === null) {
      errors.push(err('Expertise.metadata', 'must be an object if present'))
    } else {
      const metaKnown = new Set(['created', 'updated', 'owner_id', 'tags', 'risks', 'lessons', 'workflows', '_extra'])
      checkUnknown(obj.metadata, metaKnown, 'Expertise.metadata', strict, errors, warnings)
      if (typeof obj.metadata.created !== 'string') {
        errors.push(err('Expertise.metadata.created', 'must be string'))
      }
      if (typeof obj.metadata.updated !== 'string') {
        errors.push(err('Expertise.metadata.updated', 'must be string'))
      }
      if (typeof obj.metadata.owner_id !== 'string') {
        errors.push(err('Expertise.metadata.owner_id', 'must be string'))
      }
      if (!Array.isArray(obj.metadata.tags)) {
        errors.push(err('Expertise.metadata.tags', 'must be array'))
      }
    }
  }

  checkUnknown(obj, known, 'Expertise', strict, errors, warnings)

  return { valid: errors.length === 0, errors, warnings }
}

// ---------------------------------------------------------------------------
// Smoke test — run directly with `node scripts/expertise-schema.mjs`
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== Expertise Schema Smoke Test ===\n')

  // Valid full object
  const validExpertise = {
    id: 'dev:orchestrator',
    owner: { agent: 'orchestrator' },
    schema_version: 'mah.expertise.v1',
    capabilities: ['task-planning', 'crew-coordination'],
    domains: ['software-engineering', 'multi-agent-systems'],
    input_contract: {
      required_fields: ['task_description'],
      optional_fields: ['context'],
      field_types: { task_description: 'string', context: 'string' },
    },
    allowed_environments: ['production', 'staging'],
    validation_status: 'validated',
    confidence: {
      score: 0.87,
      band: 'high',
      evidence_count: 42,
    },
    trust_tier: 'org',
    lifecycle: 'active',
    policy: {
      federated_allowed: false,
      allowed_domains: ['engineering'],
      approval_required: true,
    },
    evidence_refs: ['ev-001', 'ev-002'],
    metadata: {
      created: '2026-01-01T00:00:00Z',
      updated: '2026-04-01T00:00:00Z',
      owner_id: 'agent-42',
      tags: ['orchestration', 'planning'],
    },
  }

  console.log('1. Validating valid Expertise object...')
  const vr = validateExpertise(validExpertise)
  console.log(`   valid: ${vr.valid}`)
  if (vr.errors.length) console.log(`   errors: ${vr.errors.join('; ')}`)
  if (vr.warnings.length) console.log(`   warnings: ${vr.warnings.join('; ')}`)

  // Wrong schema version
  console.log('\n2. Testing schema_version rejection...')
  const badSchema = { ...validExpertise, schema_version: 'wrong.version' }
  const rs = validateExpertise(badSchema)
  console.log(`   valid: ${rs.valid}`)
  console.log(`   errors: ${rs.errors.join('; ')}`)

  // Missing required fields
  console.log('\n3. Testing missing required fields...')
  const missingId = { owner: { agent: 'orchestrator' }, schema_version: 'mah.expertise.v1', capabilities: ['x'], domains: ['y'], validation_status: 'declared', lifecycle: 'draft', trust_tier: 'internal' }
  const rm = validateExpertise(missingId)
  console.log(`   valid: ${rm.valid}`)
  console.log(`   errors: ${rm.errors.join('; ')}`)

  // Unknown field warning (non-strict)
  console.log('\n4. Testing unknown field warning (non-strict)...')
  const unknownField = { ...validExpertise, unknownField: 'oops' }
  const ru = validateExpertise(unknownField, false)
  console.log(`   valid: ${ru.valid}`)
  console.log(`   warnings: ${ru.warnings.join('; ')}`)

  // Unknown field error (strict)
  console.log('\n5. Testing unknown field error (strict)...')
  const rus = validateExpertise(unknownField, true)
  console.log(`   valid: ${rus.valid}`)
  console.log(`   errors: ${rus.errors.join('; ')}`)

  // Evidence smoke
  console.log('\n6. Testing validateExpertiseEvidence...')
  const validEvidence = {
    id: 'ev-001',
    expertise_id: 'dev:orchestrator',
    type: 'execution',
    outcome: 'success',
    timestamp: '2026-04-01T00:00:00Z',
    task_context: 'planned crew tasks',
    evidence_data: { latency_ms: 120, cost_units: 5 },
    recorded_by: 'runtime',
  }
  const ve = validateExpertiseEvidence(validEvidence)
  console.log(`   valid: ${ve.valid}`)
  if (ve.errors.length) console.log(`   errors: ${ve.errors.join('; ')}`)

  // Metrics smoke
  console.log('\n7. Testing validateExpertiseMetrics...')
  const validMetrics = {
    expertise_id: 'dev:orchestrator',
    total_invocations: 150,
    successful_invocations: 140,
    failed_invocations: 10,
    avg_duration_ms: 85.5,
    p95_duration_ms: 130.1,
    total_cost_units: 18.2,
    review_pass_rate: 0.93,
    rejection_rate: 0.05,
    last_invoked: '2026-04-01T00:00:00Z',
    last_successful: '2026-04-01T00:00:00Z',
    last_failed: '2026-03-25T00:00:00Z',
    evidence_count: 150,
    window_start: '2026-03-25T00:00:00Z',
    window_end: '2026-04-01T00:00:00Z',
  }
  const vm = validateExpertiseMetrics(validMetrics)
  console.log(`   valid: ${vm.valid}`)
  if (vm.errors.length) console.log(`   errors: ${vm.errors.join('; ')}`)

  // ValidationState smoke
  console.log('\n8. Testing validateExpertiseValidationState...')
  const validState = {
    status: 'validated',
    last_validated: '2026-04-01T00:00:00Z',
    validated_by: 'agent-42',
    restrictions: [],
  }
  const vs = validateExpertiseValidationState(validState)
  console.log(`   valid: ${vs.valid}`)
  if (vs.errors.length) console.log(`   errors: ${vs.errors.join('; ')}`)

  console.log('\n=== Smoke Test Complete ===')
}
