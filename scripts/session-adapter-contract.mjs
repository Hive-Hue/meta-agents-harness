/**
 * Session Adapter Contract
 * Validates session adapters per MAH session interop spec v0.6.0
 */

import { FIDELITY_LEVELS, DEFAULT_FIDELITY_LEVEL } from "../types/session-types.mjs"

export const REQUIRED_SESSION_ADAPTER_FIELDS = [
  "runtime",
  "listSessions",
  "exportSession",
  "supportsRawExport",
  "supportsContextInjection",
  "buildInjectionPayload"
]

export const VALID_FIDELITY_LEVELS = FIDELITY_LEVELS

/**
 * Validate a registry of session adapters
 * @param {Record<string, object>} adapters
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateSessionAdapterContract(adapters) {
  const errors = []
  for (const [runtimeName, adapter] of Object.entries(adapters || {})) {
    for (const field of REQUIRED_SESSION_ADAPTER_FIELDS) {
      if (!(field in adapter)) {
        errors.push(`${runtimeName}: missing session adapter field '${field}'`)
      }
    }
    for (const method of ["listSessions", "exportSession", "supportsRawExport", "supportsContextInjection", "buildInjectionPayload"]) {
      if (method in adapter && typeof adapter[method] !== "function") {
        errors.push(`${runtimeName}: session adapter method '${method}' must be a function`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Select fidelity level based on request and runtime capabilities
 * @param {string|null} requestedLevel
 * @param {{ supportsFullReplay?: boolean }} runtimeCapabilities
 * @returns {string}
 */
export function selectFidelityLevel(requestedLevel, runtimeCapabilities) {
  if (requestedLevel && FIDELITY_LEVELS.includes(requestedLevel)) {
    return requestedLevel
  }
  if (runtimeCapabilities?.supportsFullReplay) return "full"
  return DEFAULT_FIDELITY_LEVEL
}
