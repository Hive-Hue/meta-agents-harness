import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

export const READ_TOOLS = ['desktop_status', 'desktop_version', 'desktop_skills_get', 'desktop_snapshot']
export const ACTION_TOOLS = ['desktop_click', 'desktop_set_value', 'desktop_type', 'desktop_check', 'desktop_uncheck', 'desktop_select', 'desktop_drag']
export const LAUNCH_TOOLS = ['desktop_launch']
const MUTATING_TOOLS = [...ACTION_TOOLS, ...LAUNCH_TOOLS]
const REF_PATTERN = /^@[A-Za-z0-9_-]+:e\d+$/
const MAX_DRAG_DISTANCE = 800
const CANVAS_NAME_PATTERN = /(?:\bcanvas\b|\bartboard\b|\bwhiteboard\b|\bdrawing (?:area|surface)\b|tela (?:de )?desenho|área de desenho)/i

function appIsAllowed(config, app) {
  return typeof app === 'string' && app.trim().length > 0 && (config.allow_all_apps || config.apps.includes(app))
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
  const allow_all_apps = input.allow_all_apps === true
  const tools = input.tools ?? READ_TOOLS
  if (!Array.isArray(tools) || tools.some(x => ![...READ_TOOLS, ...MUTATING_TOOLS].includes(x))) throw new Error('Unsupported tool in policy')
  if (tools.some(x => MUTATING_TOOLS.includes(x)) && input.allow_actions !== true) throw new Error('Actions require explicit allow_actions')
  if (!Array.isArray(input.args ?? []) || (input.args ?? []).some(x => typeof x !== 'string')) throw new Error('Invalid driver args')
  if (tools.includes('desktop_drag') && !(input.args ?? []).includes('--headed')) throw new Error('desktop_drag requires the explicit --headed driver mode')
  const timeout_ms = input.timeout_ms ?? 15000
  const launch_timeout_ms = input.launch_timeout_ms ?? 60000
  const max_actions = input.max_actions ?? 50
  if (!Number.isInteger(timeout_ms) || timeout_ms < 100 || timeout_ms > 120000) throw new Error('timeout_ms must be 100..120000')
  if (!Number.isInteger(launch_timeout_ms) || launch_timeout_ms < 1000 || launch_timeout_ms > 120000) throw new Error('launch_timeout_ms must be 1000..120000')
  if (!Number.isInteger(max_actions) || max_actions < 1 || max_actions > 1000) throw new Error('max_actions must be 1..1000')
  if (new Set(tools).size !== tools.length) throw new Error('Duplicate tool in policy')
  return { ...input, allow_all_apps, apps: [...input.apps], args: [...(input.args || [])], tools: [...tools], timeout_ms, launch_timeout_ms, max_actions }
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
    this.paths = computerStatePaths(this.config, stateRoot)
    this.loadConfig = loadConfig
    this.refs = new Set()
    this.refBounds = new Map()
    this.canvasBounds = new Map()
    this.refApp = ''
    this.actionCount = 0
    this.busy = false
    this.uncertain = false
    this.closed = false
    this.epoch = readControl(this.paths).epoch
  }

  clearObservedRefs() {
    this.refs.clear()
    this.refBounds.clear()
    this.canvasBounds.clear()
    this.refApp = ''
  }

  async listTools() {
    this.checkPolicy()
    const result = await this.driver.listTools()
    this.checkPolicy()
    return { tools: result.tools.filter(tool => this.config.tools.includes(tool.name) && (!['desktop_snapshot', 'desktop_launch'].includes(tool.name) || this.config.allow_all_apps || this.config.apps.length > 0) && (tool.name !== 'desktop_drag' || this.config.args.includes('--headed'))).map(tool => {
      const allowed = tool.name === 'desktop_snapshot' ? ['app', 'interactive_only', 'compact', 'skeleton', 'max_depth', 'include_bounds']
        : tool.name === 'desktop_launch' ? ['app', 'activate']
        : tool.name === 'desktop_drag' ? ['from_xy', 'to_xy', 'duration']
        : tool.name === 'desktop_skills_get' ? ['name']
        : ACTION_TOOLS.includes(tool.name) ? ['ref_id', ...(tool.name === 'desktop_type' ? ['text'] : ['desktop_set_value', 'desktop_select'].includes(tool.name) ? ['value'] : [])] : []
      const isAppScoped = ['desktop_snapshot', 'desktop_launch'].includes(tool.name)
      const isDrag = tool.name === 'desktop_drag'
      const required = isAppScoped ? ['app'] : isDrag ? ['canvas_ref', 'from_xy', 'to_xy'] : (tool.inputSchema?.required || []).filter(key => allowed.includes(key))
      const properties = Object.fromEntries(Object.entries(tool.inputSchema?.properties || {}).filter(([key]) => allowed.includes(key)))
      if (isAppScoped) {
        const appProperty = properties.app || { type: 'string' }
        properties.app = this.config.allow_all_apps
          ? { ...appProperty, description: `${appProperty.description || 'Application name'} Any app identifier supported by the desktop driver; use the exact name of the app requested by the user.` }
          : { ...appProperty, enum: [...this.config.apps], description: `${appProperty.description || 'Application name'} Must exactly match one of the allowlisted app names.` }
      }
      if (isDrag) properties.canvas_ref = { type: 'string', description: 'Use data.mah_canvases[n].canvas_ref returned by the most recent desktop_snapshot with include_bounds=true.' }
      const sequencing = 'Call desktop tools one at a time and wait for each result. Do not issue parallel desktop operations.'
      const allowedApps = this.config.allow_all_apps
        ? ' Policy allows any app; operate only on the app the user explicitly requested.'
        : this.config.apps.length ? ` Allowed app names: ${this.config.apps.join(', ')}.` : ' No app names are allowlisted.'
      const launchGuidance = tool.name === 'desktop_launch' ? ' Use only when the app is not already open; snapshot it first when possible to avoid duplicate instances.' : ''
      const dragGuidance = isDrag ? ' This is headed physical input. Use only for a user-requested drawing or drag, after snapshotting with include_bounds=true. Select a canvas from data.mah_canvases and use its canvas_ref; the broker confines both endpoints to that observed element.' : ''
      const textEntryGuidance = this.config.platform === 'win32' && tool.name === 'desktop_set_value'
        ? ' For Windows text fields in strict-headless runs, prefer this accessible value setter; desktop_type may be refused because headed physical input is disabled.'
        : this.config.platform === 'win32' && tool.name === 'desktop_type'
          ? ' Windows strict-headless sessions may refuse physical typing; use desktop_set_value when available.'
          : ''
      const description = isAppScoped
        ? `${tool.description || ''}${allowedApps}${launchGuidance} ${sequencing}`.trim()
        : `${tool.description || ''}${textEntryGuidance}${dragGuidance} ${sequencing}`.trim()
      return { ...tool, description, inputSchema: { type: 'object', properties, additionalProperties: false, ...(required.length ? { required } : {}) } }
    }) }
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
    const action = ACTION_TOOLS.includes(name)
    const launch = LAUNCH_TOOLS.includes(name)
    const mutating = action || launch
    const observedApp = this.refApp
    let release
    let poll
    let releaseSafe = true
    const action_id = randomUUID()
    try {
      if (this.busy) throw new Error('DESKTOP_BUSY: another desktop operation is still active; wait for its result before retrying. Do not send parallel desktop calls.')
      this.checkPolicy()
      if (signal?.aborted) throw new Error('Cancelled before dispatch')
      if (!this.config.tools.includes(name)) throw new Error('POLICY_DENIED: tool is not allowed')
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid arguments')
      if (name === 'desktop_snapshot') {
        const permitted = new Set(['app', 'interactive_only', 'compact', 'skeleton', 'max_depth', 'include_bounds'])
        if (Object.keys(args).some(key => !permitted.has(key))) throw new Error('POLICY_DENIED: unsupported snapshot scope')
        if (!appIsAllowed(this.config, args.app)) throw new Error(this.config.allow_all_apps ? 'POLICY_DENIED: an app identifier is required' : `POLICY_DENIED: app is not allowed; use an exact app name from the allowlist (${this.config.apps.join(', ')})`)
        for (const key of ['interactive_only', 'compact', 'skeleton']) if (key in args && typeof args[key] !== 'boolean') throw new Error(`Invalid ${key}`)
        if ('include_bounds' in args && typeof args.include_bounds !== 'boolean') throw new Error('Invalid include_bounds')
        if ('max_depth' in args && (!Number.isInteger(args.max_depth) || args.max_depth < 0 || args.max_depth > 20)) throw new Error('Invalid max_depth')
        this.clearObservedRefs()
      }
      if (launch) {
        const permitted = new Set(['app', 'activate'])
        if (Object.keys(args).some(key => !permitted.has(key))) throw new Error('POLICY_DENIED: unsupported launch argument; only app and activate are permitted')
        if (!appIsAllowed(this.config, args.app)) throw new Error(this.config.allow_all_apps ? 'POLICY_DENIED: an app identifier is required' : `POLICY_DENIED: app is not allowed; use an exact app name from the allowlist (${this.config.apps.join(', ')})`)
        if ('activate' in args && typeof args.activate !== 'boolean') throw new Error('Invalid activate')
      }
      if (name === 'desktop_skills_get' && (Object.keys(args).some(key => key !== 'name') || !['desktop', 'platform'].includes(args.name))) throw new Error('Unsupported skill; supported names are desktop and platform')
      if (['desktop_status', 'desktop_version'].includes(name) && Object.keys(args).length) throw new Error('POLICY_DENIED: unsupported read argument')
      if (mutating) {
        if (this.uncertain) throw new Error('OUTCOME_UNKNOWN: restart after operator reconciliation before more actions')
        if (!this.config.allow_actions || this.actionCount >= this.config.max_actions) throw new Error('POLICY_DENIED: action budget or permission')
      }
      if (action) {
        if (name === 'desktop_drag') {
          const permitted = new Set(['canvas_ref', 'from_xy', 'to_xy', 'duration'])
          if (Object.keys(args).some(key => !permitted.has(key))) throw new Error('POLICY_DENIED: unsupported drag argument')
          if (typeof args.canvas_ref !== 'string' || !this.canvasBounds.has(args.canvas_ref)) throw new Error('STALE_REF: take a fresh bounds-bearing snapshot and use one of its data.mah_canvases canvas_ref values')
          if (!appIsAllowed(this.config, observedApp)) throw new Error('POLICY_DENIED: observed app was revoked')
          const bounds = this.canvasBounds.get(args.canvas_ref)
          if (!bounds) throw new Error('POLICY_DENIED: canvas has no captured bounds; snapshot with include_bounds=true')
          const from = parsePoint(args.from_xy)
          const to = parsePoint(args.to_xy)
          if (!from || !to) throw new Error('Invalid drag coordinates; use integer x,y pairs')
          if (!pointInside(bounds, from) || !pointInside(bounds, to)) throw new Error('POLICY_DENIED: drag endpoints must stay inside the observed canvas bounds')
          if (Math.hypot(to.x - from.x, to.y - from.y) > MAX_DRAG_DISTANCE) throw new Error(`POLICY_DENIED: drag distance exceeds ${MAX_DRAG_DISTANCE}px`)
          if ('duration' in args && (!Number.isInteger(args.duration) || args.duration < 100 || args.duration > 5000)) throw new Error('Invalid drag duration; use 100..5000ms')
        } else {
          if (typeof args.ref_id !== 'string' || !this.refs.has(args.ref_id)) throw new Error('STALE_REF: observe an allowed app before acting')
          if (!appIsAllowed(this.config, observedApp)) throw new Error('POLICY_DENIED: observed app was revoked')
          // Ref-based UI actions only. No coordinate clicks, shell, clipboard,
          // force, window override or global physical-input flags pass through.
          const permitted = new Set(['ref_id', ...(name === 'desktop_type' ? ['text'] : name === 'desktop_set_value' ? ['value'] : name === 'desktop_select' ? ['value'] : [])])
          if (Object.keys(args).some(key => !permitted.has(key))) throw new Error('POLICY_DENIED: unsupported action argument')
          const valueKey = name === 'desktop_type' ? 'text' : ['desktop_set_value', 'desktop_select'].includes(name) ? 'value' : ''
          if (valueKey && (typeof args[valueKey] !== 'string' || args[valueKey].length > 16_384)) throw new Error(`Invalid ${valueKey}`)
        }
      }
      if (launch) this.clearObservedRefs()
      release = acquire(this.paths)
      this.busy = true
      const controller = new AbortController()
      const forward = () => controller.abort()
      signal?.addEventListener('abort', forward, { once: true })
      const timeoutMs = launch ? this.config.launch_timeout_ms : this.config.timeout_ms
      const deadline = setTimeout(() => controller.abort(), timeoutMs)
      poll = setInterval(() => {
        try { this.checkPolicy(); if (!this.config.tools.includes(name) || (mutating && (!this.config.allow_actions || this.actionCount > this.config.max_actions)) || (action && !appIsAllowed(this.config, observedApp)) || (['desktop_snapshot', 'desktop_launch'].includes(name) && !appIsAllowed(this.config, args.app))) controller.abort() }
        catch { controller.abort() }
      }, 100)
      let result
      let rejectAbort
      const aborted = new Promise((_, reject) => { rejectAbort = reject })
      const onDeadline = () => rejectAbort(new Error('Cancelled or deadline exceeded; outcome must be reconciled'))
      controller.signal.addEventListener('abort', onDeadline, { once: true })
      try {
        if (controller.signal.aborted) throw new Error('Cancelled before dispatch')
        if (mutating) { this.actionCount++; this.clearObservedRefs() }
        appendFileSync(this.paths.audit, JSON.stringify({ action_id, event: 'started', tool: name, principal_id: this.config.principal_id, at: new Date().toISOString() }) + '\n', { mode: 0o600 })
        const driverArgs = name === 'desktop_drag'
          ? { from_xy: args.from_xy, to_xy: args.to_xy, ...(args.duration === undefined ? {} : { duration: args.duration }) }
          : args
        result = await Promise.race([this.driver.callTool(name, driverArgs, { signal: controller.signal, timeout: timeoutMs }), aborted])
        if (controller.signal.aborted) throw new Error('Cancelled; outcome must be reconciled')
        this.checkPolicy()
        if (!this.config.tools.includes(name) || (mutating && !this.config.allow_actions)) throw new Error('POLICY_DENIED: permission changed during call')
        if ((['desktop_snapshot', 'desktop_launch'].includes(name) && !appIsAllowed(this.config, args.app)) || (action && !appIsAllowed(this.config, observedApp))) throw new Error('POLICY_DENIED: app changed during call')
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
      if (Buffer.byteLength(JSON.stringify(result ?? null), 'utf8') > 1_048_576) {
        if (mutating) this.uncertain = true
        throw new Error('OUTPUT_LIMIT: desktop result exceeds 1 MiB')
      }
      if (name === 'desktop_snapshot' && success) {
        this.refs = collectRefs(body.data)
        this.refBounds = collectRefBounds(body.data)
        const canvases = args.include_bounds === true
          ? collectCanvasBounds(body.data?.tree, body.data?.snapshot_id || randomUUID())
          : []
        this.canvasBounds = new Map(canvases.map(canvas => [canvas.canvas_ref, canvas.bounds]))
        attachCanvasRefs(result, canvases)
        this.refApp = args.app
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
