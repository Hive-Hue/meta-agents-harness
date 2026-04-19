/**
 * MAH Context Memory v1 Schema
 * @fileoverview Canonical context memory types for MAH v0.8.0 Context Memory (M4/M1)
 * @version 0.8.0
 */

/** @type {string} */
export const CONTEXT_MEMORY_SCHEMA_VERSION = "mah.context-memory.v1"

/** @type {string} */
export const CONTEXT_MEMORY_INDEX_VERSION = "mah.context-memory.index.v1"

/** @type {string} */
export const CONTEXT_MEMORY_PROPOSAL_VERSION = "mah.context-memory.proposal.v1"

/** @type {string[]} */
export const STABILITY_LEVELS = ["draft", "curated", "stable"]

/** @type {string[]} */
export const SOURCE_TYPES = ["human-authored", "derived", "imported"]

/** @type {string[]} */
export const DOCUMENT_KINDS = ["operational-memory", "playbook", "gotcha", "integration-guide", "reference"]

/** @type {string[]} */
export const RETRIEVAL_CONFIDENCE_LEVELS = ["high", "medium", "low", "none"]

/** @type {number} */
export const DEFAULT_RETRIEVAL_TOP_N = 5

/** @type {number} */
export const MAX_CONTEXT_DOCUMENT_SIZE_BYTES = 65536

/** @type {number} */
export const MAX_RETRIEVAL_TOTAL_SIZE_BYTES = 32768

/**
 * @typedef {"draft"|"curated"|"stable"} StabilityLevel
 * @typedef {"human-authored"|"derived"|"imported"} SourceType
 * @typedef {"operational-memory"|"playbook"|"gotcha"|"integration-guide"|"reference"} DocumentKind
 * @typedef {"critical"|"high"|"medium"|"low"} Priority
 * @typedef {"high"|"medium"|"low"|"none"} RetrievalConfidence
 * @typedef {"draft"|"reviewed"|"approved"|"rejected"|"promoted"} ProposalStatus
 */

/**
 * @typedef {Object} ContextMemoryDocument
 * @property {string} id
 * @property {DocumentKind} kind
 * @property {string} crew
 * @property {string} agent
 * @property {string[]} capabilities
 * @property {string[]} [domains]
 * @property {string[]} [systems]
 * @property {string[]} [skills]
 * @property {string[]} [tools]
 * @property {string[]} [task_patterns]
 * @property {Priority} [priority]
 * @property {StabilityLevel} stability
 * @property {SourceType} source_type
 * @property {string} [last_reviewed_at]
 * @property {string[]} [refs]
 */

/**
 * @typedef {Object} ContextMemoryIndexEntry
 * @property {string} id
 * @property {string} file_path
 * @property {string} hash
 * @property {number} mtime
 * @property {Object} metadata_summary
 * @property {number} snippet_count
 * @property {number} heading_count
 * @property {string[]} [headings]
 * @property {string[]} [tags]
 */

/**
 * @typedef {Object} ContextMemoryRetrievalRequest
 * @property {string} [crew]
 * @property {string} [agent]
 * @property {string} task
 * @property {string} [capability_hint]
 * @property {string[]} [available_tools]
 * @property {string[]} [available_mcp]
 * @property {string} [runtime]
 */

/**
 * @typedef {Object} ContextMemoryRetrievalMatch
 * @property {string} id
 * @property {number} score
 * @property {string[]} reasons
 */

/**
 * @typedef {Object} ContextMemoryRetrievalResult
 * @property {ContextMemoryRetrievalMatch[]} matched_docs
 * @property {string[]} summary_blocks
 * @property {string[]} tool_hints
 * @property {string[]} skill_hints
 * @property {string[]} blocked_refs
 * @property {RetrievalConfidence} confidence
 * @property {string} retrieved_at
 * @property {number} total_candidates
 */

/**
 * @typedef {Object} ContextMemoryProposal
 * @property {"mah.context-memory.proposal.v1"} proposal_version
 * @property {string} id
 * @property {ProposalStatus} status
 * @property {string} generated_at
 * @property {string} source_type
 * @property {string} source_ref
 * @property {string} proposed_document_id
 * @property {Object} proposed_frontmatter
 * @property {string} proposed_content
 * @property {string} summary
 * @property {string} rationale
 * @property {string[]} reviewers
 * @property {string[]} [existing_refs]
 */
