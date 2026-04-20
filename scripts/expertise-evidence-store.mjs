/**
 * MAH Expertise Evidence Store
 * @fileoverview Evidence persistence layer for expertise metrics and events
 * @version 0.7.0
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { resolveWorkspaceRoot } from './workspace-root.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const workspaceRoot = resolveWorkspaceRoot()

// SECURITY: v0.7.0-patch — evidence loading bounds
const MAX_EVIDENCE_FILES = 10000
const MAX_EVIDENCE_FILE_SIZE = 1 * 1024 * 1024 // 1MB

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a path relative to repo root.
 * @param {string} relPath
 * @returns {string}
 */
function resolvePath(relPath) {
  return join(workspaceRoot, relPath)
}

/**
 * Resolve the evidence root directory, optionally overridden by env/config.
 * @param {string} [overrideRoot]
 * @returns {string}
 */
function resolveEvidenceRoot(overrideRoot = process.env.MAH_EXPERTISE_EVIDENCE_ROOT) {
  if (overrideRoot && typeof overrideRoot === 'string' && overrideRoot.trim()) {
    return resolve(overrideRoot)
  }
  return resolvePath('.mah/expertise/evidence')
}

/**
 * Ensure a directory exists, creating it if necessary.
 * @param {string} dirPath
 */
function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * Format a Date as YYYY-MM-DD for file naming.
 * @param {Date} date
 * @returns {string}
 */
function toDateStamp(date) {
  return date.toISOString().slice(0, 10)
}

// SECURITY: v0.7.0-patch — sanitize expertise_id to prevent path traversal
const EXPERTISE_ID_REGEX = /^[a-z0-9._-]+:[a-z0-9._-]+$/

/**
 * Validate and sanitize an expertise ID.
 * Rejects path separators, '..' traversal, and invalid formats.
 * @param {string} id
 * @returns {string} The validated ID
 * @throws {Error} If the ID is invalid
 */
function sanitizeExpertiseId(id) {
  if (typeof id !== 'string' || !id) {
    throw new Error(`Invalid expertise_id: must be a non-empty string, got '${id}'`)
  }
  if (id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error(`Invalid expertise_id: path separators and '..' are not allowed in '${id}'`)
  }
  if (!EXPERTISE_ID_REGEX.test(id)) {
    throw new Error(`Invalid expertise_id: must match ${EXPERTISE_ID_REGEX.source}, got '${id}'`)
  }
  return id
}

/**
 * Verify that a resolved path stays under a base directory.
 * @param {string} resolvedPath
 * @param {string} basePath
 * @returns {{ ok: boolean, error?: string }}
 */
function ensurePathUnderBase(resolvedPath, basePath) {
  const normalizedBase = resolve(basePath).replace(/\/+$/, '') + '/'
  const normalizedTarget = resolve(resolvedPath).replace(/\/+$/, '') + '/'
  if (!normalizedTarget.startsWith(normalizedBase)) {
    return { ok: false, error: `path escapes base directory: '${resolvedPath}' is not under '${basePath}'` }
  }
  return { ok: true }
}

/**
 * Get all .json files in a directory, sorted by filename.
 * @param {string} dirPath
 * @returns {string[]}
 */
function listEvidenceFiles(dirPath) {
  if (!existsSync(dirPath)) return []
  const files = readdirSync(dirPath).filter(f => f.endsWith('.json'))
  return files.sort()
}

/**
 * Percentile calculation (simple linear interpolation).
 * @param {number[]} arr
 * @param {number} p 0-100
 * @returns {number}
 */
function percentile(arr, p) {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a single evidence event to disk.
 * Creates `.mah/expertise/evidence/{expertise_id}/` dir if needed.
 * File named `{timestamp}-{shortuuid}.json` for chronological ordering.
 *
 * @param {object} evidence - Evidence object (see task spec for fields)
 * @param {{ evidenceRoot?: string }} [options]
 * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
 */
export async function recordEvidence(evidence, options = {}) {
  try {
    const { expertise_id } = evidence
    if (!expertise_id) {
      return { ok: false, error: 'expertise_id is required' }
    }

    // SECURITY: v0.7.0-patch — sanitize expertise_id
    try {
      sanitizeExpertiseId(expertise_id)
    } catch (err) {
      return { ok: false, error: err.message }
    }

    // SECURITY: v0.7.0-patch
    // Enforce provenance minimums so confidence scoring has attributable evidence.
    if (typeof evidence.source_agent !== 'string' || evidence.source_agent.trim().length === 0) {
      return { ok: false, error: 'source_agent is required and must be a non-empty string' }
    }
    if (evidence.source_session !== undefined) {
      if (typeof evidence.source_session !== 'string' || evidence.source_session.trim().length === 0) {
        return { ok: false, error: 'source_session must be a non-empty string when provided' }
      }
    }

    const evidenceRoot = resolveEvidenceRoot(options.evidenceRoot)
    const baseDir = join(evidenceRoot, expertise_id)
    // SECURITY: v0.7.0-patch — verify path stays under evidence root
    const pathCheck = ensurePathUnderBase(baseDir, evidenceRoot)
    if (!pathCheck.ok) {
      return { ok: false, error: pathCheck.error }
    }
    ensureDir(baseDir)

    // Use recorded_at or now as timestamp
    const ts = evidence.recorded_at || evidence.timestamp || new Date().toISOString()
    const dateStamp = toDateStamp(new Date(ts))
    const uuid = randomUUID().slice(0, 8)
    const filename = `${dateStamp}-${uuid}.json`
    const filePath = join(baseDir, filename)

    // Normalize: map task spec fields to internal shape
    const normalized = {
      id: evidence.id || `ev-${dateStamp}-${uuid}`,
      expertise_id,
      outcome: evidence.outcome || 'success',
      task_type: evidence.task_type || 'unknown',
      task_description: evidence.task_description || evidence.task_context || '',
      duration_ms: evidence.duration_ms || evidence.evidence_data?.latency_ms || 0,
      quality_signals: {
        review_pass: evidence.quality_signals?.review_pass ?? evidence.evidence_data?.review_pass ?? null,
        test_coverage_delta: evidence.quality_signals?.test_coverage_delta ?? null,
        rejection_count: evidence.quality_signals?.rejection_count ?? evidence.evidence_data?.error_type ? 1 : 0,
      },
      source_agent: evidence.source_agent,
      source_session: evidence.source_session || 'unknown',
      recorded_at: ts,
    }

    writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf-8')
    return { ok: true, path: filePath }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/**
 * Load evidence events for a specific expertise, sorted by timestamp.
 *
 * @param {string} expertiseId
 * @param {{ since?: Date, limit?: number, evidenceRoot?: string }} [options]
 * @returns {Promise<object[]>} Array of evidence events
 */
export async function loadEvidenceFor(expertiseId, options = {}) {
  try {
    const { since, limit } = options
    // SECURITY: v0.7.0-patch — sanitize expertiseId
    try {
      sanitizeExpertiseId(expertiseId)
    } catch (err) {
      console.warn('[expertise-evidence-store]', err.message)
      return []
    }
    const evidenceRoot = resolveEvidenceRoot(options.evidenceRoot)
    const baseDir = join(evidenceRoot, expertiseId)

    if (!existsSync(baseDir)) return []

    const files = listEvidenceFiles(baseDir)
    // SECURITY: v0.7.0-patch — unbounded evidence loading protection
    if (files.length > MAX_EVIDENCE_FILES) {
      console.warn(`[expertise-evidence-store] too many evidence files (${files.length}) for '${expertiseId}', limit is ${MAX_EVIDENCE_FILES}`)
      return []
    }
    /** @type {object[]} */
    const evidence = []

    for (const file of files) {
      const filePath = join(baseDir, file)
      try {
        // SECURITY: v0.7.0-patch — check file size before reading
        const { statSync } = await import('node:fs')
        const stat = statSync(filePath)
        if (stat.size > MAX_EVIDENCE_FILE_SIZE) {
          console.warn(`[expertise-evidence-store] skipping oversized evidence file '${file}' (${stat.size} bytes, limit ${MAX_EVIDENCE_FILE_SIZE})`)
          continue
        }
        const raw = readFileSync(filePath, 'utf-8')
        const event = JSON.parse(raw)
        evidence.push(event)
      } catch {
        // Skip malformed files
      }
    }

    // Sort by recorded_at
    evidence.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())

    // Filter by since
    let filtered = evidence
    if (since) {
      const sinceMs = since.getTime()
      filtered = evidence.filter(e => new Date(e.recorded_at).getTime() >= sinceMs)
    }

    // Apply limit
    if (limit && limit > 0) {
      filtered = filtered.slice(-limit)
    }

    return filtered
  } catch {
    return []
  }
}

/**
 * Get aggregated metrics for an expertise (reads from computed metrics file).
 *
 * @param {string} expertiseId
 * @param {{ evidenceRoot?: string }} [options]
 * @returns {Promise<object|null>}
 */
export async function getMetricsFor(expertiseId, options = {}) {
  // SECURITY: v0.7.0-patch — sanitize expertiseId
  try {
    sanitizeExpertiseId(expertiseId)
  } catch (err) {
    return null
  }

  const evidenceRoot = resolveEvidenceRoot(options.evidenceRoot)
  const metricsPath = join(evidenceRoot, expertiseId, 'metrics.json')
  if (!existsSync(metricsPath)) return null
  try {
    const raw = readFileSync(metricsPath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Auto-discover and aggregate metrics from evidence store.
 * Computes p95_duration_ms, review_pass_rate, rejection_rate, etc.
 *
 * @param {string} expertiseId
 * @param {{ evidenceRoot?: string }} [options]
 * @returns {Promise<object>} ExpertiseMetrics object
 */
export async function computeMetrics(expertiseId, options = {}) {
  // SECURITY: v0.7.0-patch — sanitize expertiseId
  try {
    sanitizeExpertiseId(expertiseId)
  } catch (err) {
    console.warn('[expertise-evidence-store]', err.message)
    return {
      expertise_id: expertiseId,
      total_invocations: 0, successful_invocations: 0, failed_invocations: 0,
      avg_duration_ms: 0, p95_duration_ms: 0, total_cost_units: 0,
      review_pass_rate: 0, rejection_rate: 0,
      last_invoked: null, last_successful: null, last_failed: null,
      evidence_count: 0, window_start: null, window_end: null,
    }
  }

  const evidence = await loadEvidenceFor(expertiseId, options)

  if (evidence.length === 0) {
    return {
      expertise_id: expertiseId,
      total_invocations: 0,
      successful_invocations: 0,
      failed_invocations: 0,
      avg_duration_ms: 0,
      p95_duration_ms: 0,
      total_cost_units: 0,
      review_pass_rate: 0,
      rejection_rate: 0,
      last_invoked: null,
      last_successful: null,
      last_failed: null,
      evidence_count: 0,
      window_start: null,
      window_end: null,
    }
  }

  const durations = []
  let successful = 0
  let failed = 0
  let reviewPassCount = 0
  let rejectionCount = 0
  let lastInvoked = null
  let lastSuccessful = null
  let lastFailed = null
  let totalCost = 0
  let totalReviewPass = 0

  for (const ev of evidence) {
    const ts = ev.recorded_at

    if (ev.duration_ms > 0) durations.push(ev.duration_ms)
    if (ev.outcome === 'success') {
      successful++
      lastSuccessful = ts
    } else if (ev.outcome === 'failure') {
      failed++
      lastFailed = ts
    }
    lastInvoked = ts

    const qs = ev.quality_signals || {}
    if (qs.review_pass === true || qs.review_pass === false) {
      totalReviewPass++
      if (qs.review_pass) reviewPassCount++
    }
    if (qs.rejection_count > 0) rejectionCount++

    totalCost += ev.evidence_data?.cost_units || 0
  }

  const total = evidence.length
  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0
  const p95Duration = durations.length > 0 ? percentile(durations, 95) : 0

  return {
    expertise_id: expertiseId,
    total_invocations: total,
    successful_invocations: successful,
    failed_invocations: failed,
    avg_duration_ms: Math.round(avgDuration),
    p95_duration_ms: Math.round(p95Duration),
    total_cost_units: totalCost,
    review_pass_rate: totalReviewPass > 0 ? reviewPassCount / totalReviewPass : 0,
    rejection_rate: total > 0 ? rejectionCount / total : 0,
    last_invoked: lastInvoked,
    last_successful: lastSuccessful,
    last_failed: lastFailed,
    evidence_count: total,
    window_start: evidence[0]?.recorded_at || null,
    window_end: evidence[evidence.length - 1]?.recorded_at || null,
  }
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== Expertise Evidence Store Self-Test ===\n')

  const TEST_ID = 'dev:orchestrator'
  const TEST_SESSION = 'self-test-session'

  // 1. recordEvidence
  console.log('[1] recordEvidence()...')
  const result1 = await recordEvidence({
    expertise_id: TEST_ID,
    outcome: 'success',
    task_type: 'orchestration',
    task_description: 'plan v0.7.0 sprint',
    duration_ms: 12400,
    quality_signals: { review_pass: true, rejection_count: 0 },
    source_agent: 'orchestrator',
    source_session: TEST_SESSION,
    recorded_at: '2026-04-16T09:00:00.000Z',
  })
  console.log(`    result: ok=${result1.ok}, path=${result1.path || result1.error}`)

  // Record a second evidence event
  const result2 = await recordEvidence({
    expertise_id: TEST_ID,
    outcome: 'success',
    task_type: 'orchestration',
    task_description: 'coordinate sprint review',
    duration_ms: 8300,
    quality_signals: { review_pass: true, rejection_count: 0 },
    source_agent: 'orchestrator',
    source_session: TEST_SESSION,
    recorded_at: '2026-04-16T09:15:00.000Z',
  })
  console.log(`    result: ok=${result2.ok}`)

  // Record a failure event
  const result3 = await recordEvidence({
    expertise_id: TEST_ID,
    outcome: 'failure',
    task_type: 'orchestration',
    task_description: 'deploy sprint artifacts',
    duration_ms: 5000,
    quality_signals: { review_pass: false, rejection_count: 2 },
    source_agent: 'orchestrator',
    source_session: TEST_SESSION,
    recorded_at: '2026-04-16T09:30:00.000Z',
  })
  console.log(`    result: ok=${result3.ok}`)

  // 2. loadEvidenceFor
  console.log('\n[2] loadEvidenceFor()...')
  const loaded = await loadEvidenceFor(TEST_ID)
  console.log(`    loaded ${loaded.length} evidence events`)
  for (const ev of loaded) {
    console.log(`      - ${ev.recorded_at} [${ev.outcome}] ${ev.task_description}`)
  }

  // 3. computeMetrics
  console.log('\n[3] computeMetrics()...')
  const metrics = await computeMetrics(TEST_ID)
  console.log(`    expertise_id: ${metrics.expertise_id}`)
  console.log(`    total_invocations: ${metrics.total_invocations}`)
  console.log(`    successful_invocations: ${metrics.successful_invocations}`)
  console.log(`    failed_invocations: ${metrics.failed_invocations}`)
  console.log(`    avg_duration_ms: ${metrics.avg_duration_ms}`)
  console.log(`    p95_duration_ms: ${metrics.p95_duration_ms}`)
  console.log(`    review_pass_rate: ${metrics.review_pass_rate}`)
  console.log(`    rejection_rate: ${metrics.rejection_rate}`)
  console.log(`    last_invoked: ${metrics.last_invoked}`)
  console.log(`    evidence_count: ${metrics.evidence_count}`)
  console.log(`    window_start: ${metrics.window_start}`)
  console.log(`    window_end: ${metrics.window_end}`)

  // 4. loadEvidenceFor with limit
  console.log('\n[4] loadEvidenceFor(limit=2)...')
  const limited = await loadEvidenceFor(TEST_ID, { limit: 2 })
  console.log(`    loaded ${limited.length} events (expected 2)`)

  // 5. loadEvidenceFor for non-existent expertise
  console.log('\n[5] loadEvidenceFor(non-existent-id)...')
  const empty = await loadEvidenceFor('non:existent')
  console.log(`    loaded ${empty.length} events (expected 0)`)

  // 6. getMetricsFor (no pre-computed file yet)
  console.log('\n[6] getMetricsFor()...')
  const stored = await getMetricsFor(TEST_ID)
  console.log(`    result: ${stored === null ? 'null (no pre-computed file)' : 'found'}`)

  // 7. SECURITY: provenance validation checks
  console.log('\n[7] provenance validation...')
  const badProvenance = await recordEvidence({
    expertise_id: TEST_ID,
    outcome: 'success',
    task_type: 'orchestration',
    task_description: 'missing source_agent should be rejected',
    duration_ms: 1,
    source_agent: '   ',
    source_session: TEST_SESSION,
    recorded_at: '2026-04-16T09:45:00.000Z',
  })
  console.log(`    empty source_agent rejected: ${badProvenance.ok === false ? 'YES' : 'NO (ERROR)'}`)

  const badSession = await recordEvidence({
    expertise_id: TEST_ID,
    outcome: 'success',
    task_type: 'orchestration',
    task_description: 'empty source_session should be rejected when provided',
    duration_ms: 1,
    source_agent: 'orchestrator',
    source_session: '   ',
    recorded_at: '2026-04-16T09:46:00.000Z',
  })
  console.log(`    empty source_session rejected: ${badSession.ok === false ? 'YES' : 'NO (ERROR)'}`)

  // 7. Security: sanitizeExpertiseId rejects path traversal
  console.log('\n[7] sanitizeExpertiseId security tests...')
  const traversalTests = [
    { id: '../../.ssh', desc: 'path traversal ../' },
    { id: '../etc/passwd', desc: 'path traversal with slash' },
    { id: 'foo/bar:baz', desc: 'slash in segment' },
    { id: 'dev\\orchestrator', desc: 'backslash' },
    { id: 'dev:..', desc: 'dotdot segment' },
  ]
  for (const tt of traversalTests) {
    const r = await recordEvidence({ expertise_id: tt.id, outcome: 'success' })
    const blocked = !r.ok && r.error?.includes('not allowed')
    console.log(`    ${blocked ? '✓' : '✗'} ${tt.desc}: ${blocked ? 'blocked' : 'NOT BLOCKED'}`)
  }
  // Valid ID should still work
  const validR = await recordEvidence({ expertise_id: 'dev:orchestrator', outcome: 'success', source_agent: 'orchestrator' })
  console.log(`    ${validR.ok ? '✓' : '✗'} valid ID 'dev:orchestrator' still works`)

  console.log('\n=== Self-Test Passed ===')
}
