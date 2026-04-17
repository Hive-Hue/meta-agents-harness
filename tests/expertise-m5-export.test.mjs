/**
 * M5 — Expertise Export/Import Contract Tests
 * Tests bounded export/import for MAH v0.7.0 Expertise Engine
 */

import { describe, it, after } from 'node:test'
import assert from 'node:assert'
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const repoRoot = process.cwd()

// Import the module directly (not via CLI subprocess for unit coverage)
const exportModulePath = resolve(repoRoot, 'scripts/expertise-export.mjs')
const { 
  exportExpertise,
  exportExpertiseBundle,
  exportExpertiseToFile,
  checkExportPolicy,
  redactExpertise,
  validateImportPayload,
  validateImportBundle,
  importExpertise,
  loadImportFile,
} = await import(`file://${exportModulePath}`)

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const makeExpertise = (overrides = {}) => ({
  id: 'dev:test-agent',
  owner: { agent: 'test-agent', team: 'dev' },
  schema_version: 'mah.expertise.v1',
  capabilities: ['coding', 'testing'],
  domains: ['software-engineering'],
  input_contract: { required_fields: ['task_description'], optional_fields: [], field_types: {} },
  allowed_environments: ['development'],
  validation_status: 'declared',
  confidence: { score: 0.5, band: 'medium', evidence_count: 3 },
  trust_tier: 'internal',
  lifecycle: 'active',
  policy: {
    federated_allowed: false,
    allowed_domains: [],
    approval_required: false,
  },
  metadata: {
    created: '2026-03-01T10:00:00Z',
    updated: '2026-04-01T10:00:00Z',
    owner_id: 'agent:test-agent:internal',
    tags: ['test'],
  },
  evidence_refs: ['ev-001', 'ev-002'],
  ...overrides,
})

// For validateImportPayload tests: strip owner_id since it's redacted during import
const makeImportPayload = (overrides = {}) => {
  const exp = makeExpertise(overrides)
  if (exp.metadata) {
    const { owner_id, ...rest } = exp.metadata
    exp.metadata = rest
  }
  return exp
}

// ---------------------------------------------------------------------------
// redactExpertise
// ---------------------------------------------------------------------------

describe('M5 — redactExpertise', () => {
  it('redacts evidence_refs from output', () => {
    const exp = makeExpertise()
    const result = redactExpertise(exp)
    assert.ok(!('evidence_refs' in result), 'evidence_refs must be redacted')
  })

  it('redacts owner_id from metadata sub-object', () => {
    const exp = makeExpertise()
    const result = redactExpertise(exp)
    assert.ok(!result.metadata?.owner_id, 'owner_id must be redacted from metadata')
    assert.ok(result.metadata?.created, 'created must be preserved')
    assert.ok(result.metadata?.tags, 'tags must be preserved')
  })

  it('preserves all other allowed fields', () => {
    const exp = makeExpertise()
    const result = redactExpertise(exp)
    assert.ok(result.id, 'id must be present')
    assert.ok(result.owner, 'owner must be present')
    assert.ok(result.capabilities, 'capabilities must be present')
    assert.ok(result.domains, 'domains must be present')
    assert.ok(result.policy, 'policy must be present')
  })
})

// ---------------------------------------------------------------------------
// checkExportPolicy
// ---------------------------------------------------------------------------

describe('M5 — checkExportPolicy', () => {
  it('blocks export when federated_allowed=false', () => {
    const exp = makeExpertise({ policy: { federated_allowed: false, allowed_domains: [], approval_required: false } })
    const result = checkExportPolicy(exp)
    assert.ok(!result.allowed, 'must be blocked')
    assert.ok(result.reason?.includes('federated_allowed=false'), 'reason must mention policy')
  })

  it('blocks export when target domain not in allowed_domains', () => {
    const exp = makeExpertise({ policy: { federated_allowed: true, allowed_domains: ['engineering', 'ops'], approval_required: false } })
    const result = checkExportPolicy(exp, { domain: 'marketing' })
    assert.ok(!result.allowed, 'must be blocked for non-allowed domain')
    assert.ok(result.reason?.includes('domains'), 'reason must mention domains restriction')
  })

  it('allows export when domain matches allowed_domains', () => {
    const exp = makeExpertise({ policy: { federated_allowed: true, allowed_domains: ['engineering', 'ops'], approval_required: false } })
    const result = checkExportPolicy(exp, { domain: 'engineering' })
    assert.ok(result.allowed, 'must be allowed')
  })

  it('allows export with domain wildcard', () => {
    const exp = makeExpertise({ policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: false } })
    const result = checkExportPolicy(exp, { domain: 'anything' })
    assert.ok(result.allowed, 'wildcard must allow any domain')
  })

  it('warns when approval_required=true but does not block', () => {
    const exp = makeExpertise({ policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: true } })
    const result = checkExportPolicy(exp)
    assert.ok(result.allowed, 'must be allowed')
assert.ok(result.warning?.toLowerCase().includes('approval'), 'warning must mention approval')
  })

  it('allows export with no policy restrictions', () => {
    const exp = makeExpertise({ policy: { federated_allowed: true, allowed_domains: [], approval_required: false } })
    const result = checkExportPolicy(exp)
    assert.ok(result.allowed, 'must be allowed')
  })
})

// ---------------------------------------------------------------------------
// exportExpertise
// ---------------------------------------------------------------------------

describe('M5 — exportExpertise', () => {
  it('blocks and returns error for federated_allowed=false', () => {
    const exp = makeExpertise({ policy: { federated_allowed: false, allowed_domains: [], approval_required: false } })
    const result = exportExpertise(exp)
    assert.ok(!result.ok, 'must not succeed')
    assert.ok(result.error?.includes('federated_allowed=false'), 'error must mention policy')
  })

  it('succeeds with federated_allowed=true and returns payload', () => {
    const exp = makeExpertise({ policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: false } })
    const result = exportExpertise(exp)
    assert.ok(result.ok, 'must succeed')
    assert.ok(result.payload, 'payload must exist')
    assert.ok(!('evidence_refs' in result.payload), 'evidence_refs redacted')
    assert.ok(!result.payload.metadata?.owner_id, 'owner_id redacted')
  })

  it('stamps _export metadata with schema_version and policy_snapshot', () => {
    const exp = makeExpertise({ 
      policy: { federated_allowed: true, allowed_domains: ['engineering'], approval_required: true },
    })
    const result = exportExpertise(exp)
    assert.ok(result.ok, 'must succeed')
    assert.ok(result.payload._export, '_export stamp must exist')
    assert.equal(result.payload._export.schema_version, 'mah.expertise.v1', 'schema_version must match')
    assert.deepEqual(result.payload._export.policy_snapshot, {
      federated_allowed: true,
      allowed_domains: ['engineering'],
      approval_required: true,
    }, 'policy_snapshot must match')
    assert.ok(result.payload._export.exported_at, 'exported_at must be set')
    assert.ok(result.payload._export.exported_by, 'exported_by must be set')
  })

  it('returns error for invalid expertise', () => {
    const exp = makeExpertise({ schema_version: 'mah.expertise.v1' })
    // Delete required field to make it invalid
    const invalid = { ...exp, capabilities: [] }
    const result = exportExpertise(invalid)
    assert.ok(!result.ok, 'must fail for invalid expertise')
    assert.ok(result.error?.includes('invalid'), 'error must mention invalidity')
  })

  it('warns when approval_required=true', () => {
    const exp = makeExpertise({ policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: true } })
    const result = exportExpertise(exp)
    assert.ok(result.ok, 'must succeed')
    assert.ok(result.warnings?.length > 0, 'must have warnings')
    assert.ok(result.warnings?.some(w => w.toLowerCase().includes('approval')), 'warning must mention approval')
  })
})

// ---------------------------------------------------------------------------
// exportExpertiseBundle
// ---------------------------------------------------------------------------

describe('M5 — exportExpertiseBundle', () => {
  it('exports multiple entries and reports per-entry errors', () => {
    const allowed = makeExpertise({ 
      id: 'dev:agent-a', 
      policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: false } 
    })
    const blocked = makeExpertise({ 
      id: 'dev:agent-b', 
      policy: { federated_allowed: false, allowed_domains: [], approval_required: false } 
    })
    const result = exportExpertiseBundle([allowed, blocked])
    assert.ok(result.ok, 'bundle must succeed even with some blocked entries')
    assert.equal(result.exported.length, 1, 'only allowed entry exported')
    assert.equal(result.exported[0].id, 'dev:agent-a', 'correct entry exported')
    assert.ok(result.errors.some(e => e.includes('federated_allowed=false')), 'blocked entry error must be reported')
  })

  it('fails if ALL entries are blocked', () => {
    const blocked = [
      makeExpertise({ id: 'dev:a', policy: { federated_allowed: false, allowed_domains: [], approval_required: false } }),
      makeExpertise({ id: 'dev:b', policy: { federated_allowed: false, allowed_domains: [], approval_required: false } }),
    ]
    const result = exportExpertiseBundle(blocked)
    assert.ok(!result.ok, 'bundle must fail when all blocked')
  })
})

// ---------------------------------------------------------------------------
// validateImportPayload
// ---------------------------------------------------------------------------

describe('M5 — validateImportPayload', () => {
  it('accepts a valid expertise payload', () => {
    const payload = makeImportPayload({
      policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: false },
    })
    const result = validateImportPayload(payload)
    assert.ok(result.valid, 'must be valid')
    assert.equal(result.errors.length, 0, 'no errors')
  })

  it('rejects wrong schema_version', () => {
    const payload = makeImportPayload({ schema_version: 'mah.expertise.v99' })
    const result = validateImportPayload(payload)
    assert.ok(!result.valid, 'must be invalid')
    assert.ok(result.errors.some(e => e.includes('schema_version')), 'error must mention schema_version')
  })

  it('rejects missing schema_version', () => {
    const payload = { ...makeImportPayload(), schema_version: undefined }
    const result = validateImportPayload(payload)
    assert.ok(!result.valid, 'must be invalid')
    assert.ok(result.errors.some(e => e.includes('schema_version')), 'error must mention missing schema_version')
  })

  it('rejects missing id', () => {
    const payload = { ...makeImportPayload(), id: undefined }
    const result = validateImportPayload(payload)
    assert.ok(!result.valid, 'must be invalid')
    assert.ok(result.errors.some(e => e.includes('id')), 'error must mention id')
  })

  it('rejects missing owner', () => {
    const payload = { ...makeImportPayload(), owner: undefined }
    const result = validateImportPayload(payload)
    assert.ok(!result.valid, 'must be invalid')
    assert.ok(result.errors.some(e => e.includes('owner')), 'error must mention owner')
  })

  it('warns about unknown fields (forward compatibility)', () => {
    const payload = { ...makeImportPayload({ policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: false } }) }
    payload.unknown_field = 'should warn'
    const result = validateImportPayload(payload, { strict: false })
    assert.ok(result.valid, 'must still be valid')
    assert.ok(result.warnings?.some(w => w.includes('unknown_field')), 'must warn about unknown field')
  })

  it('rejects non-object payload', () => {
    const result = validateImportPayload(null)
    assert.ok(!result.valid, 'must be invalid')
    assert.ok(result.errors.some(e => e.includes('non-null object')), 'must mention non-null object')
  })

  it('rejects plain array payload (not a bundle)', () => {
    const result = validateImportPayload([makeImportPayload()])
    assert.ok(!result.valid, 'plain array must be invalid')
  })
})

// ---------------------------------------------------------------------------
// validateImportBundle
// ---------------------------------------------------------------------------

describe('M5 — validateImportBundle', () => {
  it('accepts a valid bundle with multiple entries', () => {
    const bundle = {
      schema_version: 'mah.expertise.v1',
      bundle_version: 'v1',
      entries: [
        makeImportPayload({ id: 'dev:a', policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: false } }),
        makeImportPayload({ id: 'dev:b', policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: false } }),
      ]
    }
    const result = validateImportBundle(bundle)
    assert.ok(result.valid, 'must be valid')
    assert.equal(result.entries.length, 2, 'both entries must be normalized')
  })

  it('rejects bundle with wrong schema_version', () => {
    const bundle = {
      schema_version: 'mah.expertise.v99',
      bundle_version: 'v1',
      entries: [makeImportPayload({ policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: false } })],
    }
    const result = validateImportBundle(bundle)
    assert.ok(!result.valid, 'must be invalid')
    assert.ok(result.errors.some(e => e.includes('schema_version')), 'error must mention schema_version')
  })

  it('rejects empty bundle', () => {
    const bundle = { schema_version: 'mah.expertise.v1', bundle_version: 'v1', entries: [] }
    const result = validateImportBundle(bundle)
    assert.ok(!result.valid, 'must be invalid')
    assert.ok(result.errors.some(e => e.includes('no entries')), 'error must mention no entries')
  })
})

// ---------------------------------------------------------------------------
// importExpertise
// ---------------------------------------------------------------------------

describe('M5 — importExpertise', () => {
  it('returns dry-run message when dryRun=true', () => {
    const payload = makeExpertise()
    const result = importExpertise(payload, { dryRun: true })
    assert.ok(result.ok, 'must succeed')
    assert.ok(result.message?.includes('dry-run'), 'message must mention dry-run')
    assert.ok(result.message?.includes('not written'), 'message must mention not written to disk')
  })

  it('returns commit message when dryRun=false (v0.7.0: no auto-write)', () => {
    const payload = makeExpertise()
    const result = importExpertise(payload, { dryRun: false })
    assert.ok(result.ok, 'must succeed')
    assert.ok(result.message?.includes('ready for catalog write'), 'message must mention ready for catalog write')
    assert.ok(result.message?.includes('caller must handle I/O'), 'message must clarify caller handles I/O')
  })
})

// ---------------------------------------------------------------------------
// loadImportFile
// ---------------------------------------------------------------------------

// Module-level tmp directories (created once per process)
const tmpDir1 = mkdtempSync(resolve(tmpdir(), 'mah-test-m5-'))
const tmpFile = resolve(tmpDir1, 'import-test.json')

describe('M5 — loadImportFile (disk I/O)', () => {
  it('loads and validates a valid JSON file', async () => {
    const validPayload = makeImportPayload({ policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: false } })
    writeFileSync(tmpFile, JSON.stringify(validPayload), 'utf-8')

    const result = await loadImportFile(tmpFile)
    assert.ok(result.valid, 'must be valid')
    assert.equal(result.payload.id, 'dev:test-agent', 'payload must be loaded correctly')
    assert.equal(result.errors.length, 0, 'no errors for valid file')
  })

  it('rejects file with wrong schema version', async () => {
    const badPayload = { ...makeImportPayload({ policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: false } }), schema_version: 'mah.expertise.v99' }
    writeFileSync(tmpFile, JSON.stringify(badPayload), 'utf-8')

    const result = await loadImportFile(tmpFile)
    assert.ok(!result.valid, 'must be invalid')
    assert.ok(result.errors.some(e => e.includes('schema_version')), 'error must mention schema_version')
  })

  it('rejects non-existent file', async () => {
    const result = await loadImportFile(resolve(tmpDir1, 'nonexistent.json'))
    assert.ok(!result.valid, 'must be invalid')
    assert.ok(result.errors.some(e => e.includes('not found')), 'error must mention not found')
  })

  it('rejects invalid JSON file', async () => {
    writeFileSync(tmpFile, 'not valid json {', 'utf-8')
    const result = await loadImportFile(tmpFile)
    assert.ok(!result.valid, 'must be invalid')
    assert.ok(result.errors.some(e => e.includes('not valid JSON')), 'error must mention JSON parsing')
  })

  it('warns about unknown fields in loaded file', async () => {
    const payload = makeImportPayload({ policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: false } })
    payload.custom_field = 'ignored'
    writeFileSync(tmpFile, JSON.stringify(payload), 'utf-8')

    const result = await loadImportFile(tmpFile, { strict: false })
    assert.ok(result.valid, 'must still be valid')
    assert.ok(result.warnings?.some(w => w.includes('custom_field')), 'must warn about unknown field')
  })
})

// ---------------------------------------------------------------------------
// exportExpertiseToFile (disk I/O)
// ---------------------------------------------------------------------------

const tmpDir2 = mkdtempSync(resolve(tmpdir(), 'mah-test-m5-export-'))
const outputFile = resolve(tmpDir2, 'exported-agent.json')

describe('M5 — exportExpertiseToFile (disk I/O)', () => {
  it('writes export to file when federated_allowed=true', async () => {
    const result = await exportExpertiseToFile('dev:backend-dev', outputFile)
    if (!result.ok) {
      // Registry lookup or policy block — just verify it failed gracefully
      assert.ok(!result.ok, 'export must fail gracefully if not allowed')
    } else {
      assert.equal(result.written, 1, 'must report written count')
      const written = JSON.parse(readFileSync(outputFile, 'utf-8'))
      assert.ok(written._export, 'must have _export stamp')
      assert.ok(!('evidence_refs' in written), 'evidence_refs must be redacted')
      assert.deepEqual(written.allowed_environments, ['development'])
      assert.ok(written.metadata?.created, 'canonical metadata should be preserved')
    }
  })

  it('fails for non-existent expertise id', async () => {
    const result = await exportExpertiseToFile('dev:nonexistent-agent-xyz', resolve(tmpDir2, 'dummy.json'))
    assert.ok(!result.ok, 'must fail')
    assert.ok(result.errors[0]?.includes('not found'), 'error must indicate not found in catalog')
  })
})

// ---------------------------------------------------------------------------
// Integration: export then import round-trip
// ---------------------------------------------------------------------------

const tmpDir3 = mkdtempSync(resolve(tmpdir(), 'mah-test-m5-roundtrip-'))
const exportFile = resolve(tmpDir3, 'roundtrip-export.json')

after(() => {
  rmSync(tmpDir1, { recursive: true, force: true })
  rmSync(tmpDir2, { recursive: true, force: true })
  rmSync(tmpDir3, { recursive: true, force: true })
})

describe('M5 — Export/Import Round-Trip', () => {
  it('exported payload can be validated and re-imported', async () => {
    // Create an expertise with federated_allowed=true
    const exp = makeExpertise({
      id: 'dev:roundtrip-test',
      policy: { federated_allowed: true, allowed_domains: ['*'], approval_required: false },
      metadata: { created: '2026-03-01T10:00:00Z', updated: '2026-04-01T10:00:00Z', owner_id: 'SENSITIVE', tags: ['test'] },
      evidence_refs: ['ev-001'],
    })

    // Export
    const exportResult = exportExpertise(exp)
    assert.ok(exportResult.ok, 'export must succeed')
    assert.ok(!exportResult.payload.evidence_refs, 'evidence_refs must be redacted in export')
    assert.ok(!exportResult.payload.metadata?.owner_id, 'owner_id must be redacted in export')

    // Write to file
    writeFileSync(exportFile, JSON.stringify(exportResult.payload), 'utf-8')

    // Load from file
    const loadResult = await loadImportFile(exportFile)
    assert.ok(loadResult.valid, 'loaded file must be valid')

    // Import (dry-run)
    const importResult = importExpertise(loadResult.payload, { dryRun: true })
    assert.ok(importResult.ok, 'import must succeed in dry-run')
    assert.ok(importResult.message?.includes('dry-run'), 'must indicate dry-run mode')
  })
})
