import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { RUNTIME_ADAPTERS, RUNTIME_ORDER } from "./runtime-adapters.mjs"
import { validateRuntimeAdapterContract } from "./runtime-adapter-contract.mjs"
import { appendProvenance, buildCrewGraph, buildRunGraphFromProvenance, collectSessions, readMetaConfig, readProvenance } from "./m3-ops.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

const runtimeProfiles = RUNTIME_ADAPTERS

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
  }

  const byCli = Object.entries(runtimeProfiles)
    .map(([name, profile]) => ({ name, profile, status: runtimeExecutableStatus(name) }))
    .filter(({ status }) => status.directCliAvailable || status.wrapperAvailable)

  if (byCli.length > 0) {
    const selected = byCli[0]
    const source = selected.status.directCliAvailable ? selected.profile.directCli : selected.profile.wrapper
    return { runtime: selected.name, reason: `cli:${source}` }
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
  console.log("  explain [detect|use|run|sync] [args]")
  console.log("  init [--yes] [--force] [--crew <name>] [--runtime <name>]")
  console.log("  sessions [--runtime <name>] [--crew <name>] [--json]")
  console.log("  graph [--crew <name>] [--run <id>] [--json] [--mermaid] [--mermaid-level <basic|group|detailed>]")
  console.log("  demo [crew]")
  console.log("  contract:runtime")
  console.log("  check:runtime")
  console.log("  validate:runtime")
  console.log("  validate:config")
  console.log("  validate:sync")
  console.log("  validate:all")
  console.log("  validate")
  console.log("  list:crews")
  console.log("  use <crew>")
  console.log("  clear")
  console.log("  run [runtime-args]")
  console.log("  plan")
  console.log("  diff")
  console.log("")
  console.log("Options:")
  const runtimes = Object.keys(runtimeProfiles).join("|")
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

function parseFilterArgs(argv) {
  return {
    runtime: parseValueArg(argv, "--runtime", "-r"),
    crew: parseValueArg(argv, "--crew"),
    run: parseValueArg(argv, "--run"),
    json: hasFlag(argv, "--json"),
    mermaid: hasFlag(argv, "--mermaid"),
    mermaidLevel: parseValueArg(argv, "--mermaid-level"),
    mermaidCapabilities: hasFlag(argv, "--mermaid-capabilities")
  }
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

function normalizeRunArgs(runtime, passthrough) {
  const adapter = runtimeProfiles[runtime]
  const capabilities = adapter?.capabilities || {}
  const { options, remaining } = extractSessionOptions(passthrough)
  const envOverrides = {}
  const warnings = []
  const args = [...remaining]

  if (!options.mode && !options.sessionId && !options.sessionRoot && options.sessionMirror === null) {
    return { args, envOverrides, warnings }
  }

  if (options.mode && !options.mode.match(/^(new|continue|none)$/)) {
    warnings.push(`invalid --session-mode value: ${options.mode} (expected new, continue, or none)`)
  }

  if (options.mode === "none") {
    if (runtime === "pi") {
      args.unshift("--no-session")
    } else if (runtime === "claude") {
      args.unshift("--print", "--no-session-persistence")
      warnings.push("claude: --session-mode none uses --print mode (non-interactive)")
    } else if (runtime === "hermes") {
      warnings.push("hermes: --session-mode none is not supported, sessions will persist")
    } else if (runtime === "opencode") {
      warnings.push("opencode: --session-mode none is not supported, sessions will persist")
    }
    if (options.sessionId) warnings.push("--session-id is ignored with --session-mode none")
    if (options.sessionRoot) warnings.push("--session-root is ignored with --session-mode none")
    if (options.sessionMirror === true) warnings.push("--session-mirror is ignored with --session-mode none")
    return { args, envOverrides, warnings }
  }

  if (capabilities.sessionMirrorFlag === true) {
    if (options.sessionMirror === true) args.unshift("--session-mirror")
    if (options.sessionMirror === false) args.unshift("--no-session-mirror")
  }

  if (runtime === "claude") {
    const claudePassthrough = []
    if (options.mode === "continue" && capabilities.sessionModeContinue) claudePassthrough.push("--continue")
    if (options.sessionId && capabilities.sessionIdFlag) claudePassthrough.push(capabilities.sessionIdFlag, options.sessionId)
    if (claudePassthrough.length > 0) args.push("--", ...claudePassthrough)
    if (options.sessionRoot) warnings.push("--session-root is ignored for claude runtime")
  } else if (runtime === "pi") {
    if (options.mode === "new" && capabilities.sessionModeNew) args.unshift("--new-session")
    if (options.mode === "continue" && capabilities.sessionModeContinue && !hasContinueFlag(args)) args.push("-c")
    if (options.sessionRoot && capabilities.sessionRootFlag) args.unshift(capabilities.sessionRootFlag, options.sessionRoot)
    if (options.sessionId && capabilities.sessionIdViaEnv) envOverrides[capabilities.sessionIdViaEnv] = options.sessionId
    if (options.sessionMirror !== null) warnings.push("--session-mirror is ignored for pi runtime")
  } else if (runtime === "opencode") {
    if (options.mode === "continue" && capabilities.sessionModeContinue && !hasContinueFlag(args)) args.push("-c")
    if (options.sessionId && capabilities.sessionIdFlag) args.push(capabilities.sessionIdFlag, options.sessionId)
    if (options.agent) args.push("--agent", options.agent)
    if (options.hierarchy === true) args.push("--hierarchy")
    if (options.hierarchy === false) args.push("--no-hierarchy")
    if (options.sessionRoot) warnings.push("--session-root is ignored for opencode runtime")
    if (options.sessionMirror !== null) warnings.push("--session-mirror is ignored for opencode runtime")
  } else if (runtime === "hermes") {
    if (options.mode === "new" && capabilities.sessionModeNew) args.unshift("--new-session")
    if (options.mode === "continue" && capabilities.sessionModeContinue && !hasContinueFlag(args)) args.push("-c")
    if (options.sessionRoot && capabilities.sessionRootFlag) args.unshift(capabilities.sessionRootFlag, options.sessionRoot)
    if (options.sessionId && capabilities.sessionIdViaEnv) envOverrides[capabilities.sessionIdViaEnv] = options.sessionId
    if (options.sessionMirror !== null) warnings.push("--session-mirror is ignored for hermes runtime")
  }

  return { args, envOverrides, warnings }
}

function runCommand(command, args, passthrough = [], envOverrides = {}) {
  const child = spawnSync(command, [...args, ...passthrough], {
    cwd: repoRoot,
    env: { ...process.env, ...envOverrides },
    stdio: "inherit"
  })
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
  }
  const resolved = profile.resolveCommandPlan(command, commandExists)
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
}

function runInit(argv) {
  const runtime = parseValueArg(argv, "--runtime")
  const crew = parseValueArg(argv, "--crew")
  const yesFlag = argv.includes("--yes")
  const forceFlag = argv.includes("--force")
  const created = []
  const skipped = []

  const bootstrapArgs = [path.join(repoRoot, "scripts", "bootstrap-meta-agents.mjs")]
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
  const mcpExample = path.join(repoRoot, ".mcp.example.json")
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
  console.log("next=npm run sync:meta")
  return bootstrapResult.status !== null ? bootstrapResult.status : 1
}

function runSessions(argv, jsonMode = false) {
  const filters = parseFilterArgs(argv)
  if (jsonMode) filters.json = true
  const rows = collectSessions(repoRoot, { runtime: filters.runtime, crew: filters.crew })
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

function main() {
  const argv = process.argv.slice(2)
  const traceMode = hasFlag(argv, "--trace")
  const jsonMode = hasFlag(argv, "--json")
  const mermaidMode = hasFlag(argv, "--mermaid")
  const normalizedArgv = stripRuntimeArgs(removeFlag(removeFlag(removeFlag(removeFlag(argv, "--trace"), "--strict-markers"), "--json"), "--mermaid"))
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

  if (first === "init") {
    process.exitCode = runInit(normalizedArgv.slice(1))
    return
  }

  if (first === "sessions") {
    process.exitCode = runSessions(normalizedArgv.slice(1), jsonMode)
    return
  }

  if (first === "graph") {
    process.exitCode = runGraph(normalizedArgv.slice(1), jsonMode, mermaidMode)
    return
  }

  if (first === "demo") {
    process.exitCode = runDemo(normalizedArgv.slice(1))
    return
  }

  if (first === "plan" || first === "diff") {
    const modeFlag = first === "plan" ? "--plan" : "--diff"
    if (jsonMode) {
      const captured = runLocalScriptCapture(path.join("scripts", "sync-meta-agents.mjs"), [modeFlag, "--json"])
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
    process.exitCode = runLocalScript(path.join("scripts", "sync-meta-agents.mjs"), [modeFlag])
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
      const status = config.status !== 0 ? config.status : sync.status !== 0 ? sync.status : runtime.status
      let syncJson = null
      try { syncJson = JSON.parse(sync.stdout || "{}") } catch { syncJson = null }
      printDiagnosticPayload(createDiagnosticPayload("validate:all", {
        status,
        runtime: runtimeResult.runtime || "",
        reason: runtimeResult.reason,
        data: {
          checks: {
            config: { status: config.status, stdout: config.stdout.trim(), stderr: config.stderr.trim() },
            sync: { status: sync.status, report: syncJson, stdout: sync.stdout.trim(), stderr: sync.stderr.trim() },
            runtime: { status: runtime.status, stdout: runtime.stdout.trim(), stderr: runtime.stderr.trim() }
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
      console.error(`ERROR: could not detect runtime. Use --runtime <${RUNTIME_ORDER.join("|")}>`)
      process.exitCode = 1
      return
    }
    if (explainCommand === "sync") {
      const payload = {
        runtime: runtimeResult.runtime,
        reason: runtimeResult.reason,
        command: "sync",
        resolved_exec: process.execPath,
        resolved_args: [path.join("scripts", "sync-meta-agents.mjs"), "--check"],
        crewContext
      }
      if (jsonMode) {
        printDiagnosticPayload(createDiagnosticPayload("explain", {
          status: 0,
          runtime: runtimeResult.runtime,
          reason: runtimeResult.reason,
          data: { target: "sync", payload }
        }))
      } else {
        printExplain(traceMode, payload)
      }
      return
    }
    if (["use", "run", "clear", "list:crews", "check:runtime", "validate", "validate:runtime", "doctor"].includes(explainCommand)) {
      const passthrough = normalizedArgv.slice(2)
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
    console.error(`ERROR: could not detect runtime. Use --runtime <${RUNTIME_ORDER.join("|")}>`)
    process.exitCode = 1
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

  const status = dispatch(runtimeResult.runtime, command, passthrough)
  process.exitCode = status
}

main()
