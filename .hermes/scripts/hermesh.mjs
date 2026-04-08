import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const hermesRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(hermesRoot, "..")
const crewRoot = path.join(hermesRoot, "crew")
const activeCrewPath = path.join(hermesRoot, ".active-crew.json")

function printHelp() {
  console.log("Usage: hermesh <command> [args]")
  console.log("")
  console.log("Commands:")
  console.log("  hermesh list:crews [--json]")
  console.log("  hermesh use <crew>")
  console.log("  hermesh clear")
  console.log("  hermesh run [--crew <crew>] [--new-session] [--session-root <path>] [-- ...passthrough]")
  console.log("  hermesh chat [--crew <crew>] [--new-session] [--session-root <path>] [-- ...passthrough]")
  console.log("  hermesh doctor [--crew <crew>] [--json] [-- ...passthrough]")
  console.log("  hermesh check:runtime [--crew <crew>] [--json]")
}

function toPosix(targetPath) {
  return targetPath.replaceAll(path.sep, "/")
}

function rel(targetPath) {
  return toPosix(path.relative(repoRoot, targetPath))
}

function readYaml(targetPath) {
  return YAML.parse(readFileSync(targetPath, "utf-8"))
}

function readTextIfExists(targetPath) {
  if (!targetPath || !existsSync(targetPath)) return ""
  return readFileSync(targetPath, "utf-8")
}

function listCrewIds() {
  if (!existsSync(crewRoot)) return []
  return readFileSync(path.join(repoRoot, "meta-agents.yaml"), "utf-8")
    ? readYaml(path.join(repoRoot, "meta-agents.yaml")).crews.map((crew) => crew.id)
    : []
}

function listCrewRows() {
  return listCrewIds()
    .map((crewId) => {
      const configPath = path.join(crewRoot, crewId, "config.yaml")
      const multiTeamPath = path.join(crewRoot, crewId, "multi-team.yaml")
      return {
        id: crewId,
        config: rel(configPath),
        multi_team: rel(multiTeamPath),
        ready: existsSync(configPath) && existsSync(multiTeamPath)
      }
    })
}

function parseArgs(argv) {
  const passthroughIndex = argv.indexOf("--")
  const primary = passthroughIndex >= 0 ? argv.slice(0, passthroughIndex) : argv.slice()
  const passthrough = passthroughIndex >= 0 ? argv.slice(passthroughIndex + 1) : []
  const flags = new Map()
  const positionals = []
  for (let i = 0; i < primary.length; i += 1) {
    const token = primary[i]
    if (token.startsWith("--")) {
      const [rawKey, inlineValue] = token.slice(2).split("=", 2)
      if (typeof inlineValue !== "undefined") {
        flags.set(rawKey, inlineValue)
        continue
      }
      const next = primary[i + 1]
      if (next && !next.startsWith("--")) {
        flags.set(rawKey, next)
        i += 1
      } else {
        flags.set(rawKey, true)
      }
      continue
    }
    if (token.startsWith("-")) {
      flags.set(token, true)
      continue
    }
    positionals.push(token)
  }
  return { flags, positionals, passthrough, primary }
}

function forwardedArgs(parsed, internalFlags = new Set(["crew", "json"])) {
  const forwarded = []
  for (let i = 0; i < parsed.primary.length; i += 1) {
    const token = parsed.primary[i]
    if (!token.startsWith("--")) {
      forwarded.push(token)
      continue
    }
    const [flagName, inlineValue] = token.slice(2).split("=", 2)
    if (internalFlags.has(flagName)) {
      if (typeof inlineValue === "undefined") {
        const next = parsed.primary[i + 1]
        if (next && !next.startsWith("--")) i += 1
      }
      continue
    }
    forwarded.push(token)
    if (typeof inlineValue === "undefined") {
      const next = parsed.primary[i + 1]
      if (next && !next.startsWith("--")) {
        forwarded.push(next)
        i += 1
      }
    }
  }
  return [...forwarded, ...parsed.passthrough]
}

function readActiveCrew() {
  if (!existsSync(activeCrewPath)) return null
  return JSON.parse(readFileSync(activeCrewPath, "utf-8"))
}

function persistActiveCrewState(nextState) {
  mkdirSync(path.dirname(activeCrewPath), { recursive: true })
  writeFileSync(activeCrewPath, JSON.stringify(nextState, null, 2))
}

function setActiveCrewOrchestratorSession(crewId, sessionId) {
  const current = readActiveCrew() || {}
  if (`${current.crew || ""}`.trim() !== `${crewId || ""}`.trim()) return
  const next = {
    ...current,
    orchestrator_session_id: `${sessionId || ""}`.trim(),
    updated_at: new Date().toISOString()
  }
  persistActiveCrewState(next)
}

function resolveCrewId(parsed) {
  const explicit = `${parsed.flags.get("crew") || parsed.positionals.find((token) => !token.startsWith("-")) || ""}`.trim()
  if (explicit) return explicit
  const active = readActiveCrew()
  return `${active?.crew || ""}`.trim()
}

function resolveCrewConfig(crewId) {
  if (!crewId) throw new Error("No crew selected. Use hermesh use <crew> or pass --crew <crew>.")
  const configPath = path.join(crewRoot, crewId, "config.yaml")
  const multiTeamPath = path.join(crewRoot, crewId, "multi-team.yaml")
  if (!existsSync(configPath)) throw new Error(`Missing Hermes config: ${rel(configPath)}`)
  if (!existsSync(multiTeamPath)) throw new Error(`Missing Hermes multi-team config: ${rel(multiTeamPath)}`)
  return {
    crewId,
    configPath,
    multiTeamPath,
    config: readYaml(configPath)
  }
}

function writeActiveCrew(crewId) {
  const resolved = resolveCrewConfig(crewId)
  const payload = {
    runtime: "hermes",
    crew: crewId,
    config: rel(resolved.configPath),
    multi_team: rel(resolved.multiTeamPath),
    orchestrator_session_id: "",
    updated_at: new Date().toISOString()
  }
  persistActiveCrewState(payload)
  return payload
}

function hermesAvailable() {
  const probe = spawnSync("hermes", ["--help"], { cwd: repoRoot, env: process.env, encoding: "utf-8" })
  if (probe.error?.code === "ENOENT") return false
  return probe.status === 0 || probe.status === 1
}

function runHermes(args, extraEnv = {}) {
  const child = spawnSync("hermes", args, {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit"
  })
  if (child.error?.code === "ENOENT") {
    console.error("Hermes CLI not found in PATH.")
    return 1
  }
  return typeof child.status === "number" ? child.status : 1
}

function runHermesCapture(args, extraEnv = {}) {
  const child = spawnSync("hermes", args, {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    encoding: "utf-8"
  })
  return {
    status: typeof child.status === "number" ? child.status : 1,
    stdout: child.stdout || "",
    stderr: child.stderr || "",
    error: child.error || null
  }
}

function latestSessionId() {
  const probe = runHermesCapture(["sessions", "list", "--limit", "1"])
  if (probe.status !== 0) return ""
  const lines = `${probe.stdout || ""}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const candidate = lines.find((line) => /^.+\s+\S+$/.test(line) && !line.startsWith("usage:") && !line.startsWith("Preview") && !line.startsWith("─"))
  if (!candidate) return ""
  const tokens = candidate.split(/\s+/)
  return `${tokens[tokens.length - 1] || ""}`.trim()
}

function stripContinueFlags(args) {
  const out = []
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]
    if (token === "-c" || token === "--continue") continue
    out.push(token)
  }
  return out
}

function localRuntimeStatus(crewId = "") {
  const rows = listCrewRows()
  const selected = crewId ? rows.find((item) => item.id === crewId) || null : null
  const active = readActiveCrew()
  return {
    runtime: "hermes",
    wrapper: rel(path.join(hermesRoot, "bin", "hermesh")),
    active_crew: active?.crew || "",
    hermes_cli_available: hermesAvailable(),
    crews: rows,
    selected_crew: selected
  }
}

function shouldBootstrapContext(parsed) {
  const tokens = parsed.primary || []
  if ((process.env.HERMES_SESSION_ID || "").trim()) return false
  return !tokens.some((token) => {
    if (token === "-q" || token === "--query") return true
    if (token === "-r" || token === "--resume") return true
    if (token === "-c" || token === "--continue") return true
    return false
  })
}

function stripPromptFrontmatter(raw) {
  const match = `${raw || ""}`.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
  return (match?.[1] || `${raw || ""}`).trim()
}

function buildBootstrapQuery(resolved) {
  const promptPath = path.join(repoRoot, resolved.config.orchestrator?.prompt || "")
  const promptRaw = readTextIfExists(promptPath)
  const promptBody = stripPromptFrontmatter(promptRaw)
  const instructionBlock = `${resolved.config.instruction_block || ""}`.trim()
  const mission = `${resolved.config.mission || ""}`.trim()
  const sprintMode = resolved.config.sprint_mode || {}
  const tools = Array.isArray(resolved.config.orchestrator?.tools) ? resolved.config.orchestrator.tools : []
  const skills = readYaml(resolved.multiTeamPath)?.orchestrator?.skills || []
  const skillList = Array.isArray(skills) ? skills.map((item) => `- ${item}`).join("\n") : ""
  const responsibilities = Array.isArray(readYaml(resolved.multiTeamPath)?.orchestrator?.sprint_responsibilities)
    ? readYaml(resolved.multiTeamPath).orchestrator.sprint_responsibilities.map((item) => `- ${item}`).join("\n")
    : ""
  return [
    "Load the following runtime context for this session and keep it active unless the user explicitly overrides it.",
    "",
    "You are not a generic assistant in this session.",
    "You are the Meta Agents Harness crew orchestrator for the current repository.",
    "",
    `Crew: ${resolved.crewId}`,
    `Mission: ${mission || "n/a"}`,
    `Sprint: ${sprintMode.name || "n/a"}`,
    `Target release: ${sprintMode.target_release || "n/a"}`,
    "",
    "Instruction block:",
    instructionBlock || "n/a",
    "",
    "Orchestrator responsibilities:",
    responsibilities || "- n/a",
    "",
    "Expected tools in this role:",
    tools.length > 0 ? tools.map((item) => `- ${item}`).join("\n") : "- n/a",
    "",
    "Crew skills referenced by the runtime:",
    skillList || "- n/a",
    "",
    "Prompt body:",
    promptBody || "n/a",
    "",
    "Acknowledge with exactly: CONTEXT LOADED"
  ].join("\n")
}

function buildHermesEnv(resolved, sessionRootOverride = "") {
  const configuredRoot = `${sessionRootOverride || resolved.config.session_dir || `.hermes/crew/${resolved.crewId}/sessions`}`.trim()
  const sessionRoot = path.isAbsolute(configuredRoot) ? configuredRoot : path.join(repoRoot, configuredRoot)
  return {
    MAH_RUNTIME: "hermes",
    MAH_ACTIVE_CREW: resolved.crewId,
    MAH_HERMES_CONFIG: resolved.configPath,
    MAH_HERMES_MULTI_TEAM: resolved.multiTeamPath,
    MAH_HERMES_SESSION_ROOT: sessionRoot
  }
}

function main() {
  const [command = "--help", ...rest] = process.argv.slice(2)
  const parsed = parseArgs(rest)

  if (command === "--help" || command === "help") {
    printHelp()
    return
  }

  if (command === "list" || command === "list:crews") {
    const payload = { runtime: "hermes", crews: listCrewRows(), active_crew: readActiveCrew()?.crew || "" }
    if (parsed.flags.has("json")) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }
    for (const crew of payload.crews) {
      console.log(`${crew.id}${crew.ready ? "" : " (incomplete)"}`)
    }
    return
  }

  if (command === "use" || command === "use:crew") {
    const crewId = resolveCrewId(parsed)
    if (!crewId) throw new Error("Usage: hermesh use <crew>")
    const payload = writeActiveCrew(crewId)
    console.log(`Active Hermes crew: ${payload.crew}`)
    return
  }

  if (command === "clear" || command === "clear:crew") {
    rmSync(activeCrewPath, { force: true })
    console.log("Cleared active Hermes crew selection.")
    return
  }

  if (command === "check:runtime") {
    const crewId = resolveCrewId(parsed)
    const payload = localRuntimeStatus(crewId)
    const ok = payload.crews.length > 0 && (!crewId || !!payload.selected_crew)
    if (parsed.flags.has("json")) {
      console.log(JSON.stringify({ ok, ...payload }, null, 2))
    } else {
      console.log(ok ? "Hermes runtime files are available." : "Hermes runtime files are incomplete.")
    }
    process.exitCode = ok ? 0 : 1
    return
  }

  if (command === "doctor") {
    const crewId = resolveCrewId(parsed)
    const resolved = crewId ? resolveCrewConfig(crewId) : null
    if (parsed.flags.has("json")) {
      console.log(JSON.stringify({
        ok: hermesAvailable() && (!crewId || !!resolved),
        ...localRuntimeStatus(crewId),
        selected_config: resolved ? rel(resolved.configPath) : ""
      }, null, 2))
      process.exitCode = hermesAvailable() ? 0 : 1
      return
    }
    if (resolved) {
      console.log(`Hermes crew: ${resolved.crewId}`)
      console.log(`Config: ${rel(resolved.configPath)}`)
      console.log(`Multi-team: ${rel(resolved.multiTeamPath)}`)
    }
    process.exitCode = runHermes(["doctor", ...forwardedArgs(parsed)], resolved ? {
      MAH_RUNTIME: "hermes",
      MAH_ACTIVE_CREW: resolved.crewId,
      MAH_HERMES_CONFIG: resolved.configPath,
      MAH_HERMES_MULTI_TEAM: resolved.multiTeamPath
    } : { MAH_RUNTIME: "hermes" })
    return
  }

  if (command === "run" || command === "run:crew" || command === "chat") {
    const resolved = resolveCrewConfig(resolveCrewId(parsed))
    const env = buildHermesEnv(resolved, `${parsed.flags.get("session-root") || ""}`)
    let args = forwardedArgs(parsed, new Set(["crew", "json", "new-session", "session-root"]))
    const active = readActiveCrew()
    const continueRequested = args.includes("-c") || args.includes("--continue") || parsed.flags.has("-c") || parsed.flags.has("continue")
    const envSessionId = `${process.env.HERMES_SESSION_ID || ""}`.trim()
    const hasExplicitResume = args.includes("--resume") || args.includes("-r")
    if (envSessionId && !hasExplicitResume) {
      args = stripContinueFlags(args)
      args.unshift("--resume", envSessionId)
    } else if (!hasExplicitResume && continueRequested) {
      const pinnedSession = `${active?.crew === resolved.crewId ? active?.orchestrator_session_id || "" : ""}`.trim()
      if (pinnedSession) {
        args = stripContinueFlags(args)
        args.unshift("--resume", pinnedSession)
      }
    }
    if (shouldBootstrapContext(parsed)) {
      const bootstrap = runHermesCapture(["chat", "-Q", "-q", buildBootstrapQuery(resolved), ...args], env)
      if (bootstrap.error?.code === "ENOENT") {
        console.error("Hermes CLI not found in PATH.")
        process.exitCode = 1
        return
      }
      if (bootstrap.status !== 0) {
        process.stderr.write(bootstrap.stderr || bootstrap.stdout)
        process.exitCode = bootstrap.status
        return
      }
      const pinned = latestSessionId()
      if (pinned) setActiveCrewOrchestratorSession(resolved.crewId, pinned)
      process.exitCode = runHermes(["chat", "-c", ...args], env)
      return
    }
    process.exitCode = runHermes(["chat", ...args], env)
    return
  }

  throw new Error(`Unknown hermesh command: ${command}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
