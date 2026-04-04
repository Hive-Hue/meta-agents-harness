import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { RUNTIME_ADAPTERS, RUNTIME_ORDER } from "./runtime-adapters.mjs"

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
  const variants = profile.commands[command]
  if (!variants || variants.length === 0) {
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
    return { error: `command not supported for runtime ${runtime}: ${command}` }
  }
  const candidates = variants.map(([exec, args]) => ({ exec, args, exists: commandExists(exec) }))
  const selected = candidates.find((item) => item.exists)
  if (!selected) {
    return { error: `no executable found for runtime ${runtime} and command ${command}` }
  }
  return {
    runtime,
    command,
    exec: selected.exec,
    args: selected.args,
    passthrough: normalizedPassthrough,
    envOverrides,
    warnings,
    candidates
  }
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

function dispatch(runtime, command, passthrough) {
  const plan = resolveDispatchPlan(runtime, command, passthrough)
  if (plan.error) {
    console.error(`ERROR: ${plan.error}`)
    return 1
  }
  for (const warning of plan.warnings || []) {
    console.error(`WARN: ${warning}`)
  }
  return runCommand(plan.exec, plan.args, plan.passthrough || [], plan.envOverrides || {})
}

function main() {
  const argv = process.argv.slice(2)
  const traceMode = hasFlag(argv, "--trace")
  const normalizedArgv = stripRuntimeArgs(removeFlag(removeFlag(argv, "--trace"), "--strict-markers"))
  const first = normalizedArgv[0]

  if (!first || first === "--help" || first === "-h" || first === "help") {
    printHelp()
    return
  }

  const forcedRuntime = parseRuntimeArg(argv)
  const runtimeResult = detectRuntime(repoRoot, forcedRuntime)

  if (first === "detect") {
    if (!runtimeResult.runtime) {
      console.log("runtime=unknown")
      process.exitCode = 1
      return
    }
    console.log(`runtime=${runtimeResult.runtime}`)
    console.log(`reason=${runtimeResult.reason}`)
    return
  }

  if (first === "init") {
    process.exitCode = runInit(normalizedArgv.slice(1))
    return
  }

  if (first === "plan" || first === "diff") {
    process.exitCode = runLocalScript(path.join("scripts", "sync-meta-agents.mjs"), ["--check"])
    return
  }

  if (first === "validate:config") {
    process.exitCode = runLocalScript(path.join("scripts", "validate-meta-config.mjs"))
    return
  }

  if (first === "validate:sync") {
    process.exitCode = runLocalScript(path.join("scripts", "sync-meta-agents.mjs"), ["--check"])
    return
  }

  if (first === "validate:all") {
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

  if (first === "validate") {
    const configStatus = runLocalScript(path.join("scripts", "validate-meta-config.mjs"))
    if (configStatus !== 0) {
      process.exitCode = configStatus
      return
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
