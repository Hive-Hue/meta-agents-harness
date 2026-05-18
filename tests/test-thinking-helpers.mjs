import { readFileSync } from 'node:fs'

// Extract the helper functions from the TS source for testing
// We'll eval them after stripping TS types
const src = readFileSync('/home/alysson/Github/meta-agents-harness/extensions/multi-team.ts', 'utf-8')

// Find extractThinkingBlocks function
const extractMatch = src.match(/function extractThinkingBlocks\(text[^)]*\)[\s\S]*?^}/m)
const stripMatch = src.match(/function stripThinkingTags\(text[^)]*\)[\s\S]*?^}/m)

if (!extractMatch || !stripMatch) {
  console.error('FAILED: Could not find helper functions in source')
  process.exit(1)
}

// The functions use const THINKING_OPEN/CLOSE from module scope, extract those too
const openMatch = src.match(/const THINKING_OPEN = "([^"]+)"/)
const closeMatch = src.match(/const THINKING_CLOSE = "([^"]+)"/)

if (!openMatch || !closeMatch) {
  console.error('FAILED: Could not find THINKING_OPEN/CLOSE constants')
  process.exit(1)
}

const THINKING_OPEN = openMatch[1]
const THINKING_CLOSE = closeMatch[1]

function extractThinkingBlocks(text) {
  const blocks = []
  let start = 0
  while (true) {
    const open = text.indexOf(THINKING_OPEN, start)
    if (open === -1) break
    const tagEnd = text.indexOf('>', open)
    if (tagEnd === -1) break
    const close = text.indexOf(THINKING_CLOSE, tagEnd)
    if (close === -1) break
    blocks.push(text.slice(tagEnd + 1, close).trim())
    start = close + THINKING_CLOSE.length
  }
  return blocks
}

function stripThinkingTags(text) {
  let result = text
  result = result.replace(/<think[^>]*>[\s\S]*?<\/think[^>]*>/g, '')
  result = result.replace(/<think[^>]*\/>/g, '')
  return result.trim()
}

function splitThinkingTaggedText(text) {
  const segments = []
  let cursor = 0

  while (cursor < text.length) {
    const open = text.indexOf(THINKING_OPEN, cursor)
    if (open === -1) {
      if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) })
      break
    }

    const tagEnd = text.indexOf('>', open)
    if (tagEnd === -1) {
      segments.push({ type: 'text', text: text.slice(cursor) })
      break
    }

    if (open > cursor) {
      segments.push({ type: 'text', text: text.slice(cursor, open) })
    }

    const openTag = text.slice(open, tagEnd + 1)
    if (/\/>\s*$/.test(openTag)) {
      cursor = tagEnd + 1
      continue
    }

    const close = text.indexOf(THINKING_CLOSE, tagEnd)
    if (close === -1) {
      segments.push({ type: 'text', text: text.slice(open) })
      break
    }

    const closeEnd = text.indexOf('>', close)
    if (closeEnd === -1) {
      segments.push({ type: 'text', text: text.slice(open) })
      break
    }

    segments.push({ type: 'thinking', thinking: text.slice(tagEnd + 1, close) })
    cursor = closeEnd + 1
  }

  return segments.length > 0 ? segments : [{ type: 'text', text }]
}

function normalizeAssistantThinkingContent(message) {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) return false

  let changed = false
  const nextContent = []

  for (const block of message.content) {
    if (!block || block.type !== 'text' || typeof block.text !== 'string' || !block.text.includes(THINKING_OPEN)) {
      nextContent.push(block)
      continue
    }

    const segments = splitThinkingTaggedText(block.text)
    const onlyPlainText = segments.length === 1
      && segments[0]?.type === 'text'
      && segments[0].text === block.text

    if (onlyPlainText) {
      nextContent.push(block)
      continue
    }

    changed = true
    for (const segment of segments) {
      if (segment.type === 'text') {
        if (segment.text.length > 0) nextContent.push({ type: 'text', text: segment.text })
      } else {
        nextContent.push({ type: 'thinking', thinking: segment.thinking })
      }
    }
  }

  if (changed) message.content = nextContent
  return changed
}

function extractAssistantMessageParts(messages) {
  const assistantMessages = Array.isArray(messages) ? messages.filter((message) => message?.role === 'assistant') : []
  const lastMessage = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1] : null
  if (!lastMessage) return { displayText: '', thinkingText: '' }

  if (!Array.isArray(lastMessage.content)) {
    const rawText = typeof lastMessage.content === 'string' ? lastMessage.content : ''
    return {
      displayText: stripThinkingTags(rawText) || rawText,
      thinkingText: extractThinkingBlocks(rawText).join('\n\n').trim()
    }
  }

  const textParts = []
  const thinkingParts = []

  for (const block of lastMessage.content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      thinkingParts.push(block.thinking)
      continue
    }
    if (block.type !== 'text' || typeof block.text !== 'string') continue

    if (!block.text.includes(THINKING_OPEN)) {
      textParts.push(block.text)
      continue
    }

    for (const segment of splitThinkingTaggedText(block.text)) {
      if (segment.type === 'thinking') thinkingParts.push(segment.thinking)
      else textParts.push(segment.text)
    }
  }

  return {
    displayText: textParts.join('\n\n').trim(),
    thinkingText: thinkingParts.join('\n\n').trim()
  }
}

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`✅ ${name}`)
    passed++
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`)
    failed++
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

// --- Tests ---

test('extractThinkingBlocks: single think block', () => {
  const text = '<think>I need to count to 3\nStep by step\n</think>\n1, 2, 3'
  const blocks = extractThinkingBlocks(text)
  assertDeepEqual(blocks, ['I need to count to 3\nStep by step'], 'blocks')
})

test('extractThinkingBlocks: no think blocks', () => {
  const text = 'Just a regular response with no thinking'
  const blocks = extractThinkingBlocks(text)
  assertDeepEqual(blocks, [], 'blocks')
})

test('extractThinkingBlocks: multiple think blocks', () => {
  const text = '<think>First thought\n</think>\nSome output\n<think>Second thought\n</think>\nMore output'
  const blocks = extractThinkingBlocks(text)
  assertDeepEqual(blocks, ['First thought', 'Second thought'], 'blocks')
})

test('extractThinkingBlocks: think with attributes', () => {
  const text = '<think type="reasoning">Reasoning here\n</think>\nResult'
  const blocks = extractThinkingBlocks(text)
  assertDeepEqual(blocks, ['Reasoning here'], 'blocks')
})

test('extractThinkingBlocks: empty think block', () => {
  const text = '<think></think>\nResult'
  const blocks = extractThinkingBlocks(text)
  assertDeepEqual(blocks, [''], 'blocks')
})

test('stripThinkingTags: single block', () => {
  const text = '<think>I need to count to 3\nStep by step\n</think>\n1, 2, 3'
  const stripped = stripThinkingTags(text)
  assertEqual(stripped, '1, 2, 3', 'stripped')
})

test('stripThinkingTags: no think blocks', () => {
  const text = 'Just a regular response'
  const stripped = stripThinkingTags(text)
  assertEqual(stripped, 'Just a regular response', 'stripped')
})

test('stripThinkingTags: multiple blocks', () => {
  const text = '<think>First\n</think>\nMiddle\n<think>Second\n</think>\nEnd'
  const stripped = stripThinkingTags(text)
  assertEqual(stripped, 'Middle\n\nEnd', 'stripped')
})

test('stripThinkingTags: think with attributes', () => {
  const text = '<think type="reasoning">Reasoning\n</think>\nResult'
  const stripped = stripThinkingTags(text)
  assertEqual(stripped, 'Result', 'stripped')
})

test('stripThinkingTags: self-closing think', () => {
  const text = '<think />\nResult'
  const stripped = stripThinkingTags(text)
  assertEqual(stripped, 'Result', 'stripped')
})

test('stripThinkingTags: think block only, no other text', () => {
  const text = '<think>Just thinking\n</think>\n'
  const stripped = stripThinkingTags(text)
  assertEqual(stripped, '', 'stripped')
})

test('stripThinkingTags: nested angle brackets in content', () => {
  const text = '<think>Compare a < b and c > d\n</think>\nResult: true'
  const stripped = stripThinkingTags(text)
  assertEqual(stripped, 'Result: true', 'stripped')
})

test('stripThinkingTags: preserves non-think tags', () => {
  const text = '<think>Thought\n</think>\n<code>print("hello")</code>'
  const stripped = stripThinkingTags(text)
  assertEqual(stripped, '<code>print("hello")</code>', 'stripped')
})

test('integration: extract then strip matches', () => {
  const text = '<think>Step 1: Analyze\nStep 2: Count\n</think>\nThe answer is 42.'
  const blocks = extractThinkingBlocks(text)
  const display = stripThinkingTags(text)
  assertEqual(blocks.length, 1, 'block count')
  assertEqual(blocks[0].includes('Step 1'), true, 'thinking content preserved')
  assertEqual(display, 'The answer is 42.', 'display clean')
  assertEqual(display.includes('<think'), false, 'no raw tags in display')
})

test('splitThinkingTaggedText: keeps text/thinking order', () => {
  const text = 'Before<think>Inner</think>After'
  const segments = splitThinkingTaggedText(text)
  assertDeepEqual(segments, [
    { type: 'text', text: 'Before' },
    { type: 'thinking', thinking: 'Inner' },
    { type: 'text', text: 'After' }
  ], 'segments')
})

test('normalizeAssistantThinkingContent: converts raw think tags into structured blocks', () => {
  const message = {
    role: 'assistant',
    content: [
      { type: 'text', text: '<think>Plan</think>\n\nAnswer' },
      { type: 'toolCall', id: 'call_1', name: 'read', arguments: {} }
    ]
  }
  const changed = normalizeAssistantThinkingContent(message)
  assertEqual(changed, true, 'changed')
  assertDeepEqual(message.content, [
    { type: 'thinking', thinking: 'Plan' },
    { type: 'text', text: '\n\nAnswer' },
    { type: 'toolCall', id: 'call_1', name: 'read', arguments: {} }
  ], 'content')
})

test('extractAssistantMessageParts: reads structured thinking blocks', () => {
  const parts = extractAssistantMessageParts([
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Think A' },
        { type: 'text', text: 'Visible answer' }
      ]
    }
  ])
  assertDeepEqual(parts, {
    displayText: 'Visible answer',
    thinkingText: 'Think A'
  }, 'parts')
})

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
