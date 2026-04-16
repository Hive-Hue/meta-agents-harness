/**
 * M4 — Registry + Operator UX (CLI) Integration Tests
 */

import { describe, it } from 'node:test'
import assert from 'node:assert'
import { execSync } from 'node:child_process'

const repoRoot = process.cwd()
const mah = 'node bin/mah'

/**
 * Run a mah expertise command and return { stdout, stderr, status }.
 * @param {string} args
 */
function runExpertise(args) {
  try {
    const stdout = execSync(`${mah} ${args}`, {
      encoding: 'utf-8',
      timeout: 15000,
      cwd: repoRoot,
      env: { ...process.env, MAH_ACTIVE_CREW: 'dev' }
    })
    return { stdout, stderr: '', status: 0 }
  } catch (err) {
    return {
      stdout: err.stdout?.toString() || '',
      stderr: err.stderr?.toString() || '',
      status: err.status || 1
    }
  }
}

// ---------------------------------------------------------------------------
// expertise list
// ---------------------------------------------------------------------------

describe('M4 — expertise list', () => {
  it('lists expertise entries with tabular output', () => {
    const { stdout, status } = runExpertise('expertise list --crew dev')
    assert.equal(status, 0)
    assert.ok(stdout.includes('=== Expertise Catalog'))
    assert.ok(stdout.includes('dev:backend-dev'))
    assert.ok(stdout.includes('dev:planning-lead'))
    assert.ok(stdout.includes('dev:validation-lead'))
    assert.ok(stdout.includes('9 expertise entries'))
  })

  it('outputs JSON when --json is passed', () => {
    const { stdout, status } = runExpertise('expertise list --crew dev --json')
    assert.equal(status, 0)
    const data = JSON.parse(stdout)
    assert.ok(Array.isArray(data.expertise))
    assert.ok(data.count > 0)
  })

  it('shows lifecycle and validation status columns', () => {
    const { stdout } = runExpertise('expertise list --crew dev')
    // Should show lifecycle badges and validation badges
    assert.ok(stdout.includes('Lifecycle') || stdout.includes('active') || stdout.includes('draft'))
  })
})

// ---------------------------------------------------------------------------
// expertise show
// ---------------------------------------------------------------------------

describe('M4 — expertise show', () => {
  it('shows detailed expertise for valid id', () => {
    const { stdout, status } = runExpertise('expertise show dev:backend-dev')
    assert.equal(status, 0)
    assert.ok(stdout.includes('=== Expertise: dev:backend-dev ==='))
    assert.ok(stdout.includes('Lifecycle'))
    assert.ok(stdout.includes('Validation'))
    assert.ok(stdout.includes('Confidence'))
    assert.ok(stdout.includes('Environments: development'))
  })

  it('shows expertise even without colons', () => {
    const { stdout, status } = runExpertise('expertise show backend-dev')
    assert.equal(status, 0)
    assert.ok(stdout.includes('=== Expertise:'))
  })

  it('returns error for non-existent expertise', () => {
    const { status } = runExpertise('expertise show nonexistent:agent-xyz')
    assert.notEqual(status, 0)
  })

  it('outputs JSON when --json is passed', () => {
    const { stdout, status } = runExpertise('expertise show dev:backend-dev --json')
    assert.equal(status, 0)
    const data = JSON.parse(stdout)
    assert.ok(data.expertise)
    assert.equal(data.expertise.id, 'dev:backend-dev')
    assert.deepEqual(data.expertise.allowed_environments, ['development'])
  })
})

// ---------------------------------------------------------------------------
// expertise recommend
// ---------------------------------------------------------------------------

describe('M4 — expertise recommend', () => {
  it('recommends a candidate for a coding task', () => {
    const { stdout, status } = runExpertise("expertise recommend --task 'implement user authentication API'")
    assert.equal(status, 0)
    assert.ok(stdout.includes('=== Expertise Recommendation ==='))
    assert.ok(stdout.includes('Task:'))
    assert.ok(stdout.includes('Candidates'))
  })

  it('escalates when all scores are below threshold', () => {
    const { stdout, status } = runExpertise("expertise recommend --task 'implement user authentication API'")
    assert.equal(status, 0)
    // With no evidence yet, scores should be low → escalation
    assert.ok(stdout.includes('Escalation') || stdout.includes('0.000'))
  })

  it('returns error when no task is provided', () => {
    const { status } = runExpertise('expertise recommend')
    assert.notEqual(status, 0)
  })

  it('outputs JSON when --json is passed', () => {
    const { stdout, status } = runExpertise("expertise recommend --task 'implement API' --json")
    assert.equal(status, 0)
    const data = JSON.parse(stdout)
    assert.ok(data.task)
    assert.ok('selected' in data)
    assert.ok('scores' in data)
    assert.ok('escalation' in data)
  })
})

// ---------------------------------------------------------------------------
// expertise evidence
// ---------------------------------------------------------------------------

describe('M4 — expertise evidence', () => {
  it('shows evidence events for orchestrator expertise', () => {
    const { stdout, status } = runExpertise('expertise evidence dev:orchestrator')
    assert.equal(status, 0)
    assert.ok(stdout.includes('=== Evidence: dev:orchestrator ==='))
    assert.ok(stdout.includes('event(s)'))
    assert.ok(stdout.includes('Time') || stdout.includes('Outcome'))
  })

  it('respects --limit option', () => {
    const { stdout, status } = runExpertise('expertise evidence dev:orchestrator --limit 2')
    assert.equal(status, 0)
    // Should show up to 2 events
    assert.ok(stdout.includes('event(s)'))
  })

  it('shows message for non-existent expertise', () => {
    const { stdout, status } = runExpertise('expertise evidence nonexistent:agent-xyz')
    assert.equal(status, 0) // exits 0 but shows no events
    assert.ok(stdout.includes('No evidence events'))
  })

  it('outputs JSON when --json is passed', () => {
    const { stdout, status } = runExpertise('expertise evidence dev:orchestrator --json')
    assert.equal(status, 0)
    const data = JSON.parse(stdout)
    assert.ok(Array.isArray(data.events))
    assert.ok('count' in data)
  })
})

// ---------------------------------------------------------------------------
// expertise explain
// ---------------------------------------------------------------------------

describe('M4 — expertise explain', () => {
  it('shows full routing decision trace', () => {
    const { stdout, status } = runExpertise("expertise explain --task 'implement search feature'")
    assert.equal(status, 0)
    assert.ok(stdout.includes('=== Expertise Routing Trace ==='))
    assert.ok(stdout.includes('Task:'))
    assert.ok(stdout.includes('Decision Filters'))
    assert.ok(stdout.includes('Scoring Breakdown'))
    assert.ok(stdout.includes('Decision'))
  })

  it('shows scoring breakdown for each candidate', () => {
    const { stdout, status } = runExpertise("expertise explain --task 'implement search feature'")
    assert.equal(status, 0)
    assert.ok(stdout.includes('expertise_match'))
    assert.ok(stdout.includes('final:'))
    assert.ok(!stdout.includes('expertise_match: —'))
  })

  it('shows escalation when score below threshold', () => {
    const { stdout, status } = runExpertise("expertise explain --task 'implement search feature'")
    assert.equal(status, 0)
    assert.ok(stdout.includes('ESCALATION') || stdout.includes('Escalation'))
  })

  it('outputs JSON when --json is passed', () => {
    const { stdout, status } = runExpertise("expertise explain --task 'implement search' --json")
    assert.equal(status, 0)
    const data = JSON.parse(stdout)
    assert.ok(data.routing)
    assert.ok(data.explain)
    assert.ok(Array.isArray(data.explain.filters_run))
    const firstScore = Object.values(data.routing.scores)[0]
    assert.ok(firstScore && 'match_score' in firstScore)
  })
})

// ---------------------------------------------------------------------------
// validate:expertise --owner
// ---------------------------------------------------------------------------

describe('M4 — validate:expertise owner filter', () => {
  it('filters canonical expertise entries by owner agent', () => {
    const { stdout, status } = runExpertise('validate:expertise --json --owner backend-dev')
    assert.equal(status, 0)
    const data = JSON.parse(stdout)
    assert.equal(data.data.total, 1)
    assert.equal(data.data.valid, 1)
    assert.equal(data.data.results[0].id, 'dev:backend-dev')
  })
})

// ---------------------------------------------------------------------------
// expertise export
// ---------------------------------------------------------------------------

describe('M4 — expertise export', () => {
  it('exports canonical expertise fields to stdout JSON', () => {
    const { stdout, status } = runExpertise('expertise export dev:backend-dev --json')
    assert.equal(status, 0)
    const data = JSON.parse(stdout)
    assert.deepEqual(data.allowed_environments, ['development'])
    assert.ok(data.metadata?.created)
    assert.ok(!data.metadata?.owner_id)
  })
})

// ---------------------------------------------------------------------------
// expertise --help
// ---------------------------------------------------------------------------

describe('M4 — expertise --help', () => {
  it('shows usage help', () => {
    const { stdout, status } = runExpertise('expertise --help')
    assert.equal(status, 0)
    assert.ok(stdout.includes('mah expertise'))
    assert.ok(stdout.includes('list'))
    assert.ok(stdout.includes('show'))
    assert.ok(stdout.includes('recommend'))
    assert.ok(stdout.includes('evidence'))
    assert.ok(stdout.includes('explain'))
  })

  it('shows help without subcommand', () => {
    const { stdout, status } = runExpertise('expertise')
    assert.equal(status, 0)
    assert.ok(stdout.includes('mah expertise'))
  })
})

// ---------------------------------------------------------------------------
// expertise unknown subcommand
// ---------------------------------------------------------------------------

describe('M4 — expertise unknown subcommand', () => {
  it('returns error for unknown subcommand', () => {
    const { status } = runExpertise('expertise unknown-subcommand')
    assert.notEqual(status, 0)
  })
})
