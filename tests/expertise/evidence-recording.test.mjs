import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { recordEvidence } from '../../scripts/expertise-evidence-store.mjs'

function sampleEvidence(overrides = {}) {
  return {
    expertise_id: 'dev:backend-dev',
    outcome: 'success',
    task_type: 'implementation',
    task_description: 'Implement evidence recording for delegate_agent',
    duration_ms: 1250,
    source_agent: 'engineering-lead',
    source_session: 'session-abc',
    ...overrides,
  }
}

async function fireAndForgetEvidence(recorder, evidence) {
  const delegationResult = { ok: true, output: 'delegation complete' }
  ;(async () => {
    try {
      await recorder(evidence)
    } catch {
      // best-effort
    }
  })()
  return delegationResult
}

// Test 1: Mock delegation result → verify evidence file written
test('evidence recorded after delegate_agent completes', async () => {
  const evidenceRoot = mkdtempSync(join(tmpdir(), 'mah-evidence-record-'))
  const evidence = sampleEvidence()

  const result = await recordEvidence(evidence, { evidenceRoot })
  assert.equal(result.ok, true)

  const evidenceDir = join(evidenceRoot, evidence.expertise_id)
  const files = readdirSync(evidenceDir).filter((f) => f.endsWith('.json'))
  assert.equal(files.length, 1)

  const stored = JSON.parse(readFileSync(join(evidenceDir, files[0]), 'utf-8'))
  assert.equal(stored.expertise_id, evidence.expertise_id)
  assert.equal(stored.outcome, 'success')
  assert.equal(stored.task_type, 'implementation')
  assert.equal(stored.source_agent, 'engineering-lead')
})

// Test 2: Mock failed evidence store → verify delegation still succeeds
test('delegation succeeds even if evidence recording fails', async () => {
  const mockRecordEvidence = mock.fn(async () => {
    throw new Error('evidence store unavailable')
  })

  const result = await fireAndForgetEvidence(mockRecordEvidence, sampleEvidence())
  assert.equal(result.ok, true)
  assert.equal(result.output, 'delegation complete')
  assert.equal(mockRecordEvidence.mock.callCount(), 1)
})

// Test 3: Verify evidence shape matches schema
test('evidence shape matches expertise-types.mjs schema', async () => {
  const evidenceRoot = mkdtempSync(join(tmpdir(), 'mah-evidence-shape-'))
  const evidence = sampleEvidence({ outcome: 'failure', task_type: 'bugfix' })

  const result = await recordEvidence(evidence, { evidenceRoot })
  assert.equal(result.ok, true)

  const evidenceDir = join(evidenceRoot, evidence.expertise_id)
  const files = readdirSync(evidenceDir).filter((f) => f.endsWith('.json'))
  assert.equal(files.length, 1)

  const stored = JSON.parse(readFileSync(join(evidenceDir, files[0]), 'utf-8'))

  const requiredFields = [
    'id',
    'expertise_id',
    'outcome',
    'task_type',
    'task_description',
    'duration_ms',
    'quality_signals',
    'source_agent',
    'source_session',
    'recorded_at',
  ]

  for (const field of requiredFields) {
    assert.ok(field in stored, `missing required field: ${field}`)
  }

  assert.equal(typeof stored.id, 'string')
  assert.equal(typeof stored.expertise_id, 'string')
  assert.equal(typeof stored.task_description, 'string')
  assert.equal(typeof stored.duration_ms, 'number')
  assert.equal(typeof stored.source_agent, 'string')
  assert.equal(typeof stored.source_session, 'string')
  assert.equal(typeof stored.recorded_at, 'string')
})
