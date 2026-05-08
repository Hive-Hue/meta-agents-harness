/**
 * runtime-claude — Claude Code runtime plugin.
 *
 * Integrates the Claude Code CLI with the MAH core.
 * MAH core manages crew state; this plugin provides prepareRunContext that
 * builds the orchestrator system prompt and agent definitions from the
 * crew config, then injects them via --append-system-prompt and --agents.
 *
 * Plugin source: plugins/runtime-claude/
 * Install target: mah-plugins/claude/  (via mah plugins install)
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

// --- Claude-specific helpers (inlined from runtime-core-integrations.mjs) ---

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

function parseClaudeInternalArgs(argv = []) {
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
  return {
    passthrough: remaining3,
    dryRun,
    showLaunchInfo,
    fullPrompts,
    rootRoute,
    sessionMirror,
    strictHierarchy: hierarchy,
    policy: policyParse.values.at(-1) || "",
    rootModel: rootModelParse.values.at(-1) || ""
  }
}

function mapModelToCcrRef(modelRef) {
  const value = String(modelRef || "").trim()
  if (!value) return ""
  const slashIndex = value.indexOf("/")
  if (slashIndex <= 0 || slashIndex >= value.length - 1) return ""
  const provider = value.slice(0, slashIndex).trim()
  const model = value.slice(slashIndex + 1).trim()
  const providerMap = {
    "zai": "Zai Coding Plan",
    "zai-coding-plan": "Zai Coding Plan",
    "minimax": "Minimax",
    "minimax-coding-plan": "Minimax",
    "openrouter": "openrouter",
    "lmstudio": "lmstudio",
    "openai-codex": "openrouter"
  }
  let modelId = model
  if (provider === "minimax" || provider === "minimax-coding-plan") {
    if (/^minimax-/i.test(modelId)) {
      const suffix = modelId.replace(/^minimax-/i, "")
      modelId = `MiniMax-${suffix ? suffix[0].toUpperCase() + suffix.slice(1) : suffix}`
    }
  }
  return `${providerMap[provider] || provider},${modelId}`
}

function normalizeAgentTools(tools) {
  if (Array.isArray(tools)) {
    return Array.from(new Set(tools.map((item) => `${item || ""}`.trim()).filter(Boolean)))
  }
  if (typeof tools === "string" && tools.trim()) {
    return Array.from(new Set(tools.split(",").map((item) => item.trim()).filter(Boolean)))
  }
  return []
}

function normalizeDomainRules(domain) {
  if (Array.isArray(domain)) {
    return domain
      .map((rule) => {
        if (!rule || typeof rule !== "object") return null
        const targetPath = `${rule.path || ""}`.trim() || "."
        return {
          path: targetPath,
          read: rule.read === true,
          upsert: rule.upsert === true,
          delete: rule.delete === true,
          recursive: rule.recursive === true
        }
      })
      .filter(Boolean)
  }
  if (domain && typeof domain === "object") {
    const read = Array.isArray(domain.read) ? domain.read : []
    const write = Array.isArray(domain.write) ? domain.write : []
    const readRules = read
      .map((item) => `${item || ""}`.trim())
      .filter(Boolean)
      .map((item) => ({ path: item, read: true, upsert: false, delete: false, recursive: true }))
    const writeRules = write
      .map((item) => `${item || ""}`.trim())
      .filter(Boolean)
      .map((item) => ({ path: item, read: true, upsert: true, delete: true, recursive: true }))
    return [...readRules, ...writeRules]
  }
  return []
}

function formatDomainRule(rule) {
  const perms = [
    rule.read ? "r" : "-",
    rule.upsert ? "u" : "-",
    rule.delete ? "d" : "-"
  ].join("")
  return `${rule.path} [${perms}]${rule.recursive ? " (recursive)" : ""}`
}

function buildDomainPromptLine(domain) {
  const rules = normalizeDomainRules(domain)
  if (rules.length === 0) return ""
  const preview = rules.slice(0, 8).map(formatDomainRule).join("; ")
  const suffix = rules.length > 8 ? `; ... (+${rules.length - 8} more)` : ""
  return `Declared domain rules: ${preview}${suffix}`
}

function hasGranularDomainRules(domain) {
  const rules = normalizeDomainRules(domain)
  if (rules.length === 0) return false
  if (rules.length !== 1) return true
  const only = rules[0]
  return !(only.path === "." && only.read === true && only.upsert === false && only.delete === false)
}

function collectDomainCoverageDiagnostics(config) {
  const granularAgents = []
  const collect = (agent) => {
    if (!agent?.name) return
    const rules = normalizeDomainRules(agent.domain)
    if (rules.length === 0) return
    if (hasGranularDomainRules(agent.domain)) granularAgents.push(agent.name)
  }
  collect(config?.orchestrator)
  for (const team of config?.teams || []) {
    collect(team?.lead)
    for (const member of team?.members || []) collect(member)
  }
  return { granularAgents }
}

function parsePolicyTokens(policy = "") {
  return `${policy || ""}`
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function buildClaudeRootPrompt(config, strictHierarchy, fullPrompts, orchestratorPromptBody, rootModel = "") {
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
  const rootModelRef = mapModelToCcrRef(rootModel)
  return [
    rootModelRef ? `<CCR-ROOT-MODEL>${rootModelRef}</CCR-ROOT-MODEL>` : "",
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
    `- If the task requires worker-produced evidence, per-worker capabilities, or team capability reports, you MUST delegate to the relevant leads/workers via tool calls before answering.`,
    `- Do not satisfy worker-scoped requests from topology/config text alone when delegation tools are available.`,
    `- Keep responses concise and execution-oriented.`,
    "",
    fullPrompts && orchestratorPromptBody ? `Agent operating prompt:\n${orchestratorPromptBody}` : ""
  ].filter(Boolean).join("\n")
}

function buildClaudeAgents(repoRoot, configPath, config, fullPrompts, strictHierarchy) {
  const agents = {}
  for (const team of config.teams || []) {
    const teamName = team?.name || "unknown-team"
    const lead = team?.lead
    if (lead?.name && lead?.prompt) {
      const promptBody = fullPrompts ? loadPromptBody(repoRoot, configPath, lead.prompt).body : ""
      const leadModelRef = mapModelToCcrRef(lead.model)
      const leadTools = normalizeAgentTools(lead.tools)
      const leadDomainLine = buildDomainPromptLine(lead.domain)
      agents[lead.name] = {
        description: lead.description || `Lead agent for team ${teamName}`,
        ...(leadTools.length > 0 ? { tools: leadTools } : {}),
        prompt: [
          leadModelRef ? `<CCR-SUBAGENT-MODEL>${leadModelRef}</CCR-SUBAGENT-MODEL>` : "",
          `Current role: lead`,
          `Current team: ${teamName}`,
          `Current agent: ${lead.name}`,
          `System: ${config?.name || "MultiTeam"}`,
          `Prompt source: ${lead.prompt}`,
          strictHierarchy ? `- Delegate only to workers from your own team.` : `- You may delegate within your team as needed.`,
          `- If a request depends on worker output (capabilities, verification, implementation evidence), you MUST call delegate_agent to each relevant worker before summarizing.`,
          `- Do not answer worker-scoped requests from topology/config text alone when delegation tools are available.`,
          leadDomainLine,
          fullPrompts && promptBody ? `Agent operating prompt:\n${promptBody}` : ""
        ].filter(Boolean).join("\n")
      }
    }
    for (const member of team.members || []) {
      if (!member?.name || !member?.prompt) continue
      const promptBody = fullPrompts ? loadPromptBody(repoRoot, configPath, member.prompt).body : ""
      const memberModelRef = mapModelToCcrRef(member.model)
      const memberTools = normalizeAgentTools(member.tools)
      const memberDomainLine = buildDomainPromptLine(member.domain)
      agents[member.name] = {
        description: member.description || `Worker agent for team ${teamName}`,
        ...(memberTools.length > 0 ? { tools: memberTools } : {}),
        prompt: [
          memberModelRef ? `<CCR-SUBAGENT-MODEL>${memberModelRef}</CCR-SUBAGENT-MODEL>` : "",
          `Current role: worker`,
          `Current team: ${teamName}`,
          `Current agent: ${member.name}`,
          `System: ${config?.name || "MultiTeam"}`,
          `Prompt source: ${member.prompt}`,
          `- Do not delegate unless explicitly instructed.`,
          memberDomainLine,
          fullPrompts && promptBody ? `Agent operating prompt:\n${promptBody}` : ""
        ].filter(Boolean).join("\n")
      }
    }
  }
  return agents
}

export const runtimePlugin = {
  name: "claude",
  version: "1.0.0",
  mahVersion: "^0.8.0",

  adapter: {
    name: "claude",
    markerDir: ".claude",
    configPattern: ".claude/crew/<crew>/multi-team.yaml",
    wrapper: null,
    directCli: "ccr",

    capabilities: {
      sessionModeNew: false,
      sessionModeContinue: true,
      sessionModeNone: true,
      sessionIdFlag: "--resume",
      sessionRootFlag: false,
      sessionMirrorFlag: true,
      sessionContinueArgs: [],
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
      doctor: [["ccr", ["--help"]]],
      "check:runtime": [["ccr", ["--help"]]],
      validate: [["ccr", ["--help"]]],
      "validate:runtime": [["ccr", ["--help"]]]
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
        return { ok: false, error: "no Claude crew selected. Run 'mah use <crew>' or pass '--crew <crew>'." }
      }

      const parsed = parseClaudeInternalArgs(argv)
      let config
      try {
        config = readYaml(configPath)
      } catch (error) {
        return { ok: false, error: `invalid Claude config '${rel(repoRoot, configPath)}': ${error.message}` }
      }

      const orchestratorPrompt = loadPromptBody(repoRoot, configPath, config?.orchestrator?.prompt || "")
      const policyTokens = parsePolicyTokens(parsed.policy)
      const domainCoverage = collectDomainCoverageDiagnostics(config)
      if (policyTokens.includes("enforce-domain") && domainCoverage.granularAgents.length > 0) {
        const sample = domainCoverage.granularAgents.slice(0, 6).join(", ")
        const suffix = domainCoverage.granularAgents.length > 6 ? ` (+${domainCoverage.granularAgents.length - 6} more)` : ""
        return {
          ok: false,
          error: `Claude runtime cannot enforce per-agent domain path ACLs from crew config. Granular domain rules found for: ${sample}${suffix}. Use runtime 'opencode' for enforced domain controls or run without '--policy enforce-domain'.`
        }
      }
      const rootPrompt = buildClaudeRootPrompt(
        config,
        parsed.strictHierarchy,
        parsed.fullPrompts,
        orchestratorPrompt.body,
        config?.orchestrator?.model || parsed.rootModel || ""
      )
      const agents = buildClaudeAgents(repoRoot, configPath, config, parsed.fullPrompts, parsed.strictHierarchy)

      return {
        ok: true,
        exec: this.directCli,
        args: ["code", "--append-system-prompt", rootPrompt, "--agents", JSON.stringify(agents)],
        passthrough: parsed.passthrough,
        envOverrides,
        warnings: [
          ...(parsed.sessionMirror === true ? ["claude: session mirroring metadata is not implemented in the core-integrated path"] : []),
          ...(domainCoverage.granularAgents.length > 0 && !policyTokens.includes("enforce-domain")
            ? [
                `claude: domain rules are declarative in --agents prompts and are not path-enforced by Claude runtime (${domainCoverage.granularAgents.length} agent(s) with granular domain).`
              ]
            : [])
        ],
        internal: {
          crew, configPath,
          systemName: config?.name || "MultiTeam",
          strictHierarchy: parsed.strictHierarchy,
          rootModel: parsed.rootModel,
          dryRun: parsed.dryRun,
          showLaunchInfo: parsed.showLaunchInfo,
          customAgents: Object.keys(agents).length
        }
      }
    },

    prepareHeadlessRunContext({ repoRoot, task = "", argv = [], envOverrides = {} }) {
      if (!task && (!argv || argv.length === 0)) {
        return {
          ok: false,
          error: "Claude headless requires a task prompt"
        }
      }
      return {
        ok: true,
        exec: "claude",
        args: ["-p"],
        passthrough: task ? [task] : argv,
        envOverrides: {
          ...envOverrides,
          CLAUDE_HEADLESS: "1"
        },
        warnings: [],
        internal: {
          mode: "headless",
          promptMode: "argv",
          runtime: "claude"
        }
      }
    },

    activateCrew({ repoRoot, crewId }) {
      const runtimeRoot = path.join(repoRoot, ".claude")
      const configPath = path.join(runtimeRoot, "crew", crewId, "multi-team.yaml")
      const sessionRoot = path.join(runtimeRoot, "crew", crewId, "sessions")
      mkdirSync(sessionRoot, { recursive: true })
      const payload = {
        crew: crewId,
        source_config: rel(repoRoot, configPath),
        session_root: rel(repoRoot, sessionRoot),
        activated_at: new Date().toISOString(),
        note: "Used by MAH core to bootstrap Claude runtime with selected crew."
      }
      writeJson(path.join(runtimeRoot, ".active-crew.json"), payload)
      return payload
    },

    clearCrewState({ repoRoot }) {
      removeIfExists(path.join(repoRoot, ".claude", ".active-crew.json"))
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
    if (process.env.MAH_DEBUG_PLUGINS === "1") console.log(`[claude] plugin loaded (MAH ${ctx.mahVersion})`)
  },
  teardown() {
    if (process.env.MAH_DEBUG_PLUGINS === "1") console.log("[claude] plugin unloaded")
  }
}
