/**
 * MAH Context Memory Validation Schema
 * @fileoverview Pure validation logic for MAH Context Memory types
 * @version 0.8.0
 */

import {
  STABILITY_LEVELS,
  SOURCE_TYPES,
  DOCUMENT_KINDS,
  RETRIEVAL_CONFIDENCE_LEVELS,
  MAX_CONTEXT_DOCUMENT_SIZE_BYTES,
  MAX_RETRIEVAL_TOTAL_SIZE_BYTES,
} from '../../types/context-memory-types.mjs'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} path - dotted path to field
 * @param {string} msg - error message
 * @returns {string} formatted error
 */
function err(path, msg) {
  return path + ": " + msg
}

/**
 * @param {string} path - dotted path to field
 * @param {string} msg - warning message
 * @returns {string} formatted warning
 */
function warn(path, msg) {
  return path + ": " + msg
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
      const msg = "unknown field '" + key + "'"
      if (strict) {
        errors.push(warn(path, msg))
      } else {
        warnings.push(warn(path, msg))
      }
    }
  }
}

/**
 * Validate ISO date string
 * @param {string} value
 * @returns {boolean}
 */
function isValidISODate(value) {
  if (typeof value !== "string") return false
  const d = new Date(value)
  return !isNaN(d.getTime()) && d.toISOString().startsWith(value.substring(0, 10))
}

// ---------------------------------------------------------------------------
// ID regex: ^[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*){2,}$
// Requires at least 3 segments separated by /
const ID_REGEX = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){2,}$/

/**
 * Validate ContextMemoryDocument object.
 * @param {Object} obj
 * @param {boolean} [strict=false]
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateContextMemoryDocument(obj, strict = false) {
  /** @type {string[]} */
  const errors = []
  /** @type {string[]} */
  const warnings = []

  if (!obj || typeof obj !== "object") {
    errors.push("ContextMemoryDocument: must be a non-null object")
    return { valid: false, errors, warnings }
  }

  const known = new Set([
    "id", "kind", "crew", "agent", "capabilities", "domains",
    "systems", "skills", "tools", "task_patterns", "priority",
    "stability", "source_type", "last_reviewed_at", "refs",
  ])

  // Required: id
  if (typeof obj.id !== "string" || obj.id.trim() === "") {
    errors.push(err("ContextMemoryDocument.id", "required field missing or empty"))
  } else if (!ID_REGEX.test(obj.id)) {
    errors.push(err("ContextMemoryDocument.id", "must match " + ID_REGEX + ", got '" + obj.id + "'"))
  }

  // Required: kind
  if (!DOCUMENT_KINDS.includes(obj.kind)) {
    errors.push(err("ContextMemoryDocument.kind", "must be one of " + DOCUMENT_KINDS.join(", ") + ", got '" + obj.kind + "'"))
  }

  // Required: crew
  if (typeof obj.crew !== "string" || obj.crew.trim() === "") {
    errors.push(err("ContextMemoryDocument.crew", "required field missing or empty"))
  }

  // Required: agent
  if (typeof obj.agent !== "string" || obj.agent.trim() === "") {
    errors.push(err("ContextMemoryDocument.agent", "required field missing or empty"))
  }

  // Required: capabilities (non-empty array)
  if (!Array.isArray(obj.capabilities) || obj.capabilities.length === 0) {
    errors.push(err("ContextMemoryDocument.capabilities", "must be a non-empty array"))
  } else {
    for (let i = 0; i < obj.capabilities.length; i++) {
      if (typeof obj.capabilities[i] !== "string") {
        errors.push(err("ContextMemoryDocument.capabilities[" + i + "]", "must be string, got " + typeof obj.capabilities[i]))
      }
    }
  }

  // Required: stability
  if (!STABILITY_LEVELS.includes(obj.stability)) {
    errors.push(err("ContextMemoryDocument.stability", "must be one of " + STABILITY_LEVELS.join(", ") + ", got '" + obj.stability + "'"))
  }

  // Required: source_type
  if (!SOURCE_TYPES.includes(obj.source_type)) {
    errors.push(err("ContextMemoryDocument.source_type", "must be one of " + SOURCE_TYPES.join(", ") + ", got '" + obj.source_type + "'"))
  }

  // Optional: domains
  if (obj.domains !== undefined) {
    if (!Array.isArray(obj.domains)) {
      errors.push(err("ContextMemoryDocument.domains", "must be an array if present"))
    } else {
      for (let i = 0; i < obj.domains.length; i++) {
        if (typeof obj.domains[i] !== "string") {
          errors.push(err("ContextMemoryDocument.domains[" + i + "]", "must be string"))
        }
      }
    }
  }

  // Optional: systems
  if (obj.systems !== undefined) {
    if (!Array.isArray(obj.systems)) {
      errors.push(err("ContextMemoryDocument.systems", "must be an array if present"))
    } else {
      for (let i = 0; i < obj.systems.length; i++) {
        if (typeof obj.systems[i] !== "string") {
          errors.push(err("ContextMemoryDocument.systems[" + i + "]", "must be string"))
        }
      }
    }
  }

  // Optional: skills
  if (obj.skills !== undefined) {
    if (!Array.isArray(obj.skills)) {
      errors.push(err("ContextMemoryDocument.skills", "must be an array if present"))
    } else {
      for (let i = 0; i < obj.skills.length; i++) {
        if (typeof obj.skills[i] !== "string") {
          errors.push(err("ContextMemoryDocument.skills[" + i + "]", "must be string"))
        }
      }
    }
  }

  // Optional: tools
  if (obj.tools !== undefined) {
    if (!Array.isArray(obj.tools)) {
      errors.push(err("ContextMemoryDocument.tools", "must be an array if present"))
    } else {
      for (let i = 0; i < obj.tools.length; i++) {
        if (typeof obj.tools[i] !== "string") {
          errors.push(err("ContextMemoryDocument.tools[" + i + "]", "must be string"))
        }
      }
    }
  }

  // Optional: task_patterns
  if (obj.task_patterns !== undefined) {
    if (!Array.isArray(obj.task_patterns)) {
      errors.push(err("ContextMemoryDocument.task_patterns", "must be an array if present"))
    } else {
      for (let i = 0; i < obj.task_patterns.length; i++) {
        if (typeof obj.task_patterns[i] !== "string") {
          errors.push(err("ContextMemoryDocument.task_patterns[" + i + "]", "must be string"))
        }
      }
    }
  }

  // Optional: priority
  if (obj.priority !== undefined) {
    const VALID_PRIORITIES = ["critical", "high", "medium", "low"]
    if (!VALID_PRIORITIES.includes(obj.priority)) {
      errors.push(err("ContextMemoryDocument.priority", "must be one of " + VALID_PRIORITIES.join(", ") + ", got '" + obj.priority + "'"))
    }
  }

  // Optional: last_reviewed_at
  if (obj.last_reviewed_at !== undefined) {
    if (typeof obj.last_reviewed_at !== "string") {
      errors.push(err("ContextMemoryDocument.last_reviewed_at", "must be string, got " + typeof obj.last_reviewed_at))
    } else if (!isValidISODate(obj.last_reviewed_at)) {
      errors.push(err("ContextMemoryDocument.last_reviewed_at", "must be valid ISO date, got '" + obj.last_reviewed_at + "'"))
    }
  }

  // Optional: refs
  if (obj.refs !== undefined) {
    if (!Array.isArray(obj.refs)) {
      errors.push(err("ContextMemoryDocument.refs", "must be an array if present"))
    } else {
      for (let i = 0; i < obj.refs.length; i++) {
        if (typeof obj.refs[i] !== "string") {
          errors.push(err("ContextMemoryDocument.refs[" + i + "]", "must be string"))
        } else if (obj.refs[i].trim() === "") {
          warnings.push(warn("ContextMemoryDocument.refs[" + i + "]", "empty ref string"))
        }
      }
    }
  }

  checkUnknown(obj, known, "ContextMemoryDocument", strict, errors, warnings)

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate ContextMemoryIndexEntry object.
 * @param {Object} obj
 * @param {boolean} [strict=false]
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateContextMemoryIndexEntry(obj, strict = false) {
  /** @type {string[]} */
  const errors = []
  /** @type {string[]} */
  const warnings = []

  if (!obj || typeof obj !== "object") {
    errors.push("ContextMemoryIndexEntry: must be a non-null object")
    return { valid: false, errors, warnings }
  }

  const known = new Set([
    "id", "file_path", "hash", "mtime", "metadata_summary",
    "snippet_count", "heading_count", "headings", "tags",
  ])

  // Required: id
  if (typeof obj.id !== "string" || obj.id.trim() === "") {
    errors.push(err("ContextMemoryIndexEntry.id", "required field missing or empty"))
  }

  // Required: file_path
  if (typeof obj.file_path !== "string" || obj.file_path.trim() === "") {
    errors.push(err("ContextMemoryIndexEntry.file_path", "required field missing or empty"))
  }

  // Required: hash
  if (typeof obj.hash !== "string" || obj.hash.trim() === "") {
    errors.push(err("ContextMemoryIndexEntry.hash", "required field missing or empty"))
  } else if (!/^[a-f0-9]{64}$/.test(obj.hash)) {
    errors.push(err("ContextMemoryIndexEntry.hash", "must be SHA-256 hex (64 chars), got '" + obj.hash + "'"))
  }

  // Required: mtime
  if (typeof obj.mtime !== "number" || obj.mtime <= 0) {
    errors.push(err("ContextMemoryIndexEntry.mtime", "must be number > 0, got '" + obj.mtime + "'"))
  }

  // Required: metadata_summary
  if (typeof obj.metadata_summary !== "object" || obj.metadata_summary === null) {
    errors.push(err("ContextMemoryIndexEntry.metadata_summary", "required field missing or must be object"))
  }

  // Required: snippet_count
  if (typeof obj.snippet_count !== "number" || obj.snippet_count < 0) {
    errors.push(err("ContextMemoryIndexEntry.snippet_count", "must be number >= 0, got '" + obj.snippet_count + "'"))
  }

  // Required: heading_count
  if (typeof obj.heading_count !== "number" || obj.heading_count < 0) {
    errors.push(err("ContextMemoryIndexEntry.heading_count", "must be number >= 0, got '" + obj.heading_count + "'"))
  }

  // Optional: headings
  if (obj.headings !== undefined) {
    if (!Array.isArray(obj.headings)) {
      errors.push(err("ContextMemoryIndexEntry.headings", "must be an array if present"))
    } else {
      for (let i = 0; i < obj.headings.length; i++) {
        if (typeof obj.headings[i] !== "string") {
          errors.push(err("ContextMemoryIndexEntry.headings[" + i + "]", "must be string"))
        }
      }
    }
  }

  // Optional: tags
  if (obj.tags !== undefined) {
    if (!Array.isArray(obj.tags)) {
      errors.push(err("ContextMemoryIndexEntry.tags", "must be an array if present"))
    } else {
      for (let i = 0; i < obj.tags.length; i++) {
        if (typeof obj.tags[i] !== "string") {
          errors.push(err("ContextMemoryIndexEntry.tags[" + i + "]", "must be string"))
        }
      }
    }
  }

  checkUnknown(obj, known, "ContextMemoryIndexEntry", strict, errors, warnings)

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate ContextMemoryRetrievalRequest object.
 * @param {Object} obj
 * @param {boolean} [strict=false]
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateContextMemoryRetrievalRequest(obj, strict = false) {
  /** @type {string[]} */
  const errors = []
  /** @type {string[]} */
  const warnings = []

  if (!obj || typeof obj !== "object") {
    errors.push("ContextMemoryRetrievalRequest: must be a non-null object")
    return { valid: false, errors, warnings }
  }

  const known = new Set([
    "crew", "agent", "task", "capability_hint",
    "available_tools", "available_mcp", "runtime",
  ])

  // Required: task
  if (typeof obj.task !== "string" || obj.task.trim() === "") {
    errors.push(err("ContextMemoryRetrievalRequest.task", "required field missing or empty"))
  }

  // Optional: crew
  if (obj.crew !== undefined && typeof obj.crew !== "string") {
    errors.push(err("ContextMemoryRetrievalRequest.crew", "must be string, got " + typeof obj.crew))
  }

  // Optional: agent
  if (obj.agent !== undefined && typeof obj.agent !== "string") {
    errors.push(err("ContextMemoryRetrievalRequest.agent", "must be string, got " + typeof obj.agent))
  }

  // Optional: capability_hint
  if (obj.capability_hint !== undefined && typeof obj.capability_hint !== "string") {
    errors.push(err("ContextMemoryRetrievalRequest.capability_hint", "must be string, got " + typeof obj.capability_hint))
  }

  // Optional: available_tools
  if (obj.available_tools !== undefined) {
    if (!Array.isArray(obj.available_tools)) {
      errors.push(err("ContextMemoryRetrievalRequest.available_tools", "must be an array if present"))
    } else {
      for (let i = 0; i < obj.available_tools.length; i++) {
        if (typeof obj.available_tools[i] !== "string") {
          errors.push(err("ContextMemoryRetrievalRequest.available_tools[" + i + "]", "must be string"))
        }
      }
    }
  }

  // Optional: available_mcp
  if (obj.available_mcp !== undefined) {
    if (!Array.isArray(obj.available_mcp)) {
      errors.push(err("ContextMemoryRetrievalRequest.available_mcp", "must be an array if present"))
    } else {
      for (let i = 0; i < obj.available_mcp.length; i++) {
        if (typeof obj.available_mcp[i] !== "string") {
          errors.push(err("ContextMemoryRetrievalRequest.available_mcp[" + i + "]", "must be string"))
        }
      }
    }
  }

  // Optional: runtime
  if (obj.runtime !== undefined && typeof obj.runtime !== "string") {
    errors.push(err("ContextMemoryRetrievalRequest.runtime", "must be string, got " + typeof obj.runtime))
  }

  checkUnknown(obj, known, "ContextMemoryRetrievalRequest", strict, errors, warnings)

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate ContextMemoryRetrievalResult object.
 * @param {Object} obj
 * @param {boolean} [strict=false]
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateContextMemoryRetrievalResult(obj, strict = false) {
  /** @type {string[]} */
  const errors = []
  /** @type {string[]} */
  const warnings = []

  if (!obj || typeof obj !== "object") {
    errors.push("ContextMemoryRetrievalResult: must be a non-null object")
    return { valid: false, errors, warnings }
  }

  const known = new Set([
    "matched_docs", "summary_blocks", "tool_hints", "skill_hints",
    "blocked_refs", "confidence", "retrieved_at", "total_candidates",
  ])

  // Required: matched_docs
  if (!Array.isArray(obj.matched_docs)) {
    errors.push(err("ContextMemoryRetrievalResult.matched_docs", "must be an array"))
  } else {
    for (let i = 0; i < obj.matched_docs.length; i++) {
      const doc = obj.matched_docs[i]
      if (typeof doc !== "object" || doc === null) {
        errors.push(err("ContextMemoryRetrievalResult.matched_docs[" + i + "]", "must be an object"))
      } else {
        if (typeof doc.id !== "string") {
          errors.push(err("ContextMemoryRetrievalResult.matched_docs[" + i + "].id", "must be string"))
        }
        if (typeof doc.score !== "number") {
          errors.push(err("ContextMemoryRetrievalResult.matched_docs[" + i + "].score", "must be number"))
        }
        if (!Array.isArray(doc.reasons)) {
          errors.push(err("ContextMemoryRetrievalResult.matched_docs[" + i + "].reasons", "must be array"))
        }
      }
    }
  }

  // Required: summary_blocks
  if (!Array.isArray(obj.summary_blocks)) {
    errors.push(err("ContextMemoryRetrievalResult.summary_blocks", "must be an array"))
  }

  // Required: tool_hints
  if (!Array.isArray(obj.tool_hints)) {
    errors.push(err("ContextMemoryRetrievalResult.tool_hints", "must be an array"))
  }

  // Required: skill_hints
  if (!Array.isArray(obj.skill_hints)) {
    errors.push(err("ContextMemoryRetrievalResult.skill_hints", "must be an array"))
  }

  // Required: blocked_refs
  if (!Array.isArray(obj.blocked_refs)) {
    errors.push(err("ContextMemoryRetrievalResult.blocked_refs", "must be an array"))
  }

  // Required: confidence
  if (!RETRIEVAL_CONFIDENCE_LEVELS.includes(obj.confidence)) {
    errors.push(err("ContextMemoryRetrievalResult.confidence", "must be one of " + RETRIEVAL_CONFIDENCE_LEVELS.join(", ") + ", got '" + obj.confidence + "'"))
  }

  // Required: retrieved_at
  if (typeof obj.retrieved_at !== "string") {
    errors.push(err("ContextMemoryRetrievalResult.retrieved_at", "must be string"))
  }

  // Required: total_candidates
  if (typeof obj.total_candidates !== "number" || obj.total_candidates < 0) {
    errors.push(err("ContextMemoryRetrievalResult.total_candidates", "must be number >= 0, got '" + obj.total_candidates + "'"))
  }

  checkUnknown(obj, known, "ContextMemoryRetrievalResult", strict, errors, warnings)

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Validate ContextMemoryProposal object.
 * @param {Object} obj
 * @param {boolean} [strict=false]
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateContextMemoryProposal(obj, strict = false) {
  /** @type {string[]} */
  const errors = []
  /** @type {string[]} */
  const warnings = []

  if (!obj || typeof obj !== "object") {
    errors.push("ContextMemoryProposal: must be a non-null object")
    return { valid: false, errors, warnings }
  }

  const known = new Set([
    "proposal_version", "id", "status", "generated_at",
    "source_type", "source_ref", "proposed_document_id",
    "proposed_frontmatter", "proposed_content", "summary",
    "rationale", "reviewers", "existing_refs",
  ])

  // Required: proposal_version
  if (obj.proposal_version !== "mah.context-memory.proposal.v1") {
    if (obj.proposal_version === undefined) {
      errors.push(err("ContextMemoryProposal.proposal_version", "required field missing"))
    } else {
      errors.push(err("ContextMemoryProposal.proposal_version", "must be 'mah.context-memory.proposal.v1', got '" + obj.proposal_version + "'"))
    }
  }

  // Required: id
  if (typeof obj.id !== "string" || obj.id.trim() === "") {
    errors.push(err("ContextMemoryProposal.id", "required field missing or empty"))
  }

  // Required: status
  const VALID_STATUSES = ["draft", "reviewed", "approved", "rejected", "promoted"]
  if (!VALID_STATUSES.includes(obj.status)) {
    errors.push(err("ContextMemoryProposal.status", "must be one of " + VALID_STATUSES.join(", ") + ", got '" + obj.status + "'"))
  }

  // Required: generated_at
  if (typeof obj.generated_at !== "string" || obj.generated_at.trim() === "") {
    errors.push(err("ContextMemoryProposal.generated_at", "required field missing or empty"))
  }

  // Required: source_type
  if (!SOURCE_TYPES.includes(obj.source_type)) {
    errors.push(err("ContextMemoryProposal.source_type", "must be one of " + SOURCE_TYPES.join(", ") + ", got '" + obj.source_type + "'"))
  }

  // Required: source_ref
  if (typeof obj.source_ref !== "string" || obj.source_ref.trim() === "") {
    errors.push(err("ContextMemoryProposal.source_ref", "required field missing or empty"))
  }

  // Required: proposed_document_id
  if (typeof obj.proposed_document_id !== "string" || obj.proposed_document_id.trim() === "") {
    errors.push(err("ContextMemoryProposal.proposed_document_id", "required field missing or empty"))
  }

  // Required: proposed_frontmatter
  if (typeof obj.proposed_frontmatter !== "object" || obj.proposed_frontmatter === null) {
    errors.push(err("ContextMemoryProposal.proposed_frontmatter", "required field missing or must be object"))
  }

  // Required: proposed_content
  if (typeof obj.proposed_content !== "string") {
    errors.push(err("ContextMemoryProposal.proposed_content", "required field missing or must be string"))
  } else if (obj.proposed_content.trim() === "") {
    errors.push(err("ContextMemoryProposal.proposed_content", "must be non-empty"))
  }

  // Required: summary
  if (typeof obj.summary !== "string" || obj.summary.trim() === "") {
    errors.push(err("ContextMemoryProposal.summary", "required field missing or empty"))
  }

  // Required: rationale
  if (typeof obj.rationale !== "string" || obj.rationale.trim() === "") {
    errors.push(err("ContextMemoryProposal.rationale", "required field missing or empty"))
  }

  // Required: reviewers
  if (!Array.isArray(obj.reviewers)) {
    errors.push(err("ContextMemoryProposal.reviewers", "must be an array"))
  } else if (obj.reviewers.length === 0) {
    errors.push(err("ContextMemoryProposal.reviewers", "must be non-empty array"))
  } else {
    for (let i = 0; i < obj.reviewers.length; i++) {
      if (typeof obj.reviewers[i] !== "string") {
        errors.push(err("ContextMemoryProposal.reviewers[" + i + "]", "must be string"))
      }
    }
  }

  // Optional: existing_refs
  if (obj.existing_refs !== undefined) {
    if (!Array.isArray(obj.existing_refs)) {
      errors.push(err("ContextMemoryProposal.existing_refs", "must be an array if present"))
    } else {
      for (let i = 0; i < obj.existing_refs.length; i++) {
        if (typeof obj.existing_refs[i] !== "string") {
          errors.push(err("ContextMemoryProposal.existing_refs[" + i + "]", "must be string"))
        }
      }
    }
  }

  checkUnknown(obj, known, "ContextMemoryProposal", strict, errors, warnings)

  return { valid: errors.length === 0, errors, warnings }
}

// ---------------------------------------------------------------------------
// Smoke test
// ---------------------------------------------------------------------------
if (import.meta.url === "file://" + process.argv[1]) {
  console.log("=== Context Memory Validation Schema Smoke Test ===\n")

  // Valid document
  const validDoc = {
    id: "dev/planning/backlog-triage",
    kind: "operational-memory",
    crew: "dev",
    agent: "planning-lead",
    capabilities: ["task-prioritization", "scope-estimation"],
    stability: "stable",
    source_type: "human-authored",
    priority: "high",
  }
  console.log("1. Validating valid ContextMemoryDocument...")
  const r1 = validateContextMemoryDocument(validDoc)
  console.log("   valid: " + r1.valid)
  if (r1.errors.length) console.log("   errors: " + r1.errors.join("; "))

  // Invalid ID
  console.log("\n2. Testing invalid ID...")
  const badId = { ...validDoc, id: "bad-id" }
  const r2 = validateContextMemoryDocument(badId)
  console.log("   valid: " + r2.valid)
  console.log("   errors: " + r2.errors.join("; "))

  // Missing required
  console.log("\n3. Testing missing required fields...")
  const missing = { id: "dev/planning/test" }
  const r3 = validateContextMemoryDocument(missing)
  console.log("   valid: " + r3.valid)
  console.log("   errors: " + r3.errors.join("; "))

  // Unknown field (non-strict)
  console.log("\n4. Testing unknown field (non-strict)...")
  const unknown = { ...validDoc, unknownField: "oops" }
  const r4 = validateContextMemoryDocument(unknown, false)
  console.log("   valid: " + r4.valid)
  console.log("   warnings: " + r4.warnings.join("; "))

  // Unknown field (strict)
  console.log("\n5. Testing unknown field (strict)...")
  const r5 = validateContextMemoryDocument(unknown, true)
  console.log("   valid: " + r5.valid)
  console.log("   errors: " + r5.errors.join("; "))

  // Valid proposal
  console.log("\n6. Testing valid ContextMemoryProposal...")
  const validProposal = {
    proposal_version: "mah.context-memory.proposal.v1",
    id: "proposal/dev/planning/new-approach",
    status: "draft",
    generated_at: "2026-04-18T00:00:00Z",
    source_type: "derived",
    source_ref: "session/2026-04-18/summary.md",
    proposed_document_id: "dev/planning/new-approach",
    proposed_frontmatter: { kind: "operational-memory" },
    proposed_content: "# New Approach\n\nContent here.",
    summary: "New approach summary",
    rationale: "Rationale text",
    reviewers: ["security-reviewer"],
  }
  const r6 = validateContextMemoryProposal(validProposal)
  console.log("   valid: " + r6.valid)
  if (r6.errors.length) console.log("   errors: " + r6.errors.join("; "))

  // Valid retrieval request
  console.log("\n7. Testing valid ContextMemoryRetrievalRequest...")
  const validReq = {
    task: "Plan the sprint backlog",
    crew: "dev",
    capability_hint: "task-planning",
  }
  const r7 = validateContextMemoryRetrievalRequest(validReq)
  console.log("   valid: " + r7.valid)
  if (r7.errors.length) console.log("   errors: " + r7.errors.join("; "))

  // Valid retrieval result
  console.log("\n8. Testing valid ContextMemoryRetrievalResult...")
  const validResult = {
    matched_docs: [{ id: "dev/planning/test", score: 0.85, reasons: ["capability match"] }],
    summary_blocks: ["Summary of retrieved docs"],
    tool_hints: ["bash", "grep"],
    skill_hints: ["planning"],
    blocked_refs: [],
    confidence: "high",
    retrieved_at: "2026-04-18T00:00:00Z",
    total_candidates: 10,
  }
  const r8 = validateContextMemoryRetrievalResult(validResult)
  console.log("   valid: " + r8.valid)
  if (r8.errors.length) console.log("   errors: " + r8.errors.join("; "))

  // Valid index entry
  console.log("\n9. Testing valid ContextMemoryIndexEntry...")
  const validIndex = {
    id: "dev/planning/test",
    file_path: ".mah/context/operational/dev/planning/test.md",
    hash: "a".repeat(64),
    mtime: 1713400000000,
    metadata_summary: { kind: "operational-memory" },
    snippet_count: 5,
    heading_count: 3,
    headings: ["Overview", "Guidelines", "Examples"],
    tags: ["planning", "backlog"],
  }
  const r9 = validateContextMemoryIndexEntry(validIndex)
  console.log("   valid: " + r9.valid)
  if (r9.errors.length) console.log("   errors: " + r9.errors.join("; "))

  console.log("\n=== Smoke Test Complete ===")
}
