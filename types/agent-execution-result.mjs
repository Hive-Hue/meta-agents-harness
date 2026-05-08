/**
 * @typedef {Object} AgentExecutionResult
 * @property {string} runtime
 * @property {string} crew
 * @property {string} agent
 * @property {string} task
 * @property {string|null} [sessionId]
 * @property {string} output
 * @property {number} exitCode
 * @property {number} elapsedMs
 * @property {string|null} [artifactPath]
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * Normalize mixed execution result payloads into canonical AgentExecutionResult.
 *
 * @param {Partial<AgentExecutionResult> & Record<string, unknown>} raw
 * @param {{ runtime?: string, crew?: string, agent?: string, sessionId?: string|null }} [options]
 * @returns {Readonly<AgentExecutionResult>}
 */
export function normalizeExecutionResult(raw, options = {}) {
  const source = raw ?? {}

  /** @type {AgentExecutionResult} */
  const normalized = {
    runtime: source.runtime ?? 'unknown',
    crew: source.crew ?? 'unknown',
    agent: source.agent ?? 'unknown',
    task: source.task ?? '',
    output: source.output ?? source.stdout ?? '',
    exitCode: Number(source.exitCode ?? source.status ?? 1),
    elapsedMs: Number(source.elapsedMs ?? 0),
    sessionId: source.sessionId ?? null,
    artifactPath: source.artifactPath,
    metadata: source.metadata
  }

  if (options.runtime !== undefined) normalized.runtime = options.runtime
  if (options.crew !== undefined) normalized.crew = options.crew
  if (options.agent !== undefined) normalized.agent = options.agent
  if (options.sessionId !== undefined) normalized.sessionId = options.sessionId

  return Object.freeze(normalized)
}
