/**
 * MAH Session v1 Schema
 * @fileoverview Canonical session types for MAH cross-runtime session interoperability
 * @version 0.6.0
 */

/** @type {string} */
export const MAH_SESSION_SCHEMA_VERSION = "mah.session.v1"

/** @type {string[]} */
export const FIDELITY_LEVELS = ["full", "contextual", "summary-only"]

/** @type {string} */
export const DEFAULT_FIDELITY_LEVEL = "contextual"

/**
 * @typedef {Object} SessionRef
 * @property {string} mahSessionId - Composite ID "runtime:crew:sessionId"
 * @property {string} runtime
 * @property {string} runtimeSessionId
 * @property {string} crew
 * @property {string} [agent]
 * @property {string} [createdAt] - ISO timestamp
 * @property {string} [lastActiveAt] - ISO timestamp
 */

/**
 * @typedef {Object} MahSession
 * @property {"mah.session.v1"} schema
 * @property {string} mah_session_id
 * @property {string} runtime
 * @property {string} runtime_session_id
 * @property {string} crew
 * @property {string} [agent]
 * @property {string} created_at
 * @property {string} last_active_at
 * @property {string} summary
 * @property {SessionArtifact[]} artifacts
 * @property {ProvenanceEntry[]} provenance
 * @property {ContextBlock[]} context_blocks
 * @property {string|null} raw_export_ref
 */

/**
 * @typedef {Object} SessionArtifact
 * @property {string} name
 * @property {"file"|"directory"|"symbolic-link"} type
 * @property {string} path
 * @property {number} [size_bytes]
 */

/**
 * @typedef {Object} ProvenanceEntry
 * @property {"created"|"exported"|"injected"|"projected"} event
 * @property {string} timestamp
 * @property {string} [actor]
 * @property {Record<string, any>} [details]
 */

/**
 * @typedef {Object} ContextBlock
 * @property {"system"|"user"|"assistant"|"tool-result"|"metadata"} type
 * @property {string} content
 * @property {string} [role]
 * @property {string} [timestamp]
 */

/**
 * @typedef {Object} MahJsonExport
 * @property {"mah-json"} format
 * @property {"1.0"} version
 * @property {MahSession} session
 * @property {string} exported_at
 * @property {string} exported_by
 * @property {string} mah_version
 */

/**
 * @typedef {Object} SummaryMdExport
 * @property {"summary-md"} format
 * @property {"1.0"} version
 * @property {MahSession} session
 * @property {string} summary_markdown
 * @property {string} exported_at
 */

/**
 * @typedef {Object} RuntimeRawExport
 * @property {"runtime-raw"} format
 * @property {"1.0"} version
 * @property {string} runtime
 * @property {string} runtime_session_id
 * @property {string} archive_path
 * @property {string} exported_at
 */

/**
 * @typedef {MahJsonExport|SummaryMdExport|RuntimeRawExport} SessionExport
 */

/**
 * @typedef {Object} InjectionPayload
 * @property {string} target_runtime
 * @property {MahSession} source_session
 * @property {"full"|"contextual"|"summary-only"} fidelity_level
 * @property {"full-replay"|"context-injection"|"summary-only"} strategy
 * @property {string[]} warnings
 * @property {ContextBlock[]} context_blocks
 * @property {string} generated_at
 */
