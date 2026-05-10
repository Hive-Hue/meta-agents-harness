/**
 * Lifecycle Event Type Definitions
 * v0.8.0 Bounded Governance extension
 */

/**
 * @typedef {Object} GovernanceSignals
 * @property {string} [trust_tier] - trust tier of selected agent (e.g. "standard", "elevated")
 * @property {boolean} [approval_required] - agent requires explicit approval before execution
 * @property {boolean} [supervision_required] - agent requires supervision during execution
 * @property {boolean} [confidential_execution] - agent handles confidential data
 */

/**
 * @typedef {Object} CostSummary
 * @property {number} duration_ms - elapsed time in milliseconds
 * @property {number} [evidence_records] - count of evidence records written
 * @property {number} [context_docs_loaded] - count of context documents loaded
 * @property {number} [lifecycle_events] - count of lifecycle events in session
 */

/**
 * Canonical run/session lifecycle states
 * @type {string[]}
 */
export const LIFECYCLE_STATES = ['queued', 'routed', 'context_loaded', 'running', 'blocked', 'completed', 'failed']

/**
 * Optional fields added by v0.8.0 bounded governance:
 * - goal: advisory goal binding (advisory only, never blocks execution)
 * - cost_summary: execution cost metrics
 * - governance: selected agent governance signals (included in routed events)
 *
 * All v0.8.0 fields are optional and degrade gracefully when absent.
 * Governance signals are NEVER used for enforcement — advisory only.
 */

/**
 * Get current lifecycle state from an event list (last event's event field)
 * @param {Array<{event: string}>} events
 * @returns {string}
 */
export function getCurrentState(events) {
  if (!events || events.length === 0) return 'queued'
  return events[events.length - 1].event
}