import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

export const READ_TOOLS = [
  'desktop_snapshot', 'desktop_find', 'desktop_screenshot', 'desktop_get', 'desktop_is',
  'desktop_list_windows', 'desktop_list_displays', 'desktop_list_apps', 'desktop_list_surfaces',
  'desktop_list_notifications', 'desktop_clipboard_get', 'desktop_wait', 'desktop_status',
  'desktop_permissions', 'desktop_version', 'desktop_skills_list', 'desktop_skills_get',
  'desktop_skills_path', 'desktop_session_list', 'desktop_trace_show'
]
export const REF_ACTION_TOOLS = [
  'desktop_click', 'desktop_double_click', 'desktop_triple_click', 'desktop_right_click',
  'desktop_type', 'desktop_set_value', 'desktop_clear', 'desktop_focus', 'desktop_select',
  'desktop_toggle', 'desktop_check', 'desktop_uncheck', 'desktop_expand', 'desktop_collapse',
  'desktop_scroll', 'desktop_scroll_to', 'desktop_hover'
]
export const PHYSICAL_TOOLS = [
  'desktop_double_click', 'desktop_triple_click', 'desktop_hover', 'desktop_drag', 'desktop_press',
  'desktop_mouse_move', 'desktop_mouse_click', 'desktop_mouse_down', 'desktop_mouse_up',
  'desktop_mouse_wheel', 'desktop_key_down', 'desktop_key_up'
]
export const LAUNCH_TOOLS = ['desktop_launch']
export const WINDOW_TOOLS = ['desktop_focus_window', 'desktop_resize_window', 'desktop_move_window', 'desktop_minimize', 'desktop_maximize', 'desktop_restore']
const APP_SCOPED_TOOLS = [
  'desktop_list_windows', 'desktop_snapshot', 'desktop_find', 'desktop_screenshot',
  'desktop_list_surfaces', 'desktop_list_notifications', 'desktop_dismiss_notification',
  'desktop_dismiss_all_notifications', 'desktop_notification_action', 'desktop_open_system_surface',
  'desktop_launch', 'desktop_close_app', 'desktop_double_click', 'desktop_triple_click',
  'desktop_hover', 'desktop_drag', ...WINDOW_TOOLS
]
const APP_REQUIRED_TOOLS = ['desktop_list_surfaces', 'desktop_launch', 'desktop_close_app', 'desktop_double_click', 'desktop_triple_click', 'desktop_hover', 'desktop_drag', ...WINDOW_TOOLS, 'desktop_press', 'desktop_key_down', 'desktop_key_up']
const NOTIFICATION_TARGET_TOOLS = ['desktop_dismiss_notification', 'desktop_notification_action']
const COORDINATE_TOOLS = ['desktop_mouse_move', 'desktop_mouse_click', 'desktop_mouse_down', 'desktop_mouse_up', 'desktop_mouse_wheel']
const WINDOW_TARGET_TOOLS = [...WINDOW_TOOLS, 'desktop_press', 'desktop_key_down', 'desktop_key_up', 'desktop_double_click', 'desktop_triple_click', 'desktop_hover', 'desktop_drag', ...COORDINATE_TOOLS]
const HELD_INPUT_TOOLS = ['desktop_key_down', 'desktop_key_up', 'desktop_mouse_down', 'desktop_mouse_up']
const TOOL_WILDCARD = '*'
const GLOBAL_SURFACES = ['desktop', 'taskbar', 'system-tray', 'quick-settings', 'notification-center', 'dock', 'spotlight', 'menu-bar-extras', 'system-tray-overflow', 'start-menu', 'action-center']
const FALLBACK_PROPERTIES = {
  desktop_snapshot: ['app', 'window_id', 'surface', 'root', 'interactive_only', 'compact', 'skeleton', 'max_depth', 'include_bounds', 'timeout_ms', 'force_electron_a11y'],
  desktop_list_windows: ['app', 'timeout_ms'],
  desktop_focus_window: ['app', 'window_id', 'title'],
  desktop_launch: ['app', 'activate', 'args', 'cdp', 'cwd', 'env', 'no_attach', 'timeout'],
  desktop_click: ['ref_id', 'timeout_ms'],
  desktop_double_click: ['ref_id', 'timeout_ms'],
  desktop_triple_click: ['ref_id', 'timeout_ms'],
  desktop_right_click: ['ref_id', 'timeout_ms'],
  desktop_type: ['ref_id', 'text', 'interval_ms', 'timeout_ms'],
  desktop_set_value: ['ref_id', 'value', 'timeout_ms'],
  desktop_clear: ['ref_id', 'timeout_ms'],
  desktop_focus: ['ref_id', 'timeout_ms'],
  desktop_select: ['ref_id', 'value', 'timeout_ms'],
  desktop_toggle: ['ref_id', 'timeout_ms'],
  desktop_check: ['ref_id', 'timeout_ms'],
  desktop_uncheck: ['ref_id', 'timeout_ms'],
  desktop_expand: ['ref_id', 'timeout_ms'],
  desktop_collapse: ['ref_id', 'timeout_ms'],
  desktop_scroll: ['ref_id', 'direction', 'amount', 'timeout_ms'],
  desktop_scroll_to: ['ref_id', 'timeout_ms'],
  desktop_get: ['ref_id', 'property'],
  desktop_is: ['ref_id', 'property'],
  desktop_skills_get: ['name', 'full', 'reference'],
  desktop_press: ['app', 'window_id', 'combo', 'force'],
  desktop_drag: ['from', 'from_xy', 'to', 'to_xy', 'duration', 'drop_delay', 'timeout_ms', 'wait_for_scope'],
  desktop_status: [],
  desktop_version: []
}
const REF_PATTERN = /^@[A-Za-z0-9_-]+:e\d+$/
const MAX_DRAG_DISTANCE = 800
const CANVAS_NAME_PATTERN = /(?:\bcanvas\b|\bartboard\b|\bwhiteboard\b|\bdrawing (?:area|surface)\b|tela (?:de )?desenho|área de desenho)/i

function appIsAllowed(config, app) {
  return typeof app === 'string' && app.trim().length > 0 && (config.allow_all_apps || config.apps.some(allowed => allowed.toLocaleLowerCase() === app.toLocaleLowerCase()))
}

function toolIsAllowed(config, name) {
  return config.tools.includes(TOOL_WILDCARD) || config.tools.includes(name)
}

function usesObservedRefs(name, args) {
  if (REF_ACTION_TOOLS.includes(name) && (name !== 'desktop_hover' || args.ref_id)) return true
  if (['desktop_get', 'desktop_is'].includes(name)) return true
  if (name === 'desktop_drag') return Boolean(args.canvas_ref || args.from || args.to)
  if (['desktop_snapshot', 'desktop_find'].includes(name)) return Boolean(args.root)
  return name === 'desktop_wait' && typeof args.element === 'string' && args.element.startsWith('@')
}

function isMutatingTool(name, args = {}) {
  if (!READ_TOOLS.includes(name)) return true
  return name === 'desktop_screenshot' ? Boolean(args.output_path)
    : name === 'desktop_clipboard_get' ? Boolean(args.out)
    : name === 'desktop_permissions' ? Boolean(args.guide || args.request)
      : false
}

function isHeadedTool(name, tool) { return PHYSICAL_TOOLS.includes(name) || /requires?\s+--headed/i.test(tool?.description || '') }

function needsWindowFocus(name) {
  return COORDINATE_TOOLS.includes(name) || ['desktop_double_click', 'desktop_triple_click', 'desktop_hover', 'desktop_drag', 'desktop_key_down', 'desktop_key_up'].includes(name)
}

function validateSchemaArgs(args, tool, extras = []) {
  if (!tool) return
  const properties = tool.inputSchema?.properties || Object.fromEntries((FALLBACK_PROPERTIES[tool.name] || []).map(key => [key, {}]))
  const permitted = new Set([...Object.keys(properties), ...extras])
  if (Object.keys(args).some(key => !permitted.has(key))) throw new Error(`POLICY_DENIED: unsupported ${tool.name} argument`)
  for (const key of tool.inputSchema?.required || []) if (!(key in args)) throw new Error(`Missing required argument: ${key}`)
  for (const [key, value] of Object.entries(args)) {
    const type = properties[key]?.type
    const valid = type === 'string' ? typeof value === 'string'
      : type === 'boolean' ? typeof value === 'boolean'
        : type === 'integer' ? Number.isInteger(value)
          : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
            : type === 'array' ? Array.isArray(value)
              : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
                : true
    if (properties[key]?.type && !valid) throw new Error(`Invalid ${key}`)
    if (properties[key]?.enum && !properties[key].enum.includes(value)) throw new Error(`Invalid ${key}`)
  }
}

function filteredAppsData(data, allowedApps) {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.apps) ? data.apps : null
  if (!rows) return data
  const filtered = rows.filter(row => allowedApps.some(app => app.toLocaleLowerCase() === String(row?.name ?? row?.app_name ?? '').toLocaleLowerCase()))
  return Array.isArray(data) ? filtered : { ...data, apps: filtered }
}

function pointForTool(name, args) {
  if (name === 'desktop_mouse_wheel') {
    const x = Number(args.x)
    const y = Number(args.y)
    return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? { x, y } : null
  }
  return parsePoint(args.xy)
}

function windowTarget(windowIds, app, windowId, required = true) {
  if (!windowId) {
    if (required) throw new Error('POLICY_DENIED: select a window returned by desktop_list_windows')
    return null
  }
  const observed = windowIds.get(windowId)
  if (!observed || (app && observed.app.toLocaleLowerCase() !== app.toLocaleLowerCase())) throw new Error('STALE_WINDOW: list windows for this exact app and use one of the returned window ids')
  return { ...observed, id: windowId }
}

function validateScopedArgs(config, name, args, windowIds, { checkWindow = true } = {}) {
  if (args.app && !appIsAllowed(config, args.app)) throw new Error(config.allow_all_apps ? 'POLICY_DENIED: an app identifier is required' : `POLICY_DENIED: app is not allowed; use an exact app name from the allowlist (${config.apps.join(', ')})`)
  if (name === 'desktop_screenshot' && args.screen !== undefined && !config.allow_all_apps) throw new Error('POLICY_DENIED: screen-wide screenshots require allow_all_apps=true')
  if (APP_REQUIRED_TOOLS.includes(name) && !appIsAllowed(config, args.app)) throw new Error(config.allow_all_apps ? 'POLICY_DENIED: an app identifier is required' : `POLICY_DENIED: app is not allowed; use an exact app name from the allowlist (${config.apps.join(', ')})`)
  if (!config.allow_all_apps && ['desktop_find', 'desktop_screenshot', 'desktop_list_notifications', 'desktop_dismiss_all_notifications'].includes(name) && !appIsAllowed(config, args.app)) throw new Error(`POLICY_DENIED: ${name} requires an app from the MAH allowlist`)
  if (NOTIFICATION_TARGET_TOOLS.includes(name) && !config.allow_all_apps && !appIsAllowed(config, args.expected_app)) throw new Error('POLICY_DENIED: expected_app must name an app from the MAH allowlist')
  if (name === 'desktop_open_system_surface' && !config.allow_all_apps) throw new Error('POLICY_DENIED: system surfaces require allow_all_apps=true')
  if (WINDOW_TARGET_TOOLS.includes(name) && !args.window_id) throw new Error('POLICY_DENIED: select a window returned by desktop_list_windows')
  if (['desktop_snapshot', 'desktop_find'].includes(name) && args.surface && GLOBAL_SURFACES.includes(args.surface) && !config.allow_all_apps) throw new Error('POLICY_DENIED: global system surfaces require allow_all_apps=true')
  if (name === 'desktop_wait' && (args.window !== undefined || args.window_id || args.event === 'window') && !config.allow_all_apps && !appIsAllowed(config, args.app)) throw new Error('POLICY_DENIED: waiting on windows requires an app from the MAH allowlist')
  if (checkWindow && args.window_id) windowTarget(windowIds, args.app, args.window_id)
}

function batchCommands(args) {
  let commands
  try { commands = JSON.parse(args.commands_json) } catch { throw new Error('Invalid batch JSON') }
  if (!Array.isArray(commands) || commands.length === 0) throw new Error('Batch must contain at least one command')
  if (commands.some(command => !command || typeof command !== 'object' || Array.isArray(command) || typeof command.command !== 'string' || !command.args || typeof command.args !== 'object' || Array.isArray(command.args))) throw new Error('Invalid batch entry')
  return commands
}

function parsePoint(value) {
  if (typeof value !== 'string' || !/^-?\d+,-?\d+$/.test(value)) return null
  const [x, y] = value.split(',').map(Number)
  return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? { x, y } : null
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null
  const x = Number(bounds.x ?? bounds.left)
  const y = Number(bounds.y ?? bounds.top)
  const width = Number(bounds.width ?? (Number(bounds.right) - x))
  const height = Number(bounds.height ?? (Number(bounds.bottom) - y))
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

function collectRefBounds(value, out = new Map()) {
  if (!value || typeof value !== 'object') return out
  if (Array.isArray(value)) {
    for (const item of value) collectRefBounds(item, out)
    return out
  }
  const ref = value.ref_id || value.ref
  const bounds = normalizeBounds(value.bounds)
  if (typeof ref === 'string' && REF_PATTERN.test(ref) && bounds) out.set(ref, bounds)
  for (const item of Object.values(value)) if (item && typeof item === 'object') collectRefBounds(item, out)
  return out
}

function collectCanvasBounds(value, snapshotId, out = []) {
  if (!value || typeof value !== 'object') return out
  if (Array.isArray(value)) {
    for (const item of value) collectCanvasBounds(item, snapshotId, out)
    return out
  }
  const name = typeof value.name === 'string' ? value.name : ''
  const bounds = normalizeBounds(value.bounds)
  if (name && CANVAS_NAME_PATTERN.test(name) && bounds && bounds.width >= 100 && bounds.height >= 100) {
    const canvas_ref = `mah-canvas:${snapshotId}:${out.length + 1}`
    out.push({ canvas_ref, name, bounds })
  }
  for (const item of Object.values(value)) if (item && typeof item === 'object') collectCanvasBounds(item, snapshotId, out)
  return out
}

function attachCanvasRefs(result, canvases) {
  const addToPayload = payload => {
    if (payload?.ok === true && payload.data && typeof payload.data === 'object') payload.data.mah_canvases = canvases
  }
  addToPayload(result?.structuredContent)
  for (const block of result?.content ?? []) {
    if (block.type !== 'text') continue
    try {
      const payload = JSON.parse(block.text)
      if (payload?.ok === true && payload.data && typeof payload.data === 'object') {
        payload.data.mah_canvases = canvases
        block.text = JSON.stringify(payload)
      }
    } catch { /* non-JSON text is preserved */ }
  }
}

function replaceEnvelopeData(result, data) {
  if (result?.structuredContent && Object.hasOwn(result.structuredContent, 'data')) result.structuredContent.data = data
  for (const block of result?.content ?? []) {
    if (block.type !== 'text') continue
    try {
      const payload = JSON.parse(block.text)
      if (payload && Object.hasOwn(payload, 'data')) {
        payload.data = data
        block.text = JSON.stringify(payload)
      }
    } catch { /* non-JSON text is preserved */ }
  }
}

function updateBatchLastData(result, update) {
  const apply = payload => {
    const last = payload?.data?.results?.at(-1)
    if (!last || !last.data || typeof last.data !== 'object') return
    last.data = update(last.data)
  }
  apply(result?.structuredContent)
  for (const block of result?.content ?? []) {
    if (block.type !== 'text') continue
    try {
      const payload = JSON.parse(block.text)
      apply(payload)
      block.text = JSON.stringify(payload)
    } catch { /* non-JSON text is preserved */ }
  }
}

function windowsFromData(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.windows)) return data.windows
  return []
}

function withWindowsData(data, windows) {
  return Array.isArray(data) ? windows : data && Array.isArray(data.windows) ? { ...data, windows } : data
}

function pointInside(bounds, point) {
  return point.x >= bounds.x && point.y >= bounds.y && point.x <= bounds.x + bounds.width && point.y <= bounds.y + bounds.height
}

export function validateComputerConfig(input) {
  if (!input || input.schema !== 'mah.computer.v1') throw new Error('Invalid computer config schema')
  for (const key of ['environment_id', 'principal_id', 'command', 'expected_version']) {
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error(`Missing ${key}`)
  }
  if (!['win32', 'linux', 'darwin'].includes(input.platform)) throw new Error('Invalid target platform')
  if (input.platform !== process.platform) throw new Error('Run the broker on the target OS; WSL Linux cannot drive Windows accessibility directly')
  if (!Array.isArray(input.apps) || input.apps.some(x => typeof x !== 'string' || !x.trim())) throw new Error('apps must be an explicit list')
  if (new Set(input.apps).size !== input.apps.length) throw new Error('Duplicate app in policy')
  if (input.allow_all_apps !== undefined && typeof input.allow_all_apps !== 'boolean') throw new Error('allow_all_apps must be a boolean')
  if (input.allow_actions !== undefined && typeof input.allow_actions !== 'boolean') throw new Error('allow_actions must be a boolean')
  const allow_all_apps = input.allow_all_apps === true
  const tools = input.tools ?? READ_TOOLS
  if (!Array.isArray(tools) || tools.some(x => typeof x !== 'string' || (x !== TOOL_WILDCARD && !/^desktop_[a-z0-9_]+$/.test(x)))) throw new Error('Unsupported tool in policy')
  if (!Array.isArray(input.args ?? []) || (input.args ?? []).some(x => typeof x !== 'string')) throw new Error('Invalid driver args')
  if (tools.some(tool => tool !== TOOL_WILDCARD && isHeadedTool(tool)) && !(input.args ?? []).includes('--headed')) throw new Error('Physical computer-use tools require the explicit --headed driver mode')
  const timeout_ms = input.timeout_ms ?? 15000
  const launch_timeout_ms = input.launch_timeout_ms ?? 60000
  const max_actions = input.max_actions ?? 50
  const max_output_bytes = input.max_output_bytes ?? 20 * 1024 * 1024
  if (!Number.isInteger(timeout_ms) || timeout_ms < 100 || timeout_ms > 120000) throw new Error('timeout_ms must be 100..120000')
  if (!Number.isInteger(launch_timeout_ms) || launch_timeout_ms < 1000 || launch_timeout_ms > 120000) throw new Error('launch_timeout_ms must be 1000..120000')
  if (!Number.isInteger(max_actions) || max_actions < 1 || max_actions > 1000) throw new Error('max_actions must be 1..1000')
  if (!Number.isInteger(max_output_bytes) || max_output_bytes < 1024 || max_output_bytes > 100 * 1024 * 1024) throw new Error('max_output_bytes must be 1024..104857600')
  if (new Set(tools).size !== tools.length) throw new Error('Duplicate tool in policy')
  return { ...input, allow_all_apps, allow_actions: input.allow_actions === true, apps: [...input.apps], args: [...(input.args || [])], tools: [...tools], timeout_ms, launch_timeout_ms, max_actions, max_output_bytes }
}

export function computerStatePaths(config, stateRoot = path.join(os.homedir(), '.mah', 'computer')) {
  // One graphical session on this host. Changing environment_id cannot bypass a
  // lease or human takeover for another config pointing at the same desktop.
  const base = path.join(stateRoot, 'local-desktop')
  mkdirSync(base, { recursive: true, mode: 0o700 })
  return { base, lock: path.join(base, 'lease'), control: path.join(base, 'control.json'), audit: path.join(base, 'actions.jsonl') }
}

export function setComputerPaused(paths, paused) {
  const temp = `${paths.control}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify({ paused, epoch: randomUUID(), at: new Date().toISOString() }), { mode: 0o600 })
  renameSync(temp, paths.control)
}

export function computerIsPaused(paths) { return readControl(paths).paused }

function readControl(paths) {
  if (!existsSync(paths.control)) return { paused: false, epoch: 'initial' }
  const control = JSON.parse(readFileSync(paths.control, 'utf8'))
  if (typeof control.paused !== 'boolean' || typeof control.epoch !== 'string') throw new Error('Invalid control state')
  return control
}

function acquire(paths) {
  // Missing owner after a crash fails closed. Operator recovery is intentional;
  // age alone does not prove a process or a graphical action has finished.
  try { mkdirSync(paths.lock, { mode: 0o700 }) } catch (e) {
    if (e.code === 'EEXIST') throw new Error('DESKTOP_BUSY: another desktop operation is still active; wait for it to finish before retrying. Never remove an active lease.')
    throw e
  }
  try { writeFileSync(path.join(paths.lock, 'owner.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { mode: 0o600 }) }
  catch (error) { rmSync(paths.lock, { recursive: true, force: true }); throw error }
  return () => rmSync(paths.lock, { recursive: true, force: true })
}

function envelope(result) {
  if (result?.structuredContent) return result.structuredContent
  for (const block of result?.content ?? []) {
    if (block.type !== 'text') continue
    try { const value = JSON.parse(block.text); if (typeof value.ok === 'boolean') return value } catch { /* text is not necessarily JSON */ }
  }
  return null
}

function collectRefs(value, out = new Set()) {
  if (!value || typeof value !== 'object') return out
  for (const [key, item] of Object.entries(value)) {
    if ((key === 'ref_id' || key === 'ref') && typeof item === 'string' && REF_PATTERN.test(item)) out.add(item)
    else if (item && typeof item === 'object') collectRefs(item, out)
  }
  return out
}

function toolError(code, message) {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code, message } }) }] }
}

/** Local trusted-user broker, not an OS sandbox or semantic transaction reviewer. */
export class ComputerBroker {
  constructor({ config, driver, stateRoot, loadConfig }) {
    this.config = validateComputerConfig(config)
    this.driver = driver
    this.toolCatalog = new Map()
    this.catalogLoaded = false
    this.paths = computerStatePaths(this.config, stateRoot)
    this.loadConfig = loadConfig
    this.refs = new Set()
    this.refBounds = new Map()
    this.canvasBounds = new Map()
    this.windowIds = new Map()
    this.refApp = ''
    this.actionCount = 0
    this.busy = false
    this.uncertain = false
    this.closed = false
    this.epoch = readControl(this.paths).epoch
  }

  clearElementRefs() {
    this.refs.clear()
    this.refBounds.clear()
    this.canvasBounds.clear()
    this.refApp = ''
  }

  clearObservedRefs() {
    this.clearElementRefs()
    this.windowIds.clear()
  }

  async listTools() {
    this.checkPolicy()
    const result = await this.driver.listTools()
    this.checkPolicy()
    this.toolCatalog = new Map(result.tools.map(tool => [tool.name, tool]))
    this.catalogLoaded = true
    const visibleTools = result.tools.filter(tool => {
      if (!toolIsAllowed(this.config, tool.name)) return false
      if (isMutatingTool(tool.name) && !this.config.allow_actions) return false
      if (isHeadedTool(tool.name, tool) && !this.config.args.includes('--headed')) return false
      if (tool.name === 'desktop_open_system_surface' && !this.config.allow_all_apps) return false
      if (APP_SCOPED_TOOLS.includes(tool.name) && !this.config.allow_all_apps && this.config.apps.length === 0) return false
      return true
    }).map(tool => {
      const properties = { ...(tool.inputSchema?.properties || {}) }
      const required = new Set(tool.inputSchema?.required || [])
      const windowScope = WINDOW_TARGET_TOOLS.includes(tool.name) && tool.name !== 'desktop_press'
      if (windowScope) {
        properties.app ||= { type: 'string', description: 'Application name allowed by MAH policy' }
        properties.window_id ||= { type: 'string', description: 'Window id from desktop_list_windows for the same app' }
        required.add('app')
        required.add('window_id')
      }
      if (['desktop_drag', 'desktop_hover'].includes(tool.name)) {
        properties.app ||= { type: 'string', description: 'Application name allowed by MAH policy' }
        properties.window_id ||= { type: 'string', description: 'Window id from desktop_list_windows for the same app' }
      }
      if (tool.name === 'desktop_press') {
        required.add('app')
        required.add('window_id')
      }
      if (['desktop_find', 'desktop_screenshot'].includes(tool.name) && !this.config.allow_all_apps) required.add('app')
      if (tool.name === 'desktop_list_surfaces') required.add('app')
      if (tool.name === 'desktop_list_notifications' && !this.config.allow_all_apps) required.add('app')
      if (tool.name === 'desktop_dismiss_all_notifications' && !this.config.allow_all_apps) required.add('app')
      if (NOTIFICATION_TARGET_TOOLS.includes(tool.name) && !this.config.allow_all_apps) {
        const target = properties.expected_app || { type: 'string', description: 'Notification source app name allowed by MAH policy' }
        properties.expected_app = { ...target, enum: [...this.config.apps], description: 'Notification source app name; must match an app allowed by MAH.' }
        required.add('expected_app')
      }
      if (['desktop_close_app', 'desktop_launch'].includes(tool.name)) {
        properties.app ||= { type: 'string', description: 'Application name allowed by MAH policy' }
        required.add('app')
      }
      if (tool.name === 'desktop_drag') properties.canvas_ref = { type: 'string', description: 'Use data.mah_canvases[n].canvas_ref from a fresh snapshot; otherwise supply app and window_id and keep coordinates within the observed window.' }
      if (tool.name === 'desktop_permissions' && !this.config.allow_actions) {
        delete properties.guide
        delete properties.request
      }
      if (tool.name === 'desktop_focus_window' || WINDOW_TOOLS.includes(tool.name)) {
        properties.app ||= { type: 'string', description: 'Application name allowed by MAH policy' }
        properties.window_id ||= { type: 'string', description: 'Window id from desktop_list_windows for the same app' }
        required.add('app')
        required.add('window_id')
      }
      if (properties.app) properties.app = this.config.allow_all_apps
        ? { ...properties.app, description: `${properties.app.description || 'Application name'} Use the exact app requested by the user.` }
        : { ...properties.app, enum: [...this.config.apps], description: `${properties.app.description || 'Application name'} Must exactly match an app allowed by MAH.` }
      if (properties.window_id) properties.window_id = { ...properties.window_id, description: 'Use a window id returned by desktop_list_windows for the same app. IDs expire after mutations.' }
      const appGuidance = this.config.allow_all_apps ? ' Policy permits any app; operate only on the app requested by the user.' : ` Allowed app names: ${this.config.apps.join(', ') || '(none)'}.`
      const scopeGuidance = windowScope || tool.name === 'desktop_press' ? ' This tool is scoped to a window ID observed for the exact app.' : ''
      const launchGuidance = tool.name === 'desktop_launch' ? ' Use only when the app is not already open; snapshot it first when possible.' : ''
      const focusGuidance = tool.name === 'desktop_focus_window' ? ' Use a window id returned by the latest desktop_list_windows call for this app.' : ''
      const mutationGuidance = isMutatingTool(tool.name) ? ' This operation requires allow_actions=true and counts against max_actions.' : ''
      const conditionalMutationGuidance = ['desktop_screenshot', 'desktop_clipboard_get', 'desktop_permissions'].includes(tool.name) ? ' File output or permission requests require allow_actions=true.' : ''
      const description = `${tool.description || ''}${properties.app ? appGuidance : ''}${scopeGuidance}${launchGuidance}${focusGuidance}${mutationGuidance}${conditionalMutationGuidance} Call desktop tools one at a time and wait for each result.`.trim()
      return { ...tool, description, inputSchema: { ...tool.inputSchema, type: 'object', properties, additionalProperties: false, ...(required.size ? { required: [...required] } : {}) } }
    })
    return { tools: visibleTools }
  }

  checkPolicy() {
    if (this.closed) throw new Error('DESKTOP_CLOSED: restart broker after driver cancellation')
    if (this.loadConfig) {
      const next = validateComputerConfig(this.loadConfig())
      // Driver identity cannot change mid-connection. Restart with new policy.
      for (const key of ['environment_id', 'principal_id', 'command', 'expected_version', 'platform']) {
        if (next[key] !== this.config[key]) throw new Error('Driver identity changed; restart broker')
      }
      if (JSON.stringify(next.args) !== JSON.stringify(this.config.args)) throw new Error('Driver arguments changed; restart broker')
      this.config = next
    }
    if (this.driver.version !== this.config.expected_version) throw new Error('Driver version does not match expected_version; inspect with doctor and pin the verified version')
    const control = readControl(this.paths)
    if (control.epoch !== this.epoch) {
      this.clearObservedRefs()
      this.epoch = control.epoch
    }
    if (control.paused) throw new Error('DESKTOP_PAUSED: human owns the desktop')
  }

  async callTool(name, args = {}, { signal } = {}) {
    const listWindows = name === 'desktop_list_windows'
    const mutating = isMutatingTool(name, args)
    const heldInput = HELD_INPUT_TOOLS.includes(name)
    const observedApp = this.refApp
    let release
    let poll
    let releaseSafe = true
    const action_id = randomUUID()
    let targetWindow = null
    let nestedBatch = null
    let driverArgs = args
    try {
      if (this.busy) throw new Error('DESKTOP_BUSY: another desktop operation is still active; wait for its result before retrying. Do not send parallel desktop calls.')
      this.checkPolicy()
      if (signal?.aborted) throw new Error('Cancelled before dispatch')
      if (!toolIsAllowed(this.config, name)) throw new Error('POLICY_DENIED: tool is not allowed')
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid arguments')
      if (!this.catalogLoaded) {
        this.busy = true
        try {
          const catalog = await this.driver.listTools()
          this.checkPolicy()
          this.toolCatalog = new Map(catalog.tools.map(tool => [tool.name, tool]))
          this.catalogLoaded = true
        } finally { this.busy = false }
      }
      const catalogTool = this.toolCatalog.get(name)
      if (!catalogTool) throw new Error('POLICY_DENIED: tool is not present in the pinned agent-desktop catalog')
      const upstreamTool = catalogTool || { name }
      const wrapperArgs = WINDOW_TARGET_TOOLS.includes(name) ? ['app', 'window_id'] : []
      if (name === 'desktop_drag') wrapperArgs.push('canvas_ref', 'app', 'window_id')
      if (name === 'desktop_hover') wrapperArgs.push('app', 'window_id')
      validateSchemaArgs(args, upstreamTool, wrapperArgs)
      if (isHeadedTool(name, upstreamTool) && !this.config.args.includes('--headed')) throw new Error('POLICY_DENIED: this tool requires agent-desktop --headed mode')
      if (mutating && this.uncertain) throw new Error('OUTCOME_UNKNOWN: restart after operator reconciliation before more actions')
      if (mutating && !this.config.allow_actions) throw new Error('POLICY_DENIED: allow_actions must be enabled for this operation')

      if (name === 'desktop_batch') {
        nestedBatch = batchCommands(args)
        const normalized = []
        for (const command of nestedBatch) {
          const commandName = command.command.startsWith('desktop_') ? command.command : `desktop_${command.command.replaceAll('-', '_')}`
          const tool = this.toolCatalog.get(commandName)
          if (!tool || !toolIsAllowed(this.config, commandName)) throw new Error(`POLICY_DENIED: batch command ${command.command} is not enabled`)
          if (isMutatingTool(commandName, command.args) && !this.config.allow_actions) throw new Error(`POLICY_DENIED: batch command ${command.command} requires allow_actions`)
          if (isHeadedTool(commandName, tool) && !this.config.args.includes('--headed')) throw new Error(`POLICY_DENIED: batch command ${command.command} requires --headed`)
          validateSchemaArgs(command.args, tool, ['app', 'window_id', 'canvas_ref'])
          validateScopedArgs(this.config, commandName, command.args, this.windowIds)
          const nestedRefValues = ['ref_id', 'root', 'element', 'from', 'to'].map(key => command.args[key]).filter(value => typeof value === 'string' && value.startsWith('@'))
          const earlierObservation = normalized.some(entry => ['desktop_snapshot', 'desktop_find'].includes(entry.name))
          if (nestedRefValues.some(value => !this.refs.has(value)) && !earlierObservation) throw new Error('STALE_REF: batch action needs an observed ref or an earlier snapshot/find in the batch')
          if (usesObservedRefs(commandName, command.args) && !earlierObservation && observedApp && !appIsAllowed(this.config, observedApp)) throw new Error('POLICY_DENIED: batch observed app was revoked')
          if (command.args.window_id) windowTarget(this.windowIds, command.args.app, command.args.window_id)
          if (COORDINATE_TOOLS.includes(commandName) || (commandName === 'desktop_hover' && command.args.xy)) {
            if (!appIsAllowed(this.config, command.args.app)) throw new Error('POLICY_DENIED: batch pointer input requires an app from the MAH allowlist')
            const target = windowTarget(this.windowIds, command.args.app, command.args.window_id)
            const point = pointForTool(commandName, command.args)
            if (!point || !target.bounds || !pointInside(target.bounds, point)) throw new Error('POLICY_DENIED: batch pointer target must stay inside the observed window bounds')
          }
          if (commandName === 'desktop_drag' && (command.args.from_xy || command.args.to_xy)) {
            if (!appIsAllowed(this.config, command.args.app)) throw new Error('POLICY_DENIED: batch coordinate drag requires an app from the MAH allowlist')
            const target = windowTarget(this.windowIds, command.args.app, command.args.window_id)
            const from = parsePoint(command.args.from_xy)
            const to = parsePoint(command.args.to_xy)
            if (!from || !to || !target.bounds || !pointInside(target.bounds, from) || !pointInside(target.bounds, to)) throw new Error('POLICY_DENIED: batch drag must stay inside the observed window bounds')
            if (Math.hypot(to.x - from.x, to.y - from.y) > MAX_DRAG_DISTANCE) throw new Error(`POLICY_DENIED: batch drag distance exceeds ${MAX_DRAG_DISTANCE}px`)
            if (command.args.canvas_ref) {
              const canvas = this.canvasBounds.get(command.args.canvas_ref)
              if (!canvas || !pointInside(canvas, from) || !pointInside(canvas, to)) throw new Error('POLICY_DENIED: batch drag endpoints must stay inside the observed canvas bounds')
            }
            if (command.args.duration !== undefined && (!Number.isInteger(command.args.duration) || command.args.duration < 100 || command.args.duration > 5000)) throw new Error('Invalid batch drag duration; use 100..5000ms')
          }
          if (commandName === 'desktop_batch') throw new Error('POLICY_DENIED: nested batches are not supported')
          normalized.push({ name: commandName, args: command.args })
        }
        nestedBatch = normalized
      }

      validateScopedArgs(this.config, name, args, this.windowIds)
      if (WINDOW_TARGET_TOOLS.includes(name)) targetWindow = windowTarget(this.windowIds, args.app, args.window_id)

      if (name === 'desktop_snapshot') {
        if (!args.app && (!args.surface || !this.config.allow_all_apps)) throw new Error('POLICY_DENIED: provide an allowed app or enable allow_all_apps for an explicit global surface')
        if (args.window_id) windowTarget(this.windowIds, args.app, args.window_id)
        if (args.root && !this.refs.has(args.root)) throw new Error('STALE_REF: snapshot root must come from a previous observation')
        this.clearElementRefs()
      }
      if (listWindows) {
        if (!args.app && !this.config.allow_all_apps && this.config.apps.length === 0) throw new Error('POLICY_DENIED: list at least one allowed app')
        this.clearObservedRefs()
      }
      if (['desktop_status', 'desktop_version'].includes(name) && Object.keys(args).length) throw new Error('POLICY_DENIED: unsupported read argument')
      const refKeys = ['ref_id', 'root', 'element', 'from', 'to']
      for (const key of refKeys) if (typeof args[key] === 'string' && args[key].startsWith('@') && !this.refs.has(args[key])) throw new Error('STALE_REF: observe an allowed app before acting')
      if (usesObservedRefs(name, args) && observedApp && !appIsAllowed(this.config, observedApp)) throw new Error('POLICY_DENIED: observed app was revoked')
      if (usesObservedRefs(name, args) && observedApp && args.app && observedApp.toLocaleLowerCase() !== args.app.toLocaleLowerCase()) throw new Error('STALE_REF: observe the exact app before using this ref')
      if (REF_ACTION_TOOLS.includes(name) && name !== 'desktop_hover' && (typeof args.ref_id !== 'string' || !this.refs.has(args.ref_id))) throw new Error('STALE_REF: observe an allowed app before acting')
      if (name === 'desktop_hover' && !args.ref_id && !args.xy) throw new Error('Invalid hover target: provide ref_id or xy')
      if (name === 'desktop_drag') {
        if (args.canvas_ref) {
          const bounds = this.canvasBounds.get(args.canvas_ref)
          if (!bounds) throw new Error('STALE_REF: take a fresh bounds-bearing snapshot and use one of its data.mah_canvases canvas_ref values')
          const from = parsePoint(args.from_xy)
          const to = parsePoint(args.to_xy)
          if (!from || !to || !targetWindow?.bounds || !pointInside(targetWindow.bounds, from) || !pointInside(targetWindow.bounds, to) || !pointInside(bounds, from) || !pointInside(bounds, to)) throw new Error('POLICY_DENIED: drag endpoints must stay inside the observed window and canvas bounds')
          if (Math.hypot(to.x - from.x, to.y - from.y) > MAX_DRAG_DISTANCE) throw new Error(`POLICY_DENIED: drag distance exceeds ${MAX_DRAG_DISTANCE}px`)
        } else if (args.from_xy || args.to_xy) {
          if (!appIsAllowed(this.config, args.app)) throw new Error('POLICY_DENIED: coordinate drag requires an app from the MAH allowlist')
          targetWindow = windowTarget(this.windowIds, args.app, args.window_id)
          const from = parsePoint(args.from_xy)
          const to = parsePoint(args.to_xy)
          if (!from || !to || !targetWindow.bounds || !pointInside(targetWindow.bounds, from) || !pointInside(targetWindow.bounds, to)) throw new Error('POLICY_DENIED: coordinate drag must remain inside the observed window bounds')
          if (Math.hypot(to.x - from.x, to.y - from.y) > MAX_DRAG_DISTANCE) throw new Error(`POLICY_DENIED: drag distance exceeds ${MAX_DRAG_DISTANCE}px`)
        } else if (!args.from || !args.to) throw new Error('Invalid drag: provide from/to refs or from_xy/to_xy coordinates')
        if ('duration' in args && (!Number.isInteger(args.duration) || args.duration < 100 || args.duration > 5000)) throw new Error('Invalid drag duration; use 100..5000ms')
      }
      if (COORDINATE_TOOLS.includes(name) || (name === 'desktop_hover' && args.xy)) {
        if (!appIsAllowed(this.config, args.app)) throw new Error('POLICY_DENIED: physical pointer input requires an app from the MAH allowlist')
        targetWindow ||= windowTarget(this.windowIds, args.app, args.window_id)
        const point = pointForTool(name, args)
        if (!point) throw new Error('Invalid physical coordinate')
        if (!targetWindow.bounds || !pointInside(targetWindow.bounds, point)) throw new Error('POLICY_DENIED: physical pointer target must stay inside the observed window bounds')
      }
      if (['desktop_type', 'desktop_set_value'].includes(name) && typeof (args.text ?? args.value) === 'string' && (args.text ?? args.value).length > 16_384) throw new Error(`Invalid ${name === 'desktop_type' ? 'text' : 'value'}`)
      if (name === 'desktop_batch' && nestedBatch.length > this.config.max_actions) throw new Error('POLICY_DENIED: batch exceeds max_actions')
      const batchActionCount = nestedBatch ? nestedBatch.filter(entry => isMutatingTool(entry.name, entry.args)).length : 0
      const batchFocusCount = nestedBatch ? nestedBatch.filter(entry => needsWindowFocus(entry.name) && entry.args.window_id).length : 0
      const directFocusCount = !nestedBatch && needsWindowFocus(name) && args.window_id ? 1 : 0
      const actionUnits = Math.max(1, batchActionCount + batchFocusCount + directFocusCount)
      if (mutating && this.actionCount + actionUnits > this.config.max_actions) throw new Error('POLICY_DENIED: action budget exhausted')

      driverArgs = { ...args }
      for (const key of ['canvas_ref']) delete driverArgs[key]
      for (const key of ['app', 'window_id']) if (upstreamTool.inputSchema?.properties && !upstreamTool.inputSchema.properties[key]) delete driverArgs[key]
      if (nestedBatch) {
        const translated = []
        for (const entry of nestedBatch) {
          const current = this.toolCatalog.get(entry.name)
          const nestedArgs = { ...entry.args }
          const needsFocus = needsWindowFocus(entry.name) && nestedArgs.window_id
          if (needsFocus) translated.push({ command: 'focus-window', args: { window_id: nestedArgs.window_id } })
          for (const key of ['app', 'window_id', 'canvas_ref']) if (!current.inputSchema?.properties?.[key]) delete nestedArgs[key]
          translated.push({ command: entry.name.replace(/^desktop_/, '').replaceAll('_', '-'), args: nestedArgs })
        }
        driverArgs = { ...args, commands_json: JSON.stringify(translated) }
      }
      release = acquire(this.paths)
      this.busy = true
      const controller = new AbortController()
      const forward = () => controller.abort()
      signal?.addEventListener('abort', forward, { once: true })
      const requestedTimeout = Number(args.timeout_ms ?? args.timeout ?? 0)
      const timeoutMs = Math.min(120000, Math.max(name === 'desktop_launch' ? this.config.launch_timeout_ms : this.config.timeout_ms, Number.isFinite(requestedTimeout) ? requestedTimeout : 0))
      const deadline = setTimeout(() => controller.abort(), timeoutMs)
      poll = setInterval(() => {
        try {
          this.checkPolicy()
          if (!toolIsAllowed(this.config, name) || (mutating && (!this.config.allow_actions || this.actionCount > this.config.max_actions))) controller.abort()
          validateScopedArgs(this.config, name, args, this.windowIds, { checkWindow: false })
          if (observedApp && usesObservedRefs(name, args) && !appIsAllowed(this.config, observedApp)) controller.abort()
          if (nestedBatch) for (const entry of nestedBatch) {
            if (!toolIsAllowed(this.config, entry.name) || (isMutatingTool(entry.name, entry.args) && !this.config.allow_actions)) controller.abort()
            validateScopedArgs(this.config, entry.name, entry.args, this.windowIds, { checkWindow: false })
          }
        }
        catch { controller.abort() }
      }, 100)
      let result
      let rejectAbort
      const aborted = new Promise((_, reject) => { rejectAbort = reject })
      const onDeadline = () => rejectAbort(new Error('Cancelled or deadline exceeded; outcome must be reconciled'))
      controller.signal.addEventListener('abort', onDeadline, { once: true })
      try {
        if (controller.signal.aborted) throw new Error('Cancelled before dispatch')
        if (mutating) {
          this.actionCount += actionUnits
          if (heldInput) this.clearElementRefs()
          else this.clearObservedRefs()
        }
        appendFileSync(this.paths.audit, JSON.stringify({ action_id, event: 'started', tool: name, principal_id: this.config.principal_id, at: new Date().toISOString() }) + '\n', { mode: 0o600 })
        if (needsWindowFocus(name) && targetWindow) {
          const focused = await this.driver.callTool('desktop_focus_window', { window_id: targetWindow.id }, { signal: controller.signal, timeout: timeoutMs })
          if (focused?.isError || envelope(focused)?.ok !== true) throw new Error('FOCUS_FAILED: target window could not be focused; physical input was not sent')
        }
        result = await Promise.race([this.driver.callTool(name, driverArgs, { signal: controller.signal, timeout: timeoutMs }), aborted])
        if (controller.signal.aborted) throw new Error('Cancelled; outcome must be reconciled')
        this.checkPolicy()
        if (!toolIsAllowed(this.config, name) || (mutating && !this.config.allow_actions)) throw new Error('POLICY_DENIED: permission changed during call')
        validateScopedArgs(this.config, name, args, this.windowIds, { checkWindow: false })
        if ((args.app && !appIsAllowed(this.config, args.app)) || (usesObservedRefs(name, args) && observedApp && !appIsAllowed(this.config, observedApp))) throw new Error('POLICY_DENIED: app changed during call')
        if (nestedBatch) for (const entry of nestedBatch) {
          if (!toolIsAllowed(this.config, entry.name)) throw new Error('POLICY_DENIED: batch permission changed during call')
          validateScopedArgs(this.config, entry.name, entry.args, this.windowIds, { checkWindow: false })
        }
      } catch (error) {
        // A transport timeout does not prove an action was not delivered.
        if (mutating) this.uncertain = true
        {
          // A lease may be released only after the driver transport has closed.
          // Failed shutdown leaves the global lease in place for operator recovery.
          let closeTimer
          try {
            await Promise.race([this.driver.close(), new Promise((_, reject) => { closeTimer = setTimeout(() => reject(new Error('Driver shutdown deadline')), 5000) })])
            this.closed = true
          } catch { releaseSafe = false }
          finally { clearTimeout(closeTimer) }
        }
        throw error
      } finally {
        clearTimeout(deadline)
        controller.signal.removeEventListener('abort', onDeadline)
        signal?.removeEventListener('abort', forward)
      }
      const body = envelope(result)
      const success = !result?.isError && body?.ok === true
      if (Buffer.byteLength(JSON.stringify(result ?? null), 'utf8') > this.config.max_output_bytes) {
        if (mutating) this.uncertain = true
        throw new Error(`OUTPUT_LIMIT: desktop result exceeds ${this.config.max_output_bytes} bytes`)
      }
      if (['desktop_snapshot', 'desktop_find'].includes(name) && success) {
        this.refs = collectRefs(body.data)
        this.refBounds = collectRefBounds(body.data)
        const canvases = name === 'desktop_snapshot' && args.include_bounds === true
          ? collectCanvasBounds(body.data?.tree, body.data?.snapshot_id || randomUUID())
          : []
        this.canvasBounds = new Map(canvases.map(canvas => [canvas.canvas_ref, canvas.bounds]))
        attachCanvasRefs(result, canvases)
        this.refApp = args.app || targetWindow?.app || ''
      }
      if (listWindows && success) {
        const windows = windowsFromData(body.data).filter(window => {
          if (typeof window?.id !== 'string' || typeof window?.app_name !== 'string') return false
          if (args.app) return window.app_name.toLocaleLowerCase() === args.app.toLocaleLowerCase()
          return this.config.allow_all_apps || appIsAllowed(this.config, window.app_name)
        })
        this.windowIds = new Map(windows.map(window => [window.id, { app: window.app_name, bounds: normalizeBounds(window.bounds), process_instance: window.process_instance }]))
        const filteredData = withWindowsData(body.data, windows)
        body.data = filteredData
        replaceEnvelopeData(result, filteredData)
      }
      if (name === 'desktop_list_apps' && success && !this.config.allow_all_apps) {
        const filteredData = filteredAppsData(body.data, this.config.apps)
        body.data = filteredData
        replaceEnvelopeData(result, filteredData)
      }
      if (name === 'desktop_batch' && success) {
        const lastCommand = nestedBatch?.at(-1)
        const lastResult = body.data?.results?.at(-1)
        const nestedData = lastResult?.data
        if (lastResult?.ok === true && nestedData && ['desktop_snapshot', 'desktop_find'].includes(lastCommand?.name)) {
          this.refs = collectRefs(nestedData)
          this.refBounds = collectRefBounds(nestedData)
          const canvases = lastCommand.name === 'desktop_snapshot' && lastCommand.args.include_bounds === true
            ? collectCanvasBounds(nestedData.tree, nestedData.snapshot_id || randomUUID())
            : []
          this.canvasBounds = new Map(canvases.map(canvas => [canvas.canvas_ref, canvas.bounds]))
          if (canvases.length) updateBatchLastData(result, data => ({ ...data, mah_canvases: canvases }))
          this.refApp = lastCommand.args.app || ''
        }
        if (lastResult?.ok === true && nestedData && lastCommand?.name === 'desktop_list_windows') {
          const windows = windowsFromData(nestedData).filter(window => {
            if (typeof window?.id !== 'string' || typeof window?.app_name !== 'string') return false
            if (lastCommand.args.app) return window.app_name.toLocaleLowerCase() === lastCommand.args.app.toLocaleLowerCase()
            return this.config.allow_all_apps || appIsAllowed(this.config, window.app_name)
          })
          this.windowIds = new Map(windows.map(window => [window.id, { app: window.app_name, bounds: normalizeBounds(window.bounds), process_instance: window.process_instance }]))
          updateBatchLastData(result, data => withWindowsData(data, windows))
        }
      }
      // Never retry actions automatically, including stale references.
      appendFileSync(this.paths.audit, JSON.stringify({ action_id, event: 'finished', tool: name, ok: success, at: new Date().toISOString() }) + '\n', { mode: 0o600 })
      return result
    } catch (error) {
      return toolError(this.uncertain ? 'OUTCOME_UNKNOWN' : 'COMPUTER_REFUSED', error.message)
    } finally {
      clearInterval(poll)
      if (release && releaseSafe) { release(); this.busy = false }
    }
  }
}
