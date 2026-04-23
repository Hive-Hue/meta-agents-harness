/**
 * Proposal Governance Tests — move to tests/context-memory-governance.test.mjs
 * @fileoverview Tests for list/show/promote/reject proposal governance
 * @version 0.8.0
 *
 * Run: node --test tests/context-memory-governance.test.mjs
 */

import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  listProposalSummaries,
  showProposal,
  promoteProposal,
  rejectProposal,
  detectOverlaps
} from '../scripts/context-memory-proposal.mjs'

// Helper: create a temp repo-like structure
function createTempRepo () {
  const base = join(tmpdir(), `mah-gov-test-${Date.now()}`)
  const proposalsDir = join(base, '.mah', 'context', 'proposals')
  const operationalDir = join(base, '.mah', 'context', 'operational')
  mkdirSync(proposalsDir, { recursive: true })
  mkdirSync(operationalDir, { recursive: true })
  return { base, proposalsDir, operationalDir }
}

// Helper: write a proposal file
function writeTestProposal (proposalsDir, overrides = {}) {
  const id = overrides.id || 'test-proposal-001'
  const proposal = {
    proposal_version: 'mah.context-memory.proposal.v1',
    id,
    status: overrides.status || 'draft',
    generated_at: '2026-04-23T00:00:00.000Z',
    source_type: 'session',
    source_ref: overrides.source_ref || 'dev:Planning:2026-04-23-test',
    proposed_document_id: overrides.proposed_document_id || 'test-doc-001',
    summary: overrides.summary || 'Test proposal for governance',
    rationale: overrides.rationale || 'Testing promote/reject workflow',
    reviewers: overrides.reviewers || ['orchestrator'],
    existing_refs: []
  }
  const proposedFrontmatter = overrides.proposed_frontmatter || {
    id: proposal.proposed_document_id,
    kind: 'playbook',
    crew: 'Planning',
    agent: 'planning-lead',
    capabilities: ['backlog-planning'],
    stability: 'draft',
    source_type: 'proposal',
    last_reviewed_at: '2026-04-23T00:00:00.000Z'
  }
  const yamlFm = Object.entries(proposal).map(([k, v]) => {
    if (k === 'existing_refs' && Array.isArray(v) && v.length === 0) return k + ': []'
    if (Array.isArray(v)) return `${k}:\n${v.map(i => `  - "${i}"`).join('\n')}`
    if (typeof v === 'string') return `${k}: "${v}"`
    return `${k}: ${v}`
  }).join('\n')
  const yamlDoc = Object.entries(proposedFrontmatter).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}:\n${v.map(i => `  - "${i}"`).join('\n')}`
    if (typeof v === 'string') return `${k}: "${v}"`
    return `${k}: ${v}`
  }).join('\n')
  const content = `---\n${yamlFm}\n---\n\n## Proposed Document\n\n\`\`\`yaml\n${yamlDoc}\n\`\`\`\n\n## Rationale\n\n${proposal.rationale}\n\n## Source\n\n- Type: session\n- Ref: ${proposal.source_ref}\n\nTest body content.\n`
  const filename = `2026-04-23-${id}.md`
  const filePath = join(proposalsDir, filename)
  writeFileSync(filePath, content, 'utf8')
  return { filePath, proposal }
}

// Helper: write an operational doc with proper frontmatter
function writeTestOperational (operationalDir, docId, overrides = {}) {
  const doc = {
    id: docId,
    kind: overrides.kind || 'playbook',
    crew: overrides.crew || 'Planning',
    agent: overrides.agent || 'planning-lead',
    capabilities: overrides.capabilities || ['backlog-planning'],
    stability: overrides.stability || 'curated',
    source_type: 'proposal',
    last_reviewed_at: '2026-04-23T00:00:00.000Z'
  }
  const yamlFm = Object.entries(doc).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}:\n${v.map(i => `  - "${i}"`).join('\n')}`
    if (typeof v === 'string') return `${k}: "${v}"`
    return `${k}: ${v}`
  }).join('\n')
  const content = `---\n${yamlFm}\n---\n\n# ${docId}\n\nOperational doc content.\n`
  const filePath = join(operationalDir, `${docId}.md`)
  writeFileSync(filePath, content, 'utf8')
  return filePath
}

describe('proposal governance: list/show/promote/reject', () => {
  let repo
  beforeEach(() => { repo = createTempRepo() })
  afterEach(() => { if (repo) rmSync(repo.base, { recursive: true, force: true }) })

  test('listProposalSummaries returns array with id and status', () => {
    writeTestProposal(repo.proposalsDir, { id: 'p1' })
    writeTestProposal(repo.proposalsDir, { id: 'p2' })
    const summaries = listProposalSummaries(repo.base)
    assert.ok(Array.isArray(summaries))
    assert.equal(summaries.length, 2)
    assert.ok(summaries.every(s => s.id && s.status))
  })

  test('showProposal returns full proposal and overlaps for valid id', () => {
    writeTestProposal(repo.proposalsDir, { id: 'p-show' })
    const result = showProposal(repo.base, 'p-show')
    assert.ok(result.ok !== false)
    assert.ok(result.proposal)
    assert.ok(Array.isArray(result.overlaps))
  })

  test('showProposal returns ok:false for missing id', () => {
    const result = showProposal(repo.base, 'nonexistent')
    assert.equal(result.ok, false)
    assert.ok(result.error)
  })

  test('promoteProposal writes doc to operational dir and updates status', async () => {
    writeTestProposal(repo.proposalsDir, { id: 'p-promote' })
    const result = await promoteProposal(repo.base, 'p-promote', 'curated')
    assert.equal(result.ok, true)
    assert.ok(result.target_path)
    assert.ok(existsSync(result.target_path))
    // Verify proposal status updated
    const showResult = showProposal(repo.base, 'p-promote')
    assert.equal(showResult.proposal.status, 'promoted')
  })

  test('promoteProposal rejects already-promoted proposal', async () => {
    writeTestProposal(repo.proposalsDir, { id: 'p-twice' })
    await promoteProposal(repo.base, 'p-twice', 'curated')
    const result = await promoteProposal(repo.base, 'p-twice', 'curated')
    assert.equal(result.ok, false)
  })

  test('promoteProposal rejects path traversal in proposed_document_id', async () => {
    writeTestProposal(repo.proposalsDir, {
      id: 'p-traversal',
      proposed_document_id: '../../etc/passwd'
    })
    const result = await promoteProposal(repo.base, 'p-traversal', 'curated')
    assert.equal(result.ok, false)
    assert.ok(result.error)
  })

  test('promoteProposal detects overlaps with existing operational doc', async () => {
    writeTestOperational(repo.operationalDir, 'test-doc-001')
    writeTestProposal(repo.proposalsDir, { id: 'p-overlap' })
    const result = await promoteProposal(repo.base, 'p-overlap', 'curated')
    // Should either refuse or return overlaps
    if (result.ok) {
      assert.ok(result.overlaps && result.overlaps.length > 0)
    } else {
      assert.ok(result.overlaps || result.error)
    }
  })

  test('rejectProposal updates status to rejected with reason', () => {
    writeTestProposal(repo.proposalsDir, { id: 'p-reject' })
    const result = rejectProposal(repo.base, 'p-reject', 'Duplicate of existing doc')
    assert.equal(result.ok, true)
    const showResult = showProposal(repo.base, 'p-reject')
    assert.equal(showResult.proposal.status, 'rejected')
    assert.ok(showResult.proposal.rejection_reason)
    assert.ok(showResult.proposal.rejected_at)
  })

  test('rejectProposal rejects already-rejected proposal', () => {
    writeTestProposal(repo.proposalsDir, { id: 'p-rej2' })
    rejectProposal(repo.base, 'p-rej2', 'First reason')
    const result = rejectProposal(repo.base, 'p-rej2', 'Second reason')
    assert.equal(result.ok, false)
  })

  test('detectOverlaps detects same proposed_document_id in operational dir', () => {
    writeTestOperational(repo.operationalDir, 'test-doc-001')
    const { proposal, filePath } = writeTestProposal(repo.proposalsDir, { id: 'p-detect' })
    const overlaps = detectOverlaps(repo.base, {
      ...proposal,
      file_path: filePath,
      proposed_document_id: 'test-doc-001',
      source_ref: proposal.source_ref,
      body: ''
    })
    assert.ok(Array.isArray(overlaps))
    assert.ok(overlaps.some(o => o.type === 'same-document-id'))
  })
})
