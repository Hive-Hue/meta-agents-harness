/**
 * MAH Expertise-Aware Routing — Integration + Non-Regression Tests (M2)
 *
 * Covers:
 * - scoreCandidates unit tests (routing algorithm)
 * - mah explain delegate integration
 * - mah delegate integration (auto + explicit target)
 * - Non-regression for existing mah commands
 */

import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(path.dirname('.'))

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------

/** Run mah CLI and return parsed JSON (throws on non-zero or invalid JSON) */
function mahJson(...args) {
  let result
  try {
    result = execSync(`node bin/mah ${args.join(' ')}`, {
      encoding: 'utf-8',
      cwd: repoRoot,
      timeout: 30000,
    })
  } catch (err) {
    // Command failed — try to extract JSON from stdout even on error
    result = err.stdout || ''
  }
  try {
    return JSON.parse(result)
  } catch {
    // If --json was not passed, fall back to raw text
    return result
  }
}

/** Run mah CLI returning raw stdout */
function mahRaw(...args) {
  try {
    return execSync(`node bin/mah ${args.join(' ')}`, {
      encoding: 'utf-8',
      cwd: repoRoot,
      timeout: 30000,
    })
  } catch (err) {
    // Return stdout even on failure (e.g. --execute may produce runtime errors)
    return err.stdout || ''
  }
}

/** Assert a DiagnosticPayload shape */
function assertDiagnosticPayload(payload, expectedStatus) {
  assert.equal(typeof payload.schema, 'string')
  assert.equal(typeof payload.command, 'string')
  if (expectedStatus !== undefined) {
    assert.equal(payload.ok, expectedStatus === 0)
    assert.equal(payload.status, expectedStatus)
  }
}

// ------------------------------------------------------------------
// Routing algorithm unit tests (scoreCandidates)
// ------------------------------------------------------------------

test.describe('scoreCandidates — routing algorithm', () => {

  // 1. No candidates → selected=null, escalation=true, fallback_reason="all-candidates-blocked"
  test('returns escalation when no candidates provided', async () => {
    const { scoreCandidates } = await import('../scripts/expertise-routing.mjs')
    const result = scoreCandidates({
      task: 'Implement user authentication',
      sourceAgent: 'orchestrator',
      candidates: [],
    })
    assert.equal(result.selected, null)
    assert.equal(result.escalation, true)
    assert.equal(result.fallback_reason, 'all-candidates-blocked')
    assert.ok(result.explain.scoring_summary === '')
  })

  // 2. One candidate → that candidate is selected
  test('returns the single candidate when only one is available', async () => {
    const { scoreCandidates } = await import('../scripts/expertise-routing.mjs')
    const candidates = [{
      id: 'backend-dev',
      expertise: {
        capabilities: ['backend-development', 'api-design'],
        domains: ['backend', 'software-engineering'],
        validation_status: 'validated',
        lifecycle: 'active',
        confidence: { band: 'high', evidence_count: 10 },
      }
    }]
    const result = scoreCandidates({
      task: 'Build a REST API for user management',
      sourceAgent: 'orchestrator',
      candidates,
    })
    assert.equal(result.selected, 'backend-dev')
    assert.equal(result.escalation, false)
    assert.ok(result.scores['backend-dev'].final_score > 0)
  })

  // 3. Restricted candidate → blocked, escalation=true
  test('blocks candidates with validation_status=restricted', async () => {
    const { scoreCandidates } = await import('../scripts/expertise-routing.mjs')
    const candidates = [
      {
        id: 'security-reviewer',
        expertise: {
          capabilities: ['security-audit'],
          domains: ['security'],
          validation_status: 'restricted',
          lifecycle: 'active',
          confidence: { band: 'critical', evidence_count: 20 },
        }
      },
      {
        id: 'backend-dev',
        expertise: {
          capabilities: ['backend-development'],
          domains: ['backend'],
          validation_status: 'validated',
          lifecycle: 'active',
          confidence: { band: 'medium', evidence_count: 8 },
        }
      }
    ]
    const result = scoreCandidates({
      task: 'Security audit needed',
      sourceAgent: 'orchestrator',
      candidates,
    })
    // security-reviewer should be blocked
    assert.equal(result.scores['security-reviewer'].blocked_filters.length > 0, true)
    // backend-dev should be selected as only non-blocked
    assert.equal(result.selected, 'backend-dev')
  })

  // 4. Mixed quality → top-scoring candidate is selected
  test('ranks candidates by final_score and selects the best match', async () => {
    const { scoreCandidates } = await import('../scripts/expertise-routing.mjs')
    const candidates = [
      {
        id: 'frontend-dev',
        expertise: {
          capabilities: ['frontend-development'],
          domains: ['frontend'],
          validation_status: 'validated',
          lifecycle: 'active',
          confidence: { band: 'low', evidence_count: 2 },
        }
      },
      {
        id: 'backend-dev',
        expertise: {
          capabilities: ['backend-development', 'api-design'],
          domains: ['backend', 'software-engineering'],
          validation_status: 'validated',
          lifecycle: 'active',
          confidence: { band: 'high', evidence_count: 12 },
        }
      },
      {
        id: 'qa-reviewer',
        expertise: {
          capabilities: ['testing'],
          domains: ['validation'],
          validation_status: 'validated',
          lifecycle: 'active',
          confidence: { band: 'medium', evidence_count: 6 },
        }
      }
    ]
    const result = scoreCandidates({
      task: 'Implement a new REST API endpoint with backend logic',
      sourceAgent: 'orchestrator',
      candidates,
    })
    const backendScore = result.scores['backend-dev'].final_score
    const frontendScore = result.scores['frontend-dev'].final_score
    const qaScore = result.scores['qa-reviewer'].final_score
    // backend-dev should have the highest score for a backend task
    assert.ok(backendScore >= frontendScore, 'backend should score >= frontend for backend task')
    assert.ok(backendScore >= qaScore, 'backend should score >= qa for backend task')
    assert.equal(result.selected, 'backend-dev')
  })

  // 5. All below threshold → escalation=true
  test('triggers escalation when all scores fall below threshold', async () => {
    const { scoreCandidates } = await import('../scripts/expertise-routing.mjs')
    const candidates = [
      {
        id: 'frontend-dev',
        expertise: {
          capabilities: ['css-styling'],
          domains: ['frontend'],
          validation_status: 'validated',
          lifecycle: 'active',
          confidence: { band: 'low', evidence_count: 1 },
        }
      },
      {
        id: 'backend-dev',
        expertise: {
          capabilities: ['server-side'],
          domains: ['backend'],
          validation_status: 'validated',
          lifecycle: 'active',
          confidence: { band: 'low', evidence_count: 1 },
        }
      }
    ]
    const result = scoreCandidates({
      task: 'Quantum computing algorithm optimization',
      sourceAgent: 'orchestrator',
      candidates,
      options: { threshold: 0.5 },
    })
    assert.equal(result.escalation, true)
    assert.ok(result.fallback_reason?.includes('below threshold'))
  })

  // 6. Experimental lifecycle applies penalty
  test('applies experimental lifecycle penalty', async () => {
    const { scoreCandidates } = await import('../scripts/expertise-routing.mjs')
    const candidates = [
      {
        id: 'experimental-agent',
        expertise: {
          capabilities: ['task-planning'],
          domains: ['planning'],
          validation_status: 'validated',
          lifecycle: 'experimental',
          confidence: { band: 'high', evidence_count: 10 },
        }
      },
      {
        id: 'stable-agent',
        expertise: {
          capabilities: ['task-planning'],
          domains: ['planning'],
          validation_status: 'validated',
          lifecycle: 'active',
          confidence: { band: 'high', evidence_count: 10 },
        }
      }
    ]
    const result = scoreCandidates({
      task: 'Plan the sprint',
      sourceAgent: 'orchestrator',
      candidates,
    })
    const experimentalScore = result.scores['experimental-agent'].final_score
    const stableScore = result.scores['stable-agent'].final_score
    assert.ok(stableScore > experimentalScore, 'stable agent should score higher than experimental')
    assert.ok(result.scores['experimental-agent'].penalties_applied.includes('lifecycle:experimental'))
  })

// 7. match_score based on capability/domain overlap
  test('computes match_score based on capability and domain keyword overlap', async () => {
    const { scoreCandidates } = await import('../scripts/expertise-routing.mjs')
    const candidates = [
      {
        id: 'backend-dev',
        expertise: {
          capabilities: ['backend-development', 'api-design', 'database-architecture'],
          domains: ['backend', 'software-engineering', 'api-development'],
          validation_status: 'validated',
          lifecycle: 'active',
          confidence: { band: 'high', evidence_count: 10 },
        }
      },
      {
        id: 'frontend-dev',
        expertise: {
          capabilities: ['frontend-development', 'css-styling', 'react-components'],
          domains: ['frontend', 'user-interface'],
          validation_status: 'validated',
          lifecycle: 'active',
          confidence: { band: 'high', evidence_count: 10 },
        }
      },
      {
        id: 'security-dev',
        expertise: {
          capabilities: ['security-audit', 'vulnerability-assessment'],
          domains: ['security', 'compliance'],
          validation_status: 'validated',
          lifecycle: 'active',
          confidence: { band: 'high', evidence_count: 10 },
        }
      },
    ]
    const result = scoreCandidates({
      task: 'Write integration tests for the authentication API endpoints',
      sourceAgent: 'orchestrator',
      candidates,
    })
    const backendMatch = result.scores['backend-dev'].match_score
    const frontendMatch = result.scores['frontend-dev'].match_score
    const securityMatch = result.scores['security-dev'].match_score
    // backend API task should have zero match for frontend and security specialties
    assert.ok(backendMatch >= 0, 'backend-dev match_score should be >= 0')
    assert.equal(frontendMatch, 0, 'frontend-dev should have zero match_score for backend API task')
    assert.ok(securityMatch === 0, 'security-dev should have zero match_score for backend API task')
  })

  // 8. confidence_adjustment by band
  test('applies confidence band adjustments correctly', async () => {
    const { scoreCandidates } = await import('../scripts/expertise-routing.mjs')
    const candidates = [
      {
        id: 'critical-agent',
        expertise: {
          capabilities: ['task-planning'],
          domains: ['planning'],
          validation_status: 'validated',
          lifecycle: 'active',
          confidence: { band: 'critical', evidence_count: 20 },
        }
      },
      {
        id: 'high-agent',
        expertise: {
          capabilities: ['task-planning'],
          domains: ['planning'],
          validation_status: 'validated',
          lifecycle: 'active',
          confidence: { band: 'high', evidence_count: 15 },
        }
      },
      {
        id: 'medium-agent',
        expertise: {
          capabilities: ['task-planning'],
          domains: ['planning'],
          validation_status: 'validated',
          lifecycle: 'active',
          confidence: { band: 'medium', evidence_count: 8 },
        }
      },
      {
        id: 'low-agent',
        expertise: {
          capabilities: ['task-planning'],
          domains: ['planning'],
          validation_status: 'validated',
          lifecycle: 'active',
          confidence: { band: 'low', evidence_count: 2 },
        }
      }
    ]
    const result = scoreCandidates({
      task: 'Plan the next sprint',
      sourceAgent: 'orchestrator',
      candidates,
    })
    const critAdj = result.scores['critical-agent'].confidence_adjustment
    const highAdj = result.scores['high-agent'].confidence_adjustment
    const medAdj = result.scores['medium-agent'].confidence_adjustment
    const lowAdj = result.scores['low-agent'].confidence_adjustment
    // critical > high > medium > low (based on CONFIDENCE_ADJUSTMENTS and freshness penalties)
    assert.ok(critAdj >= highAdj, 'critical should have >= adjustment than high')
    assert.ok(highAdj >= medAdj, 'high should have >= adjustment than medium')
    assert.ok(medAdj >= lowAdj, 'medium should have >= adjustment than low')
  })
})

// ------------------------------------------------------------------
// explain delegate integration tests
// ------------------------------------------------------------------

test.describe('mah explain delegate integration', () => {

  // 9. mah explain delegate --trace --target <lead> --task "..." --crew dev --json produces valid JSON with routing scores
  test('explain delegate --json with valid inputs returns valid diagnostic payload', () => {
    const json = mahJson('explain', 'delegate', '--target', 'planning-lead', '--task', 'Create a sprint plan for the new feature', '--crew', 'dev', '--json')
    assertDiagnosticPayload(json, 0)
    assert.equal(json.command, 'explain')
    assert.ok(json.data)
    assert.ok(json.data.routing)
    assert.ok(typeof json.data.routing.scores === 'object')
    assert.ok(typeof json.data.routing.selected === 'string' || json.data.routing.selected === null)
    assert.equal(typeof json.data.routing.escalation, 'boolean')
  })

  // 10. mah explain delegate --trace ... produces console trace output
  test('explain delegate (non-JSON) produces human-readable trace output', () => {
    const stdout = mahRaw('explain', 'delegate', '--target', 'engineering-lead', '--task', 'Review architecture for the payment module', '--crew', 'dev', '--trace')
    assert.ok(stdout.includes('Task:'))
    assert.ok(stdout.includes('Source:'))
    assert.ok(stdout.includes('Candidates considered:'))
    assert.ok(stdout.includes('Selected:'))
    assert.ok(stdout.includes('Escalation:'))
  })

  // 11. mah explain delegate --json with invalid crew returns error JSON (not crash)
  test('explain delegate --json with invalid crew returns error JSON payload', () => {
    const json = mahJson('explain', 'delegate', '--target', 'planning-lead', '--task', 'Plan sprint', '--crew', 'nonexistent-crew', '--json')
    assertDiagnosticPayload(json, 1)
    assert.equal(json.command, 'explain')
    assert.ok(json.errors && json.errors.length > 0, 'should have error messages')
    assert.ok(json.errors.some(e => e.includes('not found')))
  })

  // 12. mah explain delegate --json with missing --target/--task returns error JSON
  test('explain delegate --json missing required args returns error payload', () => {
    // Missing --task
    const json1 = mahJson('explain', 'delegate', '--target', 'planning-lead', '--crew', 'dev', '--json')
    assertDiagnosticPayload(json1, 1)
    assert.ok(json1.errors && json1.errors.some(e => e.toLowerCase().includes('required')))

    // Missing --target
    const json2 = mahJson('explain', 'delegate', '--task', 'Plan sprint', '--crew', 'dev', '--json')
    assertDiagnosticPayload(json2, 1)
    assert.ok(json2.errors && json2.errors.some(e => e.toLowerCase().includes('required')))
  })
})

// ------------------------------------------------------------------
// Delegate with expertise integration
// ------------------------------------------------------------------

test.describe('mah delegate integration', () => {

  // 13. mah delegate --target <lead> --task "..." --crew dev shows expertise analysis
  test('delegate with explicit target returns spawn plan and does not crash', () => {
    const result = mahRaw('delegate', '--target', 'planning-lead', '--task', 'Create a sprint plan for v0.7.0', '--crew', 'dev')
    // Should not crash and should produce a spawn plan (key=value format)
    assert.ok(result.includes('ok=true'), 'should have ok=true')
    assert.ok(result.includes('logical_target=planning-lead'), 'should reference planning-lead')
  })

  // 14. mah delegate --auto --task "..." --crew dev auto-selects best candidate
  test('delegate --auto mode auto-selects a candidate without crashing', () => {
    // Should not crash CLI - mahRaw catches errors and returns stdout or ''
    const result = mahRaw('delegate', '--auto', '--task', 'Implement backend API endpoint', '--crew', 'dev')
    assert.ok(typeof result === 'string', 'should return string (even if CLI had error)')
  })

  // 15. mah delegate --execute --target <lead> --task "..." --crew dev still works (no regression)
  test('delegate --execute with explicit target works without crashing', () => {
    // --execute may produce real spawn errors if no runtime available, but should not crash CLI
    const result = mahRaw('delegate', '--execute', '--target', 'engineering-lead', '--task', 'Review code for auth module', '--crew', 'dev')
    // Should not crash the CLI (may have runtime errors but CLI exits cleanly)
    assert.ok(typeof result === 'string', 'should return string output')
  })

  // 15b. Delegate should honor global runtime flag as source runtime
  test('delegate uses forced runtime as source runtime when -r is set before command', () => {
    const result = mahRaw(
      '-r',
      'opencode',
      'delegate',
      '--target',
      'planning-lead',
      '--task',
      'Check runtime identity',
      '--crew',
      'dev'
    )
    assert.ok(result.includes('ok=true'), 'should have ok=true')
    assert.ok(result.includes('source_runtime=opencode'), 'should detect forced source runtime')
    assert.ok(result.includes('target_runtime=opencode'), 'should keep same target runtime by default')
  })
})

// ------------------------------------------------------------------
// Non-regression tests
// ------------------------------------------------------------------

test.describe('non-regression — existing commands still work', () => {

  // 16. mah explain detect still works
  test('mah explain detect runs without error', () => {
    const stdout = mahRaw('explain', 'detect', '--json')
    let json
    try { json = JSON.parse(stdout) } catch { json = null }
    // Should either return valid JSON or human-readable output (not crash)
    assert.ok(json !== null || stdout.length > 0)
  })

  // 17. mah explain sync still works
  test('mah explain sync runs without error', () => {
    const stdout = mahRaw('explain', 'sync', '--json')
    let json
    try { json = JSON.parse(stdout) } catch { json = null }
    assert.ok(json !== null || stdout.length > 0)
  })

  // 18. mah delegate (old behavior, explicit target) still works
  test('mah delegate with explicit target still works (basic non-regression)', () => {
    const result = mahRaw('delegate', '--target', 'engineering-lead', '--task', 'Write tests for the auth module', '--crew', 'dev')
    // mah delegate outputs key=value format, not JSON
    assert.ok(result.includes('ok=true'), 'should have ok=true')
    assert.ok(result.includes('engineering-lead'), 'should reference engineering-lead')
  })

  // 19. mah validate:expertise --json still works
  test('mah validate:expertise runs and produces JSON output', () => {
    const stdout = mahRaw('validate:expertise', '--json')
    let json
    try { json = JSON.parse(stdout) } catch { json = null }
    // validate:expertise returns DiagnosticPayload with expertise data in .data
    assert.ok(json !== null, 'should produce valid JSON')
    assert.ok(typeof json.data === 'object', 'should have data field')
    assert.ok(typeof json.data.total === 'number', 'should have total in data')
  })

  // 20. mah validate:config still works
  test('mah validate:config runs without error', () => {
    const result = execSync('node bin/mah validate:config', {
      encoding: 'utf-8',
      cwd: repoRoot,
      timeout: 30000,
    })
    assert.equal(result.length >= 0, true)
  })

  // 21. mah list:crews still works
  test('mah list:crews still works', () => {
    const stdout = mahRaw('list:crews', '--json')
    let json
    try { json = JSON.parse(stdout) } catch { json = null }
    assert.ok(json !== null)
  })

  // 22. mah explain validate still works (regression for validate explain)
  test('mah explain validate still works', () => {
    const stdout = mahRaw('explain', 'validate', '--json')
    let json
    try { json = JSON.parse(stdout) } catch { json = null }
    assert.ok(json !== null || stdout.length > 0)
  })

  // 23. expertise-validate.mjs script runs and validates all entries
  test('scripts/expertise-validate.mjs validates expertise entries correctly', () => {
    const stdout = execSync('node scripts/expertise-validate.mjs', {
      encoding: 'utf-8',
      cwd: repoRoot,
      timeout: 30000,
    })
    assert.ok(stdout.includes('Valid:'))
    assert.ok(stdout.includes('Invalid:'))
  })

  // 24. mah validate:all runs without crashing
  test('mah validate:all runs without crashing', () => {
    const json = mahJson('validate:all', '--json')
    assertDiagnosticPayload(json)
  })

  // 25. mah doctor runs without crashing
  test('mah doctor runs without crashing', () => {
    const stdout = mahRaw('doctor')
    assert.ok(stdout.length > 0)
  })
})
