/**
 * MAH Expertise Validation CLI
 * @fileoverview validate:expertise command — validates expertise objects
 * @version 0.7.0
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { EXPERTISE_SCHEMA_VERSION } from '../../types/expertise-types.mjs'
import { validateExpertise } from './expertise-schema.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')

// ---------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------

const argv = process.argv.slice(2)
const flags = {
  strict: argv.includes('--strict'),
  json: argv.includes('--json'),
}

const ownerFilter = (() => {
  const idx = argv.indexOf('--owner')
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : null
})()

// Remaining positional args = file paths (stop at first -- or known flag)
const pos = []
let i = 0
while (i < argv.length) {
  const tok = argv[i]
  if (tok === '--' || tok.startsWith('--') && tok !== '--owner') break
  if (tok === '--owner') {
    i += 2
    continue
  }
  if (tok !== '--strict' && tok !== '--json' && tok !== '--owner' && !tok.startsWith('--')) {
    pos.push(tok)
  }
  i++
}

const inputPaths = pos.length > 0 ? pos : null // null = use default catalog scan

// ---------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------

/**
 * @param {string} dir
 * @returns {string[]} absolute file paths
 */
function discoverExpertiseFiles(dir) {
  if (!existsSync(dir)) return []
  const results = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml') || entry.name.endsWith('.json'))) {
      results.push(full)
    } else if (entry.isDirectory()) {
      results.push(...discoverExpertiseFiles(full))
    }
  }
  return results.sort()
}

/**
 * Load and parse a single expertise file.
 * @param {string} filePath
 * @returns {{ content: any, parseError: string|null }}
 */
function loadExpertiseFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    if (filePath.endsWith('.json')) {
      return { content: JSON.parse(raw), parseError: null }
    }
    return { content: YAML.parse(raw) || {}, parseError: null }
  } catch (err) {
    return { content: null, parseError: err.message }
  }
}

// ---------------------------------------------------------------------
// Result collection
// ---------------------------------------------------------------------

/**
 * Validate a single expertise object, optionally filtering by owner.
 * @param {any} obj
 * @param {string|null} ownerFilter
 * @param {boolean} strict
 * @returns {{ id: string, valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateExpertiseObject(obj, ownerFilter = null, strict = false) {
  const result = validateExpertise(obj, strict)
  return {
    id: obj?.id || '(unknown)',
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
  }
}

/**
 * Check whether an expertise object matches the owner filter.
 * @param {any} item
 * @param {string|null} owner
 * @returns {boolean}
 */
function matchesOwnerFilter(item, owner) {
  if (!owner) return true
  const ownerValue = item?.owner
  if (typeof ownerValue === 'string') return ownerValue === owner
  if (ownerValue && typeof ownerValue === 'object') {
    if (ownerValue.agent === owner || ownerValue.team === owner) return true
  }
  if (typeof item?.metadata?.owner_id === 'string') {
    return item.metadata.owner_id === owner
      || item.metadata.owner_id.endsWith(`/${owner}`)
      || item.metadata.owner_id.startsWith(`${owner}/`)
  }
  return false
}

/**
 * Run validation across multiple expertise files.
 * @param {string[]} filePaths
 * @param {{ strict?: boolean, owner?: string|null }} options
 * @returns {{ total: number, valid: number, invalid: number, results: any[], fileErrors: any[] }}
 */
export function runValidation(filePaths, options = {}) {
  const { strict = false, owner = null } = options
  const results = []
  const fileErrors = []

  for (const filePath of filePaths) {
    const { content, parseError } = loadExpertiseFile(filePath)

    if (parseError) {
      fileErrors.push({ file: filePath, error: parseError })
      continue
    }

    if (content === null || content === undefined) {
      fileErrors.push({ file: filePath, error: 'empty/null content' })
      continue
    }

    // Support both single object and array of objects
    const items = Array.isArray(content) ? content : [content]

    for (const item of items) {
      if (!matchesOwnerFilter(item, owner)) continue
      results.push(validateExpertiseObject(item, owner, strict))
    }
  }

  const valid = results.filter((r) => r.valid).length
  const invalid = results.filter((r) => !r.valid).length
  return { total: results.length, valid, invalid, results, fileErrors }
}

// ---------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------

/**
 * Print human-readable console output.
 * @param {{ total: number, valid: number, invalid: number, results: any[], fileErrors: any[] }} report
 */
export function printConsoleReport(report) {
  const { total, valid, invalid, results, fileErrors } = report

  if (fileErrors.length > 0) {
    for (const fe of fileErrors) {
      console.log(`\u2717 ${fe.file} — ERROR: ${fe.error}`)
    }
  }

  for (const r of results) {
    const id = r.id || '(unknown)'
    if (r.valid) {
      const warnNote = r.warnings.length > 0 ? ` (${r.warnings.length} warning${r.warnings.length !== 1 ? 's' : ''})` : ''
      console.log(`\u2713 ${id} — valid${warnNote}`)
      if (r.warnings.length > 0) {
        for (const w of r.warnings) {
          console.log(`  \u26a0 ${w}`)
        }
      }
    } else {
      console.log(`\u2717 ${id} — INVALID`)
      for (const e of r.errors) {
        console.log(`  \u2717 ${e}`)
      }
    }
  }

  const totalMark = invalid === 0 && fileErrors.length === 0 ? '\u2713' : '\u2717'
  console.log(`\n${totalMark} Total: ${total}, Valid: ${valid}, Invalid: ${invalid}${fileErrors.length > 0 ? `, Errors: ${fileErrors.length}` : ''}`)
}

/**
 * Print JSON output.
 * @param {{ total: number, valid: number, invalid: number, results: any[], fileErrors: any[] }} report
 */
export function printJsonReport(report) {
  const { total, valid, invalid, results, fileErrors } = report
  const output = {
    schema_version: EXPERTISE_SCHEMA_VERSION,
    validated_at: new Date().toISOString(),
    total,
    valid,
    invalid,
    file_errors: fileErrors.length,
    results: results.map((r) => ({
      id: r.id,
      valid: r.valid,
      errors: r.errors,
      warnings: r.warnings,
    })),
    file_errors: fileErrors.map((fe) => ({ file: fe.file, error: fe.error })),
  }
  console.log(JSON.stringify(output, null, 2))
}

// ---------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------

export function main() {
  // Resolve input paths or use default catalog
  let filePaths = []
  if (inputPaths && inputPaths.length > 0) {
    filePaths = inputPaths.map((p) => resolve(p))
  } else {
    const catalogDir = join(repoRoot, '.mah', 'expertise', 'catalog')
    filePaths = discoverExpertiseFiles(catalogDir)
  }

  // Exit code 2: no files found / file errors
  if (filePaths.length === 0) {
    if (flags.json) {
      console.log(JSON.stringify({
        schema_version: EXPERTISE_SCHEMA_VERSION,
        validated_at: new Date().toISOString(),
        total: 0,
        valid: 0,
        invalid: 0,
        results: [],
        file_errors: [{ error: 'no expertise files found' }],
      }, null, 2))
    } else {
      console.error('ERROR: no expertise files found')
    }
    return 2
  }

  const report = runValidation(filePaths, { strict: flags.strict, owner: ownerFilter })

  if (flags.json) {
    printJsonReport(report)
  } else {
    printConsoleReport(report)
  }

  // Exit code logic:
  // 0 = all valid, no file errors
  // 1 = at least one invalid expertise
  // 2 = file errors (parse, read, etc.)
  if (report.fileErrors.length > 0) return 2
  if (report.invalid > 0) return 1
  return 0
}

// ---------------------------------------------------------------------
// Direct run
// ---------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = main()
  process.exitCode = exitCode
}
