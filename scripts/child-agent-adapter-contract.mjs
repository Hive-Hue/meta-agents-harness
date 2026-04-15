/**
 * ChildAgentAdapter Contract — v0.6.0
 *
 * Defines the contract for cross-runtime child agent spawning.
 * Separates child-agent execution from RuntimeAdapter and SessionAdapter.
 *
 * The crew topology remains the authority on "who can delegate to whom".
 * The runtime chosen only defines "how the subtask will be executed".
 */

// ---------------------------------------------------------------------------
// Spawn modes
// ---------------------------------------------------------------------------

/** @type {Readonly<{NATIVE_SAME_RUNTIME: string, CROSS_RUNTIME_SIDECAR: string}>} */
export const SPAWN_MODES = Object.freeze({
  NATIVE_SAME_RUNTIME: "native-same-runtime",
  CROSS_RUNTIME_SIDECAR: "cross-runtime-sidecar"
})

// ---------------------------------------------------------------------------
// JSDoc type definitions
// ---------------------------------------------------------------------------

/**
 * @typedef {string} SpawnMode
 * One of {@link SPAWN_MODES.NATIVE_SAME_RUNTIME} or {@link SPAWN_MODES.CROSS_RUNTIME_SIDECAR}.
 */

/**
 * Context used to query whether a spawn is supported for a given (source, target) pair.
 *
 * @typedef {Object} SpawnSupportContext
 * @property {string} crew            - Crew identifier (e.g. "dev")
 * @property {string} sourceRuntime   - Runtime of the parent agent (e.g. "pi")
 * @property {string} sourceAgent     - Logical agent id of the parent (e.g. "engineering-lead")
 * @property {string} logicalTarget   - Logical agent id of the intended child (e.g. "backend-dev")
 * @property {string} targetRuntime   - Runtime where the child will execute (e.g. "codex")
 */

/**
 * Full context provided when preparing or executing a spawn.
 *
 * @typedef {Object} SpawnContext
 * @property {string} crew                    - Crew identifier
 * @property {string} sourceRuntime           - Runtime of the parent agent
 * @property {string} targetRuntime           - Runtime where the child will execute
 * @property {string} sourceAgent             - Logical agent id of the parent
 * @property {string} logicalTarget           - Original logical target requested
 * @property {string} effectiveLogicalTarget  - Resolved logical target (after any rerouting)
 * @property {string} task                    - Task description / prompt for the child agent
 * @property {SpawnMode} mode                 - Spawn mode to use
 */

/**
 * Result of preparing a spawn — the execution plan without actually spawning.
 *
 * @typedef {Object} SpawnPlanResult
 * @property {boolean} ok                      - Whether the plan is valid
 * @property {SpawnMode} mode                  - The spawn mode selected
 * @property {string} exec                     - Executable to invoke (e.g. "codex", "node")
 * @property {string[]} args                   - Arguments to pass to the executable
 * @property {Record<string, string>} envOverrides - Environment variable overrides
 * @property {string[]} warnings               - Non-fatal warnings
 * @property {string} [error]                  - Error message if ok is false
 */

/**
 * Result of an actual spawn execution.
 *
 * @typedef {Object} SpawnExecutionResult
 * @property {boolean} ok         - Whether the spawn succeeded
 * @property {number} [exitCode]  - Process exit code (if applicable)
 * @property {string} [stdout]    - Captured stdout
 * @property {string} [stderr]    - Captured stderr
 * @property {string} [error]     - Error message if ok is false
 */

// ---------------------------------------------------------------------------
// ChildAgentAdapter interface specification
// ---------------------------------------------------------------------------

/**
 * ChildAgentAdapter — contract specification
 *
 * Every adapter that wants to support child-agent spawning must implement
 * this interface. Adapters are registered by (sourceRuntime, targetRuntime)
 * and the strategy layer selects the appropriate one at delegation time.
 *
 * ## Required properties
 *
 * | Property       | Type                | Description                                      |
 * |----------------|---------------------|--------------------------------------------------|
 * | `name`         | `string`            | Unique adapter identifier                         |
 * | `sourceRuntime`| `string \| "*"`     | Runtime this adapter produces spawns FROM ("*" = any) |
 * | `targetRuntime`| `string`            | Runtime this adapter produces spawns INTO          |
 *
 * ## Required methods
 *
 * ### `supportsSpawn(ctx: SpawnSupportContext): boolean`
 * Returns `true` if this adapter can handle a spawn for the given context.
 *
 * ### `listSpawnModes(ctx: SpawnSupportContext): SpawnMode[]`
 * Returns the list of spawn modes this adapter supports for the given context.
 *
 * ### `prepareSpawn(ctx: SpawnContext): SpawnPlanResult`
 * Prepares (but does NOT execute) a spawn. Returns the execution plan including
 * exec, args, env overrides, and any warnings. This must be side-effect free.
 *
 * ## Optional methods
 *
 * ### `spawn?(ctx: SpawnContext): SpawnExecutionResult`
 * Actually executes the spawn. If omitted, the caller is responsible for
 * executing the plan returned by `prepareSpawn`.
 *
 * ## Registration
 *
 * Adapters are registered with the child-agent strategy layer:
 * ```js
 * // In a runtime plugin or adapter module:
 * export const childAgentAdapters = [
 *   myCodexSidecarAdapter,
 *   myNativePiAdapter,
 * ]
 * ```
 *
 * ## Contract invariants
 *
 * 1. The adapter MUST NOT bypass crew topology authorization.
 *    DelegationResolution must be run BEFORE prepareSpawn/spawn.
 * 2. sourceRuntime="*" means the adapter works regardless of which runtime
 *    the parent agent is running on.
 * 3. prepareSpawn must be side-effect free (no process creation).
 * 4. If ok=false in SpawnPlanResult, spawn must NOT be called.
 * 5. The adapter does NOT own session management — that is a separate concern.
 *
 * @typedef {Object} ChildAgentAdapter
 * @property {string} name
 * @property {string|'*'} sourceRuntime
 * @property {string} targetRuntime
 * @property {(ctx: SpawnSupportContext) => boolean} supportsSpawn
 * @property {(ctx: SpawnSupportContext) => SpawnMode[]} listSpawnModes
 * @property {(ctx: SpawnContext) => SpawnPlanResult} prepareSpawn
 * @property {(ctx: SpawnContext) => SpawnExecutionResult} [spawn]
 */

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

const REQUIRED_ADAPTER_FIELDS = ["name", "sourceRuntime", "targetRuntime"]
const REQUIRED_ADAPTER_METHODS = ["supportsSpawn", "listSpawnModes", "prepareSpawn"]

/**
 * Validates that an object conforms to the ChildAgentAdapter contract.
 *
 * @param {any} adapter - The adapter to validate
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateChildAgentAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") {
    return { ok: false, errors: ["adapter must be a non-null object"] }
  }

  const errors = []

  for (const field of REQUIRED_ADAPTER_FIELDS) {
    if (!(field in adapter)) {
      errors.push(`missing required field '${field}'`)
    }
  }

  if (adapter.name !== undefined && typeof adapter.name !== "string") {
    errors.push("name must be a string")
  }

  if (adapter.sourceRuntime !== undefined && typeof adapter.sourceRuntime !== "string") {
    errors.push("sourceRuntime must be a string")
  }

  if (adapter.targetRuntime !== undefined && typeof adapter.targetRuntime !== "string") {
    errors.push("targetRuntime must be a string")
  }

  for (const method of REQUIRED_ADAPTER_METHODS) {
    if (method in adapter && typeof adapter[method] !== "function") {
      errors.push(`'${method}' must be a function`)
    }
    if (!(method in adapter)) {
      errors.push(`missing required method '${method}'`)
    }
  }

  // Optional spawn method — must be a function if present
  if ("spawn" in adapter && typeof adapter.spawn !== "function") {
    errors.push("'spawn' must be a function when provided")
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Validates spawn mode value.
 *
 * @param {string} mode
 * @returns {boolean}
 */
export function isValidSpawnMode(mode) {
  return Object.values(SPAWN_MODES).includes(mode)
}
