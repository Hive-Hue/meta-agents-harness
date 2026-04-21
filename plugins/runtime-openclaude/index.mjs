/**
 * runtime-openclaude — OpenClaude runtime plugin.
 *
 * Integrates the OpenClaude CLI (multi-provider Claude Code fork) with MAH core.
 * OpenClaude supports OpenAI, Gemini, DeepSeek, Ollama, and 200+ OpenAI-compatible
 * providers. This plugin reuses the Claude Code agent injection pattern
 * (--append-system-prompt, --agents) since OpenClaude is a Claude Code fork.
 *
 * Multi-provider env vars are passed through envOverrides:
 *   CLAUDE_CODE_USE_OPENAI, OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL
 *
 * Plugin source: plugins/runtime-openclaude/
 * Install target: mah-plugins/openclaude/  (via mah plugins install)
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

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

function toPosix(t) { return `${t || ""}`.replaceAll(path.sep, "/") }
function rel(repoRoot, targetPath) { return toPosix(path.relative(repoRoot, targetPath)) }

function readYaml(targetPath) {
  const YAML = require("yaml")
  return YAML.parse(readFileSync(targetPath, "utf8"))
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

function safeReadText(targetPath) {
  if (!targetPath || !existsSync(targetPath)) return ""
  try { return readFileSync(targetPath, "utf8") } catch { return "" }
}

function stripFlags(argv, flags) {
  const flagSet = new Set(flags)
  return argv.filter((token) => !flagSet.has(token))
}

function stripFrontmatter(raw) {
  const match = `${raw || ""}`.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/)
  return match ? match[1].trim() : `${raw || ""}`.trim()
}

function loadPromptBody(repoRoot, configPath, promptPath) {
  if (!promptPath) return { body: "", resolvedPath: "" }
  const candidates = [
    path.isAbsolute(promptPath) ? promptPath : path.resolve(repoRoot, promptPath),
    path.resolve(path.dirname(configPath), promptPath)
  ]
  for (const candidate of candidates) {
    const raw = safeReadText(candidate)
    if (raw.trim()) return { body: stripFrontmatter(raw), resolvedPath: candidate }
  }
  return { body: "", resolvedPath: candidates[0] || "" }
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

function parseOpenclaudeInternalArgs(argv = []) {
  let remaining = [...argv]
  const dryRun = remaining.includes("--dry-run")
  remaining = stripFlags(remaining, ["--dry-run"])
  const showLaunchInfo = remaining.includes("--show-launch-info")
  remaining = stripFlags(remaining, ["--show-launch-info"])
  const fullPrompts = remaining.includes("--full-prompts")
  remaining = stripFlags(remaining, ["--full-prompts"])
  const rootRoute = remaining.includes("--root-route")
  remaining = stripFlags(remaining, ["--root-route"])
  const sessionMirror = remaining.includes("--session-mirror") ? true : remaining.includes("--no-session-mirror") ? false : null
  remaining = stripFlags(remaining, ["--session-mirror", "--no-session-mirror"])
  const hierarchy = remaining.includes("--hierarchy") ? true : remaining.includes("--no-hierarchy") ? false : true
  remaining = stripFlags(remaining, ["--hierarchy", "--no-hierarchy"])
  const policyParse = parseInlineFlag(remaining, "--policy")
  const remaining2 = policyParse.remaining
  const rootModelParse = parseInlineFlag(remaining2, "--root-model")
  const remaining3 = rootModelParse.remaining
  const providerParse = parseInlineFlag(remaining3, "--provider")
  const remaining4 = providerParse.remaining
  return {
    passthrough: remaining4,
    dryRun,
    showLaunchInfo,
    fullPrompts,
    rootRoute,
    sessionMirror,
    strictHierarchy: hierarchy,
    policy: policyParse.values.at(-1) || "",
    rootModel: rootModelParse.values.at(-1) || "",
    provider: providerParse.values.at(-1) || ""
  }
}

function buildOpenclaudeRootPrompt(config, strictHierarchy, fullPrompts, orchestratorPromptBody) {
  const teamLines = []
  for (const team of config.teams || []) {
    const lead = team?.lead?.name || "(missing-lead)"
    const members = Array.isArray(team?.members) ? team.members.map((m) => m?.name).filter(Boolean) : []
    if (strictHierarchy) {
      teamLines.push(`- ${team?.name || "unknown"}: ${lead}`)
    } else {
      teamLines.push(`- ${team?.name || "unknown"}: ${lead}${members.length > 0 ? ` -> ${members.join(", ")}` : ""}`)
    }
  }
  return [
    `Current role: orchestrator`,
    `Current agent: ${config?.orchestrator?.name || "orchestrator"}`,
    `System: ${config?.name || "MultiTeam"}`,
    `Mission: ${config?.mission || ""}`.trim(),
    `Hierarchy mode: ${strictHierarchy ? "strict" : "relaxed"}`,
    "",
    `Instruction block:`,
    `${config?.instruction_block || ""}`.trim() || "n/a",
    "",
    `Topology:`,
    ...teamLines,
    "",
    `Hard rules:`,
    strictHierarchy ? `- Delegate only to leads.` : `- Delegate to leads and workers as needed, with explicit deliverables.`,
    `- Keep responses concise and execution-oriented.`,
    "",
    fullPrompts && orchestratorPromptBody ? `Agent operating prompt:\n${orchestratorPromptBody}` : ""
  ].filter(Boolean).join("\n")
}

function buildOpenclaudeAgents(repoRoot, configPath, config, fullPrompts, strictHierarchy) {
  const agents = {}
  for (const team of config.teams || []) {
    const teamName = team?.name || "unknown-team"
    const lead = team?.lead
    if (lead?.name && lead?.prompt) {
      const promptBody = fullPrompts ? loadPromptBody(repoRoot, configPath, lead.prompt).body : ""
      agents[lead.name] = {
        description: lead.description || `Lead agent for team ${teamName}`,
        prompt: [
          `Current role: lead`,
          `Current team: ${teamName}`,
          `Current agent: ${lead.name}`,
          `System: ${config?.name || "MultiTeam"}`,
          `Prompt source: ${lead.prompt}`,
          strictHierarchy ? `- Delegate only to workers from your own team.` : `- You may delegate within your team as needed.`,
          fullPrompts && promptBody ? `Agent operating prompt:\n${promptBody}` : ""
        ].filter(Boolean).join("\n")
      }
    }
    if (!strictHierarchy) {
      for (const member of team.members || []) {
        if (!member?.name || !member?.prompt) continue
        const promptBody = fullPrompts ? loadPromptBody(repoRoot, configPath, member.prompt).body : ""
        agents[member.name] = {
          description: member.description || `Worker agent for team ${teamName}`,
          prompt: [
            `Current role: worker`,
            `Current team: ${teamName}`,
            `Current agent: ${member.name}`,
            `System: ${config?.name || "MultiTeam"}`,
            `Prompt source: ${member.prompt}`,
            `- Do not delegate unless explicitly instructed.`,
            fullPrompts && promptBody ? `Agent operating prompt:\n${promptBody}` : ""
          ].filter(Boolean).join("\n")
        }
      }
    }
  }
  return agents
}

function resolveProviderEnv(provider, envOverrides = {}) {
  const providerEnv = {}
  const providerLower = `${provider || ""}`.toLowerCase().trim()
  if (providerLower === "openai") {
    providerEnv.CLAUDE_CODE_USE_OPENAI = "1"
  } else if (providerLower === "gemini") {
    providerEnv.CLAUDE_CODE_USE_OPENAI = "1"
    if (!envOverrides.OPENAI_BASE_URL) providerEnv.OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
  } else if (providerLower === "deepseek") {
    providerEnv.CLAUDE_CODE_USE_OPENAI = "1"
    if (!envOverrides.OPENAI_BASE_URL) providerEnv.OPENAI_BASE_URL = "https://api.deepseek.com/v1"
  } else if (providerLower === "ollama") {
    providerEnv.CLAUDE_CODE_USE_OPENAI = "1"
    if (!envOverrides.OPENAI_BASE_URL) providerEnv.OPENAI_BASE_URL = "http://localhost:11434/v1"
  } else if (providerLower === "openrouter") {
    providerEnv.CLAUDE_CODE_USE_OPENAI = "1"
    if (!envOverrides.OPENAI_BASE_URL) providerEnv.OPENAI_BASE_URL = "https://openrouter.ai/api/v1"
  } else if (providerLower === "groq") {
    providerEnv.CLAUDE_CODE_USE_OPENAI = "1"
    if (!envOverrides.OPENAI_BASE_URL) providerEnv.OPENAI_BASE_URL = "https://api.groq.com/openai/v1"
  } else if (providerLower === "mistral") {
    providerEnv.CLAUDE_CODE_USE_OPENAI = "1"
    if (!envOverrides.OPENAI_BASE_URL) providerEnv.OPENAI_BASE_URL = "https://api.mistral.ai/v1"
  }
  return providerEnv
}

export const runtimePlugin = {
  name: "openclaude",
  version: "1.0.0",
  mahVersion: "^0.8.0",

  adapter: {
    name: "openclaude",
    markerDir: ".openclaude",
    configPattern: ".openclaude/crew/<crew>/multi-team.yaml",
    wrapper: null,
    directCli: "openclaude",

    capabilities: {
      sessionModeNew: false,
      sessionModeContinue: true,
      sessionModeNone: true,
      sessionIdFlag: "--session-id",
      sessionRootFlag: false,
      sessionMirrorFlag: true,
      sessionContinueArgs: ["--continue"],
      sessionNoneArgs: ["-p"],
      headless: {
        supported: true,
        native: true,
        requiresSession: false,
        promptMode: "argv",
        outputMode: "stdout"
      }
    },

    supportsSessions: true,
    sessionListCommand: null,
    sessionExportCommand: null,
    sessionDeleteCommand: null,
    supportsSessionNew: false,

    commands: {
      doctor: [["openclaude", ["--help"]]],
      "check:runtime": [["openclaude", ["--help"]]],
      validate: [["openclaude", ["--help"]]],
      "validate:runtime": [["openclaude", ["--help"]]]
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
      if (!configPath) {
        return { ok: false, error: "no OpenClaude crew selected. Run 'mah use <crew>' or pass '--crew <crew>'." }
      }

      const parsed = parseOpenclaudeInternalArgs(argv)
      let config
      try {
        config = readYaml(configPath)
      } catch (error) {
        return { ok: false, error: `invalid OpenClaude config '${rel(repoRoot, configPath)}': ${error.message}` }
      }

      const orchestratorPrompt = loadPromptBody(repoRoot, configPath, config?.orchestrator?.prompt || "")
      const rootPrompt = buildOpenclaudeRootPrompt(config, parsed.strictHierarchy, parsed.fullPrompts, orchestratorPrompt.body)
      const agents = buildOpenclaudeAgents(repoRoot, configPath, config, parsed.fullPrompts, parsed.strictHierarchy)
      const providerEnv = resolveProviderEnv(parsed.provider, envOverrides)

      return {
        ok: true,
        exec: this.directCli,
        args: ["code", "--append-system-prompt", rootPrompt, "--agents", JSON.stringify(agents)],
        passthrough: parsed.passthrough,
        envOverrides: {
          ...envOverrides,
          ...providerEnv,
          MAH_RUNTIME: "openclaude",
          MAH_ACTIVE_CREW: crew
        },
        warnings: parsed.sessionMirror === true ? ["openclaude: session mirroring metadata is not implemented in the MAH-managed path"] : [],
        internal: {
          crew, configPath,
          systemName: config?.name || "MultiTeam",
          strictHierarchy: parsed.strictHierarchy,
          dryRun: parsed.dryRun,
          showLaunchInfo: parsed.showLaunchInfo,
          provider: parsed.provider,
          customAgents: Object.keys(agents).length
        }
      }
    },

    prepareHeadlessRunContext({ repoRoot, task = "", argv = [], envOverrides = {} }) {
      if (!task && (!argv || argv.length === 0)) {
        return {
          ok: false,
          error: "OpenClaude headless requires a task prompt"
        }
      }
      return {
        ok: true,
        exec: "openclaude",
        args: ["-p"],
        passthrough: task ? [task] : argv,
        envOverrides: {
          ...envOverrides,
          MAH_HEADLESS: "1"
        },
        warnings: [],
        internal: {
          mode: "headless",
          promptMode: "argv",
          runtime: "openclaude"
        }
      }
    },

    activateCrew({ repoRoot, crewId }) {
      const runtimeRoot = path.join(repoRoot, ".openclaude")
      const configPath = path.join(runtimeRoot, "crew", crewId, "multi-team.yaml")
      const sessionRoot = path.join(runtimeRoot, "crew", crewId, "sessions")
      mkdirSync(sessionRoot, { recursive: true })
      const payload = {
        crew: crewId,
        source_config: rel(repoRoot, configPath),
        session_root: rel(repoRoot, sessionRoot),
        activated_at: new Date().toISOString(),
        runtime: "openclaude",
        note: "Used by MAH core to bootstrap OpenClaude runtime with selected crew."
      }
      writeJson(path.join(runtimeRoot, ".active-crew.json"), payload)
      return payload
    },

    clearCrewState({ repoRoot }) {
      removeIfExists(path.join(repoRoot, ".openclaude", ".active-crew.json"))
      return true
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
    if (process.env.MAH_DEBUG_PLUGINS === "1") console.log(`[openclaude] plugin loaded (MAH ${ctx.mahVersion})`)
  },
  teardown() {
    if (process.env.MAH_DEBUG_PLUGINS === "1") console.log("[openclaude] plugin unloaded")
  }
}
