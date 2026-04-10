/**
 * runtime-codex — Codex runtime plugin.
 *
 * Integrates the Codex CLI with MAH core-managed crew context.
 * The plugin materializes crew prompts, expertise, and shared skills under
 * `.codex/` and prepares interactive or non-interactive Codex runs from the
 * selected MAH crew agent.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, cpSync } from "node:fs"
import path from "node:path"
import YAML from "yaml"

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
    const prefixDir = args[prefixIndex + 1]
    return variantPathExists(prefixDir) && variantPathExists(path.join(prefixDir, "package.json"))
  }
  return true
}

function toPosix(value) {
  return `${value || ""}`.replaceAll(path.sep, "/")
}

function rel(repoRoot, targetPath) {
  return toPosix(path.relative(repoRoot, targetPath))
}

function resolveFromRepo(repoRoot, targetPath) {
  if (!targetPath || typeof targetPath !== "string") return ""
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(repoRoot, targetPath)
}

function readYaml(targetPath) {
  return YAML.parse(readFileSync(targetPath, "utf-8"))
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

function removeIfExists(targetPath) {
  if (!existsSync(targetPath)) return
  try {
    rmSync(targetPath, { recursive: true, force: true })
  } catch (error) {
    if (error?.code !== "EROFS" && error?.code !== "EPERM") throw error
  }
}

function forceSymlink(targetPath, linkPath) {
  removeIfExists(linkPath)
  mkdirSync(path.dirname(linkPath), { recursive: true })
  const relativeTarget = path.relative(path.dirname(linkPath), targetPath)
  symlinkSync(relativeTarget, linkPath)
}

function writeJson(targetPath, payload) {
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
}

function collectCodexAgents(crewConfig) {
  const agents = []
  const orchestrator = crewConfig?.orchestrator
  if (orchestrator?.name && orchestrator?.prompt) {
    agents.push({
      name: orchestrator.name,
      role: "orchestrator",
      team: orchestrator.team || "Orchestration",
      description: orchestrator.description || "",
      prompt: orchestrator.prompt,
      instruction_block: orchestrator.instruction_block || "",
      model: orchestrator.model || "",
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
        description: lead.description || "",
        prompt: lead.prompt,
        instruction_block: lead.instruction_block || "",
        model: lead.model || "",
        source: lead
      })
    }

    for (const member of team?.members || []) {
      if (!member?.name || !member?.prompt) continue
      agents.push({
        name: member.name,
        role: "worker",
        team: teamName,
        description: member.description || "",
        prompt: member.prompt,
        instruction_block: member.instruction_block || "",
        model: member.model || "",
        source: member
      })
    }
  }

  return agents
}

function findAgent(crewConfig, agentName) {
  const selected = `${agentName || ""}`.trim()
  const agents = collectCodexAgents(crewConfig)
  if (!selected) {
    return agents.find((item) => item.role === "orchestrator") || agents[0] || null
  }
  return agents.find((item) => item.name === selected) || null
}

function buildCodexPrompt({ crewId, crewName, mission, sprintMode, agent, promptPath, promptBody, userPrompt }) {
  const sections = [
    `Current crew id: ${crewId || "n/a"}`,
    crewName ? `Crew name: ${crewName}` : "",
    `Current agent: ${agent.name}`,
    `Current role: ${agent.role}`,
    agent.team ? `Current team: ${agent.team}` : "",
    agent.description ? `Description: ${agent.description}` : "",
    agent.model ? `Model: ${agent.model}` : "",
    mission ? `Mission: ${mission}` : "",
    sprintMode?.name ? `Sprint: ${sprintMode.name}` : "",
    sprintMode?.target_release ? `Target release: ${sprintMode.target_release}` : "",
    sprintMode?.objective ? `Objective: ${sprintMode.objective}` : "",
    sprintMode?.execution_mode ? `Execution mode: ${sprintMode.execution_mode}` : "",
    normalizeTextList(sprintMode?.directives).length > 0 ? `Directives:\n${formatBulletList(sprintMode.directives)}` : "",
    normalizeTextList(sprintMode?.must_deliver).length > 0 ? `Must deliver:\n${formatBulletList(sprintMode.must_deliver)}` : "",
    normalizeTextList(sprintMode?.must_not_deliver).length > 0 ? `Must not deliver:\n${formatBulletList(sprintMode.must_not_deliver)}` : "",
    agent.instruction_block ? `Instruction block:\n${agent.instruction_block}` : "",
    promptPath ? `Prompt source: ${promptPath}` : "",
    promptBody ? `Agent operating prompt:\n${promptBody}` : "",
    userPrompt ? `User task:\n${userPrompt}` : ""
  ].filter(Boolean)

  return sections.join("\n\n")
}

function buildCodexInitialMessagesPrompt(prompt) {
  return `initial_messages=[{ role = "system", content = ${JSON.stringify(prompt)} }]`
}

function loadCodexCrewConfig(repoRoot, configPath) {
  if (!configPath || !existsSync(configPath)) {
    return { ok: false, error: `crew config not found: ${configPath || "(empty)"}` }
  }
  try {
    return { ok: true, config: readYaml(configPath) }
  } catch (error) {
    return { ok: false, error: `invalid Codex crew config '${rel(repoRoot, configPath)}': ${error.message}` }
  }
}

function materializeCodexAgents(repoRoot, crewId, sourceAgents) {
  const runtimeRoot = path.join(repoRoot, ".codex")
  const activeAgentsPath = path.join(runtimeRoot, "agents")
  try {
    removeIfExists(activeAgentsPath)
    mkdirSync(activeAgentsPath, { recursive: true })
    writeFileSync(path.join(activeAgentsPath, ".gitkeep"), "", "utf-8")
  } catch (error) {
    if (error?.code !== "EROFS" && error?.code !== "EPERM") throw error
    return
  }

  if (!existsSync(sourceAgents)) return
  const files = readdirSync(sourceAgents).filter((entry) => entry.endsWith(".md")).sort((a, b) => a.localeCompare(b))
  for (const file of files) {
    const sourcePath = path.join(sourceAgents, file)
    const targetPath = path.join(activeAgentsPath, file)
    const relativeTarget = path.relative(path.dirname(targetPath), sourcePath)
    try {
      symlinkSync(relativeTarget, targetPath)
    } catch (error) {
      if (error?.code !== "EROFS" && error?.code !== "EPERM") throw error
      return
    }
  }
}

function materializeCodexSkills(repoRoot) {
  const sourceSkills = path.join(repoRoot, "skills")
  const targetSkills = path.join(repoRoot, ".codex", "skills")
  if (!existsSync(sourceSkills)) return
  removeIfExists(targetSkills)
  mkdirSync(path.dirname(targetSkills), { recursive: true })
  try {
    cpSync(sourceSkills, targetSkills, { recursive: true, force: true })
  } catch (error) {
    if (error?.code !== "EROFS" && error?.code !== "EPERM") throw error
  }
}

function activateCodexCrewState({ repoRoot, crewId }) {
  const runtimeRoot = path.join(repoRoot, ".codex")
  const configPath = path.join(runtimeRoot, "crew", crewId, "multi-team.yaml")
  const sourceAgents = path.join(runtimeRoot, "crew", crewId, "agents")
  const sourceExpertise = path.join(runtimeRoot, "crew", crewId, "expertise")
  const sourceSessions = path.join(runtimeRoot, "crew", crewId, "sessions")
  if (!existsSync(configPath) || !existsSync(sourceAgents) || !existsSync(sourceExpertise)) {
    throw new Error(`Codex crew assets are incomplete for '${crewId}'`)
  }

  materializeCodexAgents(repoRoot, crewId, sourceAgents)
  materializeCodexSkills(repoRoot)
  mkdirSync(sourceSessions, { recursive: true })

  const payload = {
    crew: crewId,
    source_config: rel(repoRoot, configPath),
    source_agents: rel(repoRoot, sourceAgents),
    source_expertise: rel(repoRoot, sourceExpertise),
    activated_at: new Date().toISOString(),
    note: "Used by MAH core to bootstrap Codex with selected crew."
  }
  try {
    writeJson(path.join(runtimeRoot, ".active-crew.json"), payload)
  } catch (error) {
    if (error?.code !== "EROFS" && error?.code !== "EPERM") throw error
  }
  return payload
}

function clearCodexCrewState({ repoRoot }) {
  const runtimeRoot = path.join(repoRoot, ".codex")
  removeIfExists(path.join(runtimeRoot, ".active-crew.json"))
  removeIfExists(path.join(runtimeRoot, "agents"))
  removeIfExists(path.join(runtimeRoot, "skills"))
  return true
}

function buildCodexRunContext({ repoRoot, crew, configPath, argv = [], envOverrides = {} }) {
  const crewResult = loadCodexCrewConfig(repoRoot, configPath)
  if (!crewResult.ok) {
    return { ok: false, error: crewResult.error }
  }

  const crewConfig = crewResult.config || {}
  const agentName = `${envOverrides.MAH_AGENT || process.env.MAH_AGENT || ""}`.trim()
  const selectedAgent = findAgent(crewConfig, agentName)
  if (!selectedAgent) {
    return { ok: false, error: agentName ? `agent not found in crew config: ${agentName}` : "no Codex crew agent available" }
  }

  const autonomous = `${envOverrides.MAH_CODEX_AUTONOMOUS || process.env.MAH_CODEX_AUTONOMOUS || ""}`.trim() === "1"
  const rawTaskPrompt = Array.isArray(argv)
    ? argv.map((item) => `${item || ""}`.trim()).filter(Boolean).join(" ")
    : ""
  const taskPrompt = autonomous ? rawTaskPrompt : ""

  const promptPath = resolveFromRepo(repoRoot, selectedAgent.prompt)
  const promptBody = loadPromptBody(promptPath)
  if (!promptBody) {
    return { ok: false, error: `Codex prompt not found: ${rel(repoRoot, promptPath)}` }
  }
  const warnings = []
  if (!autonomous && rawTaskPrompt) {
    warnings.push("codex: task prompt ignored in interactive mode; set MAH_CODEX_AUTONOMOUS=1 for autonomous subagent execution")
  }

  const systemPrompt = buildCodexPrompt({
    crewId: `${crew || ""}`.trim(),
    crewName: `${crewConfig?.name || ""}`.trim(),
    mission: `${crewConfig?.mission || ""}`.trim(),
    sprintMode: crewConfig?.sprint_mode,
    agent: selectedAgent,
    promptPath: selectedAgent.prompt,
    promptBody,
    userPrompt: ""
  })

  const model = `${selectedAgent.model || ""}`.trim()
  const args = [buildCodexInitialMessagesPrompt(systemPrompt)]
  if (model) args.push("--model", model)
  if (autonomous && taskPrompt) {
    args.push("exec", "--cd", repoRoot, "--full-auto", taskPrompt)
  } else {
    if (taskPrompt) {
      return {
        ok: false,
        error: "Codex run task prompts are only enabled for autonomous subagent execution"
      }
    }
    args.push("--cd", repoRoot)
  }

  return {
    ok: true,
    exec: this.directCli,
    args,
    passthrough: [],
    envOverrides: {
      ...envOverrides,
      MAH_ACTIVE_CREW: `${crew || ""}`.trim(),
      MAH_AGENT: selectedAgent.name,
      ...(autonomous ? { MAH_CODEX_AUTONOMOUS: "1" } : {})
    },
    warnings,
    internal: {
      crew,
      configPath,
      agent: selectedAgent.name,
      promptPath: selectedAgent.prompt,
      taskPrompt,
      automation: autonomous && Boolean(taskPrompt)
    }
  }
}

export const runtimePlugin = {
  name: "codex",
  version: "1.0.0",
  mahVersion: "^0.5.0",

  adapter: {
    name: "codex",
    markerDir: ".codex",
    configPattern: ".codex/crew/<crew>/multi-team.yaml",
    wrapper: null,
    directCli: "codex",
    capabilities: {
      sessionModeNew: false,
      sessionModeContinue: false,
      sessionModeNone: false,
      sessionIdFlag: "",
      sessionRootFlag: false,
      sessionMirrorFlag: false,
      sessionNewArgs: [],
      sessionContinueArgs: []
    },
    supportsSessions: false,
    sessionListCommand: null,
    sessionExportCommand: null,
    sessionDeleteCommand: null,
    supportsSessionNew: false,
    commands: {
      doctor: [["codex", ["--help"]]],
      "check:runtime": [["codex", ["--help"]]],
      validate: [["codex", ["--help"]]],
      "validate:runtime": [["codex", ["--help"]]]
    },

    detect(cwd, existsFn) {
      return existsFn(`${cwd}/${this.markerDir}`)
    },

    supports(command) {
      if (command === "run" && typeof this.prepareRunContext === "function") return true
      if (["list:crews", "use", "clear"].includes(command)) return true
      return Array.isArray(this.commands?.[command]) && this.commands[command].length > 0
    },

    activateCrew({ repoRoot, crewId }) {
      return activateCodexCrewState({ repoRoot, crewId })
    },

    clearCrewState({ repoRoot }) {
      return clearCodexCrewState({ repoRoot })
    },

    prepareRunContext(context) {
      return buildCodexRunContext.call(this, context)
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
    if (process.env.MAH_DEBUG_PLUGINS === "1") {
      console.log(`[codex] plugin loaded (MAH ${ctx.mahVersion})`)
    }
  },

  teardown() {
    if (process.env.MAH_DEBUG_PLUGINS === "1") {
      console.log("[codex] plugin unloaded")
    }
  }
}
