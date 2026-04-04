import { existsSync } from "node:fs"
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

function dispatch(runtime, command, passthrough) {
  const profile = runtimeProfiles[runtime]
  if (!profile) {
    console.error(`ERROR: unsupported runtime ${runtime}`)
    return 1
  }
  let normalizedPassthrough = passthrough
  let envOverrides = {}

  if (command === "run") {
    const normalized = normalizeRunArgs(runtime, passthrough)
    normalizedPassthrough = normalized.args
    envOverrides = normalized.envOverrides
    for (const warning of normalized.warnings) {
      console.error(`WARN: ${warning}`)
    }
  }

  const variants = profile.commands[command]
  if (!variants || variants.length === 0) {
    if (command === "run") {
      return runCommand(profile.directCli, normalizedPassthrough, [], envOverrides)
    }
    console.error(`ERROR: command not supported for runtime ${runtime}: ${command}`)
    return 1
  }

  for (const [exec, args] of variants) {
    if (!commandExists(exec)) continue
    return runCommand(exec, args, normalizedPassthrough, envOverrides)
  }

  console.error(`ERROR: no executable found for runtime ${runtime} and command ${command}`)
  return 1
}

function main() {
  const argv = process.argv.slice(2)
  const normalizedArgv = stripRuntimeArgs(argv)
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
