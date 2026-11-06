import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'

test('MCP bridge preserves image blocks, resource references, structured fallback and errors', async () => {
  const source = readFileSync(new URL('../extensions/mcp-bridge.ts', import.meta.url), 'utf8')
  // Compile the actual module without runtime-specific PI imports. Only the pure
  // exported result adapter is exercised; no session or network is started.
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/^import .*;\r?\n/gm, '')
  const { normalizeMcpToolResult } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
  const image = { type: 'image', mimeType: 'image/png', data: 'YWJj' }
  const linked = { type: 'resource_link', uri: 'artifact://snapshot', name: 'snapshot' }
  const normalized = normalizeMcpToolResult({ content: [image, linked], isError: true })
  assert.deepEqual(normalized.content[0], image)
  assert.equal(normalized.isError, true)
  assert.equal(JSON.parse(normalized.content[1].text).uri, linked.uri)
  assert.equal(normalizeMcpToolResult({ structuredContent: { ok: true } }).content[0].text, '{\n  "ok": true\n}')
  const unsupported = normalizeMcpToolResult({ content: [{ type: 'audio', data: 'PRIVATE_BINARY' }] })
  assert.ok(!JSON.stringify(unsupported).includes('PRIVATE_BINARY'))
})

test('MCP sync honors empty and scoped PI bindings without widening access', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mah-mcp-bindings-'))
  const cli = fileURLToPath(new URL('../scripts/mcp/mcp-cli.mjs', import.meta.url))
  try {
    mkdirSync(path.join(root, '.mah', 'mcp'), { recursive: true })
    const registryPath = path.join(root, '.mah', 'mcp', 'servers.json')
    const registry = { servers: { desktop: { command: 'fake-driver', args: [] }, docs: { command: 'fake-docs', args: [] } }, runtime_bindings: { pi: [], claude: [], opencode: [] } }
    writeFileSync(registryPath, JSON.stringify(registry))
    let result = spawnSync(process.execPath, [cli, 'sync', '--json'], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, '.pi', 'mcp-servers.json'), 'utf8')).servers, {})
    registry.runtime_bindings.pi = ['docs']
    writeFileSync(registryPath, JSON.stringify(registry))
    result = spawnSync(process.execPath, [cli, 'sync', '--json'], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(root, '.pi', 'mcp-servers.json'), 'utf8')).servers), ['docs'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
