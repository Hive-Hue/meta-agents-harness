const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*m/g
const CAVEMAN_BLOCK_RE = /\[CAVEMAN_CREW\][\s\S]*?\[\/CAVEMAN_CREW\]/g
const ROUTING_BLOCK_RE = /\n*Routing note from orchestrator:\n(?:- .*\n?)*/gi

function cleanTaskLine(line) {
  return line
    .replace(/^#+\s*/, '')
    .replace(/^[-*]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isBoilerplateLine(line) {
  return /^routing note from orchestrator:?$/i.test(line)
    || /^requested worker target/i.test(line)
    || /^requested worker targets/i.test(line)
    || /^team:/i.test(line)
    || /^delegate internally only/i.test(line)
    || /^\[\/?caveman_crew\]/i.test(line)
}

export function sanitizeTaskDescription(task, limit = 200) {
  const raw = typeof task === 'string' ? task : ''
  if (!raw.trim()) return ''

  const stripped = raw
    .replace(ANSI_ESCAPE_RE, '')
    .replace(CAVEMAN_BLOCK_RE, '')
    .replace(ROUTING_BLOCK_RE, '\n')

  const lines = stripped
    .split('\n')
    .map(cleanTaskLine)
    .filter((line) => line && !isBoilerplateLine(line))

  const collapsed = lines.join(' ').replace(/\s+/g, ' ').trim()
  if (!collapsed) return ''
  if (collapsed.length <= limit) return collapsed
  return collapsed.slice(0, Math.max(0, limit - 3)).trimEnd() + '...'
}

