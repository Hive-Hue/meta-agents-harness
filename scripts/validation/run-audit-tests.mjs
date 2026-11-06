import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const suites = [
  'runtime-contract', 'headless-contract', 'headless-codex', 'child-agent-spawn',
  'mah-delegate-agent-handler', 'agent-execution-result', 'tasks-cli', 'missions-cli',
  'tasks-reliability', 'context-memory-workspace', 'mcp-result-bindings', 'mcp-bridge-timeout',
]
const tests = suites.map(name => `tests/${name}.test.mjs`)
for (const name of readdirSync(path.join(root, 'tests')).sort()) {
  if (/^(computer-|webui-).+\.test\.mjs$/.test(name)) tests.push(`tests/${name}`)
}
tests.push('tests/expertise/evidence-pipeline.test.mjs', 'tests/expertise/evidence-recording.test.mjs')
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...tests], { cwd: root, stdio: 'inherit', windowsHide: true })
if (result.error) console.error(result.error.message)
process.exitCode = result.status ?? 1
