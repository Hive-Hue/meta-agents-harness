/**
 * Proposal governance tests for MAH Expertise Engine
 */

import { describe, it, after } from 'node:test'
import assert from 'node:assert'
import { execSync } from 'node:child_process'
import { rmSync, existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const repoRoot = process.cwd()
const mah = 'node bin/mah'

const {
  buildExpertiseProposal,
  writeProposalToFile,
  validateProposalPayload,
} = await import('../scripts/expertise-proposal.mjs')
const { loadExpertiseById } = await import('../scripts/expertise-loader.mjs')
const { recordEvidence } = await import('../scripts/expertise-evidence-store.mjs')

const evidenceRoot = mkdtempSync(join(tmpdir(), 'mah-expertise-proposal-evidence-'))

function runExpertise(args, envOverrides = {}) {
  try {
    const stdout = execSync(`${mah} ${args}`, {
      encoding: 'utf-8',
      timeout: 15000,
      cwd: repoRoot,
      env: {
        ...process.env,
        MAH_ACTIVE_CREW: 'dev',
        MAH_AGENT: 'planning-lead',
        MAH_EXPERTISE_EVIDENCE_ROOT: evidenceRoot,
        ...envOverrides,
      },
    })
    return { stdout, stderr: '', status: 0 }
  } catch (err) {
    return {
      stdout: err.stdout?.toString() || '',
      stderr: err.stderr?.toString() || '',
      status: err.status || 1,
    }
  }
}

describe('proposal generator', () => {
  it('creates a proposal for a lead actor', async () => {
    const target = await loadExpertiseById('dev:backend-dev')
    const result = buildExpertiseProposal({
      targetExpertise: target,
      actor: { agent: 'planning-lead', role: 'lead', team: 'dev' },
      summary: 'Promote backend-dev after v0.7.0 seed stabilization',
      rationale: 'The backend worker now reflects validated routing and evidence pipeline behavior.',
      proposedChanges: {
        validation_status: 'validated',
        confidence: { score: 0.9, band: 'high', evidence_count: 6 },
      },
      evidenceRefs: ['ev-001', 'ev-002'],
      reviewers: ['validation-lead', 'security-reviewer'],
    })

    assert.ok(result.ok)
    assert.equal(result.proposal.proposal_version, 'mah.expertise.proposal.v1')
    assert.equal(result.proposal.target_expertise_id, 'dev:backend-dev')
    assert.equal(result.proposal.generated_by.role, 'lead')
    assert.equal(result.proposal.summary, 'Promote backend-dev after v0.7.0 seed stabilization')
    assert.equal(result.proposal.proposed_changes.validation_status, 'validated')
  })

  it('rejects worker actors from generating proposals', async () => {
    const target = await loadExpertiseById('dev:backend-dev')
    const result = buildExpertiseProposal({
      targetExpertise: target,
      actor: { agent: 'backend-dev', role: 'worker', team: 'dev' },
      summary: 'Should not be allowed',
    })

    assert.equal(result.ok, false)
    assert.ok(result.error.includes('restricted to orchestrator/leads'))
  })

  it('writes proposal artifacts to disk', async () => {
    const target = await loadExpertiseById('dev:backend-dev')
    const proposalResult = buildExpertiseProposal({
      targetExpertise: target,
      actor: { agent: 'orchestrator', role: 'orchestrator', team: 'dev' },
      summary: 'Write proposal artifact for backend-dev',
      proposedChanges: { lifecycle: 'active' },
    })
    assert.ok(proposalResult.ok)

    const output = '.mah/expertise/proposals/test-proposal.json'
    const writeResult = writeProposalToFile(proposalResult.proposal, output)
    assert.ok(writeResult.ok)
    assert.ok(existsSync(writeResult.path))
    const payload = JSON.parse(readFileSync(writeResult.path, 'utf-8'))
    const validation = validateProposalPayload(payload)
    assert.ok(validation.valid)
    assert.equal(payload.generated_by.role, 'orchestrator')
    rmSync(writeResult.path, { force: true })
  })

  it('derives a draft proposal from evidence automatically', async () => {
    await recordEvidence({
      expertise_id: 'dev:backend-dev',
      outcome: 'success',
      task_type: 'code-generation',
      task_description: 'implement routing updates for expertise proposal flow',
      duration_ms: 1200,
      quality_signals: { review_pass: true, rejection_count: 0 },
      source_agent: 'backend-dev',
      source_session: 'proposal-test',
      recorded_at: '2026-04-16T10:00:00.000Z',
    }, { evidenceRoot })
    await recordEvidence({
      expertise_id: 'dev:backend-dev',
      outcome: 'success',
      task_type: 'testing',
      task_description: 'validate proposal generation from evidence',
      duration_ms: 900,
      quality_signals: { review_pass: true, rejection_count: 0 },
      source_agent: 'qa-reviewer',
      source_session: 'proposal-test',
      recorded_at: '2026-04-16T10:05:00.000Z',
    }, { evidenceRoot })
    await recordEvidence({
      expertise_id: 'dev:backend-dev',
      outcome: 'success',
      task_type: 'review',
      task_description: 'approve evidence-backed backend updates',
      duration_ms: 800,
      quality_signals: { review_pass: true, rejection_count: 0 },
      source_agent: 'validation-lead',
      source_session: 'proposal-test',
      recorded_at: '2026-04-16T10:10:00.000Z',
    }, { evidenceRoot })

    const { stdout, status } = runExpertise('expertise propose dev:backend-dev --from-evidence --json')
    assert.equal(status, 0)
    const data = JSON.parse(stdout)
    assert.equal(data.target_expertise_id, 'dev:backend-dev')
    assert.ok(data.summary.includes('Draft proposal based on'))
    assert.ok(data.rationale.includes('recent evidence event'))
    assert.ok(data.evidence_refs.length >= 3)
    assert.ok(data.proposed_changes.confidence)
  })
})

describe('proposal CLI', () => {
  it('generates a proposal from the CLI for a lead actor', () => {
    const { stdout, status } = runExpertise(
      `expertise propose dev:backend-dev --summary "Promote backend-dev" --changes '{"validation_status":"validated"}' --json`
    )

    assert.equal(status, 0)
    const data = JSON.parse(stdout)
    assert.equal(data.target_expertise_id, 'dev:backend-dev')
    assert.equal(data.generated_by.role, 'lead')
    assert.equal(data.proposed_changes.validation_status, 'validated')
  })

  it('writes the proposal to a safe output path', () => {
    const output = '.mah/expertise/proposals/test-backend-dev.json'
    try {
      const { stdout, status } = runExpertise(
        `expertise propose dev:backend-dev --summary "Write proposal" --changes '{"validation_status":"validated"}' --output ${output}`
      )
      assert.equal(status, 0)
      assert.ok(stdout.includes('Proposal written') || stdout.includes('✓ Proposal written'))
      assert.ok(existsSync(join(repoRoot, output)))
    } finally {
      rmSync(join(repoRoot, output), { force: true })
    }
  })
})

after(() => {
  rmSync(evidenceRoot, { recursive: true, force: true })
})
