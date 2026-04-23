// Canonical run/session lifecycle states
export const LIFECYCLE_STATES = ['queued', 'routed', 'context_loaded', 'running', 'blocked', 'completed', 'failed']

/**
 * Get current lifecycle state from an event list (last event's event field)
 * @param {Array<{event: string}>} events
 * @returns {string}
 */
export function getCurrentState(events) {
  if (!events || events.length === 0) return 'queued'
  return events[events.length - 1].event
}
