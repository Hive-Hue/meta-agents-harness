/**
 * Resolve the MAH workspace root from an arbitrary starting directory.
 * We walk upward until we find meta-agents.yaml, which is the canonical
 * workspace marker for MAH commands.
 *
 * @param {string} [startDir]
 * @returns {string}
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export function resolveWorkspaceRoot(startDir = process.cwd()) {
  let current = resolve(startDir)

  while (true) {
    const parent = dirname(current)
    if (existsSync(join(current, 'meta-agents.yaml'))) return current
    if (current === parent) return resolve(startDir)
    current = parent
  }
}
