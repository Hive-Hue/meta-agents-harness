import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pkg from 'yaml'
const { parse: yamlParse, stringify: yamlStringify } = pkg

const EXPERTISE_NOTE_MAX_CHARS = 2000
const EXPERTISE_FILE_MAX_BYTES = 32_000
const VALID_CATEGORIES = [
  'patterns', 'risks', 'tools', 'workflows',
  'decisions', 'lessons', 'observations', 'open_questions',
]

function normalizeCategory(category) {
  if (!category) return 'observations'
  const normalized = String(category).toLowerCase().trim().replace(/[\s-]+/g, '_')
  const mapping = {
    pattern: 'patterns', patterns: 'patterns',
    risk: 'risks', risks: 'risks',
    tool: 'tools', tools: 'tools',
    workflow: 'workflows', workflows: 'workflows',
    decision: 'decisions', decisions: 'decisions',
    lesson: 'lessons', lessons: 'lessons',
    observation: 'observations', observations: 'observations',
    open_question: 'open_questions', open_questions: 'open_questions',
    question: 'open_questions', questions: 'open_questions',
  }
  return mapping[normalized] || 'observations'
}

function shortText(text, maxChars) {
  if (!text) return ''
  const normalized = String(text).normalize('NFC')
  if (normalized.length <= maxChars) return normalized
  return normalized.slice(0, maxChars - 3) + '...'
}

function detectAgentIdentity() {
  let crew = null
  const activeCrewPath = join(process.cwd(), '.pi', '.active-crew.json')
  if (existsSync(activeCrewPath)) {
    try {
      crew = JSON.parse(readFileSync(activeCrewPath, 'utf-8')).crew || null
    } catch {}
  }

  let agent = process.env.AGENT_NAME || process.env.MAH_AGENT_NAME || null
  if (!agent) {
    const sessionMarkerPath = join(process.cwd(), '.pi', 'session-agent.txt')
    if (existsSync(sessionMarkerPath)) {
      try { agent = readFileSync(sessionMarkerPath, 'utf-8').trim() } catch {}
    }
  }

  return { crew, agent }
}

function findExpertisePath(agent, crew) {
  if (!agent) return null
  const firstCrew = crew || 'dev'
  const path1 = join(process.cwd(), '.pi', 'crew', firstCrew, 'expertise', `${agent}-expertise-model.yaml`)
  if (existsSync(path1)) return path1
  const markerPath = join(process.cwd(), '.marker', 'crew', firstCrew, 'expertise', `${agent}-expertise-model.yaml`)
  if (existsSync(markerPath)) return markerPath
  return null
}

function loadExpertiseDoc(filePath) {
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf-8').trim()
    if (!raw) return null
    const parsed = yamlParse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    for (const cat of VALID_CATEGORIES) {
      if (!Array.isArray(parsed[cat])) parsed[cat] = []
    }
    return parsed
  } catch {
    return null
  }
}

function renderDoc(doc) {
  return yamlStringify(doc, { lineWidth: 0 })
}

function saveExpertiseDoc(filePath, doc) {
  const safeDoc = { ...doc }
  for (const cat of VALID_CATEGORIES) if (!Array.isArray(safeDoc[cat])) safeDoc[cat] = []
  let content = renderDoc(safeDoc)
  while (Buffer.byteLength(content, 'utf-8') > EXPERTISE_FILE_MAX_BYTES && VALID_CATEGORIES.some((c) => safeDoc[c].length > 0)) {
    for (const cat of VALID_CATEGORIES) {
      if (safeDoc[cat].length > 0) {
        safeDoc[cat].shift()
        break
      }
    }
    content = renderDoc(safeDoc)
  }
  writeFileSync(filePath, content, 'utf-8')
}

function appendNote(filePath, note, category, { agent = 'test-agent', crew = 'dev' } = {}) {
  let doc = loadExpertiseDoc(filePath)
  if (!doc) {
    doc = {
      agent: { name: agent, role: '', team: crew },
      meta: { version: 1, max_lines: 120, last_updated: '' },
      patterns: [], risks: [], tools: [], workflows: [], decisions: [], lessons: [], observations: [], open_questions: [],
    }
  }
  if (!doc.meta) doc.meta = { version: 1, max_lines: 120, last_updated: '' }
  const cat = normalizeCategory(category)
  if (!Array.isArray(doc[cat])) doc[cat] = []
  doc[cat].push({ date: new Date().toISOString().slice(0, 10), note: shortText(note, EXPERTISE_NOTE_MAX_CHARS) })
  doc.meta.last_updated = new Date().toISOString()
  saveExpertiseDoc(filePath, doc)
  return { category: cat }
}

function handleToolCall(name, args, impl = appendNote) {
  if (name !== 'update-expertise-model') {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }
  try {
    const { note, category } = args || {}
    if (!note) return { content: [{ type: 'text', text: "Error: 'note' parameter is required" }], isError: true }
    const result = impl('/tmp/mock.yaml', note, category)
    return { content: [{ type: 'text', text: `Expertise model updated for test-agent\n${result.category}` }] }
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true }
  }
}

test('normalizeCategory: all 8 categories resolve', () => {
  const cats = ['patterns', 'risks', 'tools', 'workflows', 'decisions', 'lessons', 'observations', 'open_questions']
  for (const c of cats) assert.equal(normalizeCategory(c), c)
})

test('normalizeCategory: singular → plural', () => {
  assert.equal(normalizeCategory('lesson'), 'lessons')
  assert.equal(normalizeCategory('risk'), 'risks')
  assert.equal(normalizeCategory('observation'), 'observations')
  assert.equal(normalizeCategory('open_question'), 'open_questions')
  assert.equal(normalizeCategory('open-question'), 'open_questions')
})

test('normalizeCategory: null/unknown → observations', () => {
  assert.equal(normalizeCategory(null), 'observations')
  assert.equal(normalizeCategory(''), 'observations')
  assert.equal(normalizeCategory('foobar'), 'observations')
})

test('shortText: truncation at 2000 chars', () => {
  const long = 'a'.repeat(2500)
  const result = shortText(long, 2000)
  assert.equal(result.length, 2000)
  assert.ok(result.endsWith('...'))
})

test('shortText: NFC normalization', () => {
  const composed = 'é'
  const decomposed = 'e\u0301'
  assert.equal(shortText(decomposed, 2000), composed)
})

test('shortText: short string unchanged', () => {
  assert.equal(shortText('hello', 2000), 'hello')
})

test('detectAgentIdentity: uses AGENT_NAME env var', () => {
  const prev = process.env.AGENT_NAME
  process.env.AGENT_NAME = 'agent-x'
  const out = detectAgentIdentity()
  assert.equal(out.agent, 'agent-x')
  process.env.AGENT_NAME = prev
})

test('findExpertisePath: resolves with crew', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-exp-'))
  const prevCwd = process.cwd()
  try {
    mkdirSync(join(tmp, '.pi', 'crew', 'dev', 'expertise'), { recursive: true })
    const p = join(tmp, '.pi', 'crew', 'dev', 'expertise', 'test-agent-expertise-model.yaml')
    writeFileSync(p, 'lessons: []\n')
    process.chdir(tmp)
    assert.equal(findExpertisePath('test-agent', 'dev'), p)
  } finally {
    process.chdir(prevCwd)
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('findExpertisePath: fallback to dev crew', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-exp-'))
  const prevCwd = process.cwd()
  try {
    mkdirSync(join(tmp, '.pi', 'crew', 'dev', 'expertise'), { recursive: true })
    const p = join(tmp, '.pi', 'crew', 'dev', 'expertise', 'test-agent-expertise-model.yaml')
    writeFileSync(p, 'lessons: []\n')
    process.chdir(tmp)
    assert.equal(findExpertisePath('test-agent'), p)
  } finally {
    process.chdir(prevCwd)
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('loadExpertiseDoc: parse real YAML with entries', () => {
  const p = join(process.cwd(), '.pi', 'crew', 'dev', 'expertise', 'orchestrator-expertise-model.yaml')
  const doc = loadExpertiseDoc(p)
  assert.ok(doc)
  assert.ok(Array.isArray(doc.lessons))
  assert.ok(Array.isArray(doc.decisions))
})

test('loadExpertiseDoc: empty file returns null', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-exp-'))
  try {
    const p = join(tmp, 'x.yaml')
    writeFileSync(p, '')
    assert.equal(loadExpertiseDoc(p), null)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('loadExpertiseDoc: missing file returns null', () => {
  assert.equal(loadExpertiseDoc('/nonexistent.yaml'), null)
})

test('saveExpertiseDoc: write YAML, verify round-trip', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-exp-'))
  try {
    const p = join(tmp, 'x.yaml')
    const doc = { agent: { name: 'a' }, meta: { version: 1 }, patterns: [{ date: '2026-01-01', note: 'x: "quoted"' }], risks: [], tools: [], workflows: [], decisions: [], lessons: [], observations: [], open_questions: [] }
    saveExpertiseDoc(p, doc)
    const parsed = yamlParse(readFileSync(p, 'utf-8'))
    assert.equal(parsed.patterns[0].note, 'x: "quoted"')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('appendNote: appends to existing file', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-exp-'))
  try {
    const src = join(process.cwd(), '.pi', 'crew', 'dev', 'expertise', 'orchestrator-expertise-model.yaml')
    const p = join(tmp, 'copy.yaml')
    writeFileSync(p, readFileSync(src, 'utf-8'))
    const before = loadExpertiseDoc(p).lessons.length
    appendNote(p, 'new lesson', 'lesson')
    const after = loadExpertiseDoc(p).lessons.length
    assert.equal(after, before + 1)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('appendNote: creates minimal doc for missing file', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-exp-'))
  try {
    const p = join(tmp, 'new.yaml')
    appendNote(p, 'new obs', 'observation', { agent: 'z', crew: 'dev' })
    assert.ok(existsSync(p))
    const parsed = yamlParse(readFileSync(p, 'utf-8'))
    assert.equal(parsed.observations.length, 1)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('YAML round-trip: load→save→load preserves entries', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-exp-'))
  try {
    const src = join(process.cwd(), '.pi', 'crew', 'dev', 'expertise', 'orchestrator-expertise-model.yaml')
    const doc = loadExpertiseDoc(src)
    const p = join(tmp, 'rt.yaml')
    saveExpertiseDoc(p, doc)
    const reread = yamlParse(readFileSync(p, 'utf-8'))
    assert.equal((reread.lessons || []).length, (doc.lessons || []).length)
    assert.equal((reread.decisions || []).length, (doc.decisions || []).length)
    assert.equal((reread.patterns || []).length, (doc.patterns || []).length)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('byte limit: file > 32KB triggers eviction', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-exp-'))
  try {
    const p = join(tmp, 'big.yaml')
    const doc = { agent: { name: 'a' }, meta: { version: 1 }, patterns: [], risks: [], tools: [], workflows: [], decisions: [], lessons: [], observations: [], open_questions: [] }
    for (let i = 0; i < 1200; i++) doc.lessons.push({ date: '2026-01-01', note: `note-${i}-` + 'x'.repeat(50) })
    saveExpertiseDoc(p, doc)
    const size = Buffer.byteLength(readFileSync(p, 'utf-8'), 'utf-8')
    assert.ok(size <= EXPERTISE_FILE_MAX_BYTES)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('MCP handler: returns correct response shape', () => {
  const ok = handleToolCall('update-expertise-model', { note: 'abc', category: 'lesson' }, () => ({ category: 'lessons' }))
  assert.equal(Array.isArray(ok.content), true)
  assert.equal(ok.isError, undefined)
  const err = handleToolCall('update-expertise-model', {})
  assert.equal(err.isError, true)
})
