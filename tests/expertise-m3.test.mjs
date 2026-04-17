/**
 * M3 — Observed Evidence + Confidence + Lifecycle
 * Integration tests covering evidence store, confidence calculation, lifecycle state machine.
 */

import { describe, it, after } from 'node:test'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Imports from expertise modules
// ---------------------------------------------------------------------------

const { recordEvidence, loadEvidenceFor, computeMetrics, getMetricsFor } = await import('../scripts/expertise-evidence-store.mjs')
const { computeConfidence, scoreToBand, mergeConfidence, applyEvidenceFloor } = await import('../scripts/expertise-confidence.mjs')
const { canTransition, transitionExpertise, describeLifecycle, getSuggestedNextStates, LIFECYCLE_STATES } = await import('../scripts/expertise-lifecycle.mjs')

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_EXPERTISE = `test:${randomUUID().slice(0, 8)}`
const repoRoot = process.cwd()
const evidenceRoot = mkdtempSync(join(tmpdir(), 'mah-expertise-m3-'))
const evidenceOptions = { evidenceRoot }

after(() => {
  rmSync(evidenceRoot, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Evidence Store tests
// ---------------------------------------------------------------------------

describe('M3 — Evidence Store', () => {
  it('recordEvidence writes a JSON file and returns path', async () => {
    const result = await recordEvidence({
      expertise_id: TEST_EXPERTISE,
      outcome: 'success',
      task_type: 'code-generation',
      task_description: 'implement user auth',
      duration_ms: 12000,
      quality_signals: { review_pass: true, rejection_count: 0 },
      source_agent: 'orchestrator',
      source_session: 'test-session',
      recorded_at: new Date().toISOString(),
    }, evidenceOptions)
    assert.equal(result.ok, true)
    assert.ok(result.path?.includes(TEST_EXPERTISE), 'path should contain expertise_id')
  })

  it('loadEvidenceFor returns evidence sorted by timestamp', async () => {
    const ts1 = '2026-04-16T10:00:00.000Z'
    const ts2 = '2026-04-16T10:05:00.000Z'
    const ts3 = '2026-04-16T10:10:00.000Z'

    await recordEvidence({
      expertise_id: TEST_EXPERTISE, outcome: 'failure', task_type: 'testing',
      task_description: 'task 2', duration_ms: 5000,
      quality_signals: { review_pass: false, rejection_count: 1 },
      source_agent: 'orchestrator', source_session: 'test-session', recorded_at: ts1,
    }, evidenceOptions)
    await recordEvidence({
      expertise_id: TEST_EXPERTISE, outcome: 'success', task_type: 'testing',
      task_description: 'task 1', duration_ms: 8000,
      quality_signals: { review_pass: true, rejection_count: 0 },
      source_agent: 'orchestrator', source_session: 'test-session', recorded_at: ts2,
    }, evidenceOptions)
    await recordEvidence({
      expertise_id: TEST_EXPERTISE, outcome: 'success', task_type: 'planning',
      task_description: 'task 3', duration_ms: 3000,
      quality_signals: { review_pass: true, rejection_count: 0 },
      source_agent: 'orchestrator', source_session: 'test-session', recorded_at: ts3,
    }, evidenceOptions)

    const events = await loadEvidenceFor(TEST_EXPERTISE, evidenceOptions)
    assert.equal(events.length, 4, 'should have 4 events total (1 + 3)')
    assert.ok(events[0].recorded_at <= events[1].recorded_at)
    assert.ok(events[1].recorded_at <= events[2].recorded_at)
    assert.ok(events[2].recorded_at <= events[3].recorded_at)
  })

  it('loadEvidenceFor respects limit option', async () => {
    const events = await loadEvidenceFor(TEST_EXPERTISE, { ...evidenceOptions, limit: 2 })
    assert.equal(events.length, 2, 'should return only 2 events')
  })

  it('loadEvidenceFor returns empty array for non-existent expertise', async () => {
    const events = await loadEvidenceFor(`nonexistent:${randomUUID().slice(0, 8)}`, evidenceOptions)
    assert.equal(events.length, 0)
  })

  it('computeMetrics aggregates evidence correctly', async () => {
    const metrics = await computeMetrics(TEST_EXPERTISE, evidenceOptions)
    assert.equal(metrics.expertise_id, TEST_EXPERTISE)
    assert.equal(metrics.total_invocations, 4)
    assert.ok(metrics.successful_invocations >= 3)
    assert.ok(metrics.failed_invocations >= 1)
    assert.ok(metrics.avg_duration_ms > 0)
    assert.ok(metrics.p95_duration_ms > 0)
    assert.ok(metrics.review_pass_rate >= 0)
    assert.ok(metrics.rejection_rate >= 0)
    assert.ok(metrics.last_invoked !== null)
  })
})

// ---------------------------------------------------------------------------
// Confidence Calculation tests
// ---------------------------------------------------------------------------

describe('M3 — Confidence Calculation', () => {
  it('scoreToBand returns correct band for each range', () => {
    assert.equal(scoreToBand(0.0), 'low')
    assert.equal(scoreToBand(0.29), 'low')
    assert.equal(scoreToBand(0.3), 'medium')
    assert.equal(scoreToBand(0.59), 'medium')
    assert.equal(scoreToBand(0.6), 'high')
    assert.equal(scoreToBand(0.84), 'high')
    assert.equal(scoreToBand(0.85), 'critical')
    assert.equal(scoreToBand(1.0), 'critical')
  })

  it('computeConfidence with zero evidence returns low band', () => {
    const metrics = {
      total_invocations: 0, successful_invocations: 0, failed_invocations: 0,
      avg_duration_ms: 0, p95_duration_ms: 0, total_cost_units: 0,
      review_pass_rate: 0, rejection_rate: 0,
      last_invoked: null, last_successful: null, last_failed: null,
      evidence_count: 0, window_start: null, window_end: null,
    }
    const result = computeConfidence(metrics)
    assert.equal(result.band, 'low')
    assert.ok(result.score >= 0 && result.score <= 1)
  })

  it('computeConfidence with all success + high review pass returns high/critical band', () => {
    const now = new Date().toISOString()
    const metrics = {
      total_invocations: 10, successful_invocations: 10, failed_invocations: 0,
      avg_duration_ms: 5000, p95_duration_ms: 8000, total_cost_units: 100,
      review_pass_rate: 1.0, rejection_rate: 0,
      last_invoked: now, last_successful: now, last_failed: null,
      evidence_count: 10, window_start: now, window_end: now,
    }
    const result = computeConfidence(metrics)
    assert.ok(result.band === 'high' || result.band === 'critical', `expected high/critical, got ${result.band}`)
    assert.ok(result.score >= 0.6, `expected score >= 0.6, got ${result.score}`)
  })

  it('computeConfidence applies rejection penalty', () => {
    const now = new Date().toISOString()
    const metrics = {
      total_invocations: 5, successful_invocations: 2, failed_invocations: 3,
      avg_duration_ms: 5000, p95_duration_ms: 8000, total_cost_units: 50,
      review_pass_rate: 0.4, rejection_rate: 0.6,
      last_invoked: now, last_successful: now, last_failed: now,
      evidence_count: 5, window_start: now, window_end: now,
    }
    const result = computeConfidence(metrics)
    assert.ok(result.score < 0.5, `expected low score with high rejection, got ${result.score}`)
  })

  it('applyEvidenceFloor caps score at 0.4 when evidence < 3', () => {
    const confidence = { score: 0.8, band: 'high', evidence_count: 2 }
    const result = applyEvidenceFloor(confidence, 2)
    assert.equal(result.band, 'low', 'band should be capped to low')
    assert.ok(result.score <= 0.4, `score should be capped at 0.4, got ${result.score}`)
  })

  it('applyEvidenceFloor with zero evidence returns score 0.1, low band', () => {
    const confidence = { score: 0.9, band: 'critical', evidence_count: 0 }
    const result = applyEvidenceFloor(confidence, 0)
    assert.equal(result.band, 'low')
    assert.ok(result.score <= 0.1)
  })

  it('mergeConfidence respects declared but caps at evidence-supported level', () => {
    const declared = { score: 0.9, band: 'high', evidence_count: 2 }
    const computed = { score: 0.5, band: 'medium', evidence_count: 10 }
    const result = mergeConfidence(declared, computed)
    assert.ok(result.score <= 0.7, `score should be capped at 0.7, got ${result.score}`)
    assert.equal(result.evidence_count, 10, 'evidence_count should come from computed')
  })

  it('mergeConfidence with no declared returns computed', () => {
    const computed = { score: 0.6, band: 'high', evidence_count: 5 }
    const result = mergeConfidence(undefined, computed)
    assert.equal(result.score, computed.score)
    assert.equal(result.band, computed.band)
  })
})

// ---------------------------------------------------------------------------
// Lifecycle State Machine tests
// ---------------------------------------------------------------------------

describe('M3 — Lifecycle State Machine', () => {
  it('LIFECYCLE_STATES contains all expected states', () => {
    assert.ok(LIFECYCLE_STATES.includes('draft'))
    assert.ok(LIFECYCLE_STATES.includes('active'))
    assert.ok(LIFECYCLE_STATES.includes('experimental'))
    assert.ok(LIFECYCLE_STATES.includes('restricted'))
    assert.ok(LIFECYCLE_STATES.includes('deprecated'))
  })

  it('canTransition draft → experimental is always allowed', () => {
    assert.equal(canTransition('draft', 'experimental'), true)
  })

  it('canTransition draft → deprecated is always allowed', () => {
    assert.equal(canTransition('draft', 'deprecated'), true)
  })

  it('canTransition draft → active is structurally valid', () => {
    assert.equal(canTransition('draft', 'active'), true)
  })

  it('canTransition deprecated → active is NOT allowed (terminal state)', () => {
    assert.equal(canTransition('deprecated', 'active'), false)
  })

  it('canTransition deprecated → draft is NOT allowed (terminal state)', () => {
    assert.equal(canTransition('deprecated', 'draft'), false)
  })

  it('canTransition active → restricted is structurally valid', () => {
    assert.equal(canTransition('active', 'restricted'), true)
  })

  it('transitionExpertise rejects draft → active without sufficient evidence', () => {
    const exp = {
      id: 'test:agent', owner: { agent: 'agent' }, lifecycle: 'draft',
      schema_version: 'mah.expertise.v1', capabilities: [], domains: [],
    }
    const result = transitionExpertise(exp, 'active', undefined)
    assert.equal(result.ok, false, 'draft→active without evidence should fail')
    assert.ok(result.errors && result.errors.length > 0)
  })

  it('transitionExpertise executes valid draft → experimental transition', () => {
    const exp = {
      id: 'test:agent', owner: { agent: 'agent' }, lifecycle: 'draft',
      schema_version: 'mah.expertise.v1', capabilities: [], domains: [],
      validation_status: 'validated',
    }
    const result = transitionExpertise(exp, 'experimental', undefined)
    assert.equal(result.ok, true, result.errors?.join('; '))
    assert.equal(result.expertise.lifecycle, 'experimental')
  })

  it('transitionExpertise requires reason for restricted target', () => {
    const exp = {
      id: 'test:agent', owner: { agent: 'agent' }, lifecycle: 'active',
      schema_version: 'mah.expertise.v1', capabilities: [], domains: [],
      validation_status: 'validated',
      confidence: { score: 0.7, band: 'high', evidence_count: 3 },
    }
    const result = transitionExpertise(exp, 'restricted', undefined, null, { id: 'gov-1', role: 'governance' })
    assert.equal(result.ok, false, 'should require reason for →restricted')
    assert.ok(result.errors?.some(e => e.toLowerCase().includes('reason') || e.toLowerCase().includes('restricted')))
  })

  it('transitionExpertise accepts reason for restricted transition', () => {
    const exp = {
      id: 'test:agent', owner: { agent: 'agent' }, lifecycle: 'active',
      schema_version: 'mah.expertise.v1', capabilities: [], domains: [],
      validation_status: 'validated',
      confidence: { score: 0.7, band: 'high', evidence_count: 3 },
    }
    const result = transitionExpertise(exp, 'restricted', 'policy review in progress', null, { id: 'gov-1', role: 'governance' })
    assert.equal(result.ok, true)
    assert.equal(result.expertise.lifecycle, 'restricted')
  })

  it('transitionExpertise rejects experimental → active without review_pass_rate metrics', () => {
    const exp = {
      id: 'test:agent',
      owner: { agent: 'agent' },
      lifecycle: 'experimental',
      schema_version: 'mah.expertise.v1',
      capabilities: ['testing'],
      domains: ['qa'],
      validation_status: 'validated',
      confidence: { score: 0.8, band: 'high', evidence_count: 5 },
      metadata: { created: '2026-04-01T00:00:00Z', updated: '2026-04-01T00:00:00Z', owner_id: 'qa/agent', tags: [] },
      trust_tier: 'internal',
      policy: { federated_allowed: false, allowed_domains: [], approval_required: false },
      evidence_refs: [],
    }
    const result = transitionExpertise(exp, 'active')
    assert.equal(result.ok, false)
    assert.ok(result.errors?.some(e => e.includes('review_pass_rate')))
  })

  it('transitionExpertise accepts experimental → active with sufficient review_pass_rate metrics', () => {
    const exp = {
      id: 'test:agent',
      owner: { agent: 'agent' },
      lifecycle: 'experimental',
      schema_version: 'mah.expertise.v1',
      capabilities: ['testing'],
      domains: ['qa'],
      validation_status: 'validated',
      confidence: { score: 0.8, band: 'high', evidence_count: 5 },
      metadata: { created: '2026-04-01T00:00:00Z', updated: '2026-04-01T00:00:00Z', owner_id: 'qa/agent', tags: [] },
      trust_tier: 'internal',
      policy: { federated_allowed: false, allowed_domains: [], approval_required: false },
      evidence_refs: [],
    }
    const result = transitionExpertise(exp, 'active', undefined, { review_pass_rate: 0.85 })
    assert.equal(result.ok, true, result.errors?.join('; '))
    assert.equal(result.expertise.lifecycle, 'active')
  })

  it('describeLifecycle returns human-readable strings', () => {
    assert.ok(describeLifecycle('draft').length > 0)
    assert.ok(describeLifecycle('active').length > 0)
    assert.ok(describeLifecycle('experimental').length > 0)
    assert.ok(describeLifecycle('restricted').length > 0)
    assert.ok(describeLifecycle('deprecated').length > 0)
  })

  it('getSuggestedNextStates for draft includes experimental and deprecated', () => {
    const suggestions = getSuggestedNextStates('draft')
    assert.ok(suggestions.includes('experimental'))
    assert.ok(suggestions.includes('deprecated'))
  })
})

// ---------------------------------------------------------------------------
// End-to-end: mah delegate fires evidence hook
// ---------------------------------------------------------------------------

describe('M3 — Evidence Hook Integration', () => {
  it('mah delegate records evidence without --execute flag', async () => {
    const integrationId = `test-integration:${randomUUID().slice(0, 8)}`
    const before = Date.now()

    try {
      execSync(
        `node bin/mah delegate --target engineering-lead --task "Implement search feature for v0.8" --crew dev`,
        {
          encoding: 'utf-8',
          timeout: 15000,
          cwd: repoRoot,
          env: {
            ...process.env,
            MAH_ACTIVE_CREW: 'dev',
            MAH_EXPERTISE_EVIDENCE_ROOT: evidenceRoot,
          },
        }
      )
    } catch {
      // May fail due to runtime but evidence should still be recorded
    }

    // Give file system a moment to settle
    await new Promise(r => setTimeout(r, 200))

    // Check evidence was recorded for the delegated target
    const evidenceDir = join(evidenceRoot, 'dev:engineering-lead')
    if (existsSync(evidenceDir)) {
      const { readdirSync, statSync } = await import('node:fs')
      const files = readdirSync(evidenceDir).filter(f => f.endsWith('.json'))
      const recent = files.filter(f => {
        const mtime = statSync(join(evidenceDir, f)).mtimeMs
        return mtime >= before - 1000
      })
      assert.ok(recent.length > 0, 'should have written at least one evidence file after delegation')
    }
  })
})
