import { existsSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

const runtimeProfiles = {
  pi: {
    markerDir: ".pi",
    wrapper: "pimh",
    directCli: "pi",
    commands: {
      "list:crews": [["node", [".pi/bin/pimh", "list:crews"]], ["pimh", ["list:crews"]], ["npm", ["--prefix", ".pi", "run", "list:crews"]]],
      use: [["node", [".pi/bin/pimh", "use"]], ["pimh", ["use"]], ["npm", ["--prefix", ".pi", "run", "use:crew", "--"]]],
      clear: [["node", [".pi/bin/pimh", "clear"]], ["pimh", ["clear"]], ["npm", ["--prefix", ".pi", "run", "clear:crew"]]],
      run: [["node", [".pi/bin/pimh", "run"]], ["pimh", ["run"]], ["npm", ["--prefix", ".pi", "run", "run:crew", "--"]]],
      doctor: [["node", [".pi/bin/pimh", "doctor"]], ["pimh", ["doctor"]], ["npm", ["--prefix", ".pi", "run", "doctor", "--"]]],
      "check:runtime": [["node", [".pi/bin/pimh", "check:runtime"]], ["pimh", ["check:runtime"]], ["npm", ["--prefix", ".pi", "run", "check:runtime"]]],
      validate: [["node", [".pi/bin/pimh", "check:runtime"]], ["pimh", ["check:runtime"]], ["npm", ["--prefix", ".pi", "run", "check:runtime"]]]
    }
  },
  claude: {
    markerDir: ".claude",
    wrapper: "ccmh",
    directCli: "claude",
    commands: {
      "list:crews": [["node", [".claude/bin/ccmh", "list:crews"]], ["ccmh", ["list:crews"]], ["npm", ["--prefix", ".claude", "run", "list:crews"]]],
      use: [["node", [".claude/bin/ccmh", "use"]], ["ccmh", ["use"]], ["npm", ["--prefix", ".claude", "run", "use:crew", "--"]]],
      clear: [["node", [".claude/bin/ccmh", "clear"]], ["ccmh", ["clear"]], ["npm", ["--prefix", ".claude", "run", "clear:crew"]]],
      run: [["node", [".claude/bin/ccmh", "run"]], ["ccmh", ["run"]], ["npm", ["--prefix", ".claude", "run", "run:crew", "--"]]],
      doctor: [["node", [".claude/bin/ccmh", "doctor"]], ["ccmh", ["doctor"]], ["npm", ["--prefix", ".claude", "run", "doctor", "--"]]],
      "check:runtime": [["node", [".claude/bin/ccmh", "check:runtime"]], ["ccmh", ["check:runtime"]], ["npm", ["--prefix", ".claude", "run", "check:runtime"]]],
      validate: [["node", [".claude/bin/ccmh", "check:runtime"]], ["ccmh", ["check:runtime"]], ["npm", ["--prefix", ".claude", "run", "check:runtime"]]]
    }
  },
  opencode: {
    markerDir: ".opencode",
    wrapper: "ocmh",
    directCli: "opencode",
    commands: {
      "list:crews": [["node", [".opencode/bin/ocmh", "list:crews"]], ["ocmh", ["list:crews"]], ["npm", ["--prefix", ".opencode", "run", "list:crews"]]],
      use: [["node", [".opencode/bin/ocmh", "use"]], ["ocmh", ["use"]], ["npm", ["--prefix", ".opencode", "run", "use:crew", "--"]]],
      clear: [["node", [".opencode/bin/ocmh", "clear"]], ["ocmh", ["clear"]], ["npm", ["--prefix", ".opencode", "run", "clear:crew"]]],
      run: [["node", [".opencode/bin/ocmh", "run"]], ["ocmh", ["run"]], ["npm", ["--prefix", ".opencode", "run", "run:crew", "--"]]],
      doctor: [["node", [".opencode/bin/ocmh", "doctor"]], ["ocmh", ["doctor"]], ["npm", ["--prefix", ".opencode", "run", "doctor", "--"]]],
      "check:runtime": [["node", [".opencode/bin/ocmh", "check:runtime"]], ["ocmh", ["check:runtime"]], ["npm", ["--prefix", ".opencode", "run", "check:runtime"]]],
      validate: [["node", [".opencode/bin/ocmh", "check:runtime"]], ["ocmh", ["check:runtime"]], ["npm", ["--prefix", ".opencode", "run", "check:runtime"]]]
    }
  }
}

function commandExists(command) {
  const probe = spawnSync("bash", ["-lc", `command -v ${command} >/dev/null 2>&1`], {
    cwd: repoRoot,
    env: process.env
  })
  return probe.status === 0
}

function runtimeExecutableStatus(profile) {
  const directCliAvailable = commandExists(profile.directCli)
  const wrapperAvailable = commandExists(profile.wrapper)
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
    const preferred = ["pi", "claude", "opencode"].find((name) => byMarker.includes(name))
    if (preferred) return { runtime: preferred, reason: `markers:${byMarker.join(",")}` }
  }

  const byCli = Object.entries(runtimeProfiles)
    .map(([name, profile]) => ({ name, profile, status: runtimeExecutableStatus(profile) }))
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
  console.log("  validate")
  console.log("  list:crews")
  console.log("  use <crew>")
  console.log("  clear")
  console.log("  run [runtime-args]")
  console.log("")
  console.log("Options:")
  console.log("  --runtime <pi|claude|opencode>")
  console.log("  -r <pi|claude|opencode>")
  console.log("  -f <pi|claude|opencode>")
  console.log("  --session-mode <new|continue>")
  console.log("  --session-id <id>")
  console.log("  --session-root <path>")
  console.log("  --session-mirror / --no-session-mirror")
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
  const { options, remaining } = extractSessionOptions(passthrough)
  const envOverrides = {}
  const warnings = []
  const args = [...remaining]

  if (!options.mode && !options.sessionId && !options.sessionRoot && options.sessionMirror === null) {
    return { args, envOverrides, warnings }
  }

  if (runtime === "claude") {
    if (options.sessionMirror === true) args.unshift("--session-mirror")
    if (options.sessionMirror === false) args.unshift("--no-session-mirror")
    const claudePassthrough = []
    if (options.mode === "continue") claudePassthrough.push("--continue")
    if (options.sessionId) claudePassthrough.push("--session-id", options.sessionId)
    if (claudePassthrough.length > 0) args.push("--", ...claudePassthrough)
    if (options.sessionRoot) warnings.push("--session-root is ignored for claude runtime")
  } else if (runtime === "pi") {
    if (options.mode === "new") args.unshift("--new-session")
    if (options.mode === "continue" && !hasContinueFlag(args)) args.push("-c")
    if (options.sessionRoot) args.unshift("--session-root", options.sessionRoot)
    if (options.sessionId) envOverrides.PI_MULTI_SESSION_ID = options.sessionId
    if (options.sessionMirror !== null) warnings.push("--session-mirror is ignored for pi runtime")
  } else if (runtime === "opencode") {
    if (options.mode === "continue" && !hasContinueFlag(args)) args.push("-c")
    if (options.sessionId) args.push("--session-id", options.sessionId)
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

  if (!runtimeResult.runtime) {
    console.error("ERROR: could not detect runtime. Use --runtime <pi|claude|opencode>")
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
