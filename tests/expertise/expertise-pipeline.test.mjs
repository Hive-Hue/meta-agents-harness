/**
 * MAH Expertise Pipeline Test
 * End-to-end: seed → evidence → sync → apply-proposal → lifecycle → export --with-evidence
 */

import { test, before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { join } from 'node:path'
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, cpSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { seedExpertiseCatalog } from '../../scripts/expertise/expertise-seed.mjs'
import { syncExpertise } from '../../scripts/expertise/expertise-sync.mjs'
import { buildRegistry } from '../../scripts/expertise/expertise-registry.mjs'
import { generateProposalFromEvidenceById } from '../../scripts/expertise/expertise-proposal.mjs'
import { applyProposalFromFile } from '../../scripts/expertise/expertise-apply-proposal.mjs'
import { transitionLifecycle } from '../../scripts/expertise/expertise-lifecycle-cli.mjs'
import { exportExpertise } from '../../scripts/expertise/expertise-export.mjs'
import { recordEvidence } from '../../scripts/expertise/evidence/expertise-evidence-store.mjs'
import { loadExpertiseById } from '../../scripts/expertise/expertise-loader.mjs'

const tmpDir = join(process.env.TEMP || '/tmp', `mah-pipeline-test-${process.pid}`)
const catalogRoot = join(tmpDir, '.mah', 'expertise', 'catalog')
const evidenceRoot = join(tmpDir, '.mah', 'expertise', 'evidence')

// Snapshot real catalog before any test runs
const REAL_CATALOG = join(process.cwd(), '.mah', 'expertise', 'catalog', 'dev')
const realCatalogFiles = {}
for (const fname of ['backend-dev.yaml', 'frontend-dev.yaml']) {
  const fpath = join(REAL_CATALOG, fname)
  if (existsSync(fpath)) realCatalogFiles[fname] = readFileSync(fpath, 'utf-8')
}

beforeEach(() => {
  mkdirSync(catalogRoot, { recursive: true })
  mkdirSync(evidenceRoot, { recursive: true })
})

// Restore real catalog after each test so sync tests aren't polluted
afterEach(() => {
  for (const [fname, content] of Object.entries(realCatalogFiles)) {
    writeFileSync(join(REAL_CATALOG, fname), content, 'utf-8')
  }
})

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true }) } catch { /* clean up */ }
})

// ---------------------------------------------------------------------------
// Test 1: Full pipeline
// ---------------------------------------------------------------------------
test('Full pipeline: seed → evidence → sync → apply-proposal → export --with-evidence', async () => {
  // 1. Seed catalog for dev crew into temp dir
  const seedResult = await seedExpertiseCatalog(null, {
    crew: 'dev',
    force: true,
    catalogRoot,
  })
  assert.ok(seedResult.seeded > 0, `expected some seeded entries, got ${seedResult.seeded}`)

  // 2. Record 5 evidence events for dev:backend-dev (4 success, 1 failure)
  const expertId = 'dev:backend-dev'
  const evidenceEvents = [
    { outcome: 'success', task_type: 'api-implementation', duration_ms: 1200, review_pass: true },
    { outcome: 'success', task_type: 'api-design', duration_ms: 900, review_pass: true },
    { outcome: 'failure', task_type: 'database-migration', duration_ms: 3000, review_pass: false },
    { outcome: 'success', task_type: 'code-review', duration_ms: 600, review_pass: true },
    { outcome: 'success', task_type: 'implementation', duration_ms: 1500, review_pass: true },
  ]
  for (const ev of evidenceEvents) {
    const result = await recordEvidence({
      expertise_id: expertId,
      ...ev,
      source_agent: 'orchestrator',
      source_session: `pipeline-test-${Date.now()}`,
    }, { evidenceRoot })
    assert.ok(result.ok, `recordEvidence failed: ${result.error}`)
  }

  // 3. Sync — verify confidence updated, capabilities present
  const syncResult = await syncExpertise({ crew: 'dev', dryRun: false, catalogRoot, evidenceRoot })
  assert.ok(syncResult.results.length > 0, 'sync should produce results')

  const backendEntry = await loadExpertiseById(expertId, { catalogRoot })
  assert.ok(backendEntry, 'backend-dev entry should exist in catalog')
  assert.ok(Array.isArray(backendEntry.capabilities) && backendEntry.capabilities.length > 0, 'capabilities should be populated')

  const confidence = backendEntry.confidence
  assert.ok(confidence, 'confidence should be set')
  // After evidence sync, confidence should reflect real invocations
  assert.ok(confidence.evidence_count >= 4, `expected evidence_count >= 4, got ${confidence.evidence_count}`)

  // 4. Generate proposal from evidence for dev:backend-dev
  const proposalResult = await generateProposalFromEvidenceById({
    targetId: expertId,
    crew: 'dev',
    actor: { agent: 'orchestrator', role: 'orchestrator' },
    limit: 5,
    reviewers: ['validation-lead'],
  })
  assert.ok(proposalResult.ok, `generateProposal failed: ${proposalResult.error}`)

  const proposal = proposalResult.proposal
  assert.ok(proposal, 'proposal should be generated')
  assert.ok(proposal.proposed_changes, 'proposal should have proposed_changes')

  // 5. Apply proposal — verify catalog updated
  const proposalPath = join(tmpDir, 'proposal-apply-test.json')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(proposalPath, JSON.stringify(proposal), 'utf-8')

  const applyResult = await applyProposalFromFile(proposalPath, {
    actor: 'orchestrator',
    catalogRoot,
  })
  assert.ok(applyResult.ok, `applyProposal failed: ${applyResult.error}`)

  const afterApply = await loadExpertiseById(expertId, { catalogRoot })
  assert.ok(afterApply, 'catalog should be updated after apply')

  // 6. Export with evidence — verify evidence_summary present with metrics
  const exportResult = await exportExpertise(afterApply, { includeEvidence: true, skipPolicy: true, evidenceRoot })
  assert.ok(exportResult.ok, `exportExpertise failed: ${exportResult.error}`)
  assert.ok(exportResult.payload.evidence_summary, 'export should include evidence_summary')
  assert.ok(typeof exportResult.payload.evidence_summary.total_invocations === 'number', 'evidence_summary should have total_invocations')
  assert.ok(typeof exportResult.payload.evidence_summary.success_rate === 'number', 'evidence_summary should have success_rate')
  assert.ok(exportResult.payload.evidence_summary.last_invoked, 'evidence_summary should have last_invoked')

  // 7. Verify registry has 10 entries
  const registry = await buildRegistry({ catalogRoot, outputPath: join(tmpDir, '.mah/expertise/registry.json') })
  assert.ok(registry.total_count >= 10, `expected at least 10 registry entries, got ${registry.total_count}`)
})

// ---------------------------------------------------------------------------
// Test 2: Lifecycle pipeline
// ---------------------------------------------------------------------------
test('Lifecycle pipeline: seed → evidence → sync → transition lifecycle', async () => {
  // 1. Seed catalog for dev crew into temp dir
  const seedResult = await seedExpertiseCatalog(null, {
    crew: 'dev',
    force: true,
    catalogRoot,
  })
  assert.ok(seedResult.seeded > 0, `expected some seeded entries`)

  // 2. Record 5+ evidence events for dev:frontend-dev (all success)
  const expertId = 'dev:frontend-dev'
  const evidenceEvents = [
    { outcome: 'success', task_type: 'ui-implementation', duration_ms: 1100, review_pass: true },
    { outcome: 'success', task_type: 'css-styling', duration_ms: 800, review_pass: true },
    { outcome: 'success', task_type: 'component-test', duration_ms: 950, review_pass: true },
    { outcome: 'success', task_type: 'integration-test', duration_ms: 1300, review_pass: true },
    { outcome: 'success', task_type: 'accessibility-review', duration_ms: 700, review_pass: true },
    { outcome: 'success', task_type: 'responsive-layout', duration_ms: 1000, review_pass: true },
  ]
  for (const ev of evidenceEvents) {
    const result = await recordEvidence({
      expertise_id: expertId,
      ...ev,
      source_agent: 'orchestrator',
      source_session: `pipeline-lifecycle-${Date.now()}`,
    }, { evidenceRoot })
    assert.ok(result.ok, `recordEvidence failed: ${result.error}`)
  }

  // 3. Sync
  const syncResult = await syncExpertise({ crew: 'dev', dryRun: false, catalogRoot, evidenceRoot })
  assert.ok(syncResult.results.length > 0, 'sync should produce results')

  const frontendEntry = await loadExpertiseById(expertId, { catalogRoot })
  assert.ok(frontendEntry, 'frontend-dev entry should exist in catalog')
  assert.equal(frontendEntry.lifecycle, 'active', 'lifecycle should be active initially')

  // 4. Transition lifecycle active → experimental
  const lifecycleResult = await transitionLifecycle(expertId, 'experimental', {
    actor: 'orchestrator',
    reason: 'test: downgrade for pipeline coverage',
    catalogRoot,
    evidenceRoot,
  })
  assert.ok(lifecycleResult.ok, `transitionLifecycle failed: ${lifecycleResult.error}`)

  // 5. Verify lifecycle changed in catalog
  const afterTransition = await loadExpertiseById(expertId, { catalogRoot })
  assert.ok(afterTransition, 'catalog entry should still exist after transition')
  assert.equal(afterTransition.lifecycle, 'experimental', `lifecycle should be 'experimental', got '${afterTransition.lifecycle}'`)
  assert.ok(afterTransition.metadata?.last_lifecycle_change, 'last_lifecycle_change should be recorded')
  assert.equal(afterTransition.metadata.last_lifecycle_change.from, 'active', 'last_lifecycle_change should record from state')
  assert.equal(afterTransition.metadata.last_lifecycle_change.to, 'experimental', 'last_lifecycle_change should record to state')
})
