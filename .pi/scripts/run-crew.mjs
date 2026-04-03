import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const piRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(piRoot, "..")
const crewRoot = path.join(piRoot, "crew")
const activeMetaPath = path.join(piRoot, ".active-crew.json")
const fallbackExtensions = [
  "extensions/multi-team.ts",
  "extensions/agent-session-navigator.ts",
  "extensions/mcp-bridge.ts",
  "extensions/theme-cycler.ts"
]

function parseExtensionList(raw) {
  if (!raw) return []
  return `${raw}`
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function stripMatchingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function parseDotEnv(raw) {
  const out = {}
  for (const line of `${raw || ""}`.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed
    const separator = normalized.indexOf("=")
    if (separator <= 0) continue
    const key = normalized.slice(0, separator).trim()
    if (!/^[A-Z0-9_]+$/i.test(key)) continue
    out[key] = stripMatchingQuotes(normalized.slice(separator + 1).trim())
  }
  return out
}

function loadRuntimeEnv() {
  const candidates = [
    process.env.PI_ENV_FILE?.trim() ? resolveFromRepo(process.env.PI_ENV_FILE.trim()) : "",
    path.join(repoRoot, "multi-agents", ".env"),
    path.join(repoRoot, ".env")
  ].filter(Boolean)

  const loaded = {}
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue
    const parsed = parseDotEnv(readFileSync(filePath, "utf-8"))
    for (const [key, value] of Object.entries(parsed)) {
      if (loaded[key] == null || loaded[key] === "") {
        loaded[key] = value
      }
    }
  }
  return loaded
}

function loadDefaultExtensionsFromMeta() {
  const metaPath = path.join(repoRoot, "meta-agents.yaml")
  if (!existsSync(metaPath)) return fallbackExtensions
  try {
    const meta = YAML.parse(readFileSync(metaPath, "utf-8")) || {}
    const configured = meta?.runtimes?.pi?.default_extensions
    if (!Array.isArray(configured) || configured.length === 0) return fallbackExtensions
    const normalized = configured
      .map((item) => `${item || ""}`.trim())
      .filter(Boolean)
    return normalized.length > 0 ? normalized : fallbackExtensions
  } catch {
    return fallbackExtensions
  }
}

function listCrews() {
  if (!existsSync(crewRoot)) return []
  return readdirSync(crewRoot)
    .filter((entry) => {
      const abs = path.join(crewRoot, entry)
      return statSync(abs).isDirectory() && existsSync(path.join(abs, "multi-team.yaml"))
    })
    .sort((a, b) => a.localeCompare(b))
}

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exitCode = 1
}

function newSessionId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const rand = Math.random().toString(36).slice(2, 8)
  return `${stamp}-${rand}`
}

function readJson(filePath) {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

function isSessionLayoutRoot(dir) {
  return (
    existsSync(path.join(dir, "manifest.json")) ||
    existsSync(path.join(dir, "session_index.json")) ||
    existsSync(path.join(dir, "conversation.jsonl")) ||
    existsSync(path.join(dir, "events.jsonl")) ||
    existsSync(path.join(dir, "tool_calls.jsonl")) ||
    existsSync(path.join(dir, "state"))
  )
}

function readSessionIdFromRoot(dir) {
  const fromIndex = readJson(path.join(dir, "session_index.json"))?.sessionId
  if (typeof fromIndex === "string" && fromIndex.trim()) return fromIndex.trim()
  const fromManifest = readJson(path.join(dir, "manifest.json"))?.sessionId
  if (typeof fromManifest === "string" && fromManifest.trim()) return fromManifest.trim()
  const base = path.basename(dir)
  return base === "sessions" ? "" : base
}

function latestSessionRoot(sessionBaseRoot) {
  if (!existsSync(sessionBaseRoot)) return null
  const candidates = readdirSync(sessionBaseRoot)
    .map((entry) => path.join(sessionBaseRoot, entry))
    .filter((entryPath) => {
      try {
        return statSync(entryPath).isDirectory() && isSessionLayoutRoot(entryPath)
      } catch {
        return false
      }
    })
    .sort((a, b) => {
      try {
        return statSync(b).mtimeMs - statSync(a).mtimeMs
      } catch {
        return 0
      }
    })
  return candidates[0] || null
}

function resolveFromRepo(filePath) {
  if (path.isAbsolute(filePath)) return filePath
  return path.resolve(repoRoot, filePath)
}

function parseArgs(argv) {
  const args = {
    crew: undefined,
    config: undefined,
    sessionRoot: undefined,
    extensions: parseExtensionList(process.env.PI_MULTI_EXTENSION),
    newSession: false,
    passthrough: []
  }

  let passthroughMode = false
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === "--") {
      passthroughMode = true
      continue
    }
    if (passthroughMode) {
      args.passthrough.push(token)
      continue
    }
    if (token === "--crew") {
      args.crew = argv[i + 1]
      i += 1
      continue
    }
    if (token === "--config") {
      args.config = argv[i + 1]
      i += 1
      continue
    }
    if (token === "--session-root") {
      args.sessionRoot = argv[i + 1]
      i += 1
      continue
    }
    if (token === "--extension") {
      const value = argv[i + 1]
      if (value) {
        args.extensions.push(...parseExtensionList(value))
      }
      i += 1
      continue
    }
    if (token === "--new-session") {
      args.newSession = true
      continue
    }

    args.passthrough.push(token)
  }
  return args
}

function printHelp() {
  console.log("Usage: pimh run [options] [-- <pi-args>]")
  console.log("")
  console.log("Options:")
  console.log("  --crew <name>          Run using .pi/crew/<name>/multi-team.yaml")
  console.log("  --config <path>        Explicit PI config path (overrides active crew)")
  console.log("  --session-root <path>  Explicit PI session root")
  console.log("  --extension <path>     Add PI extension path (supports repeated flag or comma-separated values)")
  console.log("  --new-session          Force a new multi-team session folder even with -c")
  console.log("")
  console.log("Examples:")
  console.log("  pimh run -c")
  console.log("  pimh run --crew dev -c")
  console.log("  pimh run --config .pi/crew/dev/multi-team.yaml -c")
}

function readActiveMeta() {
  if (!existsSync(activeMetaPath)) return null
  try {
    return JSON.parse(readFileSync(activeMetaPath, "utf-8"))
  } catch {
    return null
  }
}

function resolveRuntimeSelection(args) {
  const active = readActiveMeta()

  if (args.config) {
    const configPath = resolveFromRepo(args.config)
    const sessionRoot = args.sessionRoot
      ? resolveFromRepo(args.sessionRoot)
      : path.join(piRoot, "multi-team", "sessions")
    return {
      configPath,
      sessionRoot,
      crew: active?.crew || null
    }
  }

  if (args.crew) {
    const crews = listCrews()
    if (!crews.includes(args.crew)) {
      fail(`crew not found: ${args.crew}`)
      console.log("Available crews:")
      for (const crew of crews) console.log(`- ${crew}`)
      return null
    }
    return {
      configPath: path.join(crewRoot, args.crew, "multi-team.yaml"),
      sessionRoot: path.join(crewRoot, args.crew, "sessions"),
      crew: args.crew
    }
  }

  if (active?.source_config) {
    return {
      configPath: resolveFromRepo(active.source_config),
      sessionRoot: active?.session_root
        ? resolveFromRepo(active.session_root)
        : path.join(piRoot, "multi-team", "sessions"),
      crew: active?.crew || null
    }
  }

  fail("no crew selected. Run: pimh use <crew>")
  return null
}

function selectSessionLayout(sessionBaseRoot, args) {
  const envSessionRoot = process.env.PI_MULTI_SESSION_ROOT?.trim()
  const envSessionId = process.env.PI_MULTI_SESSION_ID?.trim()
  const continueRequested = args.passthrough.includes("-c") || args.passthrough.includes("--continue")
  const containerLikeRoot = path.basename(sessionBaseRoot) === "sessions"

  if (envSessionRoot) {
    const explicitRoot = resolveFromRepo(envSessionRoot)
    return {
      mode: "env-explicit",
      sessionRoot: explicitRoot,
      sessionId: envSessionId || readSessionIdFromRoot(explicitRoot) || newSessionId()
    }
  }

  if (!containerLikeRoot && isSessionLayoutRoot(sessionBaseRoot)) {
    return {
      mode: "explicit-root",
      sessionRoot: sessionBaseRoot,
      sessionId: envSessionId || readSessionIdFromRoot(sessionBaseRoot) || newSessionId()
    }
  }

  if (!args.newSession && continueRequested) {
    const latest = latestSessionRoot(sessionBaseRoot)
    if (latest) {
      return {
        mode: "continue-latest",
        sessionRoot: latest,
        sessionId: readSessionIdFromRoot(latest) || envSessionId || newSessionId()
      }
    }
  }

  const sessionId = envSessionId || newSessionId()
  return {
    mode: "new",
    sessionRoot: path.join(sessionBaseRoot, sessionId),
    sessionId
  }
}

function persistRunMetadata(selection, configPath, sessionBaseRoot, sessionRoot, sessionId) {
  const relativeConfig = path.relative(repoRoot, configPath)
  const relativeBase = path.relative(repoRoot, sessionBaseRoot)
  const relativeRoot = path.relative(repoRoot, sessionRoot)
  const current = readActiveMeta() || {}

  const next = {
    ...current,
    crew: selection.crew || current.crew || null,
    source_config: relativeConfig,
    session_root: relativeBase,
    last_session_id: sessionId,
    last_session_root: relativeRoot,
    last_run_at: new Date().toISOString(),
    note: "Used by .pi/scripts/run-crew.mjs to bootstrap PI with selected crew and encapsulated session folders."
  }

  writeFileSync(activeMetaPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8")
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp()
    return
  }

  const args = parseArgs(process.argv.slice(2))
  const selected = resolveRuntimeSelection(args)
  if (!selected) return

  const configPath = selected.configPath
  const sessionBaseRoot = selected.sessionRoot
  const defaultExtensions = loadDefaultExtensionsFromMeta()
  const configuredExtensions = args.extensions.length > 0 ? args.extensions : defaultExtensions
  const extensionPaths = Array.from(new Set(configuredExtensions)).map((item) => resolveFromRepo(item))

  if (!existsSync(configPath)) {
    fail(`config not found: ${path.relative(repoRoot, configPath)}`)
    return
  }
  for (const extensionPath of extensionPaths) {
    if (!existsSync(extensionPath)) {
      fail(`extension not found: ${path.relative(repoRoot, extensionPath)}`)
      return
    }
  }

  mkdirSync(sessionBaseRoot, { recursive: true })

  const sessionSelection = selectSessionLayout(sessionBaseRoot, args)
  const sessionRoot = sessionSelection.sessionRoot
  const sessionId = sessionSelection.sessionId
  mkdirSync(sessionRoot, { recursive: true })
  persistRunMetadata(selected, configPath, sessionBaseRoot, sessionRoot, sessionId)

  const extensionArgs = extensionPaths.flatMap((extensionPath) => ["-e", extensionPath])
  const commandArgs = [...extensionArgs, ...args.passthrough]
  const loadedEnv = loadRuntimeEnv()
  const env = {
    ...process.env
  }
  for (const [key, value] of Object.entries(loadedEnv)) {
    if (env[key] == null || env[key] === "") {
      env[key] = value
    }
  }
  env.PI_MULTI_CONFIG = configPath
  env.PI_MULTI_SESSION_ROOT = sessionRoot
  env.PI_MULTI_SESSION_ID = sessionId

  console.log("Running PI with selected crew")
  console.log(`- PI_MULTI_CONFIG=${path.relative(repoRoot, configPath)}`)
  console.log(`- PI_MULTI_SESSION_BASE=${path.relative(repoRoot, sessionBaseRoot)}`)
  console.log(`- PI_MULTI_SESSION_ROOT=${path.relative(repoRoot, sessionRoot)}`)
  console.log(`- PI_MULTI_SESSION_ID=${sessionId}`)
  console.log(`- session_mode=${sessionSelection.mode}`)
  console.log(`- extensions=${extensionPaths.map((item) => path.relative(repoRoot, item)).join(", ")}`)
  console.log(`- OPENROUTER_API_KEY=${env.OPENROUTER_API_KEY ? "***" : "(missing)"}`)
  if (args.passthrough.length > 0) {
    console.log(`- args=${args.passthrough.join(" ")}`)
  }
  console.log("")

  const child = spawnSync("pi", commandArgs, {
    cwd: repoRoot,
    env,
    stdio: "inherit"
  })

  if (typeof child.status === "number") {
    process.exitCode = child.status
    return
  }
  if (child.error) {
    fail(`failed to start pi: ${child.error.message}`)
  }
}

main()
