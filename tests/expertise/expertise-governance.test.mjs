import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stringify as stringifyYaml } from 'yaml'

test('apply-proposal with valid proposal → catalog updated', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mah-test-'))
  const proposal = {
    proposal_version: 'mah.expertise.proposal.v1',
    id: 'test-proposal-1',
    status: 'approved',
    generated_at: new Date().toISOString(),
    generated_by: { actor: 'orchestrator', role: 'orchestrator', team: 'dev' },
    governance: { generated_by_roles: ['orchestrator'], review_required_by: [], auto_apply: false },
    target_expertise_id: 'dev:backend-dev',
    target_owner: { agent: 'backend-dev' },
    target_snapshot: { lifecycle: 'active' },
    proposed_changes: { validation_status: 'validated' },
    summary: 'test',
    rationale: 'test',
    evidence_refs: [],
    reviewers: [],
    source: { catalog_path: null },
  }
  const proposalsRoot = join(process.cwd(), '.mah', 'expertise', 'proposals')
  mkdirSync(proposalsRoot, { recursive: true })
  const p = join(proposalsRoot, `test-proposal-${Date.now()}-1.yaml`)
  writeFileSync(p, stringifyYaml(proposal), 'utf-8')

  const { applyProposalFromFile } = await import('../../scripts/expertise/expertise-apply-proposal.mjs')
  const result = await applyProposalFromFile(p, { force: true, actor: 'orchestrator' })

  assert.equal(result.ok, true)
  rmSync(p, { force: true })
  rmSync(tmp, { recursive: true, force: true })
})

test('apply-proposal with unauthorized actor → rejected', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mah-test-'))
  const proposal = {
    proposal_version: 'mah.expertise.proposal.v1',
    id: 'test-proposal-2',
    status: 'approved',
    generated_at: new Date().toISOString(),
    generated_by: { actor: 'orchestrator', role: 'orchestrator', team: 'dev' },
    governance: { generated_by_roles: ['orchestrator'], review_required_by: [], auto_apply: false },
    target_expertise_id: 'dev:backend-dev',
    target_owner: { agent: 'backend-dev' },
    target_snapshot: { lifecycle: 'active' },
    proposed_changes: { validation_status: 'validated' },
    summary: 'test',
    rationale: 'test',
    evidence_refs: [],
    reviewers: [],
    source: { catalog_path: null },
  }
  const proposalsRoot = join(process.cwd(), '.mah', 'expertise', 'proposals')
  mkdirSync(proposalsRoot, { recursive: true })
  const p = join(proposalsRoot, `test-proposal-${Date.now()}-2.yaml`)
  writeFileSync(p, stringifyYaml(proposal), 'utf-8')

  const { applyProposalFromFile } = await import('../../scripts/expertise/expertise-apply-proposal.mjs')
  const result = await applyProposalFromFile(p, { actor: 'frontend-dev' })

  assert.equal(result.ok, false)
  assert.match(result.error, /not authorized/)
  rmSync(p, { force: true })
  rmSync(tmp, { recursive: true, force: true })
})

test('lifecycle invalid transition (active→validated) → blocked', async () => {
  const { transitionLifecycle } = await import('../../scripts/expertise/expertise-lifecycle-cli.mjs')
  const result = await transitionLifecycle('dev:backend-dev', 'validated', { actor: 'orchestrator' })
  assert.equal(result.ok, false)
})

test('lifecycle invalid transition (deprecated→active) style blocked for backend-dev', async () => {
  const { transitionLifecycle } = await import('../../scripts/expertise/expertise-lifecycle-cli.mjs')
  const result = await transitionLifecycle('dev:backend-dev', 'active', { actor: 'orchestrator' })
  assert.equal(result.ok, false)
})

test('export --with-evidence → payload includes evidence_summary', async () => {
  const { exportExpertise } = await import('../../scripts/expertise/expertise-export.mjs')
  const { loadExpertiseById } = await import('../../scripts/expertise/expertise-loader.mjs')

  const entry = await loadExpertiseById('dev:backend-dev')
  assert.ok(entry)

  const result = await exportExpertise(entry, { includeEvidence: true, skipPolicy: true })
  assert.equal(result.ok, true)
  assert.ok(result.payload.evidence_summary)
  assert.equal(typeof result.payload.evidence_summary.total_invocations, 'number')
})

test('export without flag → no evidence_summary (backward compat)', async () => {
  const { exportExpertise } = await import('../../scripts/expertise/expertise-export.mjs')
  const { loadExpertiseById } = await import('../../scripts/expertise/expertise-loader.mjs')

  const entry = await loadExpertiseById('dev:backend-dev')
  const result = await exportExpertise(entry, { skipPolicy: true })
  assert.equal(result.ok, true)
  assert.equal(result.payload.evidence_summary, undefined)
})
