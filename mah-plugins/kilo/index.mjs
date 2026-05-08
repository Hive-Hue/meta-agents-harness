/**
 * runtime-kilo — Kilo Code runtime plugin.
 *
 * Integrates the Kilo Code CLI (@kilocode/cli) with the MAH core.
 * Kilo is a fork of OpenCode; MAH manages crew state and generated tree lookup,
 * and this plugin translates that context into a direct `kilo` invocation.
 *
 * Plugin source: plugins/runtime-kilo/
 * Install target: mah-plugins/kilo/  (via mah plugins install)
 *
 * Core-managed commands:
 *   list:crews, use, clear, run
 *
 * Plugin-declared commands:
 *   doctor, check:runtime, validate, validate:runtime
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import YAML from "yaml"

function variantPathExists(candidatePath) {
  if (!candidatePath || typeof candidatePath !== "string") return false
  const absolutePath = path.isAbsolute(candidatePath)
    ? candidatePath
    : path.resolve(process.cwd(), candidatePath)
  return existsSync(absolutePath)
}

function variantExecutableAvailable(exec, args, commandExistsFn) {
  if (!commandExistsFn(exec)) return false
  if (exec === "node") {
    return variantPathExists(args?.[0])
  }
  if (exec === "npm") {
    const prefixIndex = Array.isArray(args) ? args.indexOf("--prefix") : -1
    if (prefixIndex === -1 || !args?.[prefixIndex + 1]) return true
    const prefixDir = args[prefixIndex + 1]
    return variantPathExists(prefixDir) && variantPathExists(path.join(prefixDir, "package.json"))
  }
  return true
}

function readYaml(targetPath) {
  return YAML.parse(readFileSync(targetPath, "utf-8"))
}

function resolveFromRepo(repoRoot, targetPath) {
  if (!targetPath || typeof targetPath !== "string") return ""
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(repoRoot, targetPath)
}

function readText(targetPath) {
  if (!targetPath || !existsSync(targetPath)) return ""
  try {
    return readFileSync(targetPath, "utf-8")
  } catch {
    return ""
  }
}

function stripFrontmatter(raw) {
  const match = `${raw || ""}`.match(/^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)$/)
  return match ? match[1].trim() : `${raw || ""}`.trim()
}

function loadPromptBody(targetPath) {
  return stripFrontmatter(readText(targetPath))
}

function normalizeTextList(value) {
  return Array.isArray(value)
    ? value.map((item) => `${item || ""}`.trim()).filter(Boolean)
    : []
}

function formatBulletList(value) {
  const lines = normalizeTextList(value)
  return lines.length > 0 ? lines.map((item) => `- ${item}`).join("\n") : ""
}

function parseExistingKiloConfig() {
  const content = process.env.KILO_CONFIG_CONTENT
  if (!content) return undefined
  try {
    return JSON.parse(content)
  } catch {
    return undefined
  }
}

function mergeKiloConfig(existing, incoming) {
  const base = existing ?? {}
  const override = incoming ?? {}
  return {
    ...base,
    ...override,
    agent: { ...base.agent, ...override.agent },
    command: { ...base.command, ...override.command },
    mcp: { ...base.mcp, ...override.mcp },
    mode: { ...base.mode, ...override.mode },
    plugin: [...(base.plugin ?? []), ...(override.plugin ?? [])],
    instructions: [...(base.instructions ?? []), ...(override.instructions ?? [])]
  }
}

function buildKiloConfigEnv(config) {
  return JSON.stringify(mergeKiloConfig(parseExistingKiloConfig(), config))
}

function normalizeKiloModelId(model = "") {
  const value = `${model || ""}`.trim()
  if (!value) return value
  const aliases = {
    "minimax-coding-plan/MiniMax-M2.7": "minimax/MiniMax-M2.7",
    "minimax/minimax-m2.7": "minimax/MiniMax-M2.7",
    "zai-coding-plan/glm-5": "zai/glm-5",
    "zai-coding-plan/glm-5.1": "zai/glm-5.1"
  }
  return aliases[value] || value
}

function readAgentFlagFromArgs(args = []) {
  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`.trim()
    if (!token) continue
    if (token === "--agent" && args[i + 1]) return `${args[i + 1]}`.trim()
    if (token.startsWith("--agent=")) return token.slice("--agent=".length).trim()
  }
  return ""
}

function readSessionIdFromArgs(args = []) {
  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`.trim()
    if (!token) continue
    if ((token === "--session" || token === "-s") && args[i + 1]) {
      return `${args[i + 1]}`.trim()
    }
    if (token.startsWith("--session=")) {
      return token.slice("--session=".length).trim()
    }
    if (token.startsWith("-s=")) {
      return token.slice("-s=".length).trim()
    }
  }
  return ""
}

function hasKiloResumeIntent(args = []) {
  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`.trim()
    if (!token) continue
    if (token === "-c" || token === "--continue" || token === "-s" || token === "--session") return true
    if (token.startsWith("--session=") || token.startsWith("-s=")) return true
  }
  return false
}

function hasKiloCommandFlag(args = []) {
  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`.trim()
    if (!token) continue
    if (token === "--command" || token.startsWith("--command=")) return true
  }
  return false
}

function hasKiloPromptMessage(args = []) {
  const flagsWithValue = new Set([
    "-s",
    "--session",
    "--agent",
    "-m",
    "--model",
    "-f",
    "--file",
    "--title",
    "--attach",
    "-p",
    "--password",
    "--dir",
    "--port",
    "--variant",
    "--format",
    "--command"
  ])
  let skipNext = false
  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`.trim()
    if (!token) continue
    if (skipNext) {
      skipNext = false
      continue
    }
    if (flagsWithValue.has(token)) {
      skipNext = true
      continue
    }
    if (token.startsWith("-")) continue
    return true
  }
  return false
}

function resolveKiloSessionIdFromCli(repoRoot) {
  const child = spawnSync("kilo", ["session", "list", "--format", "json"], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf-8"
  })
  if (child.status !== 0 || !child.stdout) return ""

  let parsed
  try {
    parsed = JSON.parse(child.stdout)
  } catch {
    return ""
  }

  const sessions = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.sessions)
      ? parsed.sessions
      : []
  if (sessions.length === 0) return ""

  const normalizedRepoRoot = path.resolve(repoRoot)
  const inWorkspace = sessions.filter((entry) => {
    const workspacePath = `${entry?.workspace || entry?.cwd || entry?.path || entry?.directory || ""}`.trim()
    if (!workspacePath) return false
    return path.resolve(workspacePath) === normalizedRepoRoot
  })
  const candidates = inWorkspace.length > 0 ? inWorkspace : sessions
  const sorted = [...candidates].sort((a, b) => {
    const aUpdated = Number.isFinite(a?.updated) ? Number(a.updated) : 0
    const bUpdated = Number.isFinite(b?.updated) ? Number(b.updated) : 0
    const aTs = aUpdated || Date.parse(`${a?.updated_at || a?.last_active_at || a?.created_at || ""}`) || 0
    const bTs = bUpdated || Date.parse(`${b?.updated_at || b?.last_active_at || b?.created_at || ""}`) || 0
    return bTs - aTs
  })

  const latest = sorted[0]
  return `${latest?.session_id || latest?.sessionId || latest?.id || ""}`.trim()
}

function parseJsonPayload(rawText = "") {
  const text = `${rawText || ""}`.trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    // Kilo may print banner/log lines around the JSON payload.
  }

  const objectStart = text.indexOf("{")
  const arrayStart = text.indexOf("[")
  const start = [objectStart, arrayStart].filter((idx) => idx >= 0).sort((a, b) => a - b)[0]
  if (start == null) return null

  const endObject = text.lastIndexOf("}")
  const endArray = text.lastIndexOf("]")
  const end = Math.max(endObject, endArray)
  if (end < start) return null

  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function mirrorKiloSession(repoRoot, crewId, sessionId, envOverrides = {}) {
  const cleanCrewId = `${crewId || ""}`.trim()
  const cleanSessionId = `${sessionId || ""}`.trim()
  if (!cleanCrewId || !cleanSessionId) return { export_file: "", export_error: "" }

  const sessionDir = path.join(repoRoot, ".kilo", "crew", cleanCrewId, "sessions", cleanSessionId)
  mkdirSync(sessionDir, { recursive: true })

  const exported = spawnSync("kilo", ["export", cleanSessionId], {
    cwd: repoRoot,
    env: { ...process.env, ...envOverrides },
    encoding: "utf-8"
  })
  const parsed = exported.status === 0 ? parseJsonPayload(exported.stdout) : null
  if (parsed && typeof parsed === "object") {
    writeJson(path.join(sessionDir, "session.export.json"), parsed)
    return { export_file: "session.export.json", export_error: "" }
  }

  const combinedLogs = `${exported.stdout || ""}${exported.stderr || ""}`.trim()
  if (combinedLogs) {
    writeFileSync(path.join(sessionDir, "session.export.log"), `${combinedLogs}\n`, "utf-8")
  }
  return {
    export_file: "",
    export_error: combinedLogs ? "export-output-not-json" : `exit-${typeof exported.status === "number" ? exported.status : "unknown"}`
  }
}

function trackKiloSessionAlias(repoRoot, crewId, sessionId, metadata = {}) {
  const cleanCrewId = `${crewId || ""}`.trim()
  const cleanSessionId = `${sessionId || ""}`.trim()
  if (!cleanCrewId || !cleanSessionId) return

  const sessionDir = path.join(repoRoot, ".kilo", "crew", cleanCrewId, "sessions", cleanSessionId)
  mkdirSync(sessionDir, { recursive: true })
  writeJson(path.join(sessionDir, "session.alias.json"), {
    runtime: "kilo",
    crew: cleanCrewId,
    session_id: cleanSessionId,
    tracked_at: new Date().toISOString(),
    ...metadata
  })
}

function resolveEffectiveKiloCrew(repoRoot, crew) {
  const cleanCrew = `${crew || ""}`.trim()
  if (cleanCrew) return cleanCrew
  const defaultCrewDir = path.join(repoRoot, ".kilo", "crew", "dev")
  return existsSync(defaultCrewDir) ? "dev" : ""
}

function collectCrewAgentBlocks(crewConfig) {
  const agents = []

  const orchestrator = crewConfig?.orchestrator
  if (orchestrator?.name && orchestrator?.prompt) {
    agents.push({
      name: orchestrator.name,
      role: "orchestrator",
      team: orchestrator.team || "Orchestration",
      prompt: orchestrator.prompt,
      source: orchestrator
    })
  }

  for (const team of crewConfig?.teams || []) {
    const teamName = `${team?.name || ""}`.trim()
    const lead = team?.lead
    if (lead?.name && lead?.prompt) {
      agents.push({
        name: lead.name,
        role: "lead",
        team: teamName,
        prompt: lead.prompt,
        source: lead
      })
    }

    for (const member of team?.members || []) {
      if (!member?.name || !member?.prompt) continue
      agents.push({
        name: member.name,
        role: "worker",
        team: teamName,
        prompt: member.prompt,
        source: member
      })
    }
  }

  return agents
}

function buildKiloAgentPrompt({ crew, crewName, agent, mission, sprintMode, promptPath, promptBody }) {
  const sections = [
    `Current crew id: ${crew || "n/a"}`,
    crewName ? `Crew name: ${crewName}` : "",
    `Current agent: ${agent.name}`,
    `Current role: ${agent.role}`,
    agent.team ? `Current team: ${agent.team}` : "",
    agent.source?.description ? `Description: ${agent.source.description}` : "",
    mission ? `Mission: ${mission}` : "",
    sprintMode?.name ? `Sprint: ${sprintMode.name}` : "",
    sprintMode?.target_release ? `Target release: ${sprintMode.target_release}` : "",
    sprintMode?.objective ? `Objective: ${sprintMode.objective}` : "",
    sprintMode?.execution_mode ? `Execution mode: ${sprintMode.execution_mode}` : "",
    normalizeTextList(sprintMode?.directives).length > 0 ? `Directives:\n${formatBulletList(sprintMode.directives)}` : "",
    normalizeTextList(sprintMode?.must_deliver).length > 0 ? `Must deliver:\n${formatBulletList(sprintMode.must_deliver)}` : "",
    normalizeTextList(sprintMode?.must_not_deliver).length > 0 ? `Must not deliver:\n${formatBulletList(sprintMode.must_not_deliver)}` : "",
    agent.source?.instruction_block ? `Instruction block:\n${agent.source.instruction_block}` : "",
    normalizeTextList(agent.source?.sprint_responsibilities).length > 0
      ? `Sprint responsibilities:\n${formatBulletList(agent.source.sprint_responsibilities)}`
      : "",
    promptPath ? `Prompt source: ${promptPath}` : "",
    promptBody ? `Agent operating prompt:\n${promptBody}` : ""
  ].filter(Boolean)

  return sections.join("\n\n")
}

function buildKiloRunConfig({ repoRoot, crew, configPath }) {
  const warnings = []
  if (!configPath || !existsSync(configPath)) {
    return { ok: false, warnings }
  }

  let crewConfig
  try {
    crewConfig = readYaml(configPath)
  } catch (err) {
    return { ok: false, warnings: [`kilo: failed to read crew config '${configPath}': ${err.message}`] }
  }

  const orchestratorName = crewConfig?.orchestrator?.name || "orchestrator"
  const orchestratorModel = `${crewConfig?.orchestrator?.model || ""}`.trim()
  const crewName = `${crewConfig?.name || ""}`.trim()
  const agents = collectCrewAgentBlocks(crewConfig)
  const agentConfig = {}

  for (const agent of agents) {
    const promptPath = resolveFromRepo(repoRoot, agent.prompt)
    const promptBody = loadPromptBody(promptPath)
    if (!promptBody) {
      warnings.push(`kilo: prompt not found at ${agent.prompt} for agent '${agent.name}'`)
      continue
    }

    const prompt = buildKiloAgentPrompt({
      crew: `${crew || ""}`.trim(),
      crewName,
      agent,
      mission: `${crewConfig?.mission || ""}`.trim(),
      sprintMode: crewConfig?.sprint_mode,
      promptPath: agent.prompt,
      promptBody
    })

    const isOrchestrator = agent.name === orchestratorName || agent.role === "orchestrator"
    const runtimeModel = isOrchestrator
      ? `${agent.source.model || orchestratorModel || ""}`.trim()
      : `${orchestratorModel || agent.source.model || ""}`.trim()
    agentConfig[agent.name] = {
      description: agent.source.description || `${agent.name} agent`,
      model: normalizeKiloModelId(runtimeModel),
      prompt,
      mode: isOrchestrator ? "primary" : "subagent",
      hidden: !isOrchestrator
    }
  }

  if (!agentConfig[orchestratorName]) {
    warnings.push(`kilo: orchestrator agent '${orchestratorName}' could not be loaded from ${configPath}`)
    return { ok: false, warnings }
  }

  return {
    ok: true,
    warnings,
    config: {
      default_agent: orchestratorName,
      agent: agentConfig
    }
  }
}

function writeJson(targetPath, payload) {
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf-8")
}

function materializeKiloAgents(repoRoot, crewId) {
  const runtimeRoot = path.join(repoRoot, ".kilo")
  const sourceAgents = path.join(runtimeRoot, "crew", crewId, "agents")
  const activeAgentsPath = path.join(runtimeRoot, "agents")

  if (!existsSync(sourceAgents)) {
    throw new Error(`Kilo crew agents are incomplete for '${crewId}'`)
  }

  rmSync(activeAgentsPath, { recursive: true, force: true })
  mkdirSync(activeAgentsPath, { recursive: true })
  writeFileSync(path.join(activeAgentsPath, ".gitkeep"), "", "utf-8")

  const files = readdirSync(sourceAgents).filter((entry) => entry.endsWith(".md")).sort((left, right) => left.localeCompare(right))
  for (const file of files) {
    const sourcePath = path.join(sourceAgents, file)
    const targetPath = path.join(activeAgentsPath, file)
    const relativeTarget = path.relative(path.dirname(targetPath), sourcePath)
    symlinkSync(relativeTarget, targetPath)
  }
}

function activateKiloCrewState({ repoRoot, crewId }) {
  const runtimeRoot = path.join(repoRoot, ".kilo")
  const configPath = path.join(runtimeRoot, "crew", crewId, "multi-team.yaml")
  const sourceAgents = path.join(runtimeRoot, "crew", crewId, "agents")
  if (!existsSync(configPath) || !existsSync(sourceAgents)) {
    throw new Error(`Kilo crew assets are incomplete for '${crewId}'`)
  }

  materializeKiloAgents(repoRoot, crewId)

  const payload = {
    crew: crewId,
    source_config: path.relative(repoRoot, configPath) || configPath,
    source_agents: path.relative(repoRoot, sourceAgents) || sourceAgents,
    activated_at: new Date().toISOString(),
    note: "Used by MAH core to bootstrap Kilo with selected crew."
  }
  writeJson(path.join(runtimeRoot, ".active-crew.json"), payload)
  return payload
}

function clearKiloCrewState({ repoRoot }) {
  const runtimeRoot = path.join(repoRoot, ".kilo")
  rmSync(path.join(runtimeRoot, ".active-crew.json"), { force: true })
  rmSync(path.join(runtimeRoot, "agents"), { recursive: true, force: true })
  return true
}

export const runtimePlugin = {
  // --- Identification ---
  name: "kilo",
  version: "1.0.0",
  mahVersion: "^0.8.0",

  // --- RuntimeAdapter ---
  adapter: {
    name: "kilo",
    markerDir: ".kilo",
    configPattern: ".kilo/crew/<crew>/multi-team.yaml",

    // Kilo Code CLI — installed via: npm install -g @kilocode/cli
    // Then accessible as `kilo` in PATH.
    // Wrapper is optional in the core-integrated model.
    wrapper: null,
    directCli: "kilo",

    // Session capabilities
    capabilities: {
      sessionModeNew: true,          // kilo supports /new session
      sessionModeContinue: true,    // kilo supports /continue
      sessionModeNone: false,
      sessionIdFlag: "--session",
      sessionRootFlag: false,
      sessionMirrorFlag: false,
      sessionNewArgs: [],
      sessionContinueArgs: [],
      headless: {
        supported: true,
        native: true,
        requiresSession: false,
        promptMode: "argv",
        outputMode: "stdout"
      }
    },

    supportsSessions: true,

    // kilo session subcommands (parsed from kilo session --help output)
    sessionListCommand: [
      ["kilo", ["session", "list", "--format", "json"]]
    ],
    sessionExportCommand: [
      ["kilo", ["export"]]
    ],
    sessionDeleteCommand: [
      ["kilo", ["session", "delete"]]
    ],
    supportsSessionNew: true,

    // Commands handled directly by the runtime CLI.
    // Crew-aware commands (list:crews, use, clear) are core-managed by MAH.
    // `run` is prepared by `prepareRunContext()` below.
    commands: {
      doctor: [
        ["kilo", ["debug"]]
      ],

      "check:runtime": [
        ["kilo", ["debug"]]
      ],

      validate: [
        ["kilo", ["debug"]]
      ],

      "validate:runtime": [
        ["kilo", ["debug"]]
      ]
    },

    // --- Required adapter methods ---

    detect(cwd, existsFn) {
      return existsFn(`${cwd}/${this.markerDir}`)
    },

    supports(command) {
      if (["list:crews", "use", "clear"].includes(command)) return true
      if (command === "run") return true
      return Array.isArray(this.commands?.[command]) && this.commands[command].length > 0
    },

    activateCrew({ repoRoot, crewId }) {
      return activateKiloCrewState({ repoRoot, crewId })
    },

    clearCrewState({ repoRoot }) {
      return clearKiloCrewState({ repoRoot })
    },

    prepareRunContext({ repoRoot, crew, configPath, argv, envOverrides: baseEnvOverrides = {} }) {
      const envOverrides = { ...baseEnvOverrides }
      const warnings = []
      let orchestratorName = ""
      const effectiveCrew = resolveEffectiveKiloCrew(repoRoot, crew)

      if (effectiveCrew && configPath && existsSync(configPath)) {
        const built = buildKiloRunConfig({ repoRoot, crew: effectiveCrew, configPath })
        warnings.push(...(built.warnings || []))
        if (built.ok) {
          envOverrides.KILO_CONFIG_CONTENT = buildKiloConfigEnv(built.config)
          orchestratorName = built.config?.default_agent || ""
        }
      } else if (effectiveCrew && configPath) {
        warnings.push(`kilo: crew config not found at ${configPath}, running without injected MAH context`)
      }

      envOverrides.MAH_RUNTIME = "kilo"
      if (effectiveCrew) envOverrides.MAH_ACTIVE_CREW = effectiveCrew
      const requestedAgent = `${envOverrides.MAH_AGENT || readAgentFlagFromArgs(argv) || process.env.MAH_AGENT || orchestratorName}`.trim()

      const passthrough = Array.isArray(argv) ? [...argv] : []
      const hasResume = hasKiloResumeIntent(passthrough)
      const hasCommand = hasKiloCommandFlag(passthrough)
      const hasMessage = hasKiloPromptMessage(passthrough)
      const args = []
      // Resume without prompt should use top-level Kilo TUI (`kilo --continue/--session`)
      // instead of `kilo run`, otherwise the CLI requires a message and exits.
      if (hasMessage || hasCommand) args.push("run")
      if (requestedAgent) args.push("--agent", requestedAgent)

      return {
        ok: true,
        exec: this.directCli,
        args,
        passthrough,
        envOverrides,
        warnings
      }
    },

    executePreparedRun({ repoRoot, plan, runCommand }) {
      const explicitSessionId = readSessionIdFromArgs([...(plan?.args || []), ...(plan?.passthrough || [])])
      const crewId = `${plan?.crew || plan?.envOverrides?.MAH_ACTIVE_CREW || process.env.MAH_ACTIVE_CREW || ""}`.trim()
      const status = runCommand(plan.exec, plan.args, plan.passthrough || [], plan.envOverrides || {})
      if (!crewId) return status

      const discoveredSessionId = explicitSessionId ? "" : resolveKiloSessionIdFromCli(repoRoot)
      const sessionId = explicitSessionId || discoveredSessionId
      if (sessionId) {
        const mirrorMeta = mirrorKiloSession(repoRoot, crewId, sessionId, plan.envOverrides || {})
        trackKiloSessionAlias(repoRoot, crewId, sessionId, {
          source: explicitSessionId ? "argv" : "session-list",
          ...mirrorMeta
        })
      }
      return status
    },

    prepareHeadlessRunContext({ task = "", argv = [], envOverrides = {} }) {
      if (!task && (!Array.isArray(argv) || argv.length === 0)) {
        return {
          ok: false,
          error: "Kilo headless requires a task prompt"
        }
      }

      return {
        ok: true,
        exec: this.directCli,
        args: ["run"],
        passthrough: task ? [task] : argv,
        envOverrides: {
          ...envOverrides,
          KILO_HEADLESS: "1"
        },
        warnings: [],
        internal: {
          mode: "headless",
          promptMode: "argv",
          runtime: "kilo"
        }
      }
    },

    resolveCommandPlan(command, commandExistsFn, passthroughArgs = []) {
      const variants = this.commands?.[command] || []
      if (variants.length === 0) {
        return { ok: false, error: `command not supported: ${command}`, variants: [] }
      }

      const candidates = variants.map(([exec, args]) => ({
        exec,
        args,
        exists: commandExistsFn(exec),
        usable: variantExecutableAvailable(exec, args, commandExistsFn)
      }))
      const selected = candidates.find((item) => item.usable)
      if (!selected) {
        return { ok: false, error: `no executable available for ${command}`, variants: candidates }
      }
      return { ok: true, exec: selected.exec, args: selected.args, variants: candidates }
    },

    validateRuntime(commandExistsFn) {
      const hasRuntimeEntrypoint = Boolean(this.wrapper) || Boolean(this.directCli)
      const checks = [
        { name: "marker_dir", ok: Boolean(this.markerDir) },
        { name: "wrapper_declared", ok: Boolean(this.wrapper) },
        { name: "direct_cli_declared", ok: Boolean(this.directCli) },
        { name: "runtime_entrypoint_declared", ok: hasRuntimeEntrypoint },
        {
          name: "wrapper_available",
          ok: Boolean(this.wrapper) ? commandExistsFn(this.wrapper) : false
        },
        {
          name: "direct_cli_available",
          ok: Boolean(this.directCli) ? commandExistsFn(this.directCli) : false
        }
      ]
      const hasCommandTable = Object.keys(this.commands || {}).length > 0
      checks.push({ name: "commands_declared", ok: hasCommandTable })
      const ok = checks.every((item) =>
        item.ok ||
        item.name === "wrapper_declared" ||
        item.name.endsWith("_available")
      )
      return { ok, checks }
    }
  },

  // --- Lifecycle hooks ---
  init(ctx) {
    if (process.env.MAH_DEBUG_PLUGINS === "1") {
      console.log(`[kilo] plugin loaded (MAH ${ctx.mahVersion})`)
    }
  },

  teardown() {
    if (process.env.MAH_DEBUG_PLUGINS === "1") {
      console.log("[kilo] plugin unloaded")
    }
  }
}
