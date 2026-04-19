import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, cpSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { resolve, dirname } from "node:path"
import { spawnSync } from "node:child_process"
import os from "node:os"
import { fileURLToPath } from "node:url"
import YAML from "yaml"
import { RUNTIME_ORDER } from "./runtime-adapters.mjs"
import { validateRuntimeAdapterContract } from "./runtime-adapter-contract.mjs"
import { appendProvenance, buildCrewGraph, buildRunGraphFromProvenance, collectSessions, parseSessionId, readMetaConfig, readProvenance, exportSession as exportSessionFn, deleteSession as deleteSessionFn, resumeSession as resumeSessionFn, startSession as startSessionFn } from "./m3-ops.mjs"
import { validatePlugin as validatePluginFn, unloadPlugin as unloadPluginFn, getAllRuntimes, listLoadedPlugins, loadPlugins, MAH_VERSION } from "./plugin-loader.mjs"
import { clearActiveCrew, extractCrewArg, listRuntimeCrews, readActiveCrew, resolveCrewConfigPath, writeActiveCrew } from "./runtime-core-ops.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.resolve(__dirname, "..")

function isPathWithin(parentDir, childDir) {
  const relative = path.relative(parentDir, childDir)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function resolveSearchBoundary(startDir) {
  const cwd = path.resolve(startDir)
  const gitProbe = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"]
  })
  if (gitProbe.status === 0) {
    const gitRoot = `${gitProbe.stdout || ""}`.trim()
    if (gitRoot) {
      return { dir: path.resolve(gitRoot), include: true }
    }
  }

  const homeDir = process.env.HOME?.trim() || os.homedir()
  if (homeDir) {
    const resolvedHome = path.resolve(homeDir)
    if (isPathWithin(resolvedHome, cwd)) {
      return { dir: resolvedHome, include: false }
    }
  }

  return { dir: path.parse(cwd).root, include: false }
}

function resolveWorkspaceRoot(startDir = process.cwd()) {
  const markerNames = ["meta-agents.yaml", ".pi", ".claude", ".opencode", ".hermes", ".codex", ".kilo"]
  const initial = path.resolve(startDir)
  const { dir: ceiling, include: includeCeiling } = resolveSearchBoundary(initial)
  let current = initial

  while (true) {
    for (const marker of markerNames) {
      if (existsSync(path.join(current, marker))) {
        if (current !== ceiling || includeCeiling) return current
        break
      }
    }
    if (current === ceiling) return initial
    const parent = path.dirname(current)
    if (parent === current || !isPathWithin(ceiling, parent)) return initial
    current = parent
  }
}

const repoRoot = resolveWorkspaceRoot(process.cwd())

// Bootstrap plugin discovery at module load time (top-level await).
// This ensures plugin runtimes are available for all commands including detect.
const runtimeProfiles = await getAllRuntimes()

function orderedRuntimeNames(profiles = runtimeProfiles) {
  const builtIns = RUNTIME_ORDER.filter((name) => profiles[name])
  const plugins = Object.keys(profiles)
    .filter((name) => !RUNTIME_ORDER.includes(name))
    .sort((left, right) => left.localeCompare(right))
  return [...builtIns, ...plugins]
}

function commandExists(command) {
  const probe = spawnSync("bash", ["-lc", `command -v ${command} >/dev/null 2>&1`], {
    cwd: repoRoot,
    env: process.env
  })
  return probe.status === 0
}

function runtimeExecutableStatus(runtimeName) {
  const profile = runtimeProfiles[runtimeName]
  const directCliAvailable = profile?.directCli ? commandExists(profile.directCli) : false
  const wrapperAvailable = profile?.wrapper ? commandExists(profile.wrapper) : false
  return { directCliAvailable, wrapperAvailable }
}

function parseRuntimeArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === "--runtime" && argv[i + 1]) return argv[i + 1]
    if (token === "-r" && argv[i + 1]) return argv[i + 1]
    if (token === "-f" && argv[i + 1]) return argv[i + 1]
    if (token.startsWith("--runtime=")) return token.slice("--runtime=".length)
    if (token.startsWith("-r=")) return token.slice("-r=".length)
    if (token.startsWith("-f=")) return token.slice("-f=".length)
  }
  return process.env.MAH_RUNTIME?.trim() || ""
}

function stripRuntimeArgs(argv) {
  const cleaned = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === "--runtime" || token === "-r" || token === "-f") {
      i += 1
      continue
    }
    if (token.startsWith("--runtime=") || token.startsWith("-r=") || token.startsWith("-f=")) {
      continue
    }
    cleaned.push(token)
  }
  return cleaned
}

function parseRuntimeBeforeCommand(argv = [], commandName = "") {
  if (!Array.isArray(argv) || !commandName) return ""
  const commandIndex = argv.indexOf(commandName)
  if (commandIndex <= 0) return ""
  return parseRuntimeArg(argv.slice(0, commandIndex))
}

function findAgentConfigByName(crewConfig = {}, agentName = "") {
  const normalizedTarget = `${agentName || ""}`.trim().toLowerCase()
  if (!normalizedTarget) return null

  const orchestrator = crewConfig?.orchestrator
  if (`${orchestrator?.name || ""}`.trim().toLowerCase() === normalizedTarget) {
    return orchestrator
  }

  for (const team of Array.isArray(crewConfig?.teams) ? crewConfig.teams : []) {
    if (`${team?.lead?.name || ""}`.trim().toLowerCase() === normalizedTarget) {
      return team.lead
    }
    for (const member of Array.isArray(team?.members) ? team.members : []) {
      if (`${member?.name || ""}`.trim().toLowerCase() === normalizedTarget) {
        return member
      }
    }
  }

  return null
}

function resolveCanonicalModelForTarget({ runtime, crew, targetAgent, repoRoot }) {
  const runtimeProfile = runtimeProfiles[runtime]
  if (!runtimeProfile?.markerDir || !crew || !targetAgent) return ""
  const multiTeamPath = path.join(repoRoot, runtimeProfile.markerDir, "crew", crew, "multi-team.yaml")
  if (!existsSync(multiTeamPath)) return ""
  try {
    const crewConfig = YAML.parse(readFileSync(multiTeamPath, "utf-8"))
    const agentConfig = findAgentConfigByName(crewConfig, targetAgent)
    return `${agentConfig?.model || ""}`.trim()
  } catch {
    return ""
  }
}

function isModelIdentityTask(task = "") {
  const text = `${task || ""}`.toLowerCase()
  if (!text) return false
  const hasModelSignal =
    text.includes("which model") ||
    text.includes("model id") ||
    text.includes("model identifier") ||
    text.includes("model identity") ||
    text.includes("model name") ||
    text.includes("provider")
  const hasStatusSignal =
    text.includes("using") ||
    text.includes("running") ||
    text.includes("currently") ||
    text.includes("operating")
  return hasModelSignal && hasStatusSignal
}

function buildCanonicalModelIdentityTask(task = "", canonicalModel = "") {
  if (!task || !canonicalModel || !isModelIdentityTask(task)) return task
  return `${task}\n\nSystem directive: return exactly this canonical model identifier and nothing else: ${canonicalModel}\nDo not inspect files, environment, or configuration for this question.`
}

function detectRuntime(cwd, forcedRuntime) {
  if (forcedRuntime && runtimeProfiles[forcedRuntime]) {
    return { runtime: forcedRuntime, reason: "forced" }
  }

  const byMarker = Object.entries(runtimeProfiles)
    .filter(([, profile]) => existsSync(path.join(cwd, profile.markerDir)))
    .map(([name]) => name)

  if (byMarker.length === 1) {
    return { runtime: byMarker[0], reason: "marker" }
  }

  if (byMarker.length > 1) {
    const strictMarkers = process.argv.includes("--strict-markers") || process.env.MAH_STRICT_MARKERS === "1"
    if (strictMarkers) {
      return { runtime: null, reason: `ambiguous-markers:${byMarker.join(",")}` }
    }
    const preferred = RUNTIME_ORDER.find((name) => byMarker.includes(name))
    if (preferred) return { runtime: preferred, reason: `markers:${byMarker.join(",")}` }
    const pluginPreferred = [...byMarker].sort((left, right) => left.localeCompare(right))[0]
    if (pluginPreferred) return { runtime: pluginPreferred, reason: `markers:${byMarker.join(",")}` }
  }

  return { runtime: null, reason: "none" }
}

function printHelp() {
  console.log("meta-agents-harness")
  console.log("")
  console.log("Usage:")
  console.log("  mah <command> [args]")
  console.log("")
  console.log("Commands:")
  console.log("  detect")
  console.log("  doctor")
  console.log("  explain [detect|use|run|plan|diff|sync|generate|generate:tree|validate] [args]")
  console.log("  init [--yes] [--force] [--crew <name>] [--runtime <name>]")
  console.log("  sessions [--runtime <name>] [--crew <name>] [--json] [list|resume|new|export|delete] [args]")
  console.log("  graph [--crew <name>] [--run <id>] [--json] [--mermaid] [--mermaid-level <basic|group|detailed>]")
  console.log("  demo [crew]")
  console.log("  contract:runtime")
  console.log("  check:runtime")
  console.log("  validate:runtime")
  console.log("  validate:config")
  console.log("  validate:sync")
  console.log("  validate:all")
  console.log("  validate")
  console.log("  generate")
  console.log("  generate:tree")
  console.log("  list:crews")
  console.log("  plugins [list|install <path>|uninstall <name>|validate <path>]")
  console.log("  use <crew>")
  console.log("  clear")
  console.log("  delegate --target <agent> --task '<task>' [--runtime <target>] [--crew <id>] [--execute|-x]")
  console.log("  run [runtime-args]")
  console.log("  plan")
  console.log("  diff")
  console.log("  sync")
  console.log("")
  console.log("Options:")
  const runtimes = orderedRuntimeNames(runtimeProfiles).join("|")
  console.log(`  --runtime <${runtimes}>`)
  console.log(`  -r <${runtimes}>`)
  console.log(`  -f <${runtimes}>`)
  console.log("  --session-mode <new|continue>")
  console.log("  --session-id <id>")
  console.log("  --session-root <path>")
  console.log("  --session-mirror / --no-session-mirror")
  console.log("  --trace")
  console.log("  --json")
  console.log("  --mermaid")
  console.log("  --mermaid-level <basic|group|detailed>")
  console.log("  --mermaid-capabilities")
  console.log("  --crew <name>")
  console.log("  --run <id>")
  console.log("  --agent <name>")
  console.log("  --strict-markers")
  console.log("  --headless                 run in non-interactive mode")
  console.log("  --output <json|text>")
  console.log("  -o <json|text>")
}

function hasFlag(argv, flag) {
  return argv.includes(flag)
}

function removeFlag(argv, flag) {
  return argv.filter((item) => item !== flag)
}

function parseValueArg(argv, flag, short = "") {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === flag && argv[i + 1]) return argv[i + 1]
    if (short && token === short && argv[i + 1]) return argv[i + 1]
    if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1)
  }
  return ""
}

function hasHeadlessFlag(argv) {
  return argv.includes("--headless")
}

function parseOutputMode(argv) {
  if (argv.includes("--output=json") || argv.includes("-o=json")) return "json"
  if (argv.includes("--output=text") || argv.includes("-o=text")) return "text"
  return "text" // default
}

function stripHeadlessArgs(argv) {
  return argv.filter((item) => item !== "--headless" && !item.startsWith("--output=") && !item.startsWith("-o="))
}

function parseFilterArgs(argv) {
  return {
    runtime: parseValueArg(argv, "--runtime", "-r"),
    crew: parseValueArg(argv, "--crew"),
    run: parseValueArg(argv, "--run"),
    json: hasFlag(argv, "--json"),
    mermaid: hasFlag(argv, "--mermaid"),
    mermaidLevel: parseValueArg(argv, "--mermaid-level"),
    mermaidCapabilities: hasFlag(argv, "--mermaid-capabilities"),
    dryRun: hasFlag(argv, "--dry-run")
  }
}

// SECURITY: v0.7.0-patch
function validateCliPath(inputPath, intent) {
  if (!inputPath || typeof inputPath !== "string") {
    return { ok: false, error: "path must be a non-empty string" }
  }
  if (intent !== "read" && intent !== "write") {
    return { ok: false, error: `invalid path intent '${intent}'` }
  }

  const trimmed = inputPath.trim()
  if (!trimmed) {
    return { ok: false, error: "path must be a non-empty string" }
  }

  const currentRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const resolvedPath = path.isAbsolute(trimmed) ? resolve(trimmed) : resolve(currentRepoRoot, trimmed)
  const rel = path.relative(currentRepoRoot, resolvedPath)
  const escapesRepoRoot = rel.startsWith("..") || path.isAbsolute(rel)

  if (escapesRepoRoot) {
    return {
      ok: false,
      error: `${intent} path escapes repository root and is not allowed: '${inputPath}'`
    }
  }

  return { ok: true, resolvedPath }
}

function runCliPathSecuritySelfTest() {
  // SECURITY: v0.7.0-patch
  const cases = [
    { path: '.mah/expertise/export.json', intent: 'write', expectOk: true },
    { path: '../../etc/passwd', intent: 'read', expectOk: false },
    { path: '/etc/passwd', intent: 'read', expectOk: false },
  ]
  let failed = 0
  for (const t of cases) {
    const result = validateCliPath(t.path, t.intent)
    const pass = result.ok === t.expectOk
    if (!pass) failed += 1
    console.log(`[cli-path-selftest] ${t.intent} '${t.path}' => ok=${result.ok} (expected ${t.expectOk})`)
  }
  return failed === 0 ? 0 : 1
}

function runLocalScript(scriptPath, scriptArgs = []) {
  const child = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit"
  })
  if (typeof child.status === "number") return child.status
  if (child.error) {
    console.error(`ERROR: failed to run ${scriptPath}: ${child.error.message}`)
  }
  return 1
}

function runLocalScriptCapture(scriptPath, scriptArgs = []) {
  const child = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf-8"
  })
  return {
    status: typeof child.status === "number" ? child.status : 1,
    stdout: child.stdout || "",
    stderr: child.stderr || ""
  }
}

function readConfiguredMcpServers() {
  const candidates = [path.join(repoRoot, ".mcp.json"), path.join(repoRoot, ".mcp.example.json")]
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue
    try {
      const raw = readFileSync(filePath, "utf-8")
      const parsed = JSON.parse(raw)
      const servers = Object.keys(parsed?.mcpServers || {}).filter(Boolean).sort()
      if (servers.length > 0) return servers
    } catch {
    }
  }
  return ["context7", "github"]
}

function normalizeStringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : []
}

function normalizeSprintMode(value) {
  if (!value || typeof value !== "object") return null
  const next = {
    name: `${value.name || ""}`.trim(),
    active: Boolean(value.active),
    target_release: `${value.target_release || ""}`.trim(),
    objective: `${value.objective || ""}`.trim(),
    execution_mode: `${value.execution_mode || ""}`.trim(),
    directives: normalizeStringList(value.directives),
    must_deliver: normalizeStringList(value.must_deliver),
    must_not_deliver: normalizeStringList(value.must_not_deliver)
  }
  const compact = Object.fromEntries(
    Object.entries(next).filter(([, item]) => {
      if (Array.isArray(item)) return item.length > 0
      if (typeof item === "boolean") return true
      return Boolean(item)
    })
  )
  return Object.keys(compact).length > 0 ? compact : null
}

function normalizeAgentCrewContext(agent) {
  if (!agent || typeof agent !== "object") return null
  const context = {
    id: `${agent.id || ""}`.trim(),
    role: `${agent.role || ""}`.trim(),
    team: `${agent.team || ""}`.trim(),
    sprint_responsibilities: normalizeStringList(agent.sprint_responsibilities)
  }
  const compact = Object.fromEntries(
    Object.entries(context).filter(([, item]) => {
      if (Array.isArray(item)) return item.length > 0
      return Boolean(item)
    })
  )
  return Object.keys(compact).length > 0 ? compact : null
}

function resolveCrewExecutionContext(crewId) {
  const requested = `${crewId || ""}`.trim()
  if (!requested) return null
  const meta = readMetaConfig(repoRoot)
  const crew = (meta.crews || []).find((item) => item.id === requested)
  if (!crew) {
    return { requested_crew: requested, found: false }
  }
  const agents = (crew.agents || [])
    .map((agent) => normalizeAgentCrewContext(agent))
    .filter(Boolean)
  return {
    crew_id: crew.id,
    display_name: `${crew.display_name || ""}`.trim(),
    found: true,
    mission: `${crew.mission || ""}`.trim(),
    sprint_mode: normalizeSprintMode(crew.sprint_mode),
    topology: {
      orchestrator: `${crew.topology?.orchestrator || ""}`.trim(),
      leads: Object.entries(crew.topology?.leads || {}).map(([team, lead]) => ({ team, lead })),
      worker_teams: Object.entries(crew.topology?.workers || {}).map(([team, members]) => ({ team, members }))
    },
    agents
  }
}

function createDiagnosticPayload(command, values = {}) {
  const status = Number.isInteger(values.status) ? values.status : 0
  const errors = Array.isArray(values.errors) ? values.errors : []
  return {
    schema: "mah.diagnostics.v1",
    command,
    ok: status === 0 && errors.length === 0,
    status,
    runtime: values.runtime || "",
    reason: values.reason || "",
    data: values.data || {},
    errors
  }
}

function printDiagnosticPayload(payload) {
  console.log(JSON.stringify(payload, null, 2))
}

function logProvenance(event) {
  const enabled = process.env.MAH_AUDIT === "1" || process.env.MAH_PROVENANCE === "1"
  if (!enabled) return
  appendProvenance(repoRoot, event)
}

function extractSessionOptions(argv) {
  const options = {
    mode: "",
    sessionId: "",
    sessionRoot: "",
    sessionMirror: null,
    agent: "",
    hierarchy: null
  }
  const remaining = []

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === "--session-mode" && argv[i + 1]) {
      options.mode = argv[i + 1]
      i += 1
      continue
    }
    if (token === "--session-id" && argv[i + 1]) {
      options.sessionId = argv[i + 1]
      i += 1
      continue
    }
    if (token === "--session-root" && argv[i + 1]) {
      options.sessionRoot = argv[i + 1]
      i += 1
      continue
    }
    if (token === "--session-mirror") {
      options.sessionMirror = true
      continue
    }
    if (token === "--no-session-mirror") {
      options.sessionMirror = false
      continue
    }
    if (token === "--agent" && argv[i + 1]) {
      options.agent = argv[i + 1]
      i += 1
      continue
    }
    if (token === "--hierarchy") {
      options.hierarchy = true
      continue
    }
    if (token === "--no-hierarchy") {
      options.hierarchy = false
      continue
    }
    remaining.push(token)
  }

  return { options, remaining: remaining.filter(Boolean) }
}

function hasContinueFlag(argv) {
  return argv.includes("-c") || argv.includes("--continue") || argv.includes("--resume")
}

function normalizeCapabilityArgs(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.trim())
  if (typeof value === "string" && value.trim()) return [value]
  return []
}

function appendArgsOnce(target, extraArgs) {
  if (extraArgs.length === 0) return
  const alreadyPresent = extraArgs.every((token) => target.includes(token))
  if (!alreadyPresent) target.push(...extraArgs)
}

function supportsCoreManagedCommand(adapter, command) {
  if (!adapter || typeof adapter !== "object") return false
  if (command === "run") return typeof adapter.prepareRunContext === "function"
  if (["list:crews", "use", "clear"].includes(command)) return !adapter.commands?.[command]
  return false
}

function extractUseCrewArg(argv = []) {
  let crew = ""
  const remaining = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!crew && token === "--crew" && argv[i + 1]) {
      crew = argv[i + 1]
      i += 1
      continue
    }
    if (!crew && token.startsWith("--crew=")) {
      crew = token.slice("--crew=".length)
      continue
    }
    if (!crew && !token.startsWith("-")) {
      crew = token
      continue
    }
    remaining.push(token)
  }
  return { crew: `${crew || ""}`.trim(), remaining }
}

function executeCoreManagedCommand(runtime, command, passthrough, jsonMode = false) {
  const adapter = runtimeProfiles[runtime]
  if (!supportsCoreManagedCommand(adapter, command) || command === "run") {
    return { handled: false }
  }

  const crews = listRuntimeCrews(repoRoot, adapter, runtime)
  const activeCrew = readActiveCrew(repoRoot, adapter, runtime)

  if (command === "list:crews") {
    if (jsonMode) {
      console.log(JSON.stringify({ runtime, active_crew: activeCrew?.crew || "", crews }, null, 2))
    } else if (crews.length === 0) {
      console.log("crews=none")
    } else {
      for (const crew of crews) {
        const suffix = activeCrew?.crew === crew ? " active=true" : ""
        console.log(`crew=${crew}${suffix}`)
      }
    }
    return { handled: true, status: 0 }
  }

  if (command === "use") {
    const { crew, remaining } = extractUseCrewArg(passthrough)
    if (!crew) {
      console.error("ERROR: 'mah use <crew>' requires a crew name")
      return { handled: true, status: 1 }
    }
    if (!crews.includes(crew)) {
      console.error(`ERROR: crew not found for runtime '${runtime}': ${crew}`)
      return { handled: true, status: 1 }
    }
    let payload = null
    try {
      payload = typeof adapter.activateCrew === "function"
        ? adapter.activateCrew({ repoRoot, runtime, adapter, crewId: crew, argv: remaining })
        : writeActiveCrew(repoRoot, adapter, runtime, crew)
    } catch (error) {
      console.error(`ERROR: failed to activate crew '${crew}' for runtime '${runtime}': ${error.message}`)
      return { handled: true, status: 1 }
    }
    payload = payload || writeActiveCrew(repoRoot, adapter, runtime, crew)
    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, runtime, active_crew: crew, source_config: payload.source_config }, null, 2))
    } else {
      console.log(`active_crew=${crew}`)
      console.log(`runtime=${runtime}`)
      console.log(`source_config=${payload.source_config}`)
    }
    return { handled: true, status: 0 }
  }

  if (command === "clear") {
    let removed = false
    try {
      removed = typeof adapter.clearCrewState === "function"
        ? adapter.clearCrewState({ repoRoot, runtime, adapter, argv: passthrough })
        : clearActiveCrew(repoRoot, adapter, runtime)
    } catch (error) {
      console.error(`ERROR: failed to clear runtime state for '${runtime}': ${error.message}`)
      return { handled: true, status: 1 }
    }
    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, runtime, cleared: removed }, null, 2))
    } else {
      console.log(`runtime=${runtime}`)
      console.log(`cleared=${removed ? "active-crew" : "none"}`)
    }
    return { handled: true, status: 0 }
  }

  return { handled: false }
}

function resolveCoreManagedRunPlan(runtime, passthrough, envOverrides = {}, warnings = []) {
  const adapter = runtimeProfiles[runtime]
  if (!supportsCoreManagedCommand(adapter, "run")) return null

  const { crew: requestedCrew, remaining } = extractCrewArg(passthrough)
  const crews = listRuntimeCrews(repoRoot, adapter, runtime)
  if (requestedCrew && !crews.includes(requestedCrew)) {
    return { error: `crew not found for runtime '${runtime}': ${requestedCrew}` }
  }

  const activeCrew = readActiveCrew(repoRoot, adapter, runtime)
  const selectedCrew = requestedCrew || activeCrew?.crew || ""
  const configPath = selectedCrew ? resolveCrewConfigPath(repoRoot, adapter, runtime, selectedCrew) : ""
  const prepared = adapter.prepareRunContext({
    repoRoot,
    runtime,
    adapter,
    crew: selectedCrew,
    requestedCrew,
    activeCrew,
    configPath,
    argv: remaining,
    envOverrides
  })

  if (!prepared?.ok) {
    return { error: prepared?.error || `failed to prepare run context for runtime '${runtime}'` }
  }

  return {
    runtime,
    command: "run",
    exec: prepared.exec || adapter.directCli,
    args: Array.isArray(prepared.args) ? prepared.args : [],
    passthrough: Array.isArray(prepared.passthrough) ? prepared.passthrough : remaining,
    envOverrides: { ...envOverrides, ...(prepared.envOverrides || {}) },
    warnings: [...warnings, ...((prepared.warnings || []).filter(Boolean))],
    candidates: [],
    crew: selectedCrew,
    internal: prepared.internal || null
  }
}

function buildCoreManagedCommandPayload(runtime, command, passthrough = []) {
  const adapter = runtimeProfiles[runtime]
  if (!supportsCoreManagedCommand(adapter, command) || command === "run") return null
  const crews = listRuntimeCrews(repoRoot, adapter, runtime)
  const activeCrew = readActiveCrew(repoRoot, adapter, runtime)
  const payload = {
    runtime,
    command,
    mode: "mah-managed",
    crew_root: path.join(adapter.markerDir || `.${runtime}`, "crew"),
    active_crew: activeCrew?.crew || "",
    crews
  }
  if (command === "use") {
    payload.target_crew = `${passthrough[0] || ""}`.trim()
  }
  return payload
}

function normalizeRunArgs(runtime, passthrough) {
  const adapter = runtimeProfiles[runtime]
  const capabilities = adapter?.capabilities || {}
  const { options, remaining } = extractSessionOptions(passthrough)
  const envOverrides = {}
  const warnings = []
  const args = [...remaining]

  const hasSessionFlags =
    Boolean(options.mode) ||
    Boolean(options.sessionId) ||
    Boolean(options.sessionRoot) ||
    options.sessionMirror !== null
  const hasAgentFlags = Boolean(options.agent) || options.hierarchy !== null

  if (!hasSessionFlags && !hasAgentFlags) {
    return { args, envOverrides, warnings }
  }

  if (options.mode && !options.mode.match(/^(new|continue|none)$/)) {
    warnings.push(`invalid --session-mode value: ${options.mode} (expected new, continue, or none)`)
  }

  if (options.mode === "none") {
    if (capabilities.sessionModeNone) {
      args.unshift(...normalizeCapabilityArgs(capabilities.sessionNoneArgs))
      if (runtime === "claude") {
        warnings.push("claude: --session-mode none uses --print mode (non-interactive)")
      }
    } else {
      warnings.push(`${runtime}: --session-mode none is not supported, sessions will persist`)
    }
    if (options.sessionId) warnings.push("--session-id is ignored with --session-mode none")
    if (options.sessionRoot) warnings.push("--session-root is ignored with --session-mode none")
    if (options.sessionMirror === true) warnings.push("--session-mirror is ignored with --session-mode none")
  } else {
    if (capabilities.sessionMirrorFlag === true) {
      if (options.sessionMirror === true) args.unshift("--session-mirror")
      if (options.sessionMirror === false) args.unshift("--no-session-mirror")
    } else if (options.sessionMirror !== null) {
      warnings.push(`--session-mirror is ignored for ${runtime} runtime`)
    }

    if (options.mode === "new") {
      if (capabilities.sessionModeNew) {
        args.unshift(...normalizeCapabilityArgs(capabilities.sessionNewArgs))
      } else {
        warnings.push(`${runtime}: --session-mode new is not supported`)
      }
    }

    if (options.mode === "continue") {
      if (capabilities.sessionModeContinue) {
        const continueArgs = normalizeCapabilityArgs(capabilities.sessionContinueArgs)
        if (continueArgs.length > 0 && !hasContinueFlag(args)) appendArgsOnce(args, continueArgs)
      } else {
        warnings.push(`${runtime}: --session-mode continue is not supported`)
      }
    }

    if (options.sessionRoot) {
      if (capabilities.sessionRootFlag) {
        args.unshift(capabilities.sessionRootFlag, options.sessionRoot)
      } else {
        warnings.push(`--session-root is ignored for ${runtime} runtime`)
      }
    }

    if (options.sessionId) {
      if (capabilities.sessionIdViaEnv) {
        envOverrides[capabilities.sessionIdViaEnv] = options.sessionId
      } else if (capabilities.sessionIdFlag) {
        args.push(capabilities.sessionIdFlag, options.sessionId)
      } else {
        warnings.push(`--session-id is ignored for ${runtime} runtime`)
      }
    }
  }

  if (runtime === "opencode") {
    if (options.agent) args.push("--agent", options.agent)
    if (options.hierarchy === true) args.push("--hierarchy")
    if (options.hierarchy === false) args.push("--no-hierarchy")
  } else if (options.agent) {
    envOverrides.MAH_AGENT = options.agent
    if (options.hierarchy !== null) {
      warnings.push(`--hierarchy is ignored for ${runtime} runtime`)
    }
  }

  return { args, envOverrides, warnings }
}

function runCommand(command, args, passthrough = [], envOverrides = {}, options = {}) {
  const headless = options.headless === true
  const stdio = headless ? "pipe" : "inherit"
  const child = spawnSync(command, [...args, ...passthrough], {
    cwd: repoRoot,
    env: { ...process.env, ...envOverrides },
    stdio
  })
  if (headless && child) {
    return {
      status: typeof child.status === "number" ? child.status : 1,
      stdout: child.stdout ? child.stdout.toString() : "",
      stderr: child.stderr ? child.stderr.toString() : ""
    }
  }
  if (typeof child.status === "number") return child.status
  if (child.error) {
    console.error(`ERROR: failed to run ${command}: ${child.error.message}`)
  }
  return 1
}

function resolveDispatchPlan(runtime, command, passthrough) {
  const profile = runtimeProfiles[runtime]
  if (!profile) {
    return { error: `unsupported runtime ${runtime}` }
  }
  let normalizedPassthrough = passthrough
  let envOverrides = {}
  const warnings = []
  if (command === "run") {
    const normalized = normalizeRunArgs(runtime, passthrough)
    normalizedPassthrough = normalized.args
    envOverrides = normalized.envOverrides
    warnings.push(...normalized.warnings)
    const coreManagedPlan = resolveCoreManagedRunPlan(runtime, normalizedPassthrough, envOverrides, warnings)
    if (coreManagedPlan) return coreManagedPlan
  }
  const resolved = profile.resolveCommandPlan(command, commandExists, normalizedPassthrough)
  if (!resolved.ok) {
    if (command === "run") {
      return {
        runtime,
        command,
        exec: profile.directCli,
        args: normalizedPassthrough,
        envOverrides,
        warnings,
        candidates: []
      }
    }
    return { error: resolved.error || `command not supported for runtime ${runtime}: ${command}` }
  }
  return {
    runtime,
    command,
    exec: resolved.exec,
    args: resolved.args,
    passthrough: normalizedPassthrough,
    envOverrides,
    warnings,
    candidates: resolved.variants || []
  }
}

function runtimeValidationReport(runtime) {
  const adapter = runtimeProfiles[runtime]
  if (!adapter) return { ok: false, checks: [{ name: "adapter", ok: false }] }
  return adapter.validateRuntime(commandExists)
}

function printExplain(traceMode, payload) {
  if (traceMode) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }
  if (payload.runtime) console.log(`runtime=${payload.runtime}`)
  if (payload.reason) console.log(`reason=${payload.reason}`)
  if (payload.command) console.log(`command=${payload.command}`)
  if (payload.mode) console.log(`mode=${payload.mode}`)
  if (payload.exec) console.log(`resolved_exec=${payload.exec}`)
  if (payload.execArgs) console.log(`resolved_args=${payload.execArgs.join(" ")}`)
  if (payload.passthrough) console.log(`passthrough=${payload.passthrough.join(" ")}`)
  if (payload.env && Object.keys(payload.env).length > 0) {
    console.log(`env_overrides=${Object.keys(payload.env).join(",")}`)
  }
  if (Array.isArray(payload.warnings)) {
    for (const warning of payload.warnings) {
      console.log(`warning=${warning}`)
    }
  }
  if (payload.crewContext?.crew_id) {
    console.log(`crew_context=${payload.crewContext.crew_id}`)
    if (payload.crewContext.mission) console.log(`crew_mission=${payload.crewContext.mission}`)
    if (payload.crewContext.sprint_mode?.name) console.log(`crew_sprint=${payload.crewContext.sprint_mode.name}`)
    if (payload.crewContext.sprint_mode?.target_release) {
      console.log(`crew_target_release=${payload.crewContext.sprint_mode.target_release}`)
    }
  } else if (payload.crewContext?.requested_crew && payload.crewContext?.found === false) {
    console.log(`crew_context_missing=${payload.crewContext.requested_crew}`)
  }
  if (payload.active_crew) console.log(`active_crew=${payload.active_crew}`)
  if (payload.target_crew) console.log(`target_crew=${payload.target_crew}`)
}

function runInit(argv) {
  const runtime = parseValueArg(argv, "--runtime")
  const crew = parseValueArg(argv, "--crew")
  const yesFlag = argv.includes("--yes")
  const forceFlag = argv.includes("--force")
  const created = []
  const skipped = []

  const bootstrapArgs = [path.join(packageRoot, "scripts", "bootstrap-meta-agents.mjs")]
  if (!process.stdin.isTTY || yesFlag) {
    bootstrapArgs.push("--non-interactive")
  }
  if (forceFlag) {
    bootstrapArgs.push("--force")
  }
  if (crew) {
    bootstrapArgs.push("--crew", crew)
  }

  const bootstrapResult = spawnSync("node", bootstrapArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env
  })

  const metaTarget = path.join(process.cwd(), "meta-agents.yaml")
  if (bootstrapResult.status === 0 && existsSync(metaTarget)) {
    created.push("meta-agents.yaml")
  } else {
    skipped.push("meta-agents.yaml")
  }

  const mcpTarget = path.join(repoRoot, ".mcp.json")
  const mcpExample = path.join(packageRoot, ".mcp.example.json")
  if (!existsSync(mcpTarget) && existsSync(mcpExample)) {
    copyFileSync(mcpExample, mcpTarget)
    created.push(".mcp.json")
  } else {
    skipped.push(".mcp.json")
  }
  if (runtime && runtimeProfiles[runtime]) {
    const markerPath = path.join(repoRoot, runtimeProfiles[runtime].markerDir)
    if (!existsSync(markerPath)) {
      mkdirSync(markerPath, { recursive: true })
      created.push(runtimeProfiles[runtime].markerDir)
    } else {
      skipped.push(runtimeProfiles[runtime].markerDir)
    }
  }
  console.log("mah init completed")
  console.log(`created=${created.join(",") || "none"}`)
  console.log(`skipped=${skipped.join(",") || "none"}`)
  if (crew) {
    console.log(`crew_hint=${crew}`)
    console.log(`next=mah use ${crew}`)
  }
  console.log("next=mah sync")
  return bootstrapResult.status !== null ? bootstrapResult.status : 1
}

function printSessionsHelp() {
  const runtimeNames = orderedRuntimeNames(runtimeProfiles)
  const sessionNewSupported = runtimeNames
    .filter((runtimeName) => runtimeProfiles[runtimeName]?.supportsSessionNew)
  const sessionNewUnsupported = runtimeNames
    .filter((runtimeName) => !runtimeProfiles[runtimeName]?.supportsSessionNew)

  console.log("")
  console.log("mah sessions — Unified session operations across all runtimes")
  console.log("")
  console.log("Usage:")
  console.log("  mah sessions list                    # List active sessions for current runtime")
  console.log("  mah sessions list --runtime <name>   # List sessions for a specific runtime")
  console.log("  mah sessions list --crew <name>      # Filter sessions by crew")
  console.log("  mah sessions list --json             # JSON output")
  console.log("  mah sessions resume <id>             # Resume a session (format: runtime:crew:sessionId)")
  console.log("  mah sessions resume <id> --dry-run   # Preview resume command without spawning")
  console.log("  mah sessions new --runtime <name>    # Start a new session (runtime-dependent)")
  console.log("  mah sessions new --runtime <name> --dry-run  # Preview without spawning")
  console.log("  mah sessions export <id>             # Export session to $MAH_SESSIONS_DIR/<runtime>/<id>.tar.gz")
  console.log("  mah sessions delete <id> --yes       # Delete session (requires --yes confirmation)")
  console.log("  mah sessions --help                  # Show this help")
  console.log("")
  console.log("Global flags:")
  console.log(`  --runtime <name>  Target a specific runtime (${runtimeNames.join(", ")})`)
  console.log("  --json            Output results as JSON")
  console.log("  --dry-run         Preview the command that would be run without executing it")
  console.log("")
  console.log("Session ID format: runtime:crew:sessionId  (e.g., hermes:dev:2026-04-08T13-00-00-abc123)")
  console.log("")
  console.log("'mah sessions new' support per runtime:")
  console.log(`  ${sessionNewSupported.length > 0 ? sessionNewSupported.join(", ") : "(none)"} — supported`)
  console.log(`  ${sessionNewUnsupported.length > 0 ? sessionNewUnsupported.join(", ") : "(none)"} — not supported (use 'mah sessions resume' instead)`)
  console.log("")
}

async function runSessions(argv, jsonMode = false, detectedRuntime = "") {
  const subcommand = argv[0] || "list"
  const filters = parseFilterArgs(argv)
  // Use explicitly forced runtime (from --runtime flag) or auto-detected runtime
  const effectiveRuntime = filters.runtime || detectedRuntime || ""
  if (jsonMode) filters.json = true

  // Get all runtimes (bundled plugins + loaded plugins)
  const allRuntimes = await getAllRuntimes()

  // Handle subcommands
  if (subcommand === "list") {
    const rows = collectSessions(repoRoot, { runtime: effectiveRuntime, crew: filters.crew }, allRuntimes)
    if (filters.json) {
      console.log(JSON.stringify({ sessions: rows }, null, 2))
      return 0
    }
    if (rows.length === 0) {
      console.log("sessions=none")
      return 0
    }
    for (const row of rows) {
      console.log(`${row.id} runtime=${row.runtime} crew=${row.crew} last_active_at=${row.last_active_at} path=${row.source_path}`)
    }
    return 0
  }

  if (subcommand === "resume") {
    const sessionId = argv[1]
    if (!sessionId) {
      console.error("ERROR: 'mah sessions resume <id>' requires a session ID")
      return 1
    }
    // Detect runtime from session ID or use forced runtime
    const parsedSessionId = parseSessionId(sessionId)
    if (!parsedSessionId) {
      console.error(`ERROR: invalid session ID format: ${sessionId} (expected runtime:crew:sessionId)`)
      return 1
    }
    const targetRuntime = effectiveRuntime || parsedSessionId.runtime
    const sessions = collectSessions(repoRoot, { runtime: targetRuntime }, allRuntimes)
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) {
      console.error(`ERROR: session not found: ${sessionId}`)
      return 1
    }
    const resumeResult = resumeSessionFn(repoRoot, sessionId, targetRuntime, argv.slice(2), allRuntimes)
    if (!resumeResult.ok) {
      console.error(`ERROR: ${resumeResult.error}`)
      return 1
    }
    // Dry-run: print the command plan without dispatching
    if (filters.dryRun) {
      const plan = resolveDispatchPlan(targetRuntime, "run", resumeResult.args)
      if (plan.error) {
        console.error(`ERROR: ${plan.error}`)
        return 1
      }
      console.log(`[dry-run] Would resume session '${sessionId}' with runtime '${targetRuntime}'`)
      console.log(`[dry-run] exec=${plan.exec}`)
      console.log(`[dry-run] args=${[...plan.args, ...plan.passthrough].join(" ")}`)
      return 0
    }
    // Dispatch the run command with session context
    return dispatch(targetRuntime, "run", resumeResult.args)
  }

  if (subcommand === "new") {
    const targetRuntime = effectiveRuntime
    if (!targetRuntime) {
      // Try to detect runtime
      const detected = detectRuntime(repoRoot, "")
      if (!detected.runtime) {
        console.error("ERROR: could not detect runtime. Use --runtime to specify a runtime")
        return 1
      }
      if (!allRuntimes[detected.runtime]?.supportsSessionNew) {
        console.error(`ERROR: runtime '${detected.runtime}' does not support starting new sessions`)
        return 1
      }
    } else {
      if (!allRuntimes[targetRuntime]?.supportsSessionNew) {
        console.error(`ERROR: runtime '${targetRuntime}' does not support starting new sessions`)
        return 1
      }
    }
    const runtimeToUse = targetRuntime || detectRuntime(repoRoot, "").runtime
    const startResult = startSessionFn(repoRoot, runtimeToUse, argv.slice(1), allRuntimes)
    if (!startResult.ok) {
      console.error(`ERROR: ${startResult.error}`)
      return 1
    }
    // Dry-run: print the command plan without dispatching
    if (filters.dryRun) {
      const plan = resolveDispatchPlan(runtimeToUse, "run", startResult.args)
      if (plan.error) {
        console.error(`ERROR: ${plan.error}`)
        return 1
      }
      console.log(`[dry-run] Would start new session with runtime '${runtimeToUse}'`)
      console.log(`[dry-run] exec=${plan.exec}`)
      console.log(`[dry-run] args=${[...plan.args, ...plan.passthrough].join(" ")}`)
      return 0
    }
    return dispatch(runtimeToUse, "run", startResult.args)
  }

  if (subcommand === "export") {
    const sessionId = argv[1]
    if (!sessionId) {
      console.error("ERROR: 'mah sessions export <id>' requires a session ID")
      return 1
    }
    // Add format parsing
    const formatArgIndex = argv.indexOf("--format")
    const format = formatArgIndex !== -1 ? argv[formatArgIndex + 1] : "mah-json"
    if (!["mah-json", "summary-md", "runtime-raw"].includes(format)) {
      console.error(`ERROR: unknown format '${format}'. Use: mah-json, summary-md, runtime-raw`)
      return 1
    }
    const { exportSession } = await import("./session-export.mjs")
    const exportResult = await exportSession(repoRoot, sessionId, format, allRuntimes)
    if (!exportResult.ok) {
      console.error(`ERROR: ${exportResult.error}`)
      return 1
    }
    if (filters.json) {
      console.log(JSON.stringify({ ok: true, path: exportResult.path }, null, 2))
    } else {
      console.log(`exported=${exportResult.path}`)
    }
    return 0
  }

  if (subcommand === "inject") {
    // mah sessions inject <id> --runtime <target> [--fidelity full|contextual|summary-only]
    const sessionId = argv[1]
    const runtimeIdx = argv.indexOf("--runtime")
    const fidelityIdx = argv.indexOf("--fidelity")

    if (!sessionId) {
      console.error("ERROR: 'mah sessions inject <id>' requires a session ID")
      return 1
    }
    if (runtimeIdx === -1) {
      console.error("ERROR: 'mah sessions inject' requires --runtime <target>")
      return 1
    }

    const targetRuntime = argv[runtimeIdx + 1]
    const fidelityLevel = fidelityIdx !== -1 ? argv[fidelityIdx + 1] : "contextual"

    // Import and use session-injection
    const { injectSessionContext } = await import("./session-injection.mjs")
    const { parseSessionId } = await import("./m3-ops.mjs")
    const { collectSessions } = await import("./m3-ops.mjs")

    const parsed = parseSessionId(sessionId)
    if (!parsed) {
      console.error(`ERROR: invalid session ID format: ${sessionId}`)
      return 1
    }

    const sessions = collectSessions(repoRoot, { runtime: parsed.runtime }, allRuntimes)
    const sessionRef = sessions.find(s => s.id === sessionId)
    if (!sessionRef) {
      console.error(`ERROR: session not found: ${sessionId}`)
      return 1
    }

    // Build envelope from session ref
    const { buildMahSessionEnvelope } = await import("./session-export.mjs")
    const envelope = buildMahSessionEnvelope(sessionRef)

    const result = await injectSessionContext(repoRoot, envelope, targetRuntime, fidelityLevel, {
      runtimeRegistry: allRuntimes
    })

    if (!result.ok) {
      console.error(`ERROR: injection failed: ${result.error}`)
      return 1
    }

    console.log(`✓ Session injected to '${targetRuntime}'`)
    console.log(`  Strategy: ${result.strategy}`)
    console.log(`  Fidelity: ${result.fidelity_level}`)
    if (result.warnings.length > 0) {
      for (const w of result.warnings) console.log(`  ⚠ ${w}`)
    }
    console.log(`  Projection: ${result.path}`)
    return 0
  } else if (subcommand === "bridge") {
    // mah sessions bridge <id> --to <runtime> [--fidelity level]
    const sessionId = argv[1]
    const toIdx = argv.indexOf("--to")

    if (!sessionId) {
      console.error("ERROR: 'mah sessions bridge <id>' requires a session ID")
      return 1
    }
    if (toIdx === -1) {
      console.error("ERROR: 'mah sessions bridge' requires --to <target-runtime>")
      return 1
    }

    const targetRuntime = argv[toIdx + 1]
    const fidelityIdx = argv.indexOf("--fidelity")
    const fidelityLevel = fidelityIdx !== -1 ? argv[fidelityIdx + 1] : "contextual"

    const { bridgeSession } = await import("./session-bridge.mjs")
    const result = await bridgeSession(repoRoot, sessionId, targetRuntime, {
      fidelityLevel,
      runtimeRegistry: allRuntimes
    })

    if (!result.ok) {
      console.error(`ERROR: bridge failed: ${result.error}`)
      return 1
    }

    console.log(`✓ Session bridged from '${sessionId}' to '${targetRuntime}'`)
    console.log(result.explain)
    return 0
  }

  if (subcommand === "delete") {
    const sessionId = argv[1]
    if (!sessionId) {
      console.error("ERROR: 'mah sessions delete <id>' requires a session ID")
      return 1
    }
    const parsed = parseSessionId(sessionId)
    if (!parsed) {
      console.error(`ERROR: invalid session ID format: ${sessionId} (expected runtime:crew:sessionId)`)
      return 1
    }
    // Read confirmation from stdin (for non-interactive use)
    // In CLI context, we require the user to confirm explicitly
    // Check if stdin has data for non-interactive confirmation
    let confirmed = ""
    if (process.stdin.isTTY) {
      // Interactive mode - prompt not supported in this context, require --yes flag
      // For safety, require explicit y/Y from argv check
    }
    // Check for --yes flag
    const yesFlag = argv.includes("--yes") || argv.includes("-y")
    if (yesFlag) {
      confirmed = "y"
    } else {
      console.log(`Delete session '${sessionId}' on '${parsed.runtime}'? [y/N]`)
      // In test/CI context, confirmation comes from the caller passing "y" or reading from stdin
      // For now, we require --yes flag for non-interactive deletion
      console.error("ERROR: deletion requires explicit confirmation. Use --yes flag or pipe 'y' to stdin")
      return 1
    }
    const deleteResult = deleteSessionFn(repoRoot, sessionId, confirmed, allRuntimes)
    if (!deleteResult.ok) {
      console.error(`ERROR: ${deleteResult.error}`)
      return 1
    }
    if (filters.json) {
      console.log(JSON.stringify({ ok: true, deleted: sessionId }, null, 2))
    } else {
      console.log(`deleted=${sessionId}`)
    }
    return 0
  }

  // Unknown subcommand — also handles --help, -h
  if (["--help", "-h", "help"].includes(subcommand)) {
    printSessionsHelp()
    return 0
  }
  console.error(`ERROR: unknown sessions subcommand '${subcommand}'`)
  printSessionsHelp()
  return 1
}

function mermaidNodeId(value) {
  return `${value || "unknown"}`.replace(/[^a-zA-Z0-9_]/g, "_")
}

function renderMermaidBasic(topology) {
  const lines = ["flowchart LR", `subgraph crew_${mermaidNodeId(topology.crew || "default")}[Crew ${topology.crew || "default"}]`]
  lines.push("  direction TB")
  lines.push(`  m_orchestrator["orchestrator"]`)
  lines.push(`  m_leads["leads"]`)
  lines.push(`  m_workers["workers"]`)
  lines.push("end")
  lines.push("m_orchestrator -->|can delegate| m_leads")
  lines.push("m_leads -->|can delegate| m_workers")
  return `${lines.join("\n")}\n`
}

function renderMermaidGroup(topology) {
  const lines = ["flowchart LR", `subgraph crew_${mermaidNodeId(topology.crew || "default")}[Crew ${topology.crew || "default"}]`]
  lines.push("  direction TB")
  const nodeById = new Map((topology.nodes || []).map((node) => [node.id, node]))
  const orchestrators = (topology.nodes || []).filter((node) => node.role === "orchestrator")
  const teamSet = new Set((topology.nodes || []).filter((node) => node.role === "lead").map((node) => node.team || "unassigned"))

  lines.push("  subgraph tier_1[Teams]")
  for (const team of teamSet) {
    lines.push(`    grp_${mermaidNodeId(team)}["${team} team"]`)
  }
  lines.push("  end")
  lines.push("  subgraph tier_0[Orchestrator]")
  for (const node of orchestrators) {
    lines.push(`    ${mermaidNodeId(`topo_${node.id}`)}["${node.id} (orchestrator)"]`)
  }
  lines.push("  end")
  lines.push("end")

  const seen = new Set()
  for (const edge of topology.edges || []) {
    const from = nodeById.get(edge.from)
    const to = nodeById.get(edge.to)
    if (from?.role === "orchestrator" && to?.role === "lead") {
      const fromId = mermaidNodeId(`topo_${from.id}`)
      const teamId = `grp_${mermaidNodeId(to.team || "unassigned")}`
      const key = `${fromId}:${teamId}`
      if (!seen.has(key)) {
        lines.push(`${fromId} -->|can delegate| ${teamId}`)
        seen.add(key)
      }
    }
  }
  return `${lines.join("\n")}\n`
}

function renderMermaidDetailed(topology, runGraph) {
  return renderMermaidDetailedWithOptions(topology, runGraph, { includeCapabilities: false, teamCapabilities: {} })
}

function buildRoleCapabilitySummary(meta, crewId) {
  const crew = (meta.crews || []).find((item) => item.id === crewId) || (meta.crews || [])[0]
  const skillsByRole = {
    orchestrator: new Set(),
    lead: new Set(),
    worker: new Set()
  }
  const configuredMcp = readConfiguredMcpServers()
  if (!crew) {
    return {
      skills: { orchestrator: [], lead: [], worker: [] },
      mcp: {
        orchestrator: configuredMcp,
        lead: configuredMcp,
        worker: configuredMcp
      }
    }
  }
  for (const agent of crew.agents || []) {
    const roleKey = agent.role === "orchestrator" ? "orchestrator" : agent.role === "lead" ? "lead" : "worker"
    for (const skillRef of agent.skills || []) {
      skillsByRole[roleKey].add(skillRef)
    }
  }
  return {
    skills: {
      orchestrator: Array.from(skillsByRole.orchestrator).sort(),
      lead: Array.from(skillsByRole.lead).sort(),
      worker: Array.from(skillsByRole.worker).sort()
    },
    mcp: {
      orchestrator: configuredMcp,
      lead: configuredMcp,
      worker: configuredMcp
    }
  }
}

function renderMermaidDetailedWithOptions(topology, runGraph, options = {}) {
  const lines = ["flowchart LR", `subgraph crew_${mermaidNodeId(topology.crew || "default")}[Crew ${topology.crew || "default"}]`]
  lines.push("  direction TB")
  const orchestrators = (topology.nodes || []).filter((node) => node.role === "orchestrator")
  const leads = (topology.nodes || []).filter((node) => node.role === "lead")
  const workers = (topology.nodes || []).filter((node) => node.role !== "orchestrator" && node.role !== "lead")
  const orchestratorIds = orchestrators.map((node) => mermaidNodeId(`topo_${node.id}`))
  const leadIds = leads.map((node) => mermaidNodeId(`topo_${node.id}`))
  const workerIds = workers.map((node) => mermaidNodeId(`topo_${node.id}`))

  lines.push("  subgraph tier_1[Leads]")
  for (const node of leads) {
    lines.push(`    ${mermaidNodeId(`topo_${node.id}`)}["${node.id} (lead · ${node.team})"]`)
  }
  if (options.includeCapabilities) {
    const leadSkills = (options.capabilitySummary?.skills?.lead || []).join(", ") || "none"
    const leadMcp = (options.capabilitySummary?.mcp?.lead || []).join(", ") || "none"
    lines.push("    subgraph lead_skill[Skills]")
    lines.push(`      cap_skill_leads["${leadSkills}"]`)
    lines.push("    end")
    lines.push("    subgraph lead_mcp[MCPs]")
    lines.push(`      cap_mcp_leads["${leadMcp}"]`)
    lines.push("    end")
  }
  lines.push("  end")

  lines.push("  subgraph tier_2[Workers]")
  for (const node of workers) {
    lines.push(`    ${mermaidNodeId(`topo_${node.id}`)}["${node.id} (worker · ${node.team})"]`)
  }
  if (options.includeCapabilities) {
    const workerSkills = (options.capabilitySummary?.skills?.worker || []).join(", ") || "none"
    const workerMcp = (options.capabilitySummary?.mcp?.worker || []).join(", ") || "none"
    lines.push("    subgraph worker_skill[Skills]")
    lines.push("      direction TB")
    lines.push(`      cap_skill_workers["${workerSkills}"]`)
    lines.push("    end")
    lines.push("    subgraph workers_mcp[MCPs]")
    lines.push(`      cap_mcp_workers["${workerMcp}"]`)
    lines.push("    end")
  }
  lines.push("  end")

  lines.push("  subgraph tier_0[Orchestrator]")
  for (const node of orchestrators) {
    lines.push(`    ${mermaidNodeId(`topo_${node.id}`)}["${node.id} (orchestrator)"]`)
  }
  lines.push("  end")
  lines.push("end")
  for (const edge of topology.edges || []) {
    const fromId = mermaidNodeId(`topo_${edge.from}`)
    const toId = mermaidNodeId(`topo_${edge.to}`)
    lines.push(`${fromId} -->|can delegate| ${toId}`)
  }
  if ((runGraph.edges || []).length > 0) {
    lines.push("subgraph run_graph[Run Graph]")
    for (const node of runGraph.nodes || []) {
      lines.push(`  ${mermaidNodeId(`run_${node.id}`)}["${node.id}"]`)
    }
    lines.push("end")
    for (const edge of runGraph.edges || []) {
      lines.push(`${mermaidNodeId(`run_${edge.from}`)} -.-> ${mermaidNodeId(`run_${edge.to}`)}`)
    }
  }

  lines.push("classDef orchestrator fill:#fff3e0,stroke:#ef6c00,stroke-width:2px,color:#1a1a1a")
  lines.push("classDef lead fill:#e3f2fd,stroke:#1976d2,stroke-width:1.5px,color:#1a1a1a")
  lines.push("classDef worker fill:#f5f5f5,stroke:#757575,stroke-width:1px,color:#1a1a1a")
  if (options.includeCapabilities) {
    lines.push("classDef skillNode fill:#ede7f6,stroke:#5e35b1,stroke-width:1px,color:#1a1a1a")
    lines.push("classDef mcpNode fill:#e8f5e9,stroke:#2e7d32,stroke-width:1px,color:#1a1a1a")
  }
  if (orchestratorIds.length > 0) lines.push(`class ${orchestratorIds.join(",")} orchestrator`)
  if (leadIds.length > 0) lines.push(`class ${leadIds.join(",")} lead`)
  if (workerIds.length > 0) lines.push(`class ${workerIds.join(",")} worker`)
  if (options.includeCapabilities) {
    const skillNodes = ["cap_skill_leads", "cap_skill_workers"]
    const mcpNodes = ["cap_mcp_leads", "cap_mcp_workers"]
    if (skillNodes.length > 0) lines.push(`class ${skillNodes.join(",")} skillNode`)
    if (mcpNodes.length > 0) lines.push(`class ${mcpNodes.join(",")} mcpNode`)
    lines.push("subgraph legend[Legend]")
    lines.push("  lg_orch[Orchestrator]")
    lines.push("  lg_lead[Lead]")
    lines.push("  lg_worker[Worker]")
    lines.push("  lg_skill[Skills]")
    lines.push("  lg_mcp[MCP]")
    lines.push("end")
    lines.push("class lg_orch orchestrator")
    lines.push("class lg_lead lead")
    lines.push("class lg_worker worker")
    lines.push("class lg_skill skillNode")
    lines.push("class lg_mcp mcpNode")
  }
  return `${lines.join("\n")}\n`
}

function renderMermaidGraph(topology, runGraph, level = "detailed", options = {}) {
  if (level === "basic") return renderMermaidBasic(topology)
  if (level === "group") return renderMermaidGroup(topology)
  return renderMermaidDetailedWithOptions(topology, runGraph, options)
}

function runGraph(argv, jsonMode = false, mermaidMode = false) {
  const filters = parseFilterArgs(argv)
  const mermaidLevel = filters.mermaidLevel || "detailed"
  if (jsonMode) filters.json = true
  if (mermaidMode || filters.mermaid || filters.mermaidLevel) filters.mermaid = true
  if (filters.json && filters.mermaid) {
    console.error("ERROR: --json and --mermaid are mutually exclusive for graph")
    return 1
  }
  if (!["basic", "group", "detailed"].includes(mermaidLevel)) {
    console.error("ERROR: invalid --mermaid-level. Use basic, group, or detailed")
    return 1
  }
  const meta = readMetaConfig(repoRoot)
  const topology = buildCrewGraph(meta, filters.crew)
  const provenance = readProvenance(repoRoot, { run: filters.run, limit: 1000 })
  const runGraph = buildRunGraphFromProvenance(provenance, { run: filters.run })
  const capabilitySummary = buildRoleCapabilitySummary(meta, topology.crew)
  if (filters.mermaid) {
    process.stdout.write(renderMermaidGraph(topology, runGraph, mermaidLevel, {
      includeCapabilities: filters.mermaidCapabilities,
      capabilitySummary
    }))
    return 0
  }
  if (filters.json) {
    console.log(JSON.stringify({ topology, run: runGraph }, null, 2))
    return 0
  }
  console.log(`crew=${topology.crew}`)
  for (const edge of topology.edges) {
    console.log(`topology ${edge.from} -> ${edge.to}`)
  }
  if (runGraph.edges.length > 0) {
    console.log("run_graph")
    for (const edge of runGraph.edges) {
      console.log(`execution ${edge.from} -> ${edge.to} at=${edge.at}`)
    }
  }
  return 0
}

function printSyncHelp() {
  console.log("mah sync / mah generate — materialize tree artifacts from meta-agents.yaml")
  console.log("")
  console.log("Usage:")
  console.log("  mah sync              sync all meta-agent files (prompts for confirmation)")
  console.log("  mah generate          generate runtime tree artifacts from meta-agents.yaml")
  console.log("  mah generate:tree     alias for `mah generate`")
  console.log("  mah sync --check      check for drift without modifying files")
  console.log("  mah sync --plan       show planned changes")
  console.log("  mah sync --diff       show detailed diff")
  console.log("")
  console.log("Options:")
  console.log("  --json                output machine-readable JSON")
  console.log("  -h, --help            show this help")
}

/**
 * Sync plugin runtime entry into meta-agents.yaml.
 * action: "add" — adds the plugin's markerDir entry.
 * action: "remove" — removes the plugin's markerDir entry.
 *
 * This function only updates plugin-owned marker entries.
 * It does not remove user-authored runtime overrides from meta-agents.yaml.
 */
function syncPluginYaml(pluginName, pluginMeta, action) {
  const yamlPath = path.join(repoRoot, "meta-agents.yaml")
  if (!existsSync(yamlPath)) return

  let doc = {}
  try {
    const raw = readFileSync(yamlPath, "utf-8")
    doc = YAML.parse(raw) || {}
  } catch {
    return
  }

  doc.runtime_detection = doc.runtime_detection || {}
  doc.runtime_detection.marker = doc.runtime_detection.marker || {}

  if (action === "add") {
    // Add/update marker entry
    if (pluginMeta.markerDir) {
      doc.runtime_detection.marker[pluginName] = pluginMeta.markerDir
    }
  } else if (action === "remove") {
    delete doc.runtime_detection.marker[pluginName]
  }
  try {
    const updated = YAML.stringify(doc, { indent: 2, lineWidth: 0 })
    writeFileSync(yamlPath, updated, "utf-8")
  } catch {
    // non-fatal
  }
}

function printPluginsHelp() {
  console.log("mah plugins — manage runtime plugins")
  console.log("")
  console.log("Usage:")
  console.log("  mah plugins [list]")
  console.log("  mah plugins install <path>")
  console.log("  mah plugins uninstall <name>")
  console.log("  mah plugins validate <path>")
  console.log("")
  console.log("Commands:")
  console.log("  list                      list installed plugins")
  console.log("  install <path>            validate and install a plugin from <path>")
  console.log("  uninstall <name>          remove an installed plugin")
  console.log("  validate <path>           validate a plugin without installing it")
  console.log("")
  console.log("Options:")
  console.log("  --json                    output as JSON")
  console.log("  -h, --help                show this help")
}

async function runPlugins(argv, jsonMode = false) {
  // Handle help flags before subcommand dispatch
  if (argv.includes("--help") || argv.includes("-h")) {
    printPluginsHelp()
    return 0
  }

  const subcommand = argv[0] || "list"
  const mahPluginsDir = path.join(repoRoot, "mah-plugins")

  if (subcommand === "list") {
    const entries = listLoadedPlugins()
    if (jsonMode) {
      console.log(JSON.stringify({ plugins: entries }, null, 2))
    } else if (entries.length === 0) {
      console.log("plugins=none")
    } else {
      for (const plugin of entries) {
        console.log(`plugin ${plugin.name} version=${plugin.version} source=${plugin.source}`)
      }
    }
    return 0
  }

  if (subcommand === "install") {
    const pluginPath = argv[1]
    if (!pluginPath) {
      console.error("ERROR: 'mah plugins install <path>' requires a plugin path")
      return 1
    }
    const validation = await validatePluginFn(pluginPath)
    if (!validation.ok) {
      console.error(`ERROR: plugin validation failed: ${validation.errors.join("; ")}`)
      return 1
    }
    for (const warning of validation.warnings || []) {
      console.warn(`WARN: ${warning}`)
    }
    const pluginName = validation.name
    if (!pluginName) {
      console.error("ERROR: plugin name could not be determined")
      return 1
    }
    const targetDir = path.join(mahPluginsDir, pluginName)
    if (existsSync(targetDir)) {
      console.error(`ERROR: plugin '${pluginName}' is already installed at ${targetDir}`)
      return 1
    }

    let markerPath = ""
    let markerCreated = false
    mkdirSync(mahPluginsDir, { recursive: true })
    try {
      // Copy plugin files to mah-plugins/<name>/
      cpSync(pluginPath, targetDir, { recursive: true })
      // Create the plugin's marker directory so mah detect can find it immediately
      const markerDir = validation.adapter?.markerDir
      if (markerDir) {
        markerPath = path.join(repoRoot, markerDir)
        if (!existsSync(markerPath)) {
          mkdirSync(markerPath, { recursive: true })
          markerCreated = true
          console.log(`marker created=${markerDir}`)
        }
      }
      // --- Runtime CLI provisioning ---
      const directCli = validation.adapter?.directCli
      if (directCli) {
        const { execSync } = await import("child_process")
        let cliAvailable = false
        try {
          execSync(`which ${directCli}`, { stdio: "ignore" })
          cliAvailable = true
        } catch {
          cliAvailable = false
        }
        if (!cliAvailable) {
          if (validation.adapter?.runtimePackage === false) {
            console.log(`runtime provisioning skipped=${directCli}`)
          } else {
          // Derive npm package name: directCli or runtimePackage override
            let npmPackage = validation.adapter?.runtimePackage
            if (!npmPackage) {
            // Convention: kilo -> @kilocode/cli, opencode -> @opencodeai/cli
              if (directCli === "kilo") {
                npmPackage = "@kilocode/cli"
              } else if (directCli === "opencode") {
                npmPackage = "@opencodeai/cli"
              } else {
                npmPackage = directCli
              }
            }
            console.log(`runtime ${directCli} not found — installing ${npmPackage}...`)
            try {
              execSync(`npm install -g ${npmPackage}`, { stdio: "inherit" })
              console.log(`runtime installed=${directCli} package=${npmPackage}`)
            } catch (err) {
              throw new Error(`failed to install runtime ${directCli}: ${err.message}`)
            }
          }
        }
        // --- Run onboard hook if plugin exports it ---
        const installedIndex = path.join(targetDir, "index.mjs")
        if (existsSync(installedIndex)) {
          try {
            const mod = await import(`file://${installedIndex}`)
            if (typeof mod.runtimePlugin?.onboard === "function") {
              const onboardCtx = {
                name: pluginName,
                version: validation.version,
                markerDir: validation.adapter?.markerDir,
                directCli,
                mahVersion: MAH_VERSION
              }
              await mod.runtimePlugin.onboard(onboardCtx)
              console.log(`onboarded=${pluginName}`)
            }
          } catch (err) {
            console.warn(`WARN: onboard hook failed for ${pluginName}: ${err.message}`)
          }
        }
      }
      // Sync plugin entry into meta-agents.yaml
      syncPluginYaml(pluginName, {
        markerDir: validation.adapter?.markerDir || null,
        directCli: validation.adapter?.directCli || null,
        wrapper: validation.adapter?.wrapper || null,
        configRoot: validation.adapter?.configRoot || null,
        configPattern: validation.adapter?.configPattern || null
      }, "add")
      await loadPlugins([targetDir], MAH_VERSION)
      console.log(`installed=${pluginName} path=${targetDir}`)
      return 0
    } catch (err) {
      console.error(`ERROR: plugin install failed: ${err.message}`)
      try {
        rmSync(targetDir, { recursive: true, force: true })
      } catch {
      }
      if (markerCreated && markerPath) {
        try {
          rmSync(markerPath, { recursive: true, force: true })
        } catch {
        }
      }
      return 1
    }
  }

  if (subcommand === "uninstall") {
    const pluginName = argv[1]
    if (!pluginName) {
      console.error("ERROR: 'mah plugins uninstall <name>' requires a plugin name")
      return 1
    }
    // Read plugin metadata from plugin.json (sync, no module import needed)
    const installedPluginJson = path.join(mahPluginsDir, pluginName, "plugin.json")
    let markerDir = null
    let directCli = null
    let wrapper = null
    let configRoot = null
    let configPattern = null
    if (existsSync(installedPluginJson)) {
      try {
        const pluginMeta = JSON.parse(readFileSync(installedPluginJson, "utf-8"))
        markerDir = pluginMeta.markerDir || null
        directCli = pluginMeta.directCli || null
        wrapper = pluginMeta.wrapper || null
        configRoot = pluginMeta.configRoot || null
        configPattern = pluginMeta.configPattern || null
      } catch {
        // ignore — will remove plugin dir anyway
      }
    }
    // Also try index.mjs for adapter.markerDir as fallback
    if (!markerDir) {
      const installedIndex = path.join(mahPluginsDir, pluginName, "index.mjs")
      if (existsSync(installedIndex)) {
        const content = readFileSync(installedIndex, "utf-8")
        const match = content.match(/markerDir:\s*["']([^"']+)["']/)
        if (match) markerDir = match[1]
      }
    }
    // Remove plugin entry from meta-agents.yaml before removing files
    syncPluginYaml(pluginName, { markerDir, directCli, wrapper, configRoot, configPattern }, "remove")
    // First remove from mah-plugins/ directory if present
    const targetDir = path.join(mahPluginsDir, pluginName)
    if (existsSync(targetDir)) {
      try {
        rmSync(targetDir, { recursive: true })
      } catch (err) {
        console.warn(`WARN: could not remove plugin directory: ${err.message}`)
      }
    }
    // Remove the marker directory if it exists
    if (markerDir) {
      const markerPath = path.join(repoRoot, markerDir)
      if (existsSync(markerPath)) {
        try {
          rmSync(markerPath, { recursive: true })
          console.log(`marker removed=${markerDir}`)
        } catch (err) {
          console.warn(`WARN: could not remove marker directory: ${err.message}`)
        }
      }
    }
    // Then try to unload from registry (will be no-op if not loaded)
    unloadPluginFn(pluginName)
    // --- Clean orphaned runtime if no other plugin uses it ---
    if (directCli) {
      // Check if any other installed plugin uses the same directCli
      let otherPluginUsesRuntime = false
      if (existsSync(mahPluginsDir)) {
        try {
          const otherDirs = readdirSync(mahPluginsDir, { withFileTypes: true })
          for (const entry of otherDirs) {
            if (entry.isDirectory() && entry.name !== pluginName) {
              const otherPluginJson = path.join(mahPluginsDir, entry.name, "plugin.json")
              if (existsSync(otherPluginJson)) {
                const otherMeta = JSON.parse(readFileSync(otherPluginJson, "utf-8"))
                if (otherMeta.directCli === directCli) {
                  otherPluginUsesRuntime = true
                  break
                }
              }
            }
          }
        } catch {
          // ignore — proceed with cleanup suggestion
        }
      }
      if (!otherPluginUsesRuntime) {
        // Derive npm package name
        let npmPackage = null
        if (directCli === "kilo") {
          npmPackage = "@kilocode/cli"
        } else if (directCli === "opencode") {
          npmPackage = "@opencodeai/cli"
        } else {
          npmPackage = directCli
        }
        console.log(`runtime orphaned=${directCli} package=${npmPackage}`)
        console.log(`  No other plugin uses this runtime. Run:`)
        console.log(`    npm uninstall -g ${npmPackage}`)
      }
    }
    console.log(`uninstalled=${pluginName}`)
    return 0
  }

  if (subcommand === "validate") {
    const pluginPath = argv[1]
    if (!pluginPath) {
      console.error("ERROR: 'mah plugins validate <path>' requires a plugin path")
      return 1
    }
    const validation = await validatePluginFn(pluginPath)
    if (jsonMode) {
      console.log(JSON.stringify(validation, null, 2))
    } else if (validation.ok) {
      console.log(`valid plugin=${validation.name} version=${validation.version} mahVersion=${validation.mahVersion}`)
      for (const warning of validation.warnings || []) {
        console.warn(`WARN: ${warning}`)
      }
    } else {
      console.error(`ERROR: invalid plugin: ${validation.errors.join("; ")}`)
      for (const warning of validation.warnings || []) {
        console.warn(`WARN: ${warning}`)
      }
    }
    return validation.ok ? 0 : 1
  }

  console.error(`ERROR: unknown plugins subcommand '${subcommand}'`)
  console.error("Usage: mah plugins [list|install <path>|uninstall <name>|validate <path>]")
  return 1
}

function runDemo(argv) {
  const crew = argv[0] || "dev"
  console.log(`demo crew=${crew}`)
  const steps = [
    ["explain", "detect", "--trace"],
    ["plan"],
    ["validate:all"],
    ["explain", "run", "--session-mode", "continue", "--session-id", "demo-session", "--trace"]
  ]
  for (const step of steps) {
    const status = runLocalScript(path.join("scripts", "meta-agents-harness.mjs"), step)
    if (status !== 0) return status
  }
  console.log("demo completed")
  return 0
}

function dispatch(runtime, command, passthrough) {
  const plan = resolveDispatchPlan(runtime, command, passthrough)
  if (plan.error) {
    console.error(`ERROR: ${plan.error}`)
    return 1
  }
  for (const warning of plan.warnings || []) {
    console.error(`WARN: ${warning}`)
  }
  logProvenance({
    run_id: process.env.MAH_RUN_ID || "",
    runtime,
    command,
    exec: plan.exec,
    args: [...(plan.args || []), ...(plan.passthrough || [])]
  })
  const adapter = runtimeProfiles[runtime]
  if (command === "run" && typeof adapter?.executePreparedRun === "function") {
    return adapter.executePreparedRun({
      repoRoot,
      runtime,
      command,
      adapter,
      plan,
      runCommand
    })
  }
  return runCommand(plan.exec, plan.args, plan.passthrough || [], plan.envOverrides || {})
}

function dispatchCapture(runtime, command, passthrough) {
  const plan = resolveDispatchPlan(runtime, command, passthrough)
  if (plan.error) return { status: 1, stdout: "", stderr: plan.error, plan: null }
  const child = spawnSync(plan.exec, [...(plan.args || []), ...(plan.passthrough || [])], {
    cwd: repoRoot,
    env: { ...process.env, ...(plan.envOverrides || {}) },
    encoding: "utf-8"
  })
  return {
    status: typeof child.status === "number" ? child.status : 1,
    stdout: child.stdout || "",
    stderr: child.stderr || "",
    plan
  }
}

function dispatchHeadless(runtime, command, passthrough, outputMode = "text") {
  const adapter = runtimeProfiles[runtime]
  if (!adapter) {
    return {
      status: 1,
      stdout: "",
      stderr: `unsupported runtime: ${runtime}`,
      error: `unsupported runtime: ${runtime}`
    }
  }

  // Check if adapter supports headless execution
  const supportsHeadless = typeof adapter.prepareHeadlessRunContext === "function"
  if (!supportsHeadless) {
    // Fall back to dispatchCapture for non-headless-aware adapters
    const captured = dispatchCapture(runtime, command, passthrough)
    return captured
  }

  // Normalize args - strip headless/output flags for passthrough
  const normalizedPassthrough = stripHeadlessArgs(passthrough)
  const normalized = normalizeRunArgs(runtime, normalizedPassthrough)
  const envOverrides = { ...normalized.envOverrides }

  // Get headless execution plan from adapter
  const headlessPlan = adapter.prepareHeadlessRunContext({
    repoRoot,
    runtime,
    adapter,
    crew: normalizedPassthrough,
    argv: normalized.args,
    envOverrides
  })

  if (!headlessPlan || headlessPlan.error) {
    return {
      status: 1,
      stdout: "",
      stderr: headlessPlan?.error || "failed to prepare headless run context",
      error: headlessPlan?.error || "failed to prepare headless run context"
    }
  }

  // Execute with headless options
  const result = runCommand(
    headlessPlan.exec || adapter.directCli,
    headlessPlan.args || [],
    headlessPlan.passthrough || [],
    { ...envOverrides, ...(headlessPlan.envOverrides || {}) },
    { headless: true }
  )

  // Format output based on output mode
  if (outputMode === "json") {
    const envelope = {
      runtime,
      command,
      status: result.status,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      crew: headlessPlan.crew || "",
      session_id: headlessPlan.session_id || "",
      execution_time_ms: headlessPlan.execution_time_ms || 0
    }
    return envelope
  }

  // Text mode output
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "")
  }
  process.stdout.write(result.stdout || "")
  return result
}

function isSyncLikeCommand(command) {
  return ["plan", "diff", "sync", "generate", "generate:tree"].includes(command)
}

/**
 * Handle `mah delegate` command — exposes the child agent spawn planning surface.
 * Parses --target, --task, --runtime, --crew flags; resolves delegation;
 * prints the spawn plan (does NOT execute it).
 *
 * Supports two expertise-aware modes:
 * - --auto: automatically select best candidate from policy-allowed set using expertise scoring
 * - --target <agent>: verify explicit target against policy, then score all candidates
 *                     and emit expertise_warning if explicit target isn't the best match
 */
async function runDelegate(passthrough) {
  const startTimeMs = Date.now()
  const execute = passthrough.includes("--execute") || passthrough.includes("-x")
  const autoMode = passthrough.includes("--auto")
  const runArgs = passthrough.filter(a => a !== "--execute" && a !== "-x" && a !== "--auto")
  const target = parseValueArg(runArgs, "--target")
  const task = parseValueArg(runArgs, "--task")
  const targetRuntime = parseValueArg(runArgs, "--runtime", "-r") || ""
  const crew = parseValueArg(runArgs, "--crew") || process.env.MAH_ACTIVE_CREW || "dev"

  // --auto mode: task is required, target is not
  // --target mode: both target and task are required
  if (!task || (!autoMode && !target)) {
    if (autoMode) {
      console.error("ERROR: --task is required in --auto mode")
      console.error("Usage: mah delegate --auto --task '<task>' [--runtime <target-runtime>] [--crew <crew-id>]")
    } else {
      console.error("ERROR: --target and --task are required")
      console.error("Usage: mah delegate --target <agent> --task '<task>' [--runtime <target-runtime>] [--crew <crew-id>]")
      console.error("       mah delegate --auto --task '<task>' [--runtime <target-runtime>] [--crew <crew-id>]")
    }
    return 1
  }

  // Dynamic imports — keeps the delegate surface lazy-loaded
  const { prepareChildSpawn, registerChildAgentAdapter, clearAdapters } = await import("./child-agent-spawn.mjs")
  const { codexSidecarAdapter } = await import("./child-agent-codex-sidecar.mjs")
  const { nativeRuntimeAdapter } = await import("./child-agent-native-runtime.mjs")

  // Register adapters (fresh each invocation)
  clearAdapters()
  registerChildAgentAdapter(nativeRuntimeAdapter)
  registerChildAgentAdapter(codexSidecarAdapter)

  const sourceAgent = process.env.MAH_AGENT || "orchestrator"
  const runtimeFromGlobalFlag = parseRuntimeBeforeCommand(process.argv.slice(2), "delegate")
  const sourceRuntime = process.env.MAH_RUNTIME || runtimeFromGlobalFlag || "pi"
  const effectiveTargetRuntime = targetRuntime || sourceRuntime

  // Initialize expertise-related variables
  let expertiseSelected = null
  let expertiseScore = null
  let expertiseWarning = null

  // Determine the logical target (either explicit or auto-selected)
  let effectiveTarget = target

  if (autoMode) {
    // Mode A: Auto-selection using expertise scoring
    try {
      const { listDelegationTargets } = await import("./delegation-resolution.mjs")
      const { scoreCandidates } = await import("./expertise-routing.mjs")
      const { getRegistry } = await import("./expertise-registry.mjs")

      // Get policy-allowed candidates
      const listResult = listDelegationTargets({ crew, sourceAgent, repoRoot })
      if (!listResult.ok || listResult.targets.length === 0) {
        console.error(`ERROR: no valid delegation targets found for '${sourceAgent}' in crew '${crew}'`)
        if (listResult.error) console.error(`  ${listResult.error}`)
        return 1
      }

      // Get expertise registry to find expertise for each candidate
      const registry = await getRegistry()
      const allowedIds = listResult.targets

      // Build candidates list from registry entries matching allowed targets
      // Registry entries have id like "crew:agent-name" but target is just "agent-name"
      const candidates = registry.entries.filter(entry => {
        const entryAgentId = entry.id.includes(":") ? entry.id.split(":")[1] : entry.id
        return allowedIds.includes(entryAgentId)
      }).map(entry => ({
        id: entry.id.includes(":") ? entry.id.split(":")[1] : entry.id,
        expertise: entry
      }))

      if (candidates.length === 0) {
        // No expertise found for candidates - fall back to first allowed target
        effectiveTarget = listResult.targets[0]
        expertiseWarning = `no expertise entries found for crew '${crew}', defaulting to first allowed target`
      } else {
        // Score all candidates
        const scoringResult = scoreCandidates({
          task,
          sourceAgent,
          candidates,
          options: { allowed_environments: [effectiveTargetRuntime] }
        })

        if (scoringResult.selected) {
          expertiseSelected = scoringResult.selected
          expertiseScore = scoringResult.scores[scoringResult.selected]?.final_score ?? 0

          if (scoringResult.escalation) {
            expertiseWarning = scoringResult.fallback_reason || `score ${expertiseScore.toFixed(3)} below threshold, escalation recommended`
          }
        } else {
          // All candidates blocked - fall back to first allowed target
          effectiveTarget = listResult.targets[0]
          expertiseWarning = `all candidates blocked by filters, defaulting to first allowed target`
        }
      }
    } catch (err) {
      // Expertise scoring failed - log but continue with fallback
      console.error(`WARNING: expertise scoring failed: ${err.message}`)
      // Fall back to first allowed target if we have one
      try {
        const { listDelegationTargets } = await import("./delegation-resolution.mjs")
        const listResult = listDelegationTargets({ crew, sourceAgent, repoRoot })
        if (listResult.ok && listResult.targets.length > 0) {
          effectiveTarget = listResult.targets[0]
          expertiseWarning = `expertise scoring unavailable, using fallback target`
        }
      } catch {
        // Can't even get targets - return error
        console.error(`ERROR: could not determine delegation target: ${err.message}`)
        return 1
      }
    }
  } else {
    // Mode B: Explicit target with expertise review
    // First, verify the explicit target is policy-allowed via delegation-resolution
    try {
      const { resolveDelegationTarget, listDelegationTargets } = await import("./delegation-resolution.mjs")
      const { scoreCandidates } = await import("./expertise-routing.mjs")
      const { getRegistry } = await import("./expertise-registry.mjs")

      // Resolve explicit target against policy
      const resolveResult = resolveDelegationTarget({
        crew,
        sourceAgent,
        sourceRuntime,
        logicalTarget: target,
        repoRoot
      })

      if (!resolveResult.ok) {
        console.error(`ERROR: delegation not allowed: ${resolveResult.error}`)
        return 1
      }

      effectiveTarget = resolveResult.effectiveTarget

      // Now score ALL policy-allowed candidates to check if explicit target is optimal
      const listResult = listDelegationTargets({ crew, sourceAgent, repoRoot })
      if (listResult.ok && listResult.targets.length > 0) {
        const registry = await getRegistry()
        const allowedIds = listResult.targets

        const candidates = registry.entries.filter(entry => {
          const entryAgentId = entry.id.includes(":") ? entry.id.split(":")[1] : entry.id
          return allowedIds.includes(entryAgentId)
        }).map(entry => ({
          id: entry.id.includes(":") ? entry.id.split(":")[1] : entry.id,
          expertise: entry
        }))

        if (candidates.length > 0) {
          const scoringResult = scoreCandidates({
            task,
            sourceAgent,
            candidates,
            options: { allowed_environments: [effectiveTargetRuntime] }
          })

          if (scoringResult.selected) {
            const topCandidate = scoringResult.selected
            const topScore = scoringResult.scores[topCandidate]?.final_score ?? 0
            const explicitScore = scoringResult.scores[effectiveTarget]?.final_score ?? 0

            expertiseSelected = effectiveTarget
            expertiseScore = explicitScore

            if (topCandidate !== effectiveTarget) {
              expertiseWarning = `explicit target '${effectiveTarget}' has score ${explicitScore.toFixed(3)} but '${topCandidate}' has score ${topScore.toFixed(3)} (better match)`
            }
          }
        }
      }
    } catch (err) {
      // Expertise scoring failed - but we already validated the explicit target is policy-allowed
      // Log warning but continue with the explicitly requested target
      console.error(`WARNING: expertise scoring failed: ${err.message}`)
      // expertiseSelected and expertiseScore remain null, expertiseWarning is set
      expertiseWarning = `expertise scoring unavailable for target verification`
    }
  }

  const canonicalTargetModel = resolveCanonicalModelForTarget({
    runtime: effectiveTargetRuntime,
    crew,
    targetAgent: effectiveTarget,
    repoRoot
  })

  if (
    (sourceRuntime === "opencode" && effectiveTargetRuntime === "opencode" && effectiveTarget !== "orchestrator") ||
    (sourceRuntime === "kilo" && effectiveTargetRuntime === "kilo" && effectiveTarget !== "orchestrator")
  ) {
    console.error(`ERROR: ${sourceRuntime} runtime cannot launch subagents as primary agents in same-runtime delegation.`)
    console.error("       Use --runtime codex for delegated execution from this runtime, or run delegation from hermes/pi directly.")
    return 1
  }

  const modelIdentityTask = isModelIdentityTask(task)
  const delegatedTask = buildCanonicalModelIdentityTask(task, canonicalTargetModel)

  const result = prepareChildSpawn({
    crew,
    sourceAgent,
    sourceRuntime,
    targetRuntime: effectiveTargetRuntime,
    logicalTarget: effectiveTarget,
    task: delegatedTask,
    repoRoot
  })

  if (!result.ok) {
    console.error(`ERROR: ${result.error}`)
    return 1
  }

  if (canonicalTargetModel) {
    result.plan.envOverrides = {
      ...(result.plan.envOverrides || {}),
      MAH_AGENT_MODEL_CANONICAL: canonicalTargetModel
    }
  }

  // Structured output (key=value, consistent with other mah commands)
  console.log("ok=true")
  console.log(`logical_target=${effectiveTarget}`)
  console.log(`effective_target=${result.context.effectiveLogicalTarget}`)
  console.log(`mode=${result.context.mode}`)
  console.log(`source_runtime=${result.context.sourceRuntime}`)
  console.log(`target_runtime=${result.context.targetRuntime}`)
  console.log(`exec=${result.plan.exec}`)
  console.log(`args=${result.plan.args.join(" ")}`)
  if (result.plan.envOverrides && Object.keys(result.plan.envOverrides).length > 0) {
    console.log(`env_overrides=${Object.entries(result.plan.envOverrides).map(([k, v]) => `${k}=${v}`).join(",")}`)
  }
  if (result.warnings && result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.log(`warning=${w}`)
    }
  }

  // Expertise scoring output fields
  if (expertiseSelected) {
    console.log(`expertise_selected=${expertiseSelected}`)
  }
  if (expertiseScore !== null) {
    console.log(`expertise_score=${expertiseScore.toFixed(3)}`)
  }
  if (expertiseWarning) {
    console.log(`expertise_warning=${expertiseWarning}`)
  }
  if (canonicalTargetModel) {
    console.log(`model_canonical=${canonicalTargetModel}`)
  }
  if (modelIdentityTask) {
    console.log(`model_identity_task=true`)
  }

  if (execute) {
    console.log("--- executing ---")
    const { spawnSync } = await import("node:child_process")
    const forceCanonicalModelOutput = modelIdentityTask && Boolean(canonicalTargetModel)
    const child = spawnSync(result.plan.exec, result.plan.args, {
      cwd: repoRoot,
      env: { ...process.env, ...result.plan.envOverrides },
      stdio: forceCanonicalModelOutput ? "pipe" : "inherit"
    })
    if (forceCanonicalModelOutput) {
      const stdout = child.stdout ? child.stdout.toString() : ""
      const stderr = child.stderr ? child.stderr.toString() : ""
      if (stdout) process.stdout.write(stdout)
      if (stderr) process.stderr.write(stderr)
      const canonicalLine = canonicalTargetModel.trim().toLowerCase()
      const outputLines = `${stdout}\n${stderr}`
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/^["'`]+|["'`]+$/g, "").toLowerCase())
        .filter(Boolean)
      const hasExactCanonicalLine = outputLines.includes(canonicalLine)
      if (!hasExactCanonicalLine) {
        process.stdout.write(`${canonicalTargetModel}\n`)
      }
    }
    const exitCode = typeof child.status === "number" ? child.status : 1
    console.log(`exit_code=${exitCode}`)
    if (child.error) console.log(`error=${child.error.message}`)
    // Record evidence for executed delegation
    await recordDelegationEvidence({
      crew,
      expertiseId: effectiveTarget,
      taskDescription: task,
      outcome: exitCode === 0 ? "success" : "failure",
      durationMs: Date.now() - startTimeMs,
      sourceAgent,
      isExecuted: true
    })
    return exitCode
  }

  // Plan-only mode: record evidence that delegation was planned
  await recordDelegationEvidence({
    crew,
    expertiseId: effectiveTarget,
    taskDescription: task,
    outcome: "success",
    durationMs: 0,
    sourceAgent,
    isExecuted: false
  })

  return 0
}

/**
 * Record delegation evidence to the evidence store.
 * @param {Object} params
 */
async function recordDelegationEvidence({ crew, expertiseId, taskDescription, outcome, durationMs, sourceAgent, isExecuted }) {
  try {
    const { recordEvidence } = await import("./expertise-evidence-store.mjs")
    const { randomUUID } = await import("node:crypto")

    // Map task description to task type via simple keyword detection
    const taskLower = (taskDescription || "").toLowerCase()
    /** @type {string} */
    let taskType = "general"
    if (taskLower.includes("implement") || taskLower.includes("build") || taskLower.includes("write") || taskLower.includes("code")) {
      taskType = "code-generation"
    } else if (taskLower.includes("test") || taskLower.includes("verify")) {
      taskType = "testing"
    } else if (taskLower.includes("review") || taskLower.includes("audit")) {
      taskType = "review"
    } else if (taskLower.includes("plan") || taskLower.includes("design") || taskLower.includes("architecture")) {
      taskType = "planning"
    } else if (taskLower.includes("deploy") || taskLower.includes("release")) {
      taskType = "deployment"
    }

    const evidence = {
      id: `ev-${Date.now()}-${randomUUID().slice(0, 8)}`,
      expertise_id: `${crew}:${expertiseId}`,
      outcome,
      task_type: taskType,
      task_description: taskDescription,
      duration_ms: durationMs,
      quality_signals: {
        review_pass: outcome === "success" && isExecuted ? true : undefined,
        rejection_count: outcome === "failure" ? 1 : 0
      },
      source_agent: sourceAgent,
      source_session: process.env.MAH_SESSION_ID || "cli",
      recorded_at: new Date().toISOString()
    }

    await recordEvidence(evidence)
  } catch (err) {
    // Evidence recording is best-effort — never block delegation output
    console.error(`[expertise-evidence] failed to record evidence: ${err.message}`)
  }
}

// ---------------------------------------------------------------------------
// Expertise CLI (M4 — Registry + Operator UX)
// ---------------------------------------------------------------------------

/**
 * Parse --crew, --json, and other common flags from argv.
 * @param {string[]} argv
 * @returns {{ crew: string, json: boolean, extras: string[] }}
 */
function parseExpertiseFlags(argv) {
  const crew = parseValueArg(argv, '--crew') || process.env.MAH_ACTIVE_CREW || 'dev'
  const json = argv.includes('--json')
  // Strip flags from extras
  const extras = argv.filter(a => !a.startsWith('--') || a === '--json' || a.startsWith('--crew') || a.startsWith('--limit'))
  return { crew, json, extras }
}

/**
 * Format confidence band with visual indicator.
 * @param {string} band
 * @returns {string}
 */
function formatBand(band) {
  const map = { low: '🔵 low', medium: '🟡 medium', high: '🟢 high', critical: '🔴 critical' }
  return map[band] || band
}

/**
 * Format lifecycle state.
 * @param {string} state
 * @returns {string}
 */
function formatLifecycle(state) {
  const map = { draft: '📝 draft', active: '✅ active', experimental: '🧪 experimental', restricted: '⚠️ restricted', deprecated: '🚫 deprecated' }
  return map[state] || state
}

/**
 * Format validation status.
 * @param {string} status
 * @returns {string}
 */
function formatValidation(status) {
  const map = { declared: '📋 declared', observed: '👁 observed', validated: '✓ validated', restricted: '⚠ restricted', revoked: '✗ revoked' }
  return map[status] || status
}

/**
 * Run expertise subcommand.
 * @param {string[]} argv
 * @param {boolean} jsonMode
 * @returns {Promise<number>} exit code
 */
async function runContext(argv, jsonMode = false) {
  const sub = argv[0]
  const subArgv = argv.slice(1)
  const contextRoot = path.resolve(repoRoot, ".mah", "context")

  if (!sub || sub === "--help" || sub === "-h") {
    console.log(`Usage: mah context <subcommand> [options]

Context Memory — operational context retrieval for MAH agents

Subcommands:
  validate [--strict] [--path <dir>]   Validate context memory documents
  index [--rebuild]                    Build or update the context index
  list [--agent <name>] [--capability] List context memory documents
  show <id>                            Show a specific context document
  find --agent <name> --task "<desc>"  Find relevant context for a task
  explain --agent <name> --task "<desc>" Explain retrieval reasoning
  propose --from-session <ref>         Create memory proposal from session

Options:
  --json        JSON output mode
  --strict      Strict validation (unknown fields = errors)
  --help, -h    Show this help message

Context Memory is separate from Expertise routing. It provides operational
detail, playbooks, and gotchas for agents AFTER routing decisions are made.`)
    return 0
  }

  // --- mah context validate [--strict] [--path <dir>] ---
  if (sub === "validate") {
    const strict = subArgv.includes("--strict")
    const pathIdx = subArgv.indexOf("--path")
    const targetPath = pathIdx >= 0 && subArgv[pathIdx + 1]
      ? path.resolve(repoRoot, subArgv[pathIdx + 1])
      : path.join(contextRoot, "operational")

    const { parseContextFile } = await import("./context-memory-schema.mjs")
    const { validateContextMemoryDocument } = await import("./context-memory-validate.mjs")
    const { readdirSync } = await import("node:fs")

    const files = []
    function walk(dir) {
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) { walk(full); continue }
          if (entry.name.endsWith(".md") || entry.name.endsWith(".qmd")) files.push(full)
        }
      } catch {}
    }
    walk(targetPath)

    const results = []
    for (const file of files) {
      const parsed = parseContextFile(file)
      if (parsed.error) {
        results.push({ file: path.relative(repoRoot, file), valid: false, errors: [parsed.error], warnings: [] })
        continue
      }
      const vr = validateContextMemoryDocument(parsed.frontmatter, strict)
      if (!parsed.body || !parsed.body.trim()) {
        vr.warnings.push("body: empty or whitespace-only body")
      }
      if (parsed.body && !parsed.body.match(/^#{1,6}\s+/m)) {
        vr.warnings.push("body: no headings found (consider adding structure)")
      }
      results.push({ file: path.relative(repoRoot, file), ...vr })
    }

    if (jsonMode) {
      const valid = results.filter(r => r.valid).length
      console.log(JSON.stringify({ files_checked: results.length, valid, invalid: results.length - valid, results }, null, 2))
    } else {
      for (const r of results) {
        const icon = r.valid ? "✓" : "✗"
        console.log(icon + " " + r.file)
        for (const e of r.errors) console.log("  ERROR: " + e)
        for (const w of r.warnings) console.log("  WARN:  " + w)
      }
      const valid = results.filter(r => r.valid).length
      console.log("\n" + results.length + " file(s) checked: " + valid + " valid, " + (results.length - valid) + " invalid")
    }
    return results.every(r => r.valid) ? 0 : 1
  }

  // --- mah context list [--agent <name>] [--capability <cap>] [--json] ---
  if (sub === "list") {
    const agentIdx = subArgv.indexOf("--agent")
    const agentFilter = agentIdx >= 0 ? subArgv[agentIdx + 1] : null
    const capIdx = subArgv.indexOf("--capability")
    const capFilter = capIdx >= 0 ? subArgv[capIdx + 1] : null

    const { parseContextFile } = await import("./context-memory-schema.mjs")
    const { readdirSync } = await import("node:fs")

    const searchDirs = [path.join(contextRoot, "operational")]
    const files = []
    for (const dir of searchDirs) {
      try {
        function walk(d) {
          for (const entry of readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name)
            if (entry.isDirectory()) { walk(full); continue }
            if (entry.name.endsWith(".md") || entry.name.endsWith(".qmd")) files.push(full)
          }
        }
        walk(dir)
      } catch {}
    }

    const docs = []
    for (const file of files) {
      const parsed = parseContextFile(file)
      if (parsed.error) continue
      const fm = parsed.frontmatter
      if (agentFilter && fm.agent !== agentFilter) continue
      if (capFilter && !(fm.capabilities || []).includes(capFilter)) continue
      docs.push({ id: fm.id || "(no id)", kind: fm.kind || "(no kind)", stability: fm.stability || "(no stability)", priority: fm.priority || "—", last_reviewed_at: fm.last_reviewed_at || "—" })
    }

    if (jsonMode) {
      console.log(JSON.stringify({ documents: docs }, null, 2))
    } else {
      if (docs.length === 0) { console.log("No context memory documents found."); return 0 }
      console.log("=== Context Memory Documents ===\n")
      console.log("ID".padEnd(60) + " Kind".padEnd(22) + " Stability".padEnd(12) + " Priority".padEnd(10))
      console.log("─".repeat(60) + " " + "─".repeat(22) + " " + "─".repeat(12) + " " + "─".repeat(10))
      for (const d of docs) console.log(d.id.padEnd(60) + " " + d.kind.padEnd(22) + " " + d.stability.padEnd(12) + " " + d.priority.padEnd(10))
      console.log("\n" + docs.length + " document(s).")
    }
    return 0
  }

  // --- mah context show <id> [--json] ---
  if (sub === "show") {
    const docId = subArgv.find(a => !a.startsWith("--"))
    if (!docId) { console.error("ERROR: usage: mah context show <id>"); return 1 }

    const { parseContextFile, deriveDocId } = await import("./context-memory-schema.mjs")
    const { readdirSync } = await import("node:fs")

    const searchDirs = [path.join(contextRoot, "operational")]
    const files = []
    for (const dir of searchDirs) {
      try {
        function walk(d) {
          for (const entry of readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name)
            if (entry.isDirectory()) { walk(full); continue }
            if (entry.name.endsWith(".md") || entry.name.endsWith(".qmd")) files.push(full)
          }
        }
        walk(dir)
      } catch {}
    }

    for (const file of files) {
      const rel = path.relative(repoRoot, file)
      const derived = deriveDocId(rel)
      const parsed = parseContextFile(file)
      if (parsed.error) continue
      if (parsed.frontmatter.id === docId || derived === docId) {
        if (jsonMode) {
          console.log(JSON.stringify({ document: { frontmatter: parsed.frontmatter, body: parsed.body, file_path: rel } }, null, 2))
        } else {
          console.log("=== Context: " + parsed.frontmatter.id + " ===\n")
          console.log("Kind:      " + parsed.frontmatter.kind)
          console.log("Agent:     " + parsed.frontmatter.agent)
          console.log("Crew:      " + parsed.frontmatter.crew)
          console.log("Stability: " + parsed.frontmatter.stability)
          if (parsed.frontmatter.priority) console.log("Priority:  " + parsed.frontmatter.priority)
          if (parsed.frontmatter.capabilities) console.log("Capabilities: " + parsed.frontmatter.capabilities.join(", "))
          console.log("\n--- Content ---\n" + parsed.body)
        }
        return 0
      }
    }

    console.error("ERROR: context document \x27" + docId + "\x27 not found.")
    return 1
  }

  // --- mah context index [--rebuild] ---
  if (sub === "index") {
    const rebuild = subArgv.includes("--rebuild")

    const { buildOperationalIndex, loadIndex } = await import("./context-memory-schema.mjs")
    const indexPath = path.join(contextRoot, "index", "operational-context.index.json")

    const result = buildOperationalIndex(contextRoot, { rebuild })

    if (jsonMode) {
      console.log(JSON.stringify({
        total_documents: result.total_documents,
        new: result.new,
        updated: result.updated,
        removed: result.removed,
        errors: result.errors,
      }, null, 2))
    } else {
      console.log("=== Context Memory Index ===")
      console.log("Total documents: " + result.total_documents)
      console.log("New: " + result.new)
      console.log("Updated: " + result.updated)
      console.log("Removed: " + result.removed)
      if (result.errors.length > 0) {
        console.log("\nErrors:")
        for (const e of result.errors) console.log("  " + e)
      }
      console.log("\nIndex saved to: " + indexPath)
    }
    return result.errors.length > 0 ? 1 : 0
  }

  // --- mah context find --agent <name> --task "<desc>" [--capability <cap>] [--json] ---
  if (sub === "find") {
    const agentIdx = subArgv.indexOf("--agent")
    const taskIdx = subArgv.indexOf("--task")
    const capIdx = subArgv.indexOf("--capability")
    const toolIdx = subArgv.indexOf("--tools")

    const agent = agentIdx >= 0 ? subArgv[agentIdx + 1] : null
    const task = taskIdx >= 0 ? subArgv[taskIdx + 1] : null
    const capability_hint = capIdx >= 0 ? subArgv[capIdx + 1] : null

    if (!agent || !task) {
      console.error("ERROR: usage: mah context find --agent <name> --task "<desc>" [--capability <cap>]")
      return 1
    }

    const { loadIndex, buildOperationalIndex, retrieveDocuments } = await import("./context-memory-schema.mjs")

    // Try to load existing index first, build if needed
    const indexPath = path.join(contextRoot, "index", "operational-context.index.json")
    let index = loadIndex(indexPath)

    // If index is empty or doesn't exist, build from operational corpus only
    if (!index || !index.entries || index.entries.length === 0) {
      buildOperationalIndex(contextRoot, { rebuild: false })
      index = loadIndex(indexPath)
    }
    if (!index || !index.entries) {
      index = { entries: [] }
    }

    const request = {
      agent,
      task,
      capability_hint,
      available_tools: null,
      available_mcp: null,
    }


    const result = retrieveDocuments(request, index)

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      if (result.matched_docs.length === 0) {
        console.log("No matching documents found.")
        return 0
      }
      console.log("=== Context Memory Retrieval ===")
      console.log("Task: " + task)
      console.log("Agent: " + agent)
      if (capability_hint) console.log("Capability hint: " + capability_hint)
      console.log("Total candidates: " + result.total_candidates)
      console.log("Confidence: " + result.confidence)
      console.log("\nTop matches:")
      console.log("ID".padEnd(60) + " Score   Reasons")
      console.log("─".repeat(90))
      for (const m of result.matched_docs) {
        const scoreStr = (m.score * 100).toFixed(0) + "%"
        const reasonsStr = m.reasons.join("; ")
        console.log(m.id.padEnd(60) + scoreStr.padStart(8) + " " + reasonsStr)
      }
      if (result.tool_hints.length > 0) {
        console.log("\nTool hints: " + result.tool_hints.join(", "))
      }
    }
    return 0
  }

  // --- mah context explain --agent <name> --task "<desc>" [--capability <cap>] [--json] ---
  if (sub === "explain") {
    const agentIdx = subArgv.indexOf("--agent")
    const taskIdx = subArgv.indexOf("--task")
    const capIdx = subArgv.indexOf("--capability")

    const agent = agentIdx >= 0 ? subArgv[agentIdx + 1] : null
    const task = taskIdx >= 0 ? subArgv[taskIdx + 1] : null
    const capability_hint = capIdx >= 0 ? subArgv[capIdx + 1] : null

    if (!agent || !task) {
      console.error("ERROR: usage: mah context explain --agent <name> --task "<desc>" [--capability <cap>]")
      return 1
    }

    const { loadIndex, buildOperationalIndex, retrieveDocuments, scoreDocument } = await import("./context-memory-schema.mjs")

    // Try to load existing index first, build if needed
    const indexPath = path.join(contextRoot, "index", "operational-context.index.json")
    let index = loadIndex(indexPath)

    // If index is empty or doesn't exist, build from operational corpus only
    if (!index || !index.entries || index.entries.length === 0) {
      buildOperationalIndex(contextRoot, { rebuild: false })
      index = loadIndex(indexPath)
    }
    if (!index || !index.entries) {
      index = { entries: [] }
    }

    const request = { agent, task, capability_hint, available_tools: null, available_mcp: null }

    // Score all docs for explanation
    const allScored = []
    for (const entry of index.entries || []) {
      const r = scoreDocument(entry, request)
      allScored.push({ entry, ...r })
    }
    allScored.sort((a, b) => b.score - a.score)

    const result = retrieveDocuments(request, index)

    if (jsonMode) {
      console.log(JSON.stringify({
        retrieval_result: result,
        explanation: {
          steps: [
            "1. Filtered by agent: " + agent,
            "2. Scored by capability_hint match (+0.3 if matched)",
            "3. Boosted by tool matches (+0.1 each, max +0.3)",
            "4. Boosted by system/MCP matches (+0.1 each, max +0.3)",
            "5. Lexical match on task_patterns (+0.1 each, max +0.3)",
            "6. Lexical fallback on tags (+0.05 each, max +0.2)",
            "7. Lexical match on headings (+0.05 each, max +0.2)",
            "8. Stability adjustment (stable +0.05, draft -0.1)",
            "9. Clamped to [0, 1]",
          ],
          total_candidates: index.entries?.length || 0,
          filtered_count: allScored.filter(s => s.score > 0).length,
          top_scores: allScored.slice(0, 5).map(s => ({ id: s.id, score: s.score, reasons: s.reasons })),
        },
      }, null, 2))
    } else {
      console.log("=== Context Memory Retrieval Explanation ===")
      console.log("Task: " + task)
      console.log("Agent: " + agent)
      if (capability_hint) console.log("Capability hint: " + capability_hint)
      console.log("")
      console.log("Retrieval Process:")
      console.log("1. Filtered by agent: " + agent)
      console.log("2. Scored by capability_hint match (+0.3 if matched)")
      console.log("3. Boosted by tool matches (+0.1 each, max +0.3)")
      console.log("4. Boosted by system/MCP matches (+0.1 each, max +0.3)")
      console.log("5. Lexical match on task_patterns (+0.1 each, max +0.3)")
      console.log("6. Lexical fallback on tags (+0.05 each, max +0.2)")
      console.log("7. Lexical match on headings (+0.05 each, max +0.2)")
      console.log("8. Stability adjustment (stable +0.05, draft -0.1)")
      console.log("9. Clamped to [0, 1]")
      console.log("")
      console.log("Statistics:")
      console.log("Total candidates considered: " + (index.entries?.length || 0))
      console.log("Passed filter: " + allScored.filter(s => s.score > 0).length)
      console.log("Confidence: " + result.confidence)
      console.log("")
      console.log("Top-scored documents:")
      console.log("ID".padEnd(55) + " Score   Stability   Reasons")
      console.log("─".repeat(100))
      for (const s of allScored.slice(0, 5)) {
        const stability = s.entry?.metadata_summary?.stability || "?"
        const scoreStr = (s.score * 100).toFixed(0) + "%"
        console.log((s.id || "").padEnd(55) + scoreStr.padStart(8) + " " + stability.padEnd(11) + " " + s.reasons.join("; "))
      }
    }
    return 0
  }

  // --- mah context propose --from-session <session-ref> ---
  if (sub === "propose") {
    const sessionIdx = subArgv.indexOf("--from-session")
    const sessionRef = sessionIdx >= 0 ? subArgv[sessionIdx + 1] : null

    if (!sessionRef) {
      console.error("ERROR: usage: mah context propose --from-session <session-ref>")
      console.error("  session-ref format: runtime:crew:sessionId")
      console.error("  Example: mah context propose --from-session hermes:dev:abc123")
      return 1
    }

    const { proposeFromSession, writeProposal } = await import("./context-memory-proposal.mjs")
    const result = proposeFromSession(repoRoot, sessionRef)

    if (!result.ok) {
      console.error("ERROR: " + result.error)
      return 1
    }

    const writeResult = writeProposal(repoRoot, result.proposal)
    if (!writeResult.ok) {
      console.error("ERROR: " + writeResult.error)
      return 1
    }

    const prop = result.proposal
    console.log("=== Context Memory Proposal Created ===")
    console.log("File:    " + writeResult.file_path)
    console.log("Status:  draft (requires review)")
    console.log("Source:  " + prop.source_type + " — " + prop.source_ref)
    console.log("Proposed ID: " + prop.proposed_document_id)
    console.log("")
    console.log("Summary:")
    console.log("  " + prop.summary)
    console.log("")
    console.log("Rationale:")
    for (const line of (prop.rationale || "").split("\n").slice(0, 5)) {
      console.log("  " + line)
    }
    console.log("")
    console.log("Next steps:")
    console.log("  1. Review the proposal at: " + writeResult.file_path)
    console.log("  2. If approved, move to .mah/context/operational/")
    console.log("  3. Set stability: draft → curated → stable")
    return 0
  }

  console.error("ERROR: unknown context subcommand \x27" + sub + "\x27. Run \x27mah context --help\x27 for usage.")
  return 1
}

async function runExpertise(argv, jsonMode = false) {
  const sub = argv[0]
  const subArgv = argv.slice(1)
  const defaultCrew = process.env.MAH_ACTIVE_CREW || 'dev'

  // Load expertise modules lazily
  const { getRegistry } = await import('./expertise-registry.mjs')
  const { loadExpertiseById } = await import('./expertise-loader.mjs')
  const { loadEvidenceFor, computeMetrics } = await import('./expertise-evidence-store.mjs')
  const { computeConfidence, mergeConfidence } = await import('./expertise-confidence.mjs')
  const { generateProposalById, generateProposalFromEvidenceById, writeProposalToFile, canGenerateProposal } = await import('./expertise-proposal.mjs')

  const resolveExpertiseId = (targetId, crew = defaultCrew) => (
    targetId?.includes(':') ? targetId : `${crew}:${targetId}`
  )

  const loadCanonicalExpertise = async (targetId, crew = defaultCrew) => {
    const resolvedId = resolveExpertiseId(targetId, crew)
    const expertise = await loadExpertiseById(resolvedId)
    return { resolvedId, expertise }
  }

  // ------------------------------------------------------------------
  // expertise list [--crew <crew>] [--json]
  // ------------------------------------------------------------------
  if (sub === 'list') {
    const { crew, json } = parseExpertiseFlags(subArgv)
    const registry = await getRegistry()
    const entries = registry.entries.filter(e => !crew || e.id.startsWith(`${crew}:`) || e.id === crew)

    if (json || jsonMode) {
      console.log(JSON.stringify({ expertise: entries, count: entries.length }, null, 2))
      return 0
    }

    if (entries.length === 0) {
      console.log(`No expertise entries found${crew ? ` for crew '${crew}'` : ''}.`)
      return 0
    }

    console.log(`=== Expertise Catalog${crew ? ` (crew: ${crew})` : ''} ===`)
    console.log(`Total: ${entries.length} entries\n`)
    console.log(`${'ID'.padEnd(30)} ${'Lifecycle'.padEnd(16)} ${'Band'.padEnd(14)} ${'Validation'.padEnd(14)} Owner`)
    console.log(`${'─'.repeat(30)} ${'─'.repeat(16)} ${'─'.repeat(14)} ${'─'.repeat(14)} ${'─'.repeat(20)}`)

    for (const entry of entries.sort((a, b) => a.id.localeCompare(b.id))) {
      const id = entry.id.padEnd(30)
      const lc = formatLifecycle(entry.lifecycle).padEnd(16)
      const band = entry.confidence ? formatBand(entry.confidence.band).padEnd(14) : '—'.padEnd(14)
      const validation = entry.validation_status ? formatValidation(entry.validation_status).padEnd(14) : '—'.padEnd(14)
      const owner = entry.owner?.agent || entry.owner?.team || '—'
      console.log(`${id} ${lc} ${band} ${validation} ${owner}`)
    }

    console.log(`\n${entries.length} expertise entries.`)
    console.log("\nUse 'mah expertise show <id>' for details.")
    return 0
  }

  // ------------------------------------------------------------------
  // expertise show <id> [--json]
  // ------------------------------------------------------------------
  if (sub === 'show') {
    const targetId = parseValueArg(subArgv, '') || subArgv[0]
    if (!targetId) {
      console.error("ERROR: usage: mah expertise show <id>")
      return 1
    }

    const { resolvedId, expertise: entry } = await loadCanonicalExpertise(targetId)

    if (!entry) {
      console.error(`ERROR: expertise '${targetId}' not found.`)
      return 1
    }

    // Compute live metrics + confidence
    let metrics = null
    let confidence = null
    try {
      metrics = await computeMetrics(entry.id)
      if (metrics && metrics.total_invocations > 0) {
        confidence = mergeConfidence(entry.confidence, computeConfidence(metrics))
      }
    } catch { /* ignore */ }

    if (!confidence) confidence = entry.confidence || null

    if (jsonMode) {
      console.log(JSON.stringify({ expertise: entry, metrics, confidence }, null, 2))
      return 0
    }

    console.log(`=== Expertise: ${entry.id} ===\n`)
    console.log(`Lifecycle:    ${formatLifecycle(entry.lifecycle)}`)
    console.log(`Validation:   ${formatValidation(entry.validation_status || 'declared')}`)
    if (confidence) {
      console.log(`Confidence:   ${formatBand(confidence.band)} (${(confidence.score * 100).toFixed(0)}%)`)
      console.log(`Evidence:     ${metrics?.evidence_count ?? confidence.evidence_count ?? 0} invocation(s)`)
    } else {
      console.log(`Confidence:  no evidence yet`)
    }
    console.log(`Owner:        ${entry.owner?.agent || entry.owner?.team || '—'}`)
    console.log(`Environments: ${(entry.allowed_environments || []).join(', ') || 'all'}`)
    console.log(`Trust tier:   ${entry.trust_tier || 'internal'}`)
    if (entry.domains?.length) console.log(`Domains:      ${entry.domains.join(', ')}`)
    if (entry.capabilities?.length) console.log(`Capabilities: ${entry.capabilities.map(c => c.name || c).join(', ')}`)

    if (metrics && metrics.total_invocations > 0) {
      console.log(`\n--- Metrics (${metrics.window_start?.slice(0, 10)} → ${metrics.window_end?.slice(0, 10)}) ---`)
      console.log(`Invocations:   ${metrics.total_invocations} total, ${metrics.successful_invocations} success, ${metrics.failed_invocations} failed`)
      console.log(`Success rate:  ${(metrics.review_pass_rate * 100).toFixed(0)}% review pass`)
      console.log(`Avg latency:   ${(metrics.avg_duration_ms / 1000).toFixed(1)}s  (p95: ${(metrics.p95_duration_ms / 1000).toFixed(1)}s)`)
      console.log(`Last invoked: ${metrics.last_invoked || 'never'}`)
    }

    console.log("\nUse 'mah expertise evidence " + resolvedId + "' for full event log.")
    return 0
  }

  // ------------------------------------------------------------------
  // expertise recommend --task "<task>" [--crew <crew>] [--json]
  // ------------------------------------------------------------------
  if (sub === 'recommend') {
    const task = parseValueArg(subArgv, '--task') || subArgv.find(a => !a.startsWith('--'))
    const { crew, json } = parseExpertiseFlags(subArgv)
    const effectiveCrew = crew || defaultCrew

    if (!task) {
      console.error("ERROR: usage: mah expertise recommend --task '<task description>' [--crew <crew>]")
      return 1
    }

    const sourceAgent = process.env.MAH_AGENT || 'orchestrator'
    const { listDelegationTargets } = await import('./delegation-resolution.mjs')
    const { scoreCandidates } = await import('./expertise-routing.mjs')

    const listResult = listDelegationTargets({ crew: effectiveCrew, sourceAgent, repoRoot })
    if (!listResult.ok || listResult.targets.length === 0) {
      console.error(`ERROR: no valid delegation targets for crew '${crew}'`)
      return 1
    }

    const allowedIds = listResult.targets
    const candidates = (await Promise.all(allowedIds.map(async (agentId) => {
      const expertise = await loadExpertiseById(resolveExpertiseId(agentId, effectiveCrew))
      return expertise ? { id: agentId, expertise } : null
    }))).filter(Boolean)

    if (candidates.length === 0) {
      console.error(`ERROR: no expertise entries found for crew '${crew}'`)
      return 1
    }

    const scoringResult = scoreCandidates({
      task,
      sourceAgent,
      candidates,
      options: {}
    })

    if (json || jsonMode) {
      console.log(JSON.stringify({
        task,
        crew: effectiveCrew,
        selected: scoringResult.selected,
        escalation: scoringResult.escalation,
        fallback_reason: scoringResult.fallback_reason,
        scores: scoringResult.scores,
        candidates_count: candidates.length
      }, null, 2))
      return 0
    }

    console.log(`=== Expertise Recommendation ===\n`)
    console.log(`Task: "${task}"`)
    console.log(`Crew: ${effectiveCrew}\n`)

    const sortedScores = Object.entries(scoringResult.scores || {})
      .sort((a, b) => (b[1]?.final_score || 0) - (a[1]?.final_score || 0))

    console.log(`Candidates (${candidates.length}):\n`)
    for (const [id, scoreData] of sortedScores) {
      const bar = scoreData?.final_score > 0
        ? `█`.repeat(Math.round(scoreData.final_score * 10)).padEnd(10, '░')
        : '░'.repeat(10)
      const marker = id === scoringResult.selected ? '→ ' : '  '
      console.log(`${marker}${bar} ${(scoreData?.final_score || 0).toFixed(3)}  ${id}`)
    }

    console.log('')
    if (scoringResult.selected) {
      console.log(`Recommended: ${scoringResult.selected} (score: ${(scoringResult.scores[scoringResult.selected]?.final_score || 0).toFixed(3)})`)
    }
    if (scoringResult.escalation) {
      console.log(`⚠ Escalation: ${scoringResult.fallback_reason || 'score below threshold'}`)
    }
    console.log("\nUse 'mah expertise explain --task \"<task>\"' for full decision trace.")
    return 0
  }

  // ------------------------------------------------------------------
  // expertise evidence <id> [--limit N] [--json]
  // ------------------------------------------------------------------
  if (sub === 'evidence') {
    const targetId = parseValueArg(subArgv, '') || subArgv[0]
    const limitArg = parseValueArg(subArgv, '--limit') || subArgv.find(a => !a.startsWith('--') && a !== targetId)
    const limit = limitArg ? parseInt(limitArg, 10) : 50

    if (!targetId) {
      console.error("ERROR: usage: mah expertise evidence <id> [--limit N]")
      return 1
    }

    const events = await loadEvidenceFor(targetId, { limit })

    if (jsonMode) {
      console.log(JSON.stringify({ expertise_id: targetId, events, count: events.length }, null, 2))
      return 0
    }

    if (events.length === 0) {
      console.log(`No evidence events found for '${targetId}'.`)
      return 0
    }

    const metrics = await computeMetrics(targetId)
    console.log(`=== Evidence: ${targetId} ===\n`)
    console.log(`${events.length} event(s)${metrics ? ` | success rate: ${((metrics.successful_invocations / metrics.total_invocations) * 100).toFixed(0)}% | avg: ${(metrics.avg_duration_ms / 1000).toFixed(1)}s` : ''}\n`)
    console.log(`${'Time'.padEnd(25)} ${'Outcome'.padEnd(10)} ${'Type'.padEnd(16)} Duration  Task`)
    console.log(`${'─'.repeat(25)} ${'─'.repeat(10)} ${'─'.repeat(16)} ${'─'.repeat(8)} ${'─'.repeat(30)}`)

    for (const ev of events) {
      const ts = ev.recorded_at?.slice(0, 19).replace('T', ' ') || '—'
      const outcome = (ev.outcome === 'success' ? '✅ success' : ev.outcome === 'failure' ? '❌ failure' : '⚠ partial').padEnd(10)
      const type = (ev.task_type || 'unknown').padEnd(16)
      const dur = ev.duration_ms > 0 ? `${(ev.duration_ms / 1000).toFixed(1)}s` : '—'
      const desc = (ev.task_description || '').slice(0, 40)
      console.log(`${ts} ${outcome} ${type} ${dur.padEnd(8)} ${desc}`)
    }
    return 0
  }

  // ------------------------------------------------------------------
  // expertise explain --task "<task>" [--crew <crew>] [--json]
  // ------------------------------------------------------------------
  if (sub === 'explain') {
    const task = parseValueArg(subArgv, '--task') || subArgv.find(a => !a.startsWith('--'))
    const { crew, json } = parseExpertiseFlags(subArgv)
    const effectiveCrew = crew || defaultCrew

    if (!task) {
      console.error("ERROR: usage: mah expertise explain --task '<task>' [--crew <crew>]")
      return 1
    }

    const sourceAgent = process.env.MAH_AGENT || 'orchestrator'
    const { listDelegationTargets } = await import('./delegation-resolution.mjs')
    const { scoreCandidates } = await import('./expertise-routing.mjs')

    const listResult = listDelegationTargets({ crew: effectiveCrew, sourceAgent, repoRoot })
    if (!listResult.ok) {
      console.error(`ERROR: ${listResult.error}`)
      return 1
    }

    const candidates = (await Promise.all(listResult.targets.map(async (agentId) => {
      const expertise = await loadExpertiseById(resolveExpertiseId(agentId, effectiveCrew))
      return expertise ? { id: agentId, expertise } : null
    }))).filter(Boolean)

    const scoringResult = scoreCandidates({
      task,
      sourceAgent,
      candidates,
      options: {}
    })

    if (json || jsonMode) {
      console.log(JSON.stringify({
        task,
        crew: effectiveCrew,
        source_agent: sourceAgent,
        routing: scoringResult,
        explain: {
          filters_run: scoringResult.explain?.filters_run || [],
          blocking: scoringResult.explain?.blocking || {},
          scoring_summary: scoringResult.explain?.scoring_summary || `${Object.keys(scoringResult.scores || {}).length} candidates scored`
        }
      }, null, 2))
      return 0
    }

    console.log(`=== Expertise Routing Trace ===\n`)
    console.log(`Task: "${task}"`)
    console.log(`Source: ${sourceAgent}  |  Crew: ${effectiveCrew}\n`)

    console.log('── Decision Filters ──')
    console.log('  [1] policy/topology allowed set')
    console.log('  [2] environment compatibility')
    console.log('  [3] trust tier requirement')
    console.log('  [4] lifecycle blocking (restricted/revoked)')
    console.log('  [5] expertise match score')
    console.log('  [6] confidence + evidence freshness\n')

    const sorted = Object.entries(scoringResult.scores || {})
      .sort((a, b) => (b[1]?.final_score || 0) - (a[1]?.final_score || 0))

    console.log('── Scoring Breakdown ──')
    for (const [id, scoreData] of sorted) {
      if (!scoreData) continue
      console.log(`\n  ${id}:`)
      console.log(`    expertise_match: ${scoreData.match_score?.toFixed(3) || '—'}`)
      console.log(`    confidence_adj:  ${scoreData.confidence_adjustment?.toFixed(3) || '—'}`)
      console.log(`    penalty:         ${scoreData.penalty?.toFixed(3) || '—'}`)
      console.log(`    ─ final:         ${scoreData.final_score?.toFixed(3) || '—'}`)
      if (scoreData.penalties_applied?.length) {
        console.log(`    penalties:       ${scoreData.penalties_applied.join(', ')}`)
      }
      if (scoreData.blocked_filters?.length) {
        console.log(`    BLOCKED: ${scoreData.blocked_filters.join('; ')}`)
      }
    }

    console.log('\n── Decision ──')
    if (scoringResult.selected) {
      const topScore = scoringResult.scores[scoringResult.selected]
      console.log(`  Selected: ${scoringResult.selected}`)
      console.log(`  Score: ${(topScore?.final_score || 0).toFixed(3)}`)
      if (topScore?.confidence_band) console.log(`  Confidence band: ${topScore.confidence_band}`)
    }
    if (scoringResult.escalation) {
      console.log(`  ⚠ ESCALATION RECOMMENDED: ${scoringResult.fallback_reason}`)
    }
    return 0
  }

  // ------------------------------------------------------------------
  // expertise export <id> [--output <path>] [--json]
  // ------------------------------------------------------------------
  if (sub === 'export') {
    const targetId = parseValueArg(subArgv, '') || subArgv[0]
    const outputPath = parseValueArg(subArgv, '--output') || ''
    const domain = parseValueArg(subArgv, '--domain') || ''
    const normalizedId = resolveExpertiseId(targetId)

    if (!targetId) {
      console.error("ERROR: usage: mah expertise export <id> [--output <path>] [--domain <domain>]")
      return 1
    }

    const { exportExpertiseToFile } = await import('./expertise-export.mjs')

    if (outputPath) {
      // SECURITY: v0.7.0-patch
      const outputValidation = validateCliPath(outputPath, 'write')
      if (!outputValidation.ok) {
        console.error(`ERROR: invalid --output path: ${outputValidation.error}`)
        return 1
      }

      const result = await exportExpertiseToFile(normalizedId, outputValidation.resolvedPath, { domain })
      if (!result.ok) {
        console.error(`ERROR: export failed: ${result.errors.join('; ')}`)
        return 1
      }
      if (jsonMode) {
        console.log(JSON.stringify({ ok: true, id: normalizedId, output: outputValidation.resolvedPath, warnings: result.errors }, null, 2))
      } else {
        console.log(`✓ Exported '${normalizedId}' to '${outputValidation.resolvedPath}'`)
        if (result.errors.length) console.log(`  warnings: ${result.errors.join(', ')}`)
      }
      return 0
    }

    // Interactive export to stdout
    const { expertise: entry } = await loadCanonicalExpertise(targetId)
    if (!entry) {
      console.error(`ERROR: expertise '${targetId}' not found in catalog`)
      return 1
    }

    const { exportExpertise } = await import('./expertise-export.mjs')
    const result = exportExpertise(entry, { domain, skipPolicy: false })
    if (!result.ok) {
      console.error(`ERROR: export blocked by policy: ${result.error}`)
      return 1
    }

    if (jsonMode) {
      console.log(JSON.stringify(result.payload, null, 2))
    } else {
      console.log(`=== Expertise Export: ${normalizedId} ===`)
      console.log(JSON.stringify(result.payload, null, 2))
      if (result.warnings?.length) console.log(`\n⚠ warnings: ${result.warnings.join(', ')}`)
    }
    return 0
  }

  // ------------------------------------------------------------------
  // expertise propose <id> [--output <path>] [--summary <text>] [--json]
  // ------------------------------------------------------------------
  if (sub === 'propose') {
    const targetId = parseValueArg(subArgv, '') || subArgv[0]
    const outputPath = parseValueArg(subArgv, '--output') || ''
    const summary = parseValueArg(subArgv, '--summary') || ''
    const rationale = parseValueArg(subArgv, '--rationale') || ''
    const changesRaw = parseValueArg(subArgv, '--changes') || '{}'
    const evidenceRaw = parseValueArg(subArgv, '--evidence-refs') || ''
    const reviewersRaw = parseValueArg(subArgv, '--reviewers') || ''
    const fromEvidence = subArgv.includes('--from-evidence')
    const evidenceLimitRaw = parseValueArg(subArgv, '--evidence-limit') || '5'
    const evidenceLimit = Number.parseInt(evidenceLimitRaw, 10)

    if (!targetId) {
      console.error("ERROR: usage: mah expertise propose <id> [--from-evidence] [--summary <text>] [--rationale <text>] [--changes '<json>'] [--output <path>]")
      return 1
    }

    const actor = {
      agent: process.env.MAH_AGENT || 'orchestrator',
      role: process.env.MAH_ROLE || undefined,
      team: process.env.MAH_ACTIVE_CREW || 'dev',
    }
    if (!canGenerateProposal(actor)) {
      console.error(`ERROR: proposal generation is restricted to orchestrator/leads; current actor '${actor.agent}' is not allowed`)
      return 1
    }

    let proposedChanges = {}
    if (!fromEvidence) {
      try {
        proposedChanges = JSON.parse(changesRaw)
      } catch (err) {
        console.error(`ERROR: invalid --changes JSON: ${err.message}`)
        return 1
      }
    }

    const evidenceRefs = evidenceRaw ? evidenceRaw.split(',').map(s => s.trim()).filter(Boolean) : []
    const reviewers = reviewersRaw ? reviewersRaw.split(',').map(s => s.trim()).filter(Boolean) : []

    const proposalArgs = {
      targetId,
      crew: process.env.MAH_ACTIVE_CREW || 'dev',
      actor,
      reviewers,
    }

    const result = fromEvidence
      ? await generateProposalFromEvidenceById({
          ...proposalArgs,
          limit: Number.isFinite(evidenceLimit) && evidenceLimit > 0 ? evidenceLimit : 5,
        })
      : await generateProposalById({
          ...proposalArgs,
          summary: summary || `Propose catalog update for ${targetId}`,
          rationale,
          proposedChanges,
          evidenceRefs,
        })

    if (!result.ok) {
      console.error(`ERROR: proposal generation failed: ${result.error}`)
      return 1
    }

    const proposal = result.proposal

    if (outputPath) {
      const outputValidation = validateCliPath(outputPath, 'write')
      if (!outputValidation.ok) {
        console.error(`ERROR: invalid --output path: ${outputValidation.error}`)
        return 1
      }
      const writeResult = writeProposalToFile(proposal, outputValidation.resolvedPath)
      if (!writeResult.ok) {
        console.error(`ERROR: proposal write failed: ${writeResult.errors.join('; ')}`)
        return 1
      }
      if (jsonMode) {
        console.log(JSON.stringify({ ok: true, output: writeResult.path, proposal }, null, 2))
      } else {
        console.log(`✓ Proposal written to '${writeResult.path}'`)
        console.log(`  target: ${proposal.target_expertise_id}`)
        console.log(`  generated by: ${proposal.generated_by.actor} (${proposal.generated_by.role})`)
      }
      return 0
    }

    if (jsonMode) {
      console.log(JSON.stringify(proposal, null, 2))
    } else {
      console.log(`=== Expertise Proposal: ${proposal.target_expertise_id} ===`)
      console.log(`Generated by: ${proposal.generated_by.actor} (${proposal.generated_by.role})`)
      console.log(`Summary: ${proposal.summary}`)
      if (proposal.rationale) console.log(`Rationale: ${proposal.rationale}`)
      console.log(`Target status: ${proposal.target_snapshot.validation_status} / ${proposal.target_snapshot.lifecycle}`)
      console.log(`Proposed changes: ${Object.keys(proposal.proposed_changes || {}).length ? JSON.stringify(proposal.proposed_changes) : 'none'}`)
      console.log(`Reviewers: ${(proposal.reviewers || []).join(', ') || 'validation-lead, security-reviewer'}`)
    }
    return 0
  }

  // ------------------------------------------------------------------
  // expertise import <file> [--dry-run] [--json]
  // ------------------------------------------------------------------
  if (sub === 'import') {
    const filePath = parseValueArg(subArgv, '') || subArgv[0]
    const dryRun = subArgv.includes('--dry-run')
    const lenient = subArgv.includes('--lenient')

    if (!filePath) {
      console.error("ERROR: usage: mah expertise import <file> [--dry-run] [--lenient]")
      return 1
    }

    const { loadImportFile, importExpertise } = await import('./expertise-export.mjs')

    // SECURITY: v0.7.0-patch
    const fileValidation = validateCliPath(filePath, 'read')
    if (!fileValidation.ok) {
      console.error(`ERROR: invalid import file path: ${fileValidation.error}`)
      return 1
    }

    const loadResult = await loadImportFile(fileValidation.resolvedPath, { dryRun, strict: !lenient })
    if (!loadResult.valid) {
      if (jsonMode) {
        console.log(JSON.stringify({ ok: false, errors: loadResult.errors, warnings: loadResult.warnings }, null, 2))
      } else {
        console.error(`ERROR: import validation failed:`)
        for (const err of loadResult.errors) console.error(`  - ${err}`)
        if (loadResult.warnings.length) console.log(`warnings: ${loadResult.warnings.join(', ')}`)
      }
      return 1
    }

    const impResult = importExpertise(loadResult.payload, { dryRun })

    if (jsonMode) {
      console.log(JSON.stringify({
        ok: true,
        dry_run: dryRun,
        imported: impResult.imported?.id,
        message: impResult.message,
        warnings: loadResult.warnings,
      }, null, 2))
    } else {
      if (dryRun) {
        console.log(`=== Import Dry-Run: ${loadResult.payload.id} ===`)
        console.log(`  status: VALID (would import)`)
        console.log(`  id:       ${loadResult.payload.id}`)
        console.log(`  owner:    ${loadResult.payload.owner?.agent || loadResult.payload.owner?.team || '?'}`)
        console.log(`  domains:  ${(loadResult.payload.domains || []).join(', ')}`)
        console.log(`  policy:   federated_allowed=${loadResult.payload.policy?.federated_allowed ?? false}, approval_required=${loadResult.payload.policy?.approval_required ?? false}`)
        if (loadResult.warnings.length) console.log(`\n⚠ warnings: ${loadResult.warnings.join(', ')}`)
      } else {
        console.log(`✓ Import validated: '${loadResult.payload.id}' (write not yet implemented — see message below)`)
        console.log(`  note: ${impResult.message}`)
      }
    }
    return 0
  }

  // ------------------------------------------------------------------
  // expertise --help
  // ------------------------------------------------------------------
  if (sub === '--help' || sub === '-h' || sub === 'help' || !sub) {
    console.log(`
mah expertise — Expertise Catalog CLI (v0.7.0)

Usage:
  mah expertise list                        List all expertise entries
  mah expertise list --crew <crew>         List expertise for a specific crew
  mah expertise list --json                 JSON output

  mah expertise show <id>                   Show detailed expertise entry
  mah expertise show <id> --json            JSON output

  mah expertise recommend --task '<desc>'   Recommend best candidate for task
  mah expertise recommend --task '<desc>' --json   JSON output

  mah expertise evidence <id>               Show evidence events for expertise
  mah expertise evidence <id> --limit 20   Limit to 20 events
  mah expertise evidence <id> --json        JSON output

  mah expertise explain --task '<desc>'     Full routing decision trace
  mah expertise explain --task '<desc>' --json   JSON output

  mah expertise export <id>                 Export expertise to JSON
  mah expertise export <id> --output <path>  Write to file
  mah expertise export <id> --domain <domain>  Check domain policy
  mah expertise export <id> --json          JSON output

  mah expertise propose <id>                Create a governed proposal artifact
  mah expertise propose <id> --from-evidence  Draft changes from the evidence store
  mah expertise propose <id> --summary <text>  Proposal summary
  mah expertise propose <id> --rationale <text>  Proposal rationale
  mah expertise propose <id> --changes '<json>'  Suggested changes JSON
  mah expertise propose <id> --evidence-limit <n>  Number of recent evidence events to inspect
  mah expertise propose <id> --evidence-refs <id1,id2>  Optional evidence refs
  mah expertise propose <id> --output <path> Write proposal to file

  mah expertise import <file>               Import expertise from JSON file (strict by default)
  mah expertise import <file> --dry-run     Validate without writing
  mah expertise import <file> --lenient     Allow unknown fields (forward-compat mode)

Examples:
  mah expertise list --crew dev
  mah expertise show dev:backend-dev
  mah expertise recommend --task "implement user authentication API"
  mah expertise evidence dev:backend-dev --limit 10
  mah expertise export dev:backend-dev --output .mah/expertise/exported/backend-dev.json
  mah expertise propose dev:backend-dev --summary "Promote backend-dev after v0.7.0 evidence accumulation" --changes '{"validation_status":"validated"}'
  mah expertise propose dev:backend-dev --from-evidence --evidence-limit 10
  mah expertise import .mah/expertise/exported/backend-dev.json --dry-run
`)
    return 0
  }

  console.error(`ERROR: unknown expertise subcommand '${sub}'`)
  console.error("Use 'mah expertise --help' for usage.")
  return 1
}

function main() {
  const argv = process.argv.slice(2)
  const traceMode = hasFlag(argv, "--trace")
  const jsonMode = hasFlag(argv, "--json")
  const mermaidMode = hasFlag(argv, "--mermaid")
  const normalizedArgv = stripRuntimeArgs(removeFlag(removeFlag(removeFlag(removeFlag(removeFlag(argv, "--trace"), "--strict-markers"), "--json"), "--mermaid"), "--headless"))
  const first = normalizedArgv[0]

  if (!first || first === "--help" || first === "-h" || first === "help") {
    printHelp()
    return
  }

  const forcedRuntime = parseRuntimeArg(argv)
  const runtimeResult = detectRuntime(repoRoot, forcedRuntime)

  if (first === "contract:runtime") {
    const contract = validateRuntimeAdapterContract(runtimeProfiles)
    if (!contract.ok) {
      for (const error of contract.errors) console.error(`ERROR: ${error}`)
      process.exitCode = 1
      return
    }
    console.log("runtime adapter contract passed")
    return
  }

  if (first === "detect") {
    if (!runtimeResult.runtime) {
      if (jsonMode) {
        printDiagnosticPayload(createDiagnosticPayload("detect", {
          status: 1,
          reason: runtimeResult.reason,
          data: { runtime: "unknown" },
          errors: ["no-runtime-detected"]
        }))
      } else {
        console.log("runtime=unknown")
        console.log("reason=none")
      }
      process.exitCode = 1
      return
    }
    if (jsonMode) {
      printDiagnosticPayload(createDiagnosticPayload("detect", {
        status: 0,
        runtime: runtimeResult.runtime,
        reason: runtimeResult.reason,
        data: { runtime: runtimeResult.runtime }
      }))
    } else {
      console.log(`runtime=${runtimeResult.runtime}`)
      console.log(`reason=${runtimeResult.reason}`)
    }
    return
  }

  if (first === "selftest:cli-path") {
    process.exitCode = runCliPathSecuritySelfTest()
    return
  }

  if (first === "init") {
    process.exitCode = runInit(normalizedArgv.slice(1))
    return
  }

  if (first === "sessions") {
    ;(async () => {
      // Use original argv (not normalizedArgv) because sessions subcommands use --runtime
      // as a first-class flag (filter/target runtime) and stripping it breaks parsing.
      const sessionsCommandIndex = argv.findIndex((arg) => arg === "sessions")
      const sessionsArgv = (sessionsCommandIndex >= 0 ? argv.slice(sessionsCommandIndex + 1) : normalizedArgv.slice(1))
        .filter((arg) => !["--trace", "--json", "--mermaid", "--headless", "--strict-markers"].includes(arg))
      process.exitCode = await runSessions(sessionsArgv, jsonMode, runtimeResult.runtime)
    })()
    return
  }

  if (first === "plugins") {
    ;(async () => {
      process.exitCode = await runPlugins(normalizedArgv.slice(1), jsonMode)
    })()
    return
  }

  if (first === "graph") {
    process.exitCode = runGraph(normalizedArgv.slice(1), jsonMode, mermaidMode)
    return
  }

  if (first === "delegate") {
    ;(async () => {
      // Use original argv (not normalizedArgv) because delegate needs --runtime for target runtime,
      // not for MAH's own runtime detection. normalizedArgv strips --runtime.
      // argv = process.argv.slice(2), so argv[0] = 'delegate'. Skip it.
      const delegateArgv = argv.slice(1).filter(a => !['--trace', '--json', '--mermaid', '--headless', '--strict-markers'].includes(a))
      process.exitCode = await runDelegate(delegateArgv)
    })()
    return
  }

  if (first === "context") {
    ;(async () => {
      process.exitCode = await runContext(argv.slice(1), jsonMode)
    })()
    return
  }

  if (first === "expertise") {
    ;(async () => {
      process.exitCode = await runExpertise(argv.slice(1), jsonMode)
    })()
    return
  }


  if (first === "demo") {
    process.exitCode = runDemo(normalizedArgv.slice(1))
    return
  }

  if (isSyncLikeCommand(first)) {
    if ((first === "sync" || first === "generate" || first === "generate:tree") && argv.includes("--help")) {
      printSyncHelp()
      return
    }
    // Collect mode flags and forward remaining argv (--check, --plan, --diff, etc.)
    const extraArgs = argv.filter((a) => !a.startsWith("--json"))
    const modeFlag = (first === "sync" || first === "generate" || first === "generate:tree")
      ? []
      : [first === "plan" ? "--plan" : "--diff"]
    const allArgs = [...modeFlag, ...extraArgs]
    if (jsonMode) {
      const captured = runLocalScriptCapture(path.join("scripts", "sync-meta-agents.mjs"), [...allArgs, "--json"])
      let report = {}
      try {
        report = JSON.parse(captured.stdout || "{}")
      } catch {
        report = {}
      }
      printDiagnosticPayload(createDiagnosticPayload(first, {
        status: captured.status,
        data: report,
        errors: captured.status === 0 ? [] : ["sync-report-not-clean"]
      }))
      process.exitCode = captured.status
      return
    }
    process.exitCode = runLocalScript(path.join("scripts", "sync-meta-agents.mjs"), allArgs)
    return
  }

  if (first === "validate:config") {
    if (jsonMode) {
      const captured = runLocalScriptCapture(path.join("scripts", "validate-meta-config.mjs"))
      printDiagnosticPayload(createDiagnosticPayload("validate:config", {
        status: captured.status,
        data: { stdout: captured.stdout.trim(), stderr: captured.stderr.trim() },
        errors: captured.status === 0 ? [] : ["config-validation-failed"]
      }))
      process.exitCode = captured.status
      return
    }
    process.exitCode = runLocalScript(path.join("scripts", "validate-meta-config.mjs"))
    return
  }

  if (first === "validate:expertise") {
    const expertiseArgs = argv.slice(1).filter((arg) => arg !== "--json")
    if (jsonMode) {
      const captured = runLocalScriptCapture(path.join("scripts", "expertise-validate.mjs"), [...expertiseArgs, "--json"])
      let jsonPayload = null
      try { jsonPayload = JSON.parse(captured.stdout || "{}") } catch { jsonPayload = null }
      printDiagnosticPayload(createDiagnosticPayload("validate:expertise", {
        status: captured.status,
        data: jsonPayload || { stdout: captured.stdout.trim() },
        errors: captured.status === 0 ? [] : ["expertise-validation-failed"]
      }))
      process.exitCode = captured.status
      return
    }
    process.exitCode = runLocalScript(path.join("scripts", "expertise-validate.mjs"), expertiseArgs)
    return
  }

  if (first === "validate:sync") {
    if (jsonMode) {
      const captured = runLocalScriptCapture(path.join("scripts", "sync-meta-agents.mjs"), ["--check", "--json"])
      let report = {}
      try {
        report = JSON.parse(captured.stdout || "{}")
      } catch {
        report = {}
      }
      printDiagnosticPayload(createDiagnosticPayload("validate:sync", {
        status: captured.status,
        data: report,
        errors: captured.status === 0 ? [] : ["sync-validation-failed"]
      }))
      process.exitCode = captured.status
      return
    }
    process.exitCode = runLocalScript(path.join("scripts", "sync-meta-agents.mjs"), ["--check"])
    return
  }

  if (first === "validate:runtime") {
    if (!runtimeResult.runtime) {
      const payload = { command: "validate:runtime", ok: false, status: 1, reason: "no-runtime-detected" }
      if (jsonMode) console.log(JSON.stringify(payload, null, 2))
      else console.error("ERROR: could not detect runtime. Use --runtime to run validate:runtime")
      process.exitCode = 1
      return
    }
    if (jsonMode) {
      const captured = dispatchCapture(runtimeResult.runtime, "check:runtime", [])
      const precheck = runtimeValidationReport(runtimeResult.runtime)
      const status = precheck.ok ? captured.status : 1
      printDiagnosticPayload(createDiagnosticPayload("validate:runtime", {
        runtime: runtimeResult.runtime,
        reason: runtimeResult.reason,
        status,
        data: { precheck, stdout: captured.stdout.trim(), stderr: captured.stderr.trim() },
        errors: status === 0 ? [] : ["runtime-validation-failed"]
      }))
      process.exitCode = status
      return
    }
    const precheck = runtimeValidationReport(runtimeResult.runtime)
    if (!precheck.ok) {
      console.error("ERROR: runtime precheck failed")
      for (const check of precheck.checks || []) {
        if (!check.ok) console.error(`- ${check.name}`)
      }
      process.exitCode = 1
      return
    }
    process.exitCode = dispatch(runtimeResult.runtime, "check:runtime", [])
    return
  }

  if (first === "validate:all") {
    if (jsonMode) {
      const config = runLocalScriptCapture(path.join("scripts", "validate-meta-config.mjs"))
      const sync = runLocalScriptCapture(path.join("scripts", "sync-meta-agents.mjs"), ["--check", "--json"])
      const runtime = runtimeResult.runtime
        ? dispatchCapture(runtimeResult.runtime, "check:runtime", [])
        : { status: 0, stdout: "", stderr: "skipped: no runtime detected" }
      const expertise = runLocalScriptCapture(path.join("scripts", "expertise-validate.mjs"), ["--json"])
      const status = config.status !== 0 ? config.status : sync.status !== 0 ? sync.status : runtime.status !== 0 ? runtime.status : expertise.status
      let syncJson = null
      let expertiseJson = null
      try { syncJson = JSON.parse(sync.stdout || "{}") } catch { syncJson = null }
      try { expertiseJson = JSON.parse(expertise.stdout || "{}") } catch { expertiseJson = null }
      printDiagnosticPayload(createDiagnosticPayload("validate:all", {
        status,
        runtime: runtimeResult.runtime || "",
        reason: runtimeResult.reason,
        data: {
          checks: {
            config: { status: config.status, stdout: config.stdout.trim(), stderr: config.stderr.trim() },
            sync: { status: sync.status, report: syncJson, stdout: sync.stdout.trim(), stderr: sync.stderr.trim() },
            runtime: { status: runtime.status, stdout: runtime.stdout.trim(), stderr: runtime.stderr.trim() },
            expertise: { status: expertise.status, report: expertiseJson, stdout: expertise.stdout.trim(), stderr: expertise.stderr.trim() },
          }
        },
        errors: status === 0 ? [] : ["composed-validation-failed"]
      }))
      process.exitCode = status
      return
    }
    const configStatus = runLocalScript(path.join("scripts", "validate-meta-config.mjs"))
    if (configStatus !== 0) {
      process.exitCode = configStatus
      return
    }
    const syncStatus = runLocalScript(path.join("scripts", "sync-meta-agents.mjs"), ["--check"])
    if (syncStatus !== 0) {
      process.exitCode = syncStatus
      return
    }
    if (!runtimeResult.runtime) {
      console.error("WARN: validate:all skipped runtime validation because no runtime was detected")
      process.exitCode = 0
      return
    }
    process.exitCode = dispatch(runtimeResult.runtime, "check:runtime", [])
    return
  }

  if (first === "explain") {
    const explainCommand = normalizedArgv[1] || "detect"
    const explainFilters = parseFilterArgs(normalizedArgv.slice(2))
    const isHeadless = hasHeadlessFlag(argv)
    const crewContext = resolveCrewExecutionContext(explainFilters.crew)
    if (explainCommand === "detect") {
      if (jsonMode) {
        printDiagnosticPayload(createDiagnosticPayload("explain", {
          status: runtimeResult.runtime ? 0 : 1,
          runtime: runtimeResult.runtime || "",
          reason: runtimeResult.reason,
          data: { target: "detect", runtime: runtimeResult.runtime || "", crew_context: crewContext },
          errors: runtimeResult.runtime ? [] : ["no-runtime-detected"]
        }))
      } else {
        printExplain(traceMode, { runtime: runtimeResult.runtime, reason: runtimeResult.reason, command: "detect", crewContext })
      }
      process.exitCode = runtimeResult.runtime ? 0 : 1
      return
    }
    if (!runtimeResult.runtime) {
      console.error(`ERROR: could not detect runtime. Use --runtime <${orderedRuntimeNames(runtimeProfiles).join("|")}>`)
      process.exitCode = 1
      return
    }
    if (["sync", "generate", "generate:tree"].includes(explainCommand)) {
      const payload = {
        runtime: runtimeResult.runtime,
        reason: runtimeResult.reason,
        command: explainCommand,
        resolved_exec: process.execPath,
        resolved_args: [path.join("scripts", "sync-meta-agents.mjs"), "--check"],
        crewContext
      }
      if (jsonMode) {
        printDiagnosticPayload(createDiagnosticPayload("explain", {
          status: 0,
          runtime: runtimeResult.runtime,
          reason: runtimeResult.reason,
          data: { target: explainCommand, payload }
        }))
      } else {
        printExplain(traceMode, payload)
      }
      return
    }
    if (["list:crews", "use", "clear"].includes(explainCommand)) {
      const corePayload = buildCoreManagedCommandPayload(runtimeResult.runtime, explainCommand, normalizedArgv.slice(2))
      if (corePayload) {
        if (jsonMode) {
          printDiagnosticPayload(createDiagnosticPayload("explain", {
            status: 0,
            runtime: runtimeResult.runtime,
            reason: runtimeResult.reason,
            data: { target: explainCommand, payload: corePayload }
          }))
        } else {
          printExplain(traceMode, corePayload)
        }
        return
      }
    }

// --- explain delegate ---
    if (explainCommand === "delegate") {
      ;(async () => {
        const target = parseValueArg(normalizedArgv.slice(2), "--target")
        const task = parseValueArg(normalizedArgv.slice(2), "--task")
        const crew = parseValueArg(normalizedArgv.slice(2), "--crew") || process.env.MAH_ACTIVE_CREW || "dev"

        if (!target || !task) {
          if (jsonMode) {
            printDiagnosticPayload(createDiagnosticPayload("explain", {
              status: 1,
              command: "delegate",
              errors: ["--target and --task are required"]
            }))
          } else {
            console.error("ERROR: explain delegate requires --target and --task")
            console.error("Usage: mah explain delegate --target <agent> --task '<description>' [--crew <crew>] [--trace] [--json]")
          }
          process.exitCode = 1
          return
        }

        const sourceAgent = process.env.MAH_AGENT || "orchestrator"

        // Load delegation-resolution helpers (only listDelegationTargets and resolveDelegationTarget are exported)
        let listDelegationTargets
        try {
          const dr = await import("./delegation-resolution.mjs")
          listDelegationTargets = dr.listDelegationTargets
        } catch (err) {
          if (jsonMode) {
            printDiagnosticPayload(createDiagnosticPayload("explain", {
              status: 1,
              command: "delegate",
              errors: ["delegation-resolution.mjs not available: " + err.message]
            }))
          } else {
            console.error("ERROR: delegation-resolution.mjs not available — " + err.message)
          }
          process.exitCode = 1
          return
        }

        // Load meta config to get crew (crews is array, find by id)
        const crewData = readMetaConfig(repoRoot)
        const crewObj = Array.isArray(crewData?.crews)
          ? crewData.crews.find(c => c.id === crew)
          : crewData?.crews?.[crew]
        if (!crewObj) {
          if (jsonMode) {
            printDiagnosticPayload(createDiagnosticPayload("explain", {
              status: 1,
              command: "delegate",
              errors: [`crew '${crew}' not found in meta-agents.yaml`]
            }))
          } else {
            console.error(`ERROR: crew '${crew}' not found in meta-agents.yaml`)
          }
          process.exitCode = 1
          return
        }

        // Use listDelegationTargets to get role + valid targets
        const dlResult = listDelegationTargets({ crew, sourceAgent, repoRoot })
        if (!dlResult.ok) {
          if (jsonMode) {
            printDiagnosticPayload(createDiagnosticPayload("explain", {
              status: 1,
              command: "delegate",
              errors: [dlResult.error || "failed to resolve delegation targets"]
            }))
          } else {
            console.error(`ERROR: ${dlResult.error || "failed to resolve delegation targets"}`)
          }
          process.exitCode = 1
          return
        }

        const validTargets = dlResult.targets

        if (validTargets.length === 0) {
          if (jsonMode) {
            printDiagnosticPayload(createDiagnosticPayload("explain", {
              status: 0,
              command: "delegate",
              data: {
                task,
                source_agent: sourceAgent,
                routing: { candidates_count: 0, filtered_count: 0, scores: {}, selected: null, escalation: false, fallback_reason: "no_valid_targets" },
                explain: { filters_run: [], blocking: {}, scoring_summary: "no valid delegation targets for this role" }
              }
            }))
          } else {
            console.log("=== Expertise Routing Trace ===")
            console.log(`Task: "${task}"`)
            console.log(`Source: ${sourceAgent}`)
            console.log(`Candidates considered: 0 (no policy-allowed targets)`)
            console.log(`Selected: none`)
            console.log(`Escalation: YES (no valid targets)`)
            console.log(`Fallback: manual assignment required`)
          }
          process.exitCode = 0
          return
        }

        // Load expertise-routing for scoreCandidates
        let scoreCandidates
        try {
          const er = await import("./expertise-routing.mjs")
          scoreCandidates = er.scoreCandidates
        } catch (err) {
          if (jsonMode) {
            printDiagnosticPayload(createDiagnosticPayload("explain", {
              status: 1,
              command: "delegate",
              errors: ["expertise-routing.mjs not available: " + err.message]
            }))
          } else {
            console.error("ERROR: expertise-routing.mjs not available — " + err.message)
            console.error("       Run: node scripts/expertise-routing.mjs to verify the module exists.")
          }
          process.exitCode = 1
          return
        }

        // Build expertise objects from valid targets
        const candidates = validTargets.map(id => {
          const agentEntry = crewObj.topology?.agents?.[id] || crewObj.agents?.find(a => a.id === id)
          return {
            id,
            expertise: agentEntry ? {
              domains: agentEntry.domains || [],
              capabilities: agentEntry.capabilities || [],
              validation_status: agentEntry.validation_status || "declared"
            } : { domains: [], capabilities: [], validation_status: "declared" }
          }
        })

        const scoringResult = scoreCandidates({
          task,
          sourceAgent,
          candidates,
          options: { allowed_environments: ["production", "staging", "development"] }
        })

        const routingPayload = {
          candidates_count: validTargets.length,
          filtered_count: validTargets.length - Object.values(scoringResult.scores).filter(s => s.final_score > 0).length,
          scores: scoringResult.scores,
          selected: scoringResult.selected || null,
          selection_reason: scoringResult.explain?.selected_reason || "",
          escalation: scoringResult.escalation,
          fallback_reason: scoringResult.fallback_reason || null
        }

        if (jsonMode) {
          printDiagnosticPayload(createDiagnosticPayload("explain", {
            status: 0,
            command: "delegate",
            data: {
              schema_version: "mah.expertise.v1",
              task,
              source_agent: sourceAgent,
              routing: routingPayload,
              explain: {
                filters_run: scoringResult.explain?.filters_run || [],
                blocking: scoringResult.explain?.blocking || {},
                scoring_summary: scoringResult.explain?.scoring_summary || ""
              }
            }
          }))
        } else {
          // Console trace output
          console.log("=== Expertise Routing Trace ===")
          console.log(`Task: "${task}"`)
          console.log(`Source: ${sourceAgent}`)
          console.log(`Candidates considered: ${validTargets.length} (all policy/topology-allowed)`)
          console.log("")
          console.log("Filters applied:")

          for (const [id, score] of Object.entries(scoringResult.scores)) {
            if (score.blocked_filters?.length) {
              console.log(`  ✗ ${id}: blocked — ${score.blocked_filters.join(", ")}`)
            } else {
              const caps = candidates.find(c => c.id === id)?.expertise?.capabilities || []
              console.log(`  ✓ ${id}: match=${score.match_score?.toFixed(2) || "0.00"} + conf_adj=${score.confidence_adjustment != null ? score.confidence_adjustment.toFixed(2) : "0.00"} + penalty=${score.penalty != null ? score.penalty.toFixed(2) : "0.00"} → final=${score.final_score?.toFixed(2) || "0.00"}${caps.length ? ` [capabilities: ${caps.join(", ")}]` : ""}`)
            }
          }
          console.log("")
          console.log(`Selected: ${routingPayload.selected || "none"} (score=${routingPayload.selected ? scoringResult.scores[routingPayload.selected]?.final_score?.toFixed(2) || "0.00" : "n/a"})`)
          console.log(`Escalation: ${routingPayload.escalation ? "YES" : "NO"} (score ${routingPayload.escalation ? "<" : ">="} threshold)`)
          if (routingPayload.fallback_reason) {
            console.log(`Fallback: ${routingPayload.fallback_reason}`)
          }
        }
        process.exitCode = 0
      })()
      return
    }

    if (["use", "run", "clear", "list:crews", "check:runtime", "validate", "validate:runtime", "doctor"].includes(explainCommand)) {
      const passthrough = normalizedArgv.slice(2)

      // Handle headless mode for run command
      if (explainCommand === "run" && isHeadless) {
        const adapter = runtimeProfiles[runtimeResult.runtime]
        if (!adapter) {
          console.error(`ERROR: runtime '${runtimeResult.runtime}' not found`)
          process.exitCode = 1
          return
        }
        const supportsHeadless = typeof adapter.prepareHeadlessRunContext === "function"
        if (!supportsHeadless) {
          console.error(`ERROR: runtime '${runtimeResult.runtime}' does not support headless execution`)
          process.exitCode = 1
          return
        }

        // Normalize args - strip headless/output flags for passthrough
        const normalizedPassthrough = stripHeadlessArgs(passthrough)
        const normalized = normalizeRunArgs(runtimeResult.runtime, normalizedPassthrough)
        const envOverrides = { ...normalized.envOverrides }

        // Get headless execution plan from adapter
        const headlessPlan = adapter.prepareHeadlessRunContext({
          repoRoot,
          runtime: runtimeResult.runtime,
          adapter,
          task: normalized.args.join(" "),
          argv: normalized.args,
          envOverrides
        })

        if (!headlessPlan || headlessPlan.error) {
          console.error(`ERROR: ${headlessPlan?.error || "failed to prepare headless run context"}`)
          process.exitCode = 1
          return
        }

        const payload = {
          runtime: runtimeResult.runtime,
          reason: runtimeResult.reason,
          command: "run",
          mode: "headless",
          exec: headlessPlan.exec || adapter.directCli,
          execArgs: headlessPlan.args || [],
          passthrough: headlessPlan.passthrough || [],
          env: { ...envOverrides, ...(headlessPlan.envOverrides || {}) },
          warnings: headlessPlan.warnings || [],
          crewContext,
          internal: headlessPlan.internal || {}
        }
        if (jsonMode) {
          printDiagnosticPayload(createDiagnosticPayload("explain", {
            status: 0,
            runtime: runtimeResult.runtime,
            reason: runtimeResult.reason,
            data: { target: "run", mode: "headless", payload }
          }))
        } else {
          printExplain(traceMode, payload)
        }
        return
      }

      const plan = resolveDispatchPlan(runtimeResult.runtime, explainCommand, passthrough)
      if (plan.error) {
        console.error(`ERROR: ${plan.error}`)
        process.exitCode = 1
        return
      }
      const payload = {
        runtime: runtimeResult.runtime,
        reason: runtimeResult.reason,
        command: explainCommand,
        exec: plan.exec,
        execArgs: plan.args,
        passthrough: plan.passthrough || [],
        env: plan.envOverrides || {},
        warnings: plan.warnings || [],
        candidates: plan.candidates || [],
        crewContext
      }
      if (jsonMode) {
        printDiagnosticPayload(createDiagnosticPayload("explain", {
          status: 0,
          runtime: runtimeResult.runtime,
          reason: runtimeResult.reason,
          data: { target: explainCommand, payload }
        }))
      } else {
        printExplain(traceMode, payload)
      }
      return
    }
    console.error(`ERROR: unsupported explain target '${explainCommand}'`)
    process.exitCode = 1
    return
  }

  if (first === "doctor" && jsonMode) {
    const doctorFilters = parseFilterArgs(normalizedArgv.slice(1))
    const crewContext = resolveCrewExecutionContext(doctorFilters.crew)
    if (!runtimeResult.runtime) {
      printDiagnosticPayload(createDiagnosticPayload("doctor", {
        status: 1,
        reason: "no-runtime-detected",
        data: { crew_context: crewContext },
        errors: ["no-runtime-detected"]
      }))
      process.exitCode = 1
      return
    }
    const captured = dispatchCapture(runtimeResult.runtime, "check:runtime", [])
    const precheck = runtimeValidationReport(runtimeResult.runtime)
    const status = precheck.ok ? captured.status : 1
    printDiagnosticPayload(createDiagnosticPayload("doctor", {
      runtime: runtimeResult.runtime,
      reason: runtimeResult.reason,
      status,
      data: { precheck, stdout: captured.stdout.trim(), stderr: captured.stderr.trim(), crew_context: crewContext },
      errors: status === 0 ? [] : ["doctor-check-failed"]
    }))
    process.exitCode = status
    return
  }

  if (first === "validate") {
    const validateFilters = parseFilterArgs(normalizedArgv.slice(1))
    const crewContext = resolveCrewExecutionContext(validateFilters.crew)
    if (jsonMode) {
      const configCaptured = runLocalScriptCapture(path.join("scripts", "validate-meta-config.mjs"))
      if (configCaptured.status !== 0) {
        printDiagnosticPayload(createDiagnosticPayload("validate", {
          status: configCaptured.status,
          data: { config: { status: configCaptured.status, stdout: configCaptured.stdout.trim(), stderr: configCaptured.stderr.trim() }, crew_context: crewContext },
          errors: ["config-validation-failed"]
        }))
        process.exitCode = configCaptured.status
        return
      }
      if (!runtimeResult.runtime) {
        printDiagnosticPayload(createDiagnosticPayload("validate", {
          status: 1,
          reason: "no-runtime-detected",
          data: { config: { status: 0 }, runtime: { status: 1, reason: "no-runtime-detected" }, crew_context: crewContext },
          errors: ["no-runtime-detected"]
        }))
        process.exitCode = 1
        return
      }
      const runtimeCaptured = dispatchCapture(runtimeResult.runtime, "check:runtime", [])
      printDiagnosticPayload(createDiagnosticPayload("validate", {
        status: runtimeCaptured.status,
        runtime: runtimeResult.runtime,
        reason: runtimeResult.reason,
        data: {
          config: { status: 0 },
          crew_context: crewContext,
          runtime_check: {
            status: runtimeCaptured.status,
            stdout: runtimeCaptured.stdout.trim(),
            stderr: runtimeCaptured.stderr.trim()
          }
        },
        errors: runtimeCaptured.status === 0 ? [] : ["runtime-check-failed"]
      }))
      process.exitCode = runtimeCaptured.status
      return
    } else {
      const configStatus = runLocalScript(path.join("scripts", "validate-meta-config.mjs"))
      if (configStatus !== 0) {
        process.exitCode = configStatus
        return
      }
    }
  }

  if (!runtimeResult.runtime) {
    console.error(`ERROR: could not detect runtime. Use --runtime <${orderedRuntimeNames(runtimeProfiles).join("|")}>`)
    process.exitCode = 1
    return
  }

  const coreManaged = executeCoreManagedCommand(runtimeResult.runtime, first, normalizedArgv.slice(1), jsonMode)
  if (coreManaged.handled) {
    process.exitCode = coreManaged.status
    return
  }

  if (first === "doctor") {
    const doctorFilters = parseFilterArgs(normalizedArgv.slice(1))
    const crewContext = resolveCrewExecutionContext(doctorFilters.crew)
    console.log(`meta-agents-harness runtime: ${runtimeResult.runtime}`)
    console.log(`detection reason: ${runtimeResult.reason}`)
    if (crewContext?.crew_id) {
      console.log(`crew context: ${crewContext.crew_id}`)
      if (crewContext.mission) console.log(`crew mission: ${crewContext.mission}`)
      if (crewContext.sprint_mode?.name) console.log(`crew sprint: ${crewContext.sprint_mode.name}`)
    } else if (crewContext?.requested_crew && crewContext?.found === false) {
      console.log(`crew context not found: ${crewContext.requested_crew}`)
    }
    const status = dispatch(runtimeResult.runtime, "check:runtime", [])
    process.exitCode = status
    return
  }

  const command = first
  const passthrough = normalizedArgv.slice(1)

  // Check for headless mode on run command
  if (command === "run" && hasHeadlessFlag(argv)) {
    const outputMode = parseOutputMode(argv)
    const result = dispatchHeadless(runtimeResult.runtime, command, passthrough, outputMode)
    if (outputMode === "json") {
      console.log(JSON.stringify(result, null, 2))
    }
    process.exitCode = typeof result.status === "number" ? result.status : 1
    return
  }

  const status = dispatch(runtimeResult.runtime, command, passthrough)
  process.exitCode = status
}

await main()
await Promise.all([
  new Promise((resolve) => process.stdout.write("", resolve)),
  new Promise((resolve) => process.stderr.write("", resolve))
])
