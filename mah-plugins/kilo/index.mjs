/**
 * runtime-kilo — Kilo Code runtime plugin.
 *
 * Core-managed commands:
 *   list:crews, use, clear, run
 *
 * Plugin-declared commands:
 *   doctor, check:runtime, validate, validate:runtime
 *
 * Core-integrated runtime plugin for Kilo Code (@kilocode/cli).
 * Crew discovery/state is managed by MAH core; the plugin only adapts
 * crew context into the direct `kilo` CLI invocation.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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

function writeJson(targetPath, payload) {
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf-8")
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
    agentConfig[agent.name] = {
      description: agent.source.description || `${agent.name} agent`,
      model: agent.source.model,
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
  name: "kilo",
  version: "1.0.0",
  mahVersion: "^0.5.0",

  adapter: {
    name: "kilo",
    markerDir: ".kilo",
    configPattern: ".kilo/crew/<crew>/multi-team.yaml",
    wrapper: null,
    directCli: "kilo",
    capabilities: {
      sessionModeNew: true,
      sessionModeContinue: true,
      sessionModeNone: false,
      sessionIdFlag: "--session",
      sessionRootFlag: false,
      sessionMirrorFlag: false,
      sessionNewArgs: [],
      sessionContinueArgs: []
    },
    supportsSessions: true,
    sessionListCommand: [
      ["kilo", ["session", "list", "--output-format", "json"]]
    ],
    sessionExportCommand: [
      ["kilo", ["session", "export"]]
    ],
    sessionDeleteCommand: [
      ["kilo", ["session", "delete"]]
    ],
    supportsSessionNew: true,
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

    prepareRunContext({ repoRoot, crew, configPath, argv }) {
      const envOverrides = {}
      const warnings = []
      let orchestratorName = ""

      if (crew && configPath && existsSync(configPath)) {
        const built = buildKiloRunConfig({ repoRoot, crew, configPath })
        warnings.push(...(built.warnings || []))
        if (built.ok) {
          envOverrides.KILO_CONFIG_CONTENT = buildKiloConfigEnv(built.config)
          orchestratorName = built.config?.default_agent || ""
        }
      } else if (crew && configPath) {
        warnings.push(`kilo: crew config not found at ${configPath}, running without injected MAH context`)
      }

      const hasMessage = Array.isArray(argv) && argv.length > 0
      const args = []
      if (hasMessage) args.push("run")
      if (orchestratorName) args.push("--agent", orchestratorName)

      return {
        ok: true,
        exec: this.directCli,
        args,
        passthrough: Array.isArray(argv) ? argv : [],
        envOverrides,
        warnings
      }
    },

    resolveCommandPlan(command, commandExistsFn) {
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
