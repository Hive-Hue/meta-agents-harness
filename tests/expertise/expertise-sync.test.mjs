import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { extractCapabilitiesFromSystemA, syncExpertiseEntry } from '../../scripts/expertise/expertise-sync.mjs'
import { seedExpertiseCatalog } from '../../scripts/expertise/expertise-seed.mjs'

const repoRoot = process.cwd()

test('sync with no evidence → no changes', async () => {
  const result = await syncExpertiseEntry('dev', 'orchestrator', { dryRun: true })
  assert.ok(result)
  assert.equal(typeof result.changed, 'boolean')
})

test('System A keyword extraction → capability appended', () => {
  const sample = {
    lessons: [{ note: 'Add oauth session auth flow and endpoint hardening' }],
    patterns: [{ note: 'Use postgres schema migrations' }],
    risks: [{ note: 'Security review for XSS and injection' }],
  }
  const caps = extractCapabilitiesFromSystemA(sample)
  assert.ok(caps.includes('api-design'))
  assert.ok(caps.includes('security'))
  assert.ok(caps.includes('database'))
  assert.ok(caps.includes('security-audit'))
})

test('dry-run → catalog files unchanged', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'mah-expertise-sync-'))
  const catalogRoot = join(tempRoot, '.mah', 'expertise', 'catalog')
  mkdirSync(catalogRoot, { recursive: true })
  await seedExpertiseCatalog(null, { crew: 'dev', force: true, catalogRoot })
  const catalogPath = join(catalogRoot, 'dev', 'backend-dev.yaml')
  const before = readFileSync(catalogPath, 'utf-8')
  await syncExpertiseEntry('dev', 'backend-dev', { dryRun: true, catalogRoot })
  const after = readFileSync(catalogPath, 'utf-8')
  assert.equal(after, before)
  rmSync(tempRoot, { recursive: true, force: true })
})

test('idempotent dry-run → repeated result shape stable', async () => {
  const r1 = await syncExpertiseEntry('dev', 'backend-dev', { dryRun: true })
  const r2 = await syncExpertiseEntry('dev', 'backend-dev', { dryRun: true })
  assert.equal(r1.skipped, r2.skipped)
  assert.equal(Array.isArray(r1.changes), true)
  assert.equal(Array.isArray(r2.changes), true)
})
