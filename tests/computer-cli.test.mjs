import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { main } from '../scripts/computer/computer-cli.mjs'

async function capture(fn) {
  const original = console.log
  const lines = []
  console.log = (...args) => lines.push(args.join(' '))
  try { await fn() } finally { console.log = original }
  return lines.map(line => JSON.parse(line))
}

test('init creates disabled pinned-version template and refuses overwrite', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mah-computer-cli-'))
  try {
    const file = path.join(root, 'computer.json')
    const result = await capture(() => main(['init', '--config', file], { stateRoot: root }))
    assert.equal(result[0].ok, true)
    const config = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(config.expected_version, 'SET_VERIFIED_MCP_VERSION')
    assert.equal(config.allow_actions, false)
    assert.deepEqual(config.apps, [])
    await assert.rejects(() => main(['init', '--config', file], { stateRoot: root }), /refusing to overwrite/)
    await assert.rejects(() => main(['init', '--config'], { stateRoot: root }), /Missing value/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('doctor reports unpinned and paused state without touching driver', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mah-computer-cli-'))
  const file = path.join(root, 'computer.json')
  let connects = 0
  const connect = async () => { connects++; throw new Error('must not connect') }
  try {
    await capture(() => main(['init', '--config', file], { stateRoot: root }))
    const unpinned = await capture(() => main(['doctor', '--config', file], { stateRoot: root, connect }))
    assert.equal(unpinned[0].configured, false)
    assert.equal(connects, 0)
    process.exitCode = 0
    await capture(() => main(['pause', '--config', file], { stateRoot: root }))
    const paused = await capture(() => main(['doctor', '--config', file], { stateRoot: root, connect }))
    assert.equal(paused[0].paused, true)
    assert.equal(connects, 0)
  } finally { process.exitCode = 0; rmSync(root, { recursive: true, force: true }) }
})

test('doctor with pinned version calls only catalog and desktop_status', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mah-computer-cli-'))
  const file = path.join(root, 'computer.json')
  try {
    await capture(() => main(['init', '--config', file], { stateRoot: root }))
    const config = JSON.parse(readFileSync(file, 'utf8'))
    config.expected_version = 'verified-1'
    writeFileSync(file, JSON.stringify(config))
    const calls = []
    const driver = { version: 'verified-1', listTools: async () => { calls.push('list'); return { tools: [{ name: 'desktop_status' }] } }, callTool: async name => { calls.push(name); return { structuredContent: { ok: true } } }, close: async () => { calls.push('close') } }
    const result = await capture(() => main(['doctor', '--config', file], { stateRoot: root, connect: async () => driver }))
    assert.equal(result[0].ok, true)
    assert.deepEqual(calls, ['list', 'desktop_status', 'close'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
