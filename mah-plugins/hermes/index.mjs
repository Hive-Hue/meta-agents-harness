/**
 * runtime-hermes — Hermes runtime plugin.
 *
 * Integrates the Hermes CLI with the MAH core.
 * MAH core manages crew state; this plugin provides prepareRunContext and
 * executePreparedRun that handle session bootstrapping, persistence, and
 * multi-backend execution context injection.
 *
 * Plugin source: plugins/runtime-hermes/
 * Install target: mah-plugins/hermes/  (via mah plugins install)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

function variantPathExists(candidatePath) {
  if (!candidatePath || typeof candidatePath !== "string") return false
  const absolutePath = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(process.cwd(), candidatePath)
  return existsSync(absolutePath)
}

function variantExecutableAvailable(exec, args, commandExistsFn) {
  if (!commandExistsFn(exec)) return false
  if (exec === "node") return variantPathExists(args?.[0])
  if (exec === "npm") {
    const prefixIndex = Array.isArray(args) ? args.indexOf("--prefix") : -1
    if (prefixIndex === -1 || !args?.[prefixIndex + 1]) return true
    return variantPathExists(args[prefixIndex + 1]) && variantPathExists(path.join(args[prefixIndex + 1], "package.json"))
  }
  return true
}

// --- Hermes-specific helpers (inlined from runtime-core-integrations.mjs) ---

function toPosix(t) { return `${t || ""}`.replaceAll(path.sep, "/") }
function rel(repoRoot, targetPath) { return toPosix(path.relative(repoRoot, targetPath)) }

function resolveFromRepo(repoRoot, targetPath) {
  if (!targetPath) return ""
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(repoRoot, targetPath)
}

function readYaml(targetPath) {
  const YAML = require("yaml")
  return YAML.parse(readFileSync(targetPath, "utf8"))
}

function safeReadText(targetPath) {
  if (!targetPath || !existsSync(targetPath)) return ""
  try { return readFileSync(targetPath, "utf8") } catch { return "" }
}

function stripFrontmatter(raw) {
  const match = `${raw || ""}`.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/)
  return match ? match[1].trim() : `${raw || ""}`.trim()
}

function removeIfExists(targetPath) {
  if (!existsSync(targetPath)) return
  const { lstatSync, rmSync: rm } = require("node:fs")
  const stat = lstatSync(targetPath)
  if (stat.isDirectory() && !stat.isSymbolicLink()) { rm(targetPath, { recursive: true, force: true }); return }
  rm(targetPath, { force: true })
}

function writeJson(targetPath, payload) {
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

function readJson(targetPath) {
  if (!existsSync(targetPath)) return null
  try { return JSON.parse(readFileSync(targetPath, "utf8")) } catch { return null }
}

function parseInlineFlag(argv, flagName) {
  const collected = []
  const remaining = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === flagName && argv[i + 1]) { collected.push(argv[i + 1]); i += 1; continue }
    if (token.startsWith(`${flagName}=`)) { collected.push(token.slice(flagName.length + 1)); continue }
    remaining.push(token)
  }
  return { values: collected.filter(Boolean), remaining }
}

function stripFlags(argv, flags) {
  const flagSet = new Set(flags)
  return argv.filter((token) => !flagSet.has(token))
}

function hasContinueLikeFlag(argv = []) {
  return argv.includes("-c") || argv.includes("--continue") || argv.includes("--resume") || argv.includes("-r")
}

function stripContinueFlags(argv = []) {
  return argv.filter((token) => token !== "-c" && token !== "--continue")
}

function latestHermesSessionId(repoRoot, envOverrides = {}) {
  const probe = spawnSync("hermes", ["sessions", "list", "--limit", "1"], {
    cwd: repoRoot,
    env: { ...process.env, ...envOverrides },
    encoding: "utf8"
  })
  if (probe.status !== 0) return ""
  const lines = `${probe.stdout || ""}`.split("\n").map((line) => line.trim()).filter(Boolean)
  const candidate = lines.find((line) => /^.+\s+\S+$/.test(line) && !line.startsWith("usage:") && !line.startsWith("Preview") && !line.startsWith("─"))
  if (!candidate) return ""
  const tokens = candidate.split(/\s+/)
  return `${tokens[tokens.length - 1] || ""}`.trim()
}

function buildHermesBootstrapQuery(repoRoot, configPath, multiTeamPath) {
  const config = readYaml(configPath)
  const multiTeam = readYaml(multiTeamPath)
  const orchestratorPromptPath = resolveFromRepo(repoRoot, config?.orchestrator?.prompt || "")
  const orchestratorPromptBody = stripFrontmatter(safeReadText(orchestratorPromptPath))
  const responsibilities = Array.isArray(multiTeam?.orchestrator?.sprint_responsibilities)
    ? multiTeam.orchestrator.sprint_responsibilities.map((item) => `- ${item}`).join("\n")
    : "- n/a"
  return [
    "Load the following runtime context for this session and keep it active unless the user explicitly overrides it.",
    "",
    "You are not a generic assistant in this session.",
    "You are the Meta Agents Harness crew orchestrator for the current repository.",
    "",
    `Crew: ${config?.crew || ""}`,
    `Mission: ${config?.mission || "n/a"}`,
    `Sprint: ${config?.sprint_mode?.name || "n/a"}`,
    `Target release: ${config?.sprint_mode?.target_release || "n/a"}`,
    "",
    "Instruction block:",
    `${config?.instruction_block || ""}`.trim() || "n/a",
    "",
    "Orchestrator responsibilities:",
    responsibilities,
    "",
    "Prompt body:",
    orchestratorPromptBody || "n/a",
    "",
    "Acknowledge with exactly: CONTEXT LOADED"
  ].join("\n")
}

function shouldBootstrapHermes(args = [], envOverrides = {}) {
  const sessionId = `${envOverrides.HERMES_SESSION_ID || process.env.HERMES_SESSION_ID || ""}`.trim()
  if (sessionId) return false
  return !args.some((token) => {
    return token === "-q" || token === "--query" || token === "-r" || token === "--resume" || token === "-c" || token === "--continue"
  })
}

export const runtimePlugin = {
  name: "hermes",
  version: "1.0.0",
  mahVersion: "^0.5.0",

  adapter: {
    name: "hermes",
    markerDir: ".hermes",
    configPattern: ".hermes/crew/<crew>/config.yaml",
    wrapper: null,
    directCli: "hermes",

    capabilities: {
      sessionModeNew: true,
      sessionModeContinue: true,
      sessionModeNone: false,
      sessionIdViaEnv: "HERMES_SESSION_ID",
      sessionRootFlag: "--session-root",
      sessionMirrorFlag: false,
      sessionNewArgs: ["--new-session"],
      sessionContinueArgs: ["-c"],
      persistentMemory: true,
      supportsBackgroundOperation: true,
      supportsMultiBackendExecution: true,
      gatewayAware: true
    },

    supportsSessions: true,
    sessionListCommand: null,
    sessionExportCommand: null,
    sessionDeleteCommand: null,
    supportsSessionNew: true,

    commands: {
      doctor: [["hermes", ["doctor"]]],
      "check:runtime": [["hermes", ["doctor"]]],
      validate: [["hermes", ["doctor"]]],
      "validate:runtime": [["hermes", ["doctor"]]]
    },

    detect(cwd, existsFn) {
      return existsFn(`${cwd}/${this.markerDir}`)
    },

    supports(command) {
      if (command === "run" && typeof this.prepareRunContext === "function") return true
      if (["list:crews", "use", "clear"].includes(command)) return true
      return Array.isArray(this.commands?.[command]) && this.commands[command].length > 0
    },

    prepareRunContext({ repoRoot, crew, configPath, argv = [], envOverrides = {} }) {
      if (!crew || !configPath) {
        return { ok: false, error: "no Hermes crew selected. Run 'mah use <crew>' or pass '--crew <crew>'." }
      }

      const config = readYaml(configPath)
      const sessionRootParse = parseInlineFlag(argv, "--session-root")
      let remaining = sessionRootParse.remaining
      const newSessionRequested = remaining.includes("--new-session")
      remaining = stripFlags(remaining, ["--new-session"])

      const configuredSessionRoot = `${sessionRootParse.values.at(-1) || config?.session_dir || `.hermes/crew/${crew}/sessions`}`.trim()
      const sessionRoot = resolveFromRepo(repoRoot, configuredSessionRoot)
      const multiTeamPath = resolveFromRepo(repoRoot, config?.multi_team || `.hermes/crew/${crew}/multi-team.yaml`)

      return {
        ok: true,
        exec: this.directCli,
        args: ["chat"],
        passthrough: remaining,
        envOverrides: {
          ...envOverrides,
          MAH_RUNTIME: "hermes",
          MAH_ACTIVE_CREW: crew,
          MAH_HERMES_CONFIG: configPath,
          MAH_HERMES_MULTI_TEAM: multiTeamPath,
          MAH_HERMES_SESSION_ROOT: sessionRoot
        },
        warnings: [],
        internal: {
          crew, configPath, multiTeamPath, sessionRoot, newSessionRequested
        }
      }
    },

    activateCrew({ repoRoot, crewId }) {
      const runtimeRoot = path.join(repoRoot, ".hermes")
      const configPath = path.join(runtimeRoot, "crew", crewId, "config.yaml")
      const multiTeamPath = path.join(runtimeRoot, "crew", crewId, "multi-team.yaml")
      const payload = {
        runtime: "hermes",
        crew: crewId,
        config: rel(repoRoot, configPath),
        source_config: rel(repoRoot, configPath),
        multi_team: rel(repoRoot, multiTeamPath),
        orchestrator_session_id: "",
        updated_at: new Date().toISOString()
      }
      writeJson(path.join(runtimeRoot, ".active-crew.json"), payload)
      return payload
    },

    clearCrewState({ repoRoot }) {
      removeIfExists(path.join(repoRoot, ".hermes", ".active-crew.json"))
      return true
    },

    executePreparedRun({ repoRoot, runtime, adapter, plan, runCommand }) {
      const internal = plan.internal || {}
      const currentActive = readJson(path.join(repoRoot, ".hermes", ".active-crew.json"))

      if (internal.crew && `${currentActive?.crew || ""}`.trim() !== `${internal.crew || ""}`.trim()) {
        this.activateCrew({ repoRoot, crewId: internal.crew })
      }

      let args = [...(plan.passthrough || [])]
      const envOverrides = { ...(plan.envOverrides || {}) }
      const explicitSessionId = `${envOverrides.HERMES_SESSION_ID || process.env.HERMES_SESSION_ID || ""}`.trim()
      const continueRequested = hasContinueLikeFlag(args)
      const hasExplicitResume = args.includes("--resume") || args.includes("-r")

      if (explicitSessionId && !hasExplicitResume) {
        args = stripContinueFlags(args)
        args.unshift("--resume", explicitSessionId)
      } else if (!hasExplicitResume && continueRequested) {
        const pinnedSession = `${currentActive?.crew === internal.crew ? currentActive?.orchestrator_session_id || "" : ""}`.trim()
        if (pinnedSession) {
          args = stripContinueFlags(args)
          args.unshift("--resume", pinnedSession)
        }
      }

      if (shouldBootstrapHermes(args, envOverrides)) {
        const bootstrapQuery = buildHermesBootstrapQuery(repoRoot, internal.configPath, internal.multiTeamPath)
        const bootstrap = spawnSync("hermes", ["chat", "-Q", "-q", bootstrapQuery, ...args], {
          cwd: repoRoot,
          env: { ...process.env, ...envOverrides },
          encoding: "utf8"
        })
        if (bootstrap.error?.code === "ENOENT") {
          console.error("Hermes CLI not found in PATH.")
          return 1
        }
        if (bootstrap.status !== 0) {
          process.stderr.write(bootstrap.stderr || bootstrap.stdout || "")
          return typeof bootstrap.status === "number" ? bootstrap.status : 1
        }
        const pinnedSessionId = latestHermesSessionId(repoRoot, envOverrides)
        if (pinnedSessionId) {
          const current = readJson(path.join(repoRoot, ".hermes", ".active-crew.json")) || {}
          writeJson(path.join(repoRoot, ".hermes", ".active-crew.json"), {
            ...current,
            crew: internal.crew,
            config: rel(repoRoot, internal.configPath),
            source_config: rel(repoRoot, internal.configPath),
            multi_team: rel(repoRoot, internal.multiTeamPath),
            orchestrator_session_id: pinnedSessionId,
            updated_at: new Date().toISOString()
          })
        }
        return runCommand(plan.exec, plan.args || [], ["-c", ...args], envOverrides)
      }

      return runCommand(plan.exec, plan.args || [], args, envOverrides)
    },

    resolveCommandPlan(command, commandExistsFn, passthroughArgs = []) {
      const variants = this.commands?.[command] || []
      if (variants.length === 0) return { ok: false, error: `command not supported: ${command}`, variants: [] }
      const candidates = variants.map(([exec, args]) => ({
        exec, args,
        exists: commandExistsFn(exec),
        usable: variantExecutableAvailable(exec, args, commandExistsFn)
      }))
      const selected = candidates.find((item) => item.usable)
      if (!selected) return { ok: false, error: `no executable available for ${command}`, variants: candidates }
      return { ok: true, exec: selected.exec, args: selected.args, variants: candidates }
    },

    validateRuntime(commandExistsFn) {
      const hasRuntimeEntrypoint = Boolean(this.wrapper) || Boolean(this.directCli)
      const checks = [
        { name: "marker_dir", ok: Boolean(this.markerDir) },
        { name: "wrapper_declared", ok: Boolean(this.wrapper) },
        { name: "direct_cli_declared", ok: Boolean(this.directCli) },
        { name: "runtime_entrypoint_declared", ok: hasRuntimeEntrypoint },
        { name: "wrapper_available", ok: Boolean(this.wrapper) ? commandExistsFn(this.wrapper) : false },
        { name: "direct_cli_available", ok: Boolean(this.directCli) ? commandExistsFn(this.directCli) : false }
      ]
      const hasCommandTable = Object.keys(this.commands || {}).length > 0
      checks.push({ name: "commands_declared", ok: hasCommandTable })
      const ok = checks.every((item) => item.ok || item.name === "wrapper_declared" || item.name.endsWith("_available"))
      return { ok, checks }
    }
  },

  init(ctx) {
    if (process.env.MAH_DEBUG_PLUGINS === "1") console.log(`[hermes] plugin loaded (MAH ${ctx.mahVersion})`)
  },
  teardown() {
    if (process.env.MAH_DEBUG_PLUGINS === "1") console.log("[hermes] plugin unloaded")
  }
}