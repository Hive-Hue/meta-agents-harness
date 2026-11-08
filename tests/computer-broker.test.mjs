import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ComputerBroker, computerStatePaths, setComputerPaused, validateComputerConfig } from '../scripts/computer/broker.mjs'

const ref = '@window:e1'
const ok = data => ({ structuredContent: { ok: true, data } })
function fixture(overrides = {}) {
  const stateRoot = mkdtempSync(path.join(os.tmpdir(), 'mah-computer-test-'))
  let policy = { schema: 'mah.computer.v1', environment_id: 'a', principal_id: 'operator', platform: process.platform, command: 'fake-desktop', args: [], expected_version: '1.2.3', apps: ['Editor'], tools: ['desktop_snapshot', 'desktop_click', 'desktop_status', 'desktop_type'], allow_actions: true, timeout_ms: 200, max_actions: 3, ...overrides }
  const calls = []
  const driver = { version: '1.2.3', closed: false, listTools: async () => ({ tools: policy.tools.map(name => ({ name })) }), callTool: async (name, args) => { calls.push({ name, args }); return name === 'desktop_snapshot' ? ok({ tree: [{ ref_id: ref }] }) : ok({}) }, close: async () => { driver.closed = true } }
  const broker = new ComputerBroker({ config: policy, driver, stateRoot, loadConfig: () => policy })
  return { broker, driver, calls, stateRoot, get policy() { return policy }, set policy(value) { policy = value }, cleanup: () => rmSync(stateRoot, { recursive: true, force: true }) }
}
function message(result) { return JSON.parse(result.content[0].text).error.message }

test('policy rejects arbitrary scopes and action argument bypasses', async () => {
  const f = fixture()
  try {
    assert.match(message(await f.broker.callTool('desktop_snapshot', { app: 'Editor', window_id: 'other' })), /STALE_WINDOW/)
    assert.match(message(await f.broker.callTool('desktop_snapshot', { app: 'Other' })), /app is not allowed; use an exact app name from the allowlist \(Editor\)/)
    assert.match(message(await f.broker.callTool('desktop_status', { command: 'shell' })), /unsupported desktop_status argument/)
    assert.match(message(await f.broker.callTool('desktop_click', { ref_id: ref })), /STALE_REF/)
    await f.broker.callTool('desktop_snapshot', { app: 'Editor' })
    assert.match(message(await f.broker.callTool('desktop_click', { ref_id: ref, force: true })), /unsupported desktop_click argument/)
    assert.match(message(await f.broker.callTool('desktop_type', { ref_id: ref, text: 'x'.repeat(20_000) })), /Invalid text/)
    assert.match(message(await f.broker.callTool('desktop_launch', {})), /tool is not allowed/)
    assert.equal(f.calls.length, 1)
  } finally { f.cleanup() }
})

test('app and action revocation reload before dispatch; ref consumed after action', async () => {
  const f = fixture()
  try {
    await f.broker.callTool('desktop_snapshot', { app: 'Editor' })
    f.policy = { ...f.policy, apps: [] }
    assert.match(message(await f.broker.callTool('desktop_click', { ref_id: ref })), /observed app was revoked/)
    f.policy = { ...f.policy, apps: ['Editor'] }
    assert.equal((await f.broker.callTool('desktop_click', { ref_id: ref })).structuredContent.ok, true)
    assert.match(message(await f.broker.callTool('desktop_click', { ref_id: ref })), /STALE_REF/)
    await f.broker.callTool('desktop_snapshot', { app: 'Editor' })
    f.policy = { ...f.policy, tools: ['desktop_snapshot'], allow_actions: false }
    assert.match(message(await f.broker.callTool('desktop_click', { ref_id: ref })), /tool is not allowed/)
  } finally { f.cleanup() }
})

test('global lease and takeover cross environment IDs', async () => {
  const f = fixture()
  try {
    const other = computerStatePaths({ environment_id: 'other' }, f.stateRoot)
    assert.equal(other.lock, f.broker.paths.lock)
    setComputerPaused(other, true)
    assert.match(message(await f.broker.callTool('desktop_status', {})), /DESKTOP_PAUSED/)
    setComputerPaused(other, false)
    assert.equal((await f.broker.callTool('desktop_status', {})).structuredContent.ok, true)
  } finally { f.cleanup() }
})

test('desktop calls refuse concurrency with a safe retry instruction', async () => {
  const f = fixture()
  try {
    let finish
    f.driver.callTool = () => new Promise(resolve => { finish = resolve })
    const first = f.broker.callTool('desktop_snapshot', { app: 'Editor' })
    assert.equal(f.broker.busy, true)
    assert.match(message(await f.broker.callTool('desktop_status', {})), /wait for its result.*Do not send parallel desktop calls/)
    finish(ok({ tree: [{ ref_id: ref }] }))
    assert.equal((await first).structuredContent.ok, true)
  } finally { f.cleanup() }
})

test('launch keeps upstream arguments, enforces app policy, and invalidates old refs', async () => {
  const f = fixture({ tools: ['desktop_snapshot', 'desktop_launch', 'desktop_click', 'desktop_status', 'desktop_type'], timeout_ms: 200, launch_timeout_ms: 5000 })
  try {
    let driverTimeout
    const call = f.driver.callTool
    f.driver.callTool = async (name, args, options) => { driverTimeout = options.timeout; return call(name, args, options) }
    await f.broker.callTool('desktop_snapshot', { app: 'Editor' })
    assert.equal(driverTimeout, 200)
    const launched = await f.broker.callTool('desktop_launch', { app: 'Editor', activate: false })
    assert.equal(driverTimeout, 5000)
    assert.equal(launched.structuredContent.ok, true)
    assert.deepEqual(f.calls.at(-1), { name: 'desktop_launch', args: { app: 'Editor', activate: false } })
    assert.match(message(await f.broker.callTool('desktop_click', { ref_id: ref })), /STALE_REF/)
    const launchedWithOptions = await f.broker.callTool('desktop_launch', { app: 'Editor', args: ['--safe-test-arg'] })
    assert.equal(launchedWithOptions.structuredContent.ok, true)
    assert.deepEqual(f.calls.at(-1), { name: 'desktop_launch', args: { app: 'Editor', args: ['--safe-test-arg'] } })
    const callCount = f.calls.length
    assert.match(message(await f.broker.callTool('desktop_launch', { app: 'Other' })), /exact app name from the allowlist/)
    assert.equal(f.calls.length, callCount)
  } finally { f.cleanup() }
})

test('desktop_set_value writes through an observed field ref and consumes it', async () => {
  const f = fixture({ tools: ['desktop_snapshot', 'desktop_set_value'] })
  try {
    await f.broker.callTool('desktop_snapshot', { app: 'Editor' })
    const result = await f.broker.callTool('desktop_set_value', { ref_id: ref, value: 'MAH computer-use verification' })
    assert.equal(result.structuredContent.ok, true)
    assert.deepEqual(f.calls.at(-1), { name: 'desktop_set_value', args: { ref_id: ref, value: 'MAH computer-use verification' } })
    assert.match(message(await f.broker.callTool('desktop_set_value', { ref_id: ref, value: 'again' })), /STALE_REF/)
  } finally { f.cleanup() }
})

test('allow_all_apps explicitly bypasses app enums while preserving tool policy', async () => {
  const f = fixture({ apps: [], allow_all_apps: true, tools: ['desktop_snapshot', 'desktop_launch'] })
  try {
    f.driver.listTools = async () => ({ tools: [
      { name: 'desktop_snapshot', description: 'Capture app', inputSchema: { properties: { app: { type: 'string' }, include_bounds: { type: 'boolean' } } } },
      { name: 'desktop_launch', description: 'Launch app', inputSchema: { properties: { app: { type: 'string' }, activate: { type: 'boolean' } } } }
    ] })
    const { tools } = await f.broker.listTools()
    const snapshot = tools.find(tool => tool.name === 'desktop_snapshot')
    const launch = tools.find(tool => tool.name === 'desktop_launch')
    assert.equal(snapshot.inputSchema.properties.app.enum, undefined)
    assert.match(snapshot.description, /Policy permits any app/)
    assert.equal(launch.inputSchema.properties.app.enum, undefined)
    assert.equal((await f.broker.callTool('desktop_snapshot', { app: 'Paint.exe' })).structuredContent.ok, true)
    assert.match(message(await f.broker.callTool('desktop_launch', { app: '' })), /app identifier is required/)
  } finally { f.cleanup() }
})

test('window ids are app-scoped observations and expire after a mutation', async () => {
  const f = fixture({ apps: [], allow_all_apps: true, tools: ['desktop_list_windows', 'desktop_snapshot', 'desktop_focus_window', 'desktop_click'] })
  try {
    f.driver.listTools = async () => ({ tools: [
      { name: 'desktop_list_windows', inputSchema: { properties: { app: { type: 'string' } } } },
      { name: 'desktop_snapshot', inputSchema: { properties: { app: { type: 'string' }, window_id: { type: 'string' }, include_bounds: { type: 'boolean' } } } },
      { name: 'desktop_focus_window', inputSchema: { properties: { app: { type: 'string' }, window_id: { type: 'string' } } } },
      { name: 'desktop_click', inputSchema: { properties: { ref_id: { type: 'string' } } } }
    ] })
    f.driver.callTool = async (name, args) => {
      f.calls.push({ name, args })
      if (name === 'desktop_list_windows') return ok([
        { id: 'w-writer', app_name: 'Editor', title: 'Writer' },
        { id: 'w-other', app_name: 'Other', title: 'Other app' }
      ])
      if (name === 'desktop_snapshot') return ok({ snapshot_id: 'snapshot-writer', window: { id: args.window_id }, tree: [{ ref_id: ref }] })
      return ok({})
    }
    const { tools } = await f.broker.listTools()
    const listWindows = tools.find(tool => tool.name === 'desktop_list_windows')
    assert.deepEqual(listWindows.inputSchema.required, undefined)
    const listed = await f.broker.callTool('desktop_list_windows', { app: 'Editor' })
    assert.deepEqual(listed.structuredContent.data, [{ id: 'w-writer', app_name: 'Editor', title: 'Writer' }])
    assert.match(message(await f.broker.callTool('desktop_snapshot', { app: 'Editor', window_id: 'w-other' })), /STALE_WINDOW/)
    assert.match(message(await f.broker.callTool('desktop_focus_window', { app: 'Editor', window_id: 'w-other' })), /STALE_WINDOW/)
    const focused = await f.broker.callTool('desktop_focus_window', { app: 'Editor', window_id: 'w-writer' })
    assert.equal(focused.structuredContent.ok, true)
    assert.deepEqual(f.calls.at(-1), { name: 'desktop_focus_window', args: { app: 'Editor', window_id: 'w-writer' } })
    assert.match(message(await f.broker.callTool('desktop_snapshot', { app: 'Editor', window_id: 'w-writer' })), /STALE_WINDOW/)
    await f.broker.callTool('desktop_list_windows', { app: 'Editor' })
    const snapshot = await f.broker.callTool('desktop_snapshot', { app: 'Editor', window_id: 'w-writer', include_bounds: true })
    assert.equal(snapshot.structuredContent.ok, true)
    assert.deepEqual(f.calls.at(-1), { name: 'desktop_snapshot', args: { app: 'Editor', window_id: 'w-writer', include_bounds: true } })
    assert.equal((await f.broker.callTool('desktop_click', { ref_id: ref })).structuredContent.ok, true)
    assert.match(message(await f.broker.callTool('desktop_snapshot', { app: 'Editor', window_id: 'w-writer' })), /STALE_WINDOW/)
  } finally { f.cleanup() }
})

test('desktop_drag is headed, canvas-bounded, distance-limited, and consumes refs', async () => {
  const f = fixture({ apps: [], allow_all_apps: true, args: ['--headed'], tools: ['desktop_snapshot', 'desktop_list_windows', 'desktop_drag'] })
  try {
    f.driver.listTools = async () => ({ tools: [
      { name: 'desktop_snapshot', inputSchema: { properties: { app: { type: 'string' }, window_id: { type: 'string' }, include_bounds: { type: 'boolean' } } } },
      { name: 'desktop_list_windows', inputSchema: { properties: { app: { type: 'string' } } } },
      { name: 'desktop_drag', description: 'Headed drag', inputSchema: { properties: { from_xy: { type: 'string' }, to_xy: { type: 'string' }, duration: { type: 'integer' } }, required: ['from_xy', 'to_xy'] } }
    ] })
    const { tools } = await f.broker.listTools()
    const dragTool = tools.find(tool => tool.name === 'desktop_drag')
    assert.deepEqual(dragTool.inputSchema.required, ['from_xy', 'to_xy', 'app', 'window_id'])
    assert.match(dragTool.inputSchema.properties.canvas_ref.description, /data\.mah_canvases/)
    assert.match(dragTool.description, /allow_actions=true/)
    const driverCall = f.driver.callTool
    f.driver.callTool = async (name, args, options) => {
      if (name === 'desktop_list_windows') {
        f.calls.push({ name, args })
        return ok([{ id: 'w-paint', app_name: 'Paint.exe', bounds: { x: 0, y: 0, width: 900, height: 700 } }])
      }
      if (name === 'desktop_snapshot') {
        const payload = { ok: true, data: { snapshot_id: 'snapshot-1', tree: { children: [{ name: 'Drawing Canvas', role: 'group', bounds: { x: 100, y: 80, width: 500, height: 400 } }] } } }
        return { structuredContent: payload, content: [{ type: 'text', text: JSON.stringify(payload) }] }
      }
      return driverCall(name, args, options)
    }
    await f.broker.callTool('desktop_list_windows', { app: 'Paint.exe' })
    const snapshot = await f.broker.callTool('desktop_snapshot', { app: 'Paint.exe', window_id: 'w-paint', include_bounds: true })
    const canvas = snapshot.structuredContent.data.mah_canvases[0]
    assert.deepEqual(canvas, { canvas_ref: 'mah-canvas:snapshot-1:1', name: 'Drawing Canvas', bounds: { x: 100, y: 80, width: 500, height: 400 } })
    assert.deepEqual(JSON.parse(snapshot.content[0].text).data.mah_canvases, [canvas])
    const dragScope = { app: 'Paint.exe', window_id: 'w-paint' }
    assert.match(message(await f.broker.callTool('desktop_drag', { ...dragScope, canvas_ref: canvas.canvas_ref, from_xy: '50,90', to_xy: '180,160' })), /inside the observed window and canvas bounds/)
    const drawn = await f.broker.callTool('desktop_drag', { ...dragScope, canvas_ref: canvas.canvas_ref, from_xy: '150,120', to_xy: '260,220', duration: 700 })
    assert.equal(drawn.structuredContent.ok, true)
    assert.deepEqual(f.calls.at(-1), { name: 'desktop_drag', args: { from_xy: '150,120', to_xy: '260,220', duration: 700 } })
    assert.match(message(await f.broker.callTool('desktop_drag', { ...dragScope, canvas_ref: canvas.canvas_ref, from_xy: '150,120', to_xy: '260,220' })), /STALE_WINDOW/)
  } finally { f.cleanup() }
})

test('deadline closes driver before releasing lease; failed shutdown retains lease', async () => {
  const f = fixture({ timeout_ms: 100 })
  try {
    let closeRelease
    const closing = new Promise(resolve => { closeRelease = resolve })
    f.driver.callTool = async name => name === 'desktop_snapshot' ? ok({ ref_id: ref }) : new Promise(() => {})
    f.driver.close = async () => { await closing; f.driver.closed = true }
    await f.broker.callTool('desktop_snapshot', { app: 'Editor' })
    const pending = f.broker.callTool('desktop_click', { ref_id: ref })
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(existsSync(f.broker.paths.lock), true)
    closeRelease()
    assert.match(message(await pending), /Cancelled or deadline exceeded/)
    assert.equal(f.driver.closed, true)
    assert.equal(existsSync(f.broker.paths.lock), false)
  } finally { f.cleanup() }

  const g = fixture({ timeout_ms: 100 })
  try {
    g.driver.callTool = async name => name === 'desktop_snapshot' ? ok({ ref_id: ref }) : new Promise(() => {})
    g.driver.close = async () => { throw new Error('shutdown failed') }
    await g.broker.callTool('desktop_snapshot', { app: 'Editor' })
    assert.match(message(await g.broker.callTool('desktop_click', { ref_id: ref })), /Cancelled or deadline exceeded/)
    assert.equal(existsSync(g.broker.paths.lock), true)
  } finally { g.cleanup() }
})

test('config pins platform, version and supported tools', async () => {
  const f = fixture()
  try {
    assert.throws(() => validateComputerConfig({ ...f.policy, platform: process.platform === 'win32' ? 'linux' : 'win32' }), /target OS/)
    assert.throws(() => validateComputerConfig({ ...f.policy, tools: ['invalid'] }), /Unsupported tool/)
    assert.equal(validateComputerConfig({ ...f.policy, tools: ['desktop_launch'], allow_actions: false }).allow_actions, false)
    assert.throws(() => validateComputerConfig({ ...f.policy, tools: ['desktop_drag'], args: [] }), /require the explicit --headed driver mode/)
    assert.throws(() => validateComputerConfig({ ...f.policy, launch_timeout_ms: 999 }), /launch_timeout_ms must be 1000..120000/)
    assert.equal(validateComputerConfig(f.policy).launch_timeout_ms, 60000)
    assert.throws(() => validateComputerConfig({ ...f.policy, allow_all_apps: 'true' }), /allow_all_apps must be a boolean/)
    f.driver.version = 'different'
    assert.match(message(await f.broker.callTool('desktop_status', {})), /Driver version/)
  } finally { f.cleanup() }
})

test('advertised snapshot schema matches supported upstream max_depth and policy scope', async () => {
  const f = fixture()
  try {
    f.driver.listTools = async () => ({ tools: [{ name: 'desktop_snapshot', inputSchema: { properties: { app: { type: 'string' }, max_depth: { type: 'integer' }, window_id: { type: 'string' }, surface: { type: 'string' } } } }] })
    const catalog = await f.broker.listTools()
    assert.deepEqual(Object.keys(catalog.tools[0].inputSchema.properties), ['app', 'max_depth', 'window_id', 'surface'])
    assert.deepEqual(catalog.tools[0].inputSchema.required, undefined)
    assert.equal((await f.broker.callTool('desktop_snapshot', { app: 'Editor', max_depth: 5 })).structuredContent.ok, true)
    assert.match(message(await f.broker.callTool('desktop_snapshot', { app: 'Editor', depth: 5 })), /unsupported desktop_snapshot argument/)
  } finally { f.cleanup() }
})

test('advertised app-scoped tool schemas enumerate exact allowlisted names and safe launch args', async () => {
  const f = fixture({ tools: ['desktop_snapshot', 'desktop_list_windows', 'desktop_focus_window', 'desktop_launch'] })
  try {
    f.driver.listTools = async () => ({ tools: [
      { name: 'desktop_snapshot', description: 'Capture the app tree', inputSchema: { properties: { app: { type: 'string', description: 'App' }, compact: { type: 'boolean' }, window_id: { type: 'string' } } } },
      { name: 'desktop_list_windows', description: 'List windows', inputSchema: { properties: { app: { type: 'string', description: 'App' }, timeout_ms: { type: 'integer' } } } },
      { name: 'desktop_focus_window', description: 'Focus window', inputSchema: { properties: { window_id: { type: 'string' }, force: { type: 'boolean' } } } },
      { name: 'desktop_launch', description: 'Launch app', inputSchema: { properties: { app: { type: 'string' }, activate: { type: 'boolean' }, args: { type: 'array' }, env: { type: 'array' } } } }
    ] })
    const { tools } = await f.broker.listTools()
    const snapshot = tools.find(tool => tool.name === 'desktop_snapshot')
    const windows = tools.find(tool => tool.name === 'desktop_list_windows')
    const focus = tools.find(tool => tool.name === 'desktop_focus_window')
    const launch = tools.find(tool => tool.name === 'desktop_launch')
    assert.deepEqual(snapshot.inputSchema.properties.app.enum, ['Editor'])
    assert.match(snapshot.description, /Allowed app names: Editor/)
    assert.deepEqual(Object.keys(windows.inputSchema.properties), ['app', 'timeout_ms'])
    assert.deepEqual(windows.inputSchema.properties.app.enum, ['Editor'])
    assert.equal(windows.inputSchema.required, undefined)
    assert.deepEqual(Object.keys(focus.inputSchema.properties), ['window_id', 'force', 'app'])
    assert.deepEqual(focus.inputSchema.properties.app.enum, ['Editor'])
    assert.deepEqual(focus.inputSchema.required, ['app', 'window_id'])
    assert.match(focus.description, /latest desktop_list_windows call/)
    assert.deepEqual(Object.keys(launch.inputSchema.properties), ['app', 'activate', 'args', 'env'])
    assert.deepEqual(launch.inputSchema.properties.app.enum, ['Editor'])
    assert.deepEqual(launch.inputSchema.required, ['app'])
    assert.match(launch.description, /Use only when the app is not already open/)
  } finally { f.cleanup() }
})

test('app-scoped tools are hidden when the policy has no allowed apps', async () => {
  const f = fixture({ apps: [], tools: ['desktop_snapshot', 'desktop_list_windows', 'desktop_focus_window', 'desktop_launch', 'desktop_status'] })
  try {
    const { tools } = await f.broker.listTools()
    assert.deepEqual(tools.map(tool => tool.name), ['desktop_status'])
  } finally { f.cleanup() }
})

test('skills are forwarded to the pinned driver instead of using a stale built-in list', async () => {
  const f = fixture({ tools: ['desktop_skills_get'] })
  try {
    const result = await f.broker.callTool('desktop_skills_get', { name: 'windows' })
    assert.equal(result.structuredContent.ok, true)
    assert.deepEqual(f.calls.at(-1), { name: 'desktop_skills_get', args: { name: 'windows' } })
  } finally { f.cleanup() }
})

test('wildcard mirrors future pinned-driver tools while action and headed gates remain active', async () => {
  const f = fixture({ tools: ['*'], args: ['--headed'] })
  try {
    f.driver.listTools = async () => ({ tools: [
      { name: 'desktop_snapshot', inputSchema: { properties: { app: { type: 'string' } } } },
      { name: 'desktop_session_start', inputSchema: { properties: { name: { type: 'string' } } } },
      { name: 'desktop_cursor_overlay_enable', inputSchema: { properties: { label: { type: 'string' } } } },
      { name: 'desktop_clipboard_set', inputSchema: { properties: { text: { type: 'string' } } } },
      { name: 'desktop_mouse_click', inputSchema: { properties: { xy: { type: 'string' } } } },
      { name: 'desktop_trace_export', inputSchema: { properties: { out: { type: 'string' } } } }
    ] })
    const { tools } = await f.broker.listTools()
    assert.deepEqual(tools.map(tool => tool.name), ['desktop_snapshot', 'desktop_session_start', 'desktop_cursor_overlay_enable', 'desktop_clipboard_set', 'desktop_mouse_click', 'desktop_trace_export'])
    assert.deepEqual(Object.keys(tools[1].inputSchema.properties), ['name'])
  } finally { f.cleanup() }
})

test('wildcard does not expose mutations or physical input until explicitly enabled', async () => {
  const f = fixture({ tools: ['*'], allow_actions: false, args: [] })
  try {
    f.driver.listTools = async () => ({ tools: [
      { name: 'desktop_status', inputSchema: { properties: {} } },
      { name: 'desktop_permissions', inputSchema: { properties: { guide: { type: 'boolean' }, request: { type: 'boolean' } } } },
      { name: 'desktop_clipboard_set', inputSchema: { properties: { text: { type: 'string' } } } },
      { name: 'desktop_mouse_click', inputSchema: { properties: { xy: { type: 'string' } } } }
    ] })
    const { tools } = await f.broker.listTools()
    assert.deepEqual(tools.map(tool => tool.name), ['desktop_status', 'desktop_permissions'])
    assert.deepEqual(Object.keys(tools[1].inputSchema.properties), [])
  } finally { f.cleanup() }
})

test('physical pointer actions are window-bounded and focus the observed target', async () => {
  const f = fixture({ tools: ['desktop_list_windows', 'desktop_mouse_click'], args: ['--headed'] })
  try {
    f.driver.listTools = async () => ({ tools: [
      { name: 'desktop_list_windows', inputSchema: { properties: { app: { type: 'string' } } } },
      { name: 'desktop_mouse_click', inputSchema: { properties: { xy: { type: 'string' } } } }
    ] })
    f.driver.callTool = async (name, args) => {
      f.calls.push({ name, args })
      if (name === 'desktop_list_windows') return ok([{ id: 'w-editor', app_name: 'Editor', bounds: { x: 0, y: 0, width: 100, height: 100 } }])
      return ok({})
    }
    await f.broker.listTools()
    await f.broker.callTool('desktop_list_windows', { app: 'Editor' })
    const clicked = await f.broker.callTool('desktop_mouse_click', { app: 'Editor', window_id: 'w-editor', xy: '50,60' })
    assert.equal(clicked.structuredContent.ok, true)
    assert.deepEqual(f.calls.slice(-2), [
      { name: 'desktop_focus_window', args: { window_id: 'w-editor' } },
      { name: 'desktop_mouse_click', args: { xy: '50,60' } }
    ])
    await f.broker.callTool('desktop_list_windows', { app: 'Editor' })
    const callCount = f.calls.length
    assert.match(message(await f.broker.callTool('desktop_mouse_click', { app: 'Editor', window_id: 'w-editor', xy: '120,60' })), /stay inside the observed window bounds/)
    assert.equal(f.calls.length, callCount)
  } finally { f.cleanup() }
})

test('desktop_batch keeps child policy, window bounds, and automatic focus', async () => {
  const f = fixture({ tools: ['desktop_batch', 'desktop_list_windows', 'desktop_mouse_click'], args: ['--headed'] })
  try {
    f.driver.listTools = async () => ({ tools: [
      { name: 'desktop_batch', inputSchema: { properties: { commands_json: { type: 'string' }, stop_on_error: { type: 'boolean' } }, required: ['commands_json'] } },
      { name: 'desktop_list_windows', inputSchema: { properties: { app: { type: 'string' } } } },
      { name: 'desktop_mouse_click', inputSchema: { properties: { xy: { type: 'string' } }, required: ['xy'] } }
    ] })
    f.driver.callTool = async (name, args) => {
      f.calls.push({ name, args })
      if (name === 'desktop_list_windows') return ok([{ id: 'w-editor', app_name: 'Editor', bounds: { x: 0, y: 0, width: 100, height: 100 } }])
      return ok({})
    }
    await f.broker.listTools()
    await f.broker.callTool('desktop_list_windows', { app: 'Editor' })
    const commands = [{ command: 'mouse-click', args: { app: 'Editor', window_id: 'w-editor', xy: '25,25' } }]
    const result = await f.broker.callTool('desktop_batch', { commands_json: JSON.stringify(commands) })
    assert.equal(result.structuredContent.ok, true)
    assert.deepEqual(JSON.parse(f.calls.at(-1).args.commands_json), [
      { command: 'focus-window', args: { window_id: 'w-editor' } },
      { command: 'mouse-click', args: { xy: '25,25' } }
    ])
  } finally { f.cleanup() }
})

test('desktop_batch returns refs from its final snapshot for the next MAH call', async () => {
  const f = fixture({ tools: ['desktop_batch', 'desktop_snapshot', 'desktop_click'] })
  try {
    f.driver.listTools = async () => ({ tools: [
      { name: 'desktop_batch', inputSchema: { properties: { commands_json: { type: 'string' } }, required: ['commands_json'] } },
      { name: 'desktop_snapshot', inputSchema: { properties: { app: { type: 'string' } } } },
      { name: 'desktop_click', inputSchema: { properties: { ref_id: { type: 'string' } }, required: ['ref_id'] } }
    ] })
    f.driver.callTool = async (name, args) => {
      f.calls.push({ name, args })
      if (name === 'desktop_batch') return ok({ results: [{ command: 'snapshot', index: 0, ok: true, data: { tree: [{ ref_id: ref }] } }] })
      return ok({})
    }
    await f.broker.listTools()
    const batch = await f.broker.callTool('desktop_batch', { commands_json: JSON.stringify([{ command: 'snapshot', args: { app: 'Editor' } }]) })
    assert.equal(batch.structuredContent.ok, true)
    assert.equal((await f.broker.callTool('desktop_click', { ref_id: ref })).structuredContent.ok, true)
    assert.deepEqual(f.calls.at(-1), { name: 'desktop_click', args: { ref_id: ref } })
  } finally { f.cleanup() }
})

test('global surface and screenshot paths respect app scope', async () => {
  const f = fixture({ tools: ['desktop_snapshot', 'desktop_screenshot'], allow_all_apps: false })
  try {
    f.driver.listTools = async () => ({ tools: [
      { name: 'desktop_snapshot', inputSchema: { properties: { app: { type: 'string' }, surface: { type: 'string' } } } },
      { name: 'desktop_screenshot', inputSchema: { properties: { app: { type: 'string' }, screen: { type: 'integer' } } } }
    ] })
    await f.broker.listTools()
    assert.match(message(await f.broker.callTool('desktop_snapshot', { surface: 'taskbar' })), /global system surfaces require allow_all_apps/)
    assert.match(message(await f.broker.callTool('desktop_screenshot', { screen: 0 })), /screen-wide screenshots require allow_all_apps/)
    assert.match(message(await f.broker.callTool('desktop_screenshot', {})), /requires an app from the MAH allowlist/)
  } finally { f.cleanup() }
})
