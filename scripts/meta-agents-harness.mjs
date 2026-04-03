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
      "list:crews": [["pimh", ["list:crews"]], ["npm", ["--prefix", ".pi", "run", "list:crews"]]],
      use: [["pimh", ["use"]], ["npm", ["--prefix", ".pi", "run", "use:crew", "--"]]],
      clear: [["pimh", ["clear"]], ["npm", ["--prefix", ".pi", "run", "clear:crew"]]],
      run: [["pimh", ["run"]], ["npm", ["--prefix", ".pi", "run", "run:crew", "--"]]],
      doctor: [["pimh", ["doctor"]], ["npm", ["--prefix", ".pi", "run", "doctor", "--"]]],
      "check:runtime": [["pimh", ["check:runtime"]], ["npm", ["--prefix", ".pi", "run", "check:runtime"]]],
      validate: [["pimh", ["check:runtime"]], ["npm", ["--prefix", ".pi", "run", "check:runtime"]]]
    }
  },
  claude: {
    markerDir: ".claude",
    wrapper: "ccmh",
    directCli: "claude",
    commands: {
      "list:crews": [["ccmh", ["list:crews"]]],
      use: [["ccmh", ["use"]]],
      clear: [["ccmh", ["clear"]]],
      run: [["ccmh", ["run"]]],
      doctor: [["ccmh", ["doctor"]], ["npm", ["--prefix", ".claude", "run", "doctor", "--"]]],
      "check:runtime": [["ccmh", ["check:runtime"]], ["npm", ["--prefix", ".claude", "run", "check:runtime"]]],
      validate: [["ccmh", ["check:runtime"]], ["npm", ["--prefix", ".claude", "run", "check:runtime"]]]
    }
  },
  opencode: {
    markerDir: ".opencode",
    wrapper: "ocmh",
    directCli: "opencode",
    commands: {
      "list:crews": [["ocmh", ["list:crews"]]],
      use: [["ocmh", ["use"]]],
      clear: [["ocmh", ["clear"]]],
      run: [["opencode", []]],
      doctor: [["ocmh", ["doctor"]], ["npm", ["--prefix", ".opencode", "run", "validate:multi-team"]]],
      "check:runtime": [["ocmh", ["check:runtime"]], ["npm", ["--prefix", ".opencode", "run", "validate:multi-team"]]],
      validate: [["ocmh", ["validate"]], ["npm", ["--prefix", ".opencode", "run", "validate:multi-team"]]]
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
}

function runCommand(command, args, passthrough = []) {
  const child = spawnSync(command, [...args, ...passthrough], {
    cwd: repoRoot,
    env: process.env,
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
  const variants = profile.commands[command]
  if (!variants || variants.length === 0) {
    if (command === "run") {
      return runCommand(profile.directCli, passthrough)
    }
    console.error(`ERROR: command not supported for runtime ${runtime}: ${command}`)
    return 1
  }

  for (const [exec, args] of variants) {
    if (!commandExists(exec)) continue
    return runCommand(exec, args, passthrough)
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
