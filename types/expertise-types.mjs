/**
 * MAH Expertise v1 Schema
 * @fileoverview Canonical expertise types for MAH v0.7.0 Expertise Engine (M1/S1)
 * @version 0.7.0
 */

/** @type {string} */
export const EXPERTISE_SCHEMA_VERSION = "mah.expertise.v1"

/** @type {string[]} */
export const CONFIDENCE_BANDS = ["low", "medium", "high", "critical"]

/** @type {string[]} */
export const VALIDATION_STATUSES = ["declared", "observed", "validated", "restricted", "revoked"]

/** @type {string[]} */
export const LIFECYCLE_STATES = ["draft", "active", "experimental", "restricted", "deprecated"]

/** @type {string[]} */
export const TRUST_TIERS = ["internal", "team", "org", "federated"]

/** @type {string[]} */
export const EVIDENCE_TYPES = ["execution", "review", "cost", "latency"]

/** @type {string[]} */
export const OUTCOMES = ["success", "failure", "partial"]

/**
 * @typedef {Object} ExpertiseOwner
 * @property {string} [agent] - Agent name if owned by an agent
 * @property {string} [team] - Team name if owned by a team
 */

/**
 * @typedef {Object} Expertise
 * @property {string} id - Unique expertise identifier, e.g. "dev:orchestrator"
 * @property { ExpertiseOwner } owner - Owner object with agent and/or team
 * @property {"mah.expertise.v1"} schema_version
 * @property {string[]} capabilities - What this expertise covers
 * @property {string[]} domains - Subject areas
 * @property { ExpertiseInputContract } input_contract - What this expertise expects as input
 * @property {string[]} allowed_environments - Where this expertise is valid
 * @property { ValidationStatus } validation_status
 * @property { ExpertiseConfidence } confidence
 * @property { TrustTier } trust_tier
 * @property { LifecycleState } lifecycle
 * @property { ExpertisePolicy } policy
 * @property {string[]} evidence_refs - Pointers to evidence store
 * @property { ExpertiseMetadata } metadata
 */

/**
 * @typedef {Object} ExpertiseInputContract
 * @property {string[]} required_fields
 * @property {string[]} optional_fields
 * @property {Record<string, string>} field_types
 */

/**
 * @typedef {Object} ExpertiseConfidence
 * @property {number} score - Score between 0 and 1
 * @property { ConfidenceBand } band
 * @property {number} evidence_count
 */

/**
 * @typedef {Object} ExpertisePolicy
 * @property {boolean} federated_allowed
 * @property {string[]} allowed_domains
 * @property {boolean} approval_required
 */

/**
 * @typedef {Object} ExpertiseMetadata
 * @property {string} created - ISO timestamp
 * @property {string} updated - ISO timestamp
 * @property {string} owner_id
 * @property {string[]} tags
 * @property {Object[]} [risks]
 * @property {Object[]} [lessons]
 * @property {Object[]} [workflows]
 * @property {Record<string, unknown>} [_extra]
 */

/**
 * @typedef {Object} ExpertiseEvidence
 * @property {string} id
 * @property {string} expertise_id
 * @property { EvidenceType } type
 * @property { Outcome } outcome
 * @property {string} timestamp
 * @property {string} task_context - Task description
 * @property { ExpertiseEvidenceData } evidence_data
 * @property {string} recorded_by - Runtime or agent
 */

/**
 * @typedef {Object} ExpertiseEvidenceData
 * @property {number} [latency_ms]
 * @property {number} [cost_units]
 * @property {boolean} [review_pass]
 * @property {string} [error_type]
 */

/**
 * @typedef {Object} ExpertiseMetrics
 * @property {string} expertise_id
 * @property {number} total_invocations
 * @property {number} successful_invocations
 * @property {number} failed_invocations
 * @property {number} avg_duration_ms
 * @property {number} p95_duration_ms
 * @property {number} total_cost_units
 * @property {number} review_pass_rate
 * @property {number} rejection_rate
 * @property {string | null} last_invoked
 * @property {string | null} last_successful
 * @property {string | null} last_failed
 * @property {number} evidence_count
 * @property {string | null} window_start
 * @property {string | null} window_end
 */

/**
 * @typedef {Object} ExpertiseValidationState
 * @property { ValidationStatus } status
 * @property {string} last_validated
 * @property {string} validated_by
 * @property {string[]} restrictions
 * @property {string} [revocation_reason]
 */
