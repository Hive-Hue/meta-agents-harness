import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeTaskDescription } from '../scripts/task-description.mjs'

test('sanitizeTaskDescription strips caveman blocks and routing boilerplate', () => {
  const raw = `
[CAVEMAN_CREW]
Mode: wenyan-full. Active every response. No revert.
[/CAVEMAN_CREW]
Implement the context-memory runtime visibility slice.

Routing note from orchestrator:
- Requested worker target: backend-dev
- Team: Engineering
- Delegate internally ONLY to this worker and return worker-specific status/evidence.
`.trim()

  const sanitized = sanitizeTaskDescription(raw, 200)
  assert.equal(sanitized, 'Implement the context-memory runtime visibility slice.')
})

test('sanitizeTaskDescription strips ANSI escapes and keeps useful task text', () => {
  const raw = '\u001b[0m[CAVEMAN_CREW] noisy [/CAVEMAN_CREW]\u001b[0m Fix lifecycle event persistence for delegate traces'
  const sanitized = sanitizeTaskDescription(raw, 200)
  assert.equal(sanitized, 'Fix lifecycle event persistence for delegate traces')
})

