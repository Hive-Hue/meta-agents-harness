import { copyFileSync, existsSync, mkdirSync } from "node:fs"
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
  console.log("  init [--runtime <name>] [--crew <name>]")
  console.log("  sessions [--runtime <name>] [--crew <name>] [--json]")
  console.log("  graph [--crew <name>] [--run <id>] [--json]")
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
  console.log("  --crew <name>")
  console.log("  --run <id>")
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
    json: hasFlag(argv, "--json")
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
    sessionMirror: null
  }
  const remaining = []

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === "--session-mode" && argv[i + 1]) {
      options.mode = argv[i + 1]
      i += 1
      continue
    }
    if (token.startsWith("--session-mode=")) {
      options.mode = token.slice("--session-mode=".length)
      continue
    }
    if (token === "--session-id" && argv[i + 1]) {
      options.sessionId = argv[i + 1]
      i += 1
      continue
    }
    if (token.startsWith("--session-id=")) {
      options.sessionId = token.slice("--session-id=".length)
      continue
    }
    if (token === "--session-root" && argv[i + 1]) {
      options.sessionRoot = argv[i + 1]
      i += 1
      continue
    }
    if (token.startsWith("--session-root=")) {
      options.sessionRoot = token.slice("--session-root=".length)
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
    remaining.push(token)
  }

  return { options, remaining }
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
    if (options.sessionRoot) warnings.push("--session-root is ignored for opencode runtime")
    if (options.sessionMirror !== null) warnings.push("--session-mirror is ignored for opencode runtime")
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
}

function runInit(argv) {
  const runtime = parseValueArg(argv, "--runtime")
  const crew = parseValueArg(argv, "--crew")
  const created = []
  const skipped = []
  const metaTarget = path.join(repoRoot, "meta-agents.yaml")
  const metaExample = path.join(repoRoot, "examples", "meta-agents.yaml.example")
  if (!existsSync(metaTarget) && existsSync(metaExample)) {
    copyFileSync(metaExample, metaTarget)
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
  return 0
}

function runSessions(argv) {
  const filters = parseFilterArgs(argv)
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

function runGraph(argv) {
  const filters = parseFilterArgs(argv)
  const meta = readMetaConfig(repoRoot)
  const topology = buildCrewGraph(meta, filters.crew)
  const provenance = readProvenance(repoRoot, { run: filters.run, limit: 1000 })
  const runGraph = buildRunGraphFromProvenance(provenance, { run: filters.run })
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
  const normalizedArgv = stripRuntimeArgs(removeFlag(removeFlag(removeFlag(argv, "--trace"), "--strict-markers"), "--json"))
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
        console.log(JSON.stringify({ runtime: "unknown", reason: runtimeResult.reason }, null, 2))
      } else {
        console.log("runtime=unknown")
      }
      process.exitCode = 1
      return
    }
    if (jsonMode) {
      console.log(JSON.stringify({ runtime: runtimeResult.runtime, reason: runtimeResult.reason }, null, 2))
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
    process.exitCode = runSessions(normalizedArgv.slice(1))
    return
  }

  if (first === "graph") {
    process.exitCode = runGraph(normalizedArgv.slice(1))
    return
  }

  if (first === "demo") {
    process.exitCode = runDemo(normalizedArgv.slice(1))
    return
  }

  if (first === "plan" || first === "diff") {
    const modeFlag = first === "plan" ? "--plan" : "--diff"
    process.exitCode = runLocalScript(path.join("scripts", "sync-meta-agents.mjs"), jsonMode ? [modeFlag, "--json"] : [modeFlag])
    return
  }

  if (first === "validate:config") {
    if (jsonMode) {
      const captured = runLocalScriptCapture(path.join("scripts", "validate-meta-config.mjs"))
      console.log(JSON.stringify({
        command: "validate:config",
        status: captured.status,
        ok: captured.status === 0,
        stdout: captured.stdout.trim(),
        stderr: captured.stderr.trim()
      }, null, 2))
      process.exitCode = captured.status
      return
    }
    process.exitCode = runLocalScript(path.join("scripts", "validate-meta-config.mjs"))
    return
  }

  if (first === "validate:sync") {
    if (jsonMode) {
      const captured = runLocalScriptCapture(path.join("scripts", "sync-meta-agents.mjs"), ["--check", "--json"])
      process.stdout.write(captured.stdout)
      if (captured.stderr.trim()) process.stderr.write(captured.stderr)
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
      console.log(JSON.stringify({
        command: "validate:runtime",
        runtime: runtimeResult.runtime,
        reason: runtimeResult.reason,
        status: precheck.ok ? captured.status : 1,
        ok: precheck.ok && captured.status === 0,
        precheck,
        stdout: captured.stdout.trim(),
        stderr: captured.stderr.trim()
      }, null, 2))
      process.exitCode = precheck.ok ? captured.status : 1
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
      console.log(JSON.stringify({
        command: "validate:all",
        status,
        ok: status === 0,
        runtime: runtimeResult.runtime || "",
        reason: runtimeResult.reason,
        checks: {
          config: { status: config.status, stdout: config.stdout.trim(), stderr: config.stderr.trim() },
          sync: { status: sync.status, report: syncJson, stdout: sync.stdout.trim(), stderr: sync.stderr.trim() },
          runtime: { status: runtime.status, stdout: runtime.stdout.trim(), stderr: runtime.stderr.trim() }
        }
      }, null, 2))
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
    if (explainCommand === "detect") {
      printExplain(traceMode, { runtime: runtimeResult.runtime, reason: runtimeResult.reason, command: "detect" })
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
        resolved_args: [path.join("scripts", "sync-meta-agents.mjs"), "--check"]
      }
      printExplain(traceMode, payload)
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
        candidates: plan.candidates || []
      }
      printExplain(traceMode, payload)
      return
    }
    console.error(`ERROR: unsupported explain target '${explainCommand}'`)
    process.exitCode = 1
    return
  }

  if (first === "doctor" && jsonMode) {
    if (!runtimeResult.runtime) {
      console.log(JSON.stringify({ command: "doctor", ok: false, reason: "no-runtime-detected", status: 1 }, null, 2))
      process.exitCode = 1
      return
    }
    const captured = dispatchCapture(runtimeResult.runtime, "check:runtime", [])
    const precheck = runtimeValidationReport(runtimeResult.runtime)
    console.log(JSON.stringify({
      command: "doctor",
      runtime: runtimeResult.runtime,
      reason: runtimeResult.reason,
      status: precheck.ok ? captured.status : 1,
      ok: precheck.ok && captured.status === 0,
      precheck,
      stdout: captured.stdout.trim(),
      stderr: captured.stderr.trim()
    }, null, 2))
    process.exitCode = precheck.ok ? captured.status : 1
    return
  }

  if (first === "validate") {
    if (jsonMode) {
      const configCaptured = runLocalScriptCapture(path.join("scripts", "validate-meta-config.mjs"))
      if (configCaptured.status !== 0) {
        console.log(JSON.stringify({
          command: "validate",
          status: configCaptured.status,
          ok: false,
          config: { status: configCaptured.status, stdout: configCaptured.stdout.trim(), stderr: configCaptured.stderr.trim() }
        }, null, 2))
        process.exitCode = configCaptured.status
        return
      }
      if (!runtimeResult.runtime) {
        console.log(JSON.stringify({
          command: "validate",
          status: 1,
          ok: false,
          config: { status: 0 },
          runtime: { status: 1, reason: "no-runtime-detected" }
        }, null, 2))
        process.exitCode = 1
        return
      }
      const runtimeCaptured = dispatchCapture(runtimeResult.runtime, "check:runtime", [])
      console.log(JSON.stringify({
        command: "validate",
        status: runtimeCaptured.status,
        ok: runtimeCaptured.status === 0,
        runtime: runtimeResult.runtime,
        reason: runtimeResult.reason,
        config: { status: 0 },
        runtime_check: {
          status: runtimeCaptured.status,
          stdout: runtimeCaptured.stdout.trim(),
          stderr: runtimeCaptured.stderr.trim()
        }
      }, null, 2))
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
    console.log(`meta-agents-harness runtime: ${runtimeResult.runtime}`)
    console.log(`detection reason: ${runtimeResult.reason}`)
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
