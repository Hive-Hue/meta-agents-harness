import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import YAML from "yaml"
import { readActiveCrew } from "./runtime-core-ops.mjs"
import { mapModelToCcrRef } from "./ccr-model-helper.mjs"
import { createRequire } from "node:module"
import { resolveMahAssetPath } from "../core/mah-home.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.resolve(__dirname, "..")

function toPosix(targetPath) {
  return `${targetPath || ""}`.replaceAll(path.sep, "/")
}

function rel(repoRoot, targetPath) {
  return toPosix(path.relative(repoRoot, targetPath))
}

function readJson(targetPath) {
  if (!existsSync(targetPath)) return null
  try {
    return JSON.parse(readFileSync(targetPath, "utf-8"))
  } catch {
    return null
  }
}

function writeJson(targetPath, payload) {
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
}

function readYaml(targetPath) {
  return YAML.parse(readFileSync(targetPath, "utf-8"))
}

function safeReadText(targetPath) {
  if (!targetPath || !existsSync(targetPath)) return ""
  try {
    return readFileSync(targetPath, "utf-8")
  } catch {
    return ""
  }
}

function listSubdirs(rootPath) {
  if (!existsSync(rootPath)) return []
  return readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

function resolveFromRepo(repoRoot, targetPath) {
  if (!targetPath) return ""
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(repoRoot, targetPath)
}

function resolveMahPackageRoot() {
  const override = `${process.env.MAH_PACKAGE_ROOT || ""}`.trim()
  if (override) return path.isAbsolute(override) ? override : path.resolve(override)
  return packageRoot
}

function resolvePiAssetPath(repoRoot, targetPath) {
  return resolveMahAssetPath(repoRoot, targetPath, { packageRoot: resolveMahPackageRoot() })
}

function removeIfExists(targetPath) {
  if (!existsSync(targetPath)) return
  const stat = lstatSync(targetPath)
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    rmSync(targetPath, { recursive: true, force: true })
    return
  }
  rmSync(targetPath, { force: true })
}

function forceSymlink(targetPath, linkPath) {
  removeIfExists(linkPath)
  mkdirSync(path.dirname(linkPath), { recursive: true })
  const relativeTarget = path.relative(path.dirname(linkPath), targetPath)
  symlinkSync(relativeTarget, linkPath)
}

function newSessionId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const rand = Math.random().toString(36).slice(2, 8)
  return `${stamp}-${rand}`
}

function parseInlineFlag(argv, flagName) {
  const collected = []
  const remaining = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === flagName && argv[i + 1]) {
      collected.push(argv[i + 1])
      i += 1
      continue
    }
    if (token.startsWith(`${flagName}=`)) {
      collected.push(token.slice(flagName.length + 1))
      continue
    }
    remaining.push(token)
  }
  return { values: collected.filter(Boolean), remaining }
}

function stripFlags(argv, flags) {
  const flagSet = new Set(flags)
  const remaining = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (flagSet.has(token)) continue
    remaining.push(token)
  }
  return remaining
}

function hasContinueLikeFlag(argv = []) {
  return argv.includes("-c") || argv.includes("--continue") || argv.includes("--resume") || argv.includes("-r")
}

function latestSessionRoot(sessionBaseRoot) {
  if (!existsSync(sessionBaseRoot)) return ""
  const candidates = readdirSync(sessionBaseRoot)
    .map((entry) => path.join(sessionBaseRoot, entry))
    .filter((entryPath) => {
      try {
        return statSync(entryPath).isDirectory()
      } catch {
        return false
      }
    })
    .sort((left, right) => {
      try {
        return statSync(right).mtimeMs - statSync(left).mtimeMs
      } catch {
        return 0
      }
    })
  return candidates[0] || ""
}

function parseDotEnv(raw) {
  const out = {}
  for (const line of `${raw || ""}`.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed
    const separator = normalized.indexOf("=")
    if (separator <= 0) continue
    const key = normalized.slice(0, separator).trim()
    if (!/^[A-Z0-9_]+$/i.test(key)) continue
    let value = normalized.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function loadPiRuntimeEnv(repoRoot, baseEnvOverrides = {}) {
  const candidates = [
    process.env.PI_ENV_FILE?.trim() ? resolveFromRepo(repoRoot, process.env.PI_ENV_FILE.trim()) : "",
    path.join(repoRoot, "multi-agents", ".env"),
    path.join(repoRoot, ".env")
  ].filter(Boolean)

  const loaded = {}
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue
    const parsed = parseDotEnv(readFileSync(filePath, "utf-8"))
    for (const [key, value] of Object.entries(parsed)) {
      if ((process.env[key] == null || process.env[key] === "") && (baseEnvOverrides[key] == null || baseEnvOverrides[key] === "")) {
        loaded[key] = value
      }
    }
  }
  return loaded
}

function loadPiDefaultExtensions(repoRoot) {
  const fallbackExtensions = [
    "extensions/multi-team.ts",
    "extensions/agent-session-navigator.ts",
    "extensions/mcp-bridge.ts",
    "extensions/theme-cycler.ts"
  ]
  const metaPath = path.join(repoRoot, "meta-agents.yaml")
  if (!existsSync(metaPath)) return fallbackExtensions
  try {
    const meta = YAML.parse(readFileSync(metaPath, "utf-8")) || {}
    const configured = meta?.runtimes?.pi?.default_extensions
    if (!Array.isArray(configured) || configured.length === 0) return fallbackExtensions
    const normalized = configured.map((item) => `${item || ""}`.trim()).filter(Boolean)
    return normalized.length > 0 ? normalized : fallbackExtensions
  } catch {
    return fallbackExtensions
  }
}

function parsePiExtensionArgs(repoRoot, argv = []) {
  const collected = []
  const remaining = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === "--extension" && argv[i + 1]) {
      collected.push(argv[i + 1])
      i += 1
      continue
    }
    if (token.startsWith("--extension=")) {
      collected.push(token.slice("--extension=".length))
      continue
    }
    remaining.push(token)
  }
  const values = collected
    .flatMap((item) => `${item || ""}`.split(","))
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => resolvePiAssetPath(repoRoot, item))
  return { extensionPaths: Array.from(new Set(values)), remaining }
}

function resolvePiSessionLayout(repoRoot, crew, argv = [], baseEnvOverrides = {}) {
  const sessionRootParse = parseInlineFlag(argv, "--session-root")
  const explicitRoots = sessionRootParse.values.map((item) => resolveFromRepo(repoRoot, item))
  let remaining = sessionRootParse.remaining

  const newSessionRequested = remaining.includes("--new-session")
  remaining = stripFlags(remaining, ["--new-session"])

  const envSessionRoot = `${baseEnvOverrides.PI_MULTI_SESSION_ROOT || process.env.PI_MULTI_SESSION_ROOT || ""}`.trim()
  const envSessionId = `${baseEnvOverrides.PI_MULTI_SESSION_ID || process.env.PI_MULTI_SESSION_ID || ""}`.trim()

  const explicitRoot = explicitRoots[explicitRoots.length - 1] || (envSessionRoot ? resolveFromRepo(repoRoot, envSessionRoot) : "")
  const sessionBaseRoot = explicitRoot || path.join(repoRoot, ".pi", "crew", crew, "sessions")
  const continueRequested = hasContinueLikeFlag(remaining)

  if (explicitRoot && path.basename(explicitRoot) !== "sessions") {
    return {
      passthrough: remaining,
      sessionBaseRoot: path.dirname(explicitRoot),
      sessionRoot: explicitRoot,
      sessionId: envSessionId || path.basename(explicitRoot),
      sessionMode: "explicit-root"
    }
  }

  if (!newSessionRequested && continueRequested) {
    const latest = latestSessionRoot(sessionBaseRoot)
    if (latest) {
      return {
        passthrough: remaining,
        sessionBaseRoot,
        sessionRoot: latest,
        sessionId: envSessionId || path.basename(latest),
        sessionMode: "continue-latest"
      }
    }
  }

  const sessionId = envSessionId || newSessionId()
  return {
    passthrough: remaining,
    sessionBaseRoot,
    sessionRoot: path.join(sessionBaseRoot, sessionId),
    sessionId,
    sessionMode: "new"
  }
}

function stripFrontmatter(raw) {
  const match = `${raw || ""}`.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/)
  return match ? match[1].trim() : `${raw || ""}`.trim()
}

function loadPromptBody(repoRoot, configPath, promptPath) {
  const candidates = [
    resolveFromRepo(repoRoot, promptPath),
    path.resolve(path.dirname(configPath), promptPath)
  ]
  for (const candidate of candidates) {
    const raw = safeReadText(candidate)
    if (raw.trim()) {
      return {
        body: stripFrontmatter(raw),
        resolvedPath: candidate
      }
    }
  }
  return { body: "", resolvedPath: candidates[0] || "" }
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
  const declaredAgents = []
  const collect = (agent) => {
    if (!agent?.name) return
    const rules = normalizeDomainRules(agent.domain)
    if (rules.length === 0) return
    declaredAgents.push(agent.name)
    if (hasGranularDomainRules(agent.domain)) granularAgents.push(agent.name)
  }
  collect(config?.orchestrator)
  for (const team of config?.teams || []) {
    collect(team?.lead)
    for (const member of team?.members || []) collect(member)
  }
  return { granularAgents, declaredAgents }
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
    const members = Array.isArray(team?.members) ? team.members.map((member) => member?.name).filter(Boolean) : []
    if (strictHierarchy) {
      teamLines.push(`- ${team?.name || "unknown"}: ${lead}`)
    } else {
      teamLines.push(`- ${team?.name || "unknown"}: ${lead}${members.length > 0 ? ` -> ${members.join(", ")}` : ""}`)
    }
  }

  const rcm=mapModelToCcrRef(rootModel)
  return [
    rcm?"<CCR-ROOT-MODEL>"+rcm+"</CCR-ROOT-MODEL>":"",
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
    strictHierarchy
      ? `- Delegate only to leads.`
      : `- Delegate to leads and workers as needed, with explicit deliverables.`,
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
      const leadCcrModel = mapModelToCcrRef(lead.model)
      const leadTools = normalizeAgentTools(lead.tools)
      const leadDomainLine = buildDomainPromptLine(lead.domain)
      agents[lead.name] = {
        description: lead.description || `Lead agent for team ${teamName}`,
        ...(leadTools.length > 0 ? { tools: leadTools } : {}),
        prompt: [
          leadCcrModel?"<CCR-SUBAGENT-MODEL>"+leadCcrModel+"</CCR-SUBAGENT-MODEL>":"",
          `Current role: lead`,
          `Current team: ${teamName}`,
          `Current agent: ${lead.name}`,
          `System: ${config?.name || "MultiTeam"}`,
          `Prompt source: ${lead.prompt}`,
          strictHierarchy
            ? `- Delegate only to workers from your own team.`
            : `- You may delegate within your team as needed.`,
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
      const memberCcrModel = mapModelToCcrRef(member.model)
      const memberTools = normalizeAgentTools(member.tools)
      const memberDomainLine = buildDomainPromptLine(member.domain)
      agents[member.name] = {
        description: member.description || `Worker agent for team ${teamName}`,
        ...(memberTools.length > 0 ? { tools: memberTools } : {}),
        prompt: [
          memberCcrModel?"<CCR-SUBAGENT-MODEL>"+memberCcrModel+"</CCR-SUBAGENT-MODEL>":"",
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

  const sessionMirror = remaining.includes("--session-mirror")
    ? true
    : remaining.includes("--no-session-mirror")
      ? false
      : null
  remaining = stripFlags(remaining, ["--session-mirror", "--no-session-mirror"])

  const hierarchy = remaining.includes("--hierarchy")
    ? true
    : remaining.includes("--no-hierarchy")
      ? false
      : true
  remaining = stripFlags(remaining, ["--hierarchy", "--no-hierarchy"])

  const policyParse = parseInlineFlag(remaining, "--policy")
  remaining = policyParse.remaining
  const rootModelParse = parseInlineFlag(remaining, "--root-model")
  remaining = rootModelParse.remaining

  return {
    passthrough: remaining,
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

function parseOpenclaudeInternalArgs(argv = []) {
  let remaining = [...argv]
  const dryRun = remaining.includes("--dry-run")
  remaining = stripFlags(remaining, ["--dry-run"])
  const showLaunchInfo = remaining.includes("--show-launch-info")
  remaining = stripFlags(remaining, ["--show-launch-info"])
  const fullPrompts = remaining.includes("--full-prompts")
  remaining = stripFlags(remaining, ["--full-prompts"])
  const hierarchy = remaining.includes("--hierarchy")
    ? true
    : remaining.includes("--no-hierarchy")
      ? false
      : true
  remaining = stripFlags(remaining, ["--hierarchy", "--no-hierarchy"])
  const providerParse = parseInlineFlag(remaining, "--provider")
  remaining = providerParse.remaining
  return {
    passthrough: remaining,
    dryRun,
    showLaunchInfo,
    fullPrompts,
    strictHierarchy: hierarchy,
    provider: providerParse.values.at(-1) || ""
  }
}

function resolveOpenclaudeProviderEnv(provider, envOverrides = {}) {
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

function parseOpencodeRunArgs(argv = []) {
  const hierarchy = argv.includes("--hierarchy")
    ? true
    : argv.includes("--no-hierarchy")
      ? false
      : null
  const passthrough = stripFlags(argv, ["--hierarchy", "--no-hierarchy"])
  return { hierarchy, passthrough }
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

function hasOpencodeModelFlag(args = []) {
  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`
    if (token === "-m" || token === "--model" || token.startsWith("--model=")) return true
  }
  return false
}

function readOpencodeAgentModel(repoRoot, crew, agentName = "") {
  const requested = `${agentName || ""}`.trim().toLowerCase()
  if (!requested) return ""
  const configPath = path.join(repoRoot, ".opencode", "crew", crew, "multi-team.yaml")
  if (!existsSync(configPath)) return ""
  try {
    const config = readYaml(configPath)
    const orchestrator = config?.orchestrator
    if (
      `${orchestrator?.name || ""}`.trim().toLowerCase() === requested ||
      `${orchestrator?.id || ""}`.trim().toLowerCase() === requested
    ) {
      return `${orchestrator?.model || ""}`.trim()
    }
    for (const team of Array.isArray(config?.teams) ? config.teams : []) {
      if (
        `${team?.lead?.name || ""}`.trim().toLowerCase() === requested ||
        `${team?.lead?.id || ""}`.trim().toLowerCase() === requested
      ) {
        return `${team?.lead?.model || ""}`.trim()
      }
      for (const member of Array.isArray(team?.members) ? team.members : []) {
        if (
          `${member?.name || ""}`.trim().toLowerCase() === requested ||
          `${member?.id || ""}`.trim().toLowerCase() === requested
        ) {
          return `${member?.model || ""}`.trim()
        }
      }
    }
  } catch {
    return ""
  }
  return ""
}

function getOpencodeModelArgs(agentModel = "", passthroughArgs = []) {
  if (!agentModel || hasOpencodeModelFlag(passthroughArgs)) return []
  return ["-m", agentModel]
}

function shouldUseOpencodeRunSubcommand(argv = []) {
  if (!Array.isArray(argv) || argv.length === 0) return false
  return argv.some((token) => {
    const value = `${token || ""}`.trim()
    if (!value) return false
    return !value.startsWith("-")
  })
}

function parseJsonPayload(raw) {
  const input = `${raw || ""}`.trim()
  if (!input) return null
  try {
    return JSON.parse(input)
  } catch {
  }
  const starts = ["[", "{"]
  for (const token of starts) {
    const start = input.indexOf(token)
    if (start === -1) continue
    const endToken = token === "[" ? "]" : "}"
    const end = input.lastIndexOf(endToken)
    if (end === -1 || end <= start) continue
    const slice = input.slice(start, end + 1)
    try {
      return JSON.parse(slice)
    } catch {
    }
  }
  return null
}

function parseOpencodeSessionIdFromArgs(tokens = []) {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = `${tokens[i] || ""}`.trim()
    if (!token) continue
    if ((token === "--session" || token === "-s") && tokens[i + 1]) {
      return `${tokens[i + 1] || ""}`.trim()
    }
    if (token.startsWith("--session=")) {
      return token.slice("--session=".length).trim()
    }
  }
  return ""
}

function listOpencodeProjectSessions(repoRoot, envOverrides = {}) {
  const probe = spawnSync("opencode", ["session", "list", "--format", "json"], {
    cwd: repoRoot,
    env: { ...process.env, ...envOverrides },
    encoding: "utf-8"
  })
  if (probe.status !== 0) return []
  const parsed = parseJsonPayload(probe.stdout)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((item) => item && typeof item === "object")
    .filter((item) => {
      const directory = `${item.directory || ""}`.trim()
      if (!directory) return true
      return path.resolve(directory) === path.resolve(repoRoot)
    })
    .map((item) => ({
      id: `${item.id || ""}`.trim(),
      updated: Number.isFinite(item.updated) ? item.updated : Number.parseInt(`${item.updated || 0}`, 10) || 0
    }))
    .filter((item) => item.id)
    .sort((left, right) => right.updated - left.updated)
}

function resolveOpencodeSessionIdForMirror(repoRoot, plan, envOverrides = {}) {
  const args = [...(plan.args || []), ...(plan.passthrough || [])]
  const explicit = parseOpencodeSessionIdFromArgs(args)
  if (explicit) return explicit
  const sessions = listOpencodeProjectSessions(repoRoot, envOverrides)
  return sessions[0]?.id || ""
}

function parseClaudeResumeSessionId(args = []) {
  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`.trim()
    if (!token) continue
    if ((token === "--resume" || token === "-r") && args[i + 1]) {
      return `${args[i + 1] || ""}`.trim()
    }
    if (token.startsWith("--resume=")) {
      return token.slice("--resume=".length).trim()
    }
  }
  return ""
}

function resolveClaudeConfigRoot(envOverrides = {}) {
  const explicit = `${envOverrides.CLAUDE_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR || ""}`.trim()
  if (explicit) return explicit
  const home = `${envOverrides.HOME || process.env.HOME || ""}`.trim()
  if (!home) return ""
  return path.join(home, ".claude")
}

function resolveClaudeProjectSlug(repoRoot) {
  const resolved = path.resolve(repoRoot).replaceAll("\\", "/")
  const noLeadingSlash = resolved.replace(/^\/+/, "")
  const flattened = noLeadingSlash.replaceAll("/", "-").replaceAll(":", "")
  return resolved.startsWith("/") ? `-${flattened}` : flattened
}

function resolveClaudeProjectSessionsDir(repoRoot, envOverrides = {}) {
  const configRoot = resolveClaudeConfigRoot(envOverrides)
  if (!configRoot) return ""
  return path.join(configRoot, "projects", resolveClaudeProjectSlug(repoRoot))
}

function resolveClaudeSessionTranscriptPath(repoRoot, sessionId, envOverrides = {}) {
  const cleanSessionId = `${sessionId || ""}`.trim()
  if (!cleanSessionId) return ""
  const sessionsDir = resolveClaudeProjectSessionsDir(repoRoot, envOverrides)
  if (!sessionsDir) return ""
  const transcriptPath = path.join(sessionsDir, `${cleanSessionId}.jsonl`)
  return existsSync(transcriptPath) ? transcriptPath : ""
}

function latestClaudeSessionId(repoRoot, envOverrides = {}) {
  const sessionsDir = resolveClaudeProjectSessionsDir(repoRoot, envOverrides)
  if (!sessionsDir || !existsSync(sessionsDir)) return ""
  const candidates = readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => {
      const fullPath = path.join(sessionsDir, entry.name)
      const id = entry.name.slice(0, -".jsonl".length).trim()
      const mtime = statSync(fullPath).mtimeMs || 0
      return { id, mtime }
    })
    .filter((item) => item.id)
    .sort((left, right) => right.mtime - left.mtime)
  return candidates[0]?.id || ""
}

function trackClaudeSessionAlias(repoRoot, crewId, sessionId, metadata = {}, envOverrides = {}) {
  const cleanCrew = `${crewId || ""}`.trim()
  const cleanSessionId = `${sessionId || ""}`.trim()
  if (!cleanCrew || !cleanSessionId) return

  const sessionDir = path.join(repoRoot, ".claude", "crew", cleanCrew, "sessions", cleanSessionId)
  mkdirSync(sessionDir, { recursive: true })

  const transcriptPath = resolveClaudeSessionTranscriptPath(repoRoot, cleanSessionId, envOverrides)
  if (transcriptPath) {
    forceSymlink(transcriptPath, path.join(sessionDir, "session.transcript.jsonl.link"))
  }

  writeJson(path.join(sessionDir, "session.alias.json"), {
    runtime: "claude",
    crew: cleanCrew,
    session_id: cleanSessionId,
    transcript_path: transcriptPath || "",
    tracked_at: new Date().toISOString(),
    ...metadata
  })
}

function resolveOpenclaudeConfigRoot(envOverrides = {}) {
  const explicit = `${envOverrides.OPENCLAUDE_CONFIG_DIR || process.env.OPENCLAUDE_CONFIG_DIR || ""}`.trim()
  if (explicit) return explicit
  return resolveClaudeConfigRoot(envOverrides)
}

function resolveOpenclaudeProjectSessionsDir(repoRoot, envOverrides = {}) {
  const configRoot = resolveOpenclaudeConfigRoot(envOverrides)
  if (!configRoot) return ""
  return path.join(configRoot, "projects", resolveClaudeProjectSlug(repoRoot))
}

function resolveOpenclaudeSessionTranscriptPath(repoRoot, sessionId, envOverrides = {}) {
  const cleanSessionId = `${sessionId || ""}`.trim()
  if (!cleanSessionId) return ""
  const sessionsDir = resolveOpenclaudeProjectSessionsDir(repoRoot, envOverrides)
  if (!sessionsDir) return ""
  const transcriptPath = path.join(sessionsDir, `${cleanSessionId}.jsonl`)
  return existsSync(transcriptPath) ? transcriptPath : ""
}

function latestOpenclaudeSessionId(repoRoot, envOverrides = {}) {
  const sessionsDir = resolveOpenclaudeProjectSessionsDir(repoRoot, envOverrides)
  if (!sessionsDir || !existsSync(sessionsDir)) return ""
  const candidates = readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => {
      const fullPath = path.join(sessionsDir, entry.name)
      const id = entry.name.slice(0, -".jsonl".length).trim()
      const mtime = statSync(fullPath).mtimeMs || 0
      return { id, mtime }
    })
    .filter((item) => item.id)
    .sort((left, right) => right.mtime - left.mtime)
  return candidates[0]?.id || ""
}

function trackOpenclaudeSessionAlias(repoRoot, crewId, sessionId, metadata = {}, envOverrides = {}) {
  const cleanCrew = `${crewId || ""}`.trim()
  const cleanSessionId = `${sessionId || ""}`.trim()
  if (!cleanCrew || !cleanSessionId) return

  const sessionDir = path.join(repoRoot, ".openclaude", "crew", cleanCrew, "sessions", cleanSessionId)
  mkdirSync(sessionDir, { recursive: true })

  const transcriptPath = resolveOpenclaudeSessionTranscriptPath(repoRoot, cleanSessionId, envOverrides)
  if (transcriptPath) {
    forceSymlink(transcriptPath, path.join(sessionDir, "session.transcript.jsonl.link"))
  }

  writeJson(path.join(sessionDir, "session.alias.json"), {
    runtime: "openclaude",
    crew: cleanCrew,
    session_id: cleanSessionId,
    transcript_path: transcriptPath || "",
    tracked_at: new Date().toISOString(),
    ...metadata
  })
}

function resolveOpencodeDbPath(repoRoot, envOverrides = {}) {
  const probe = spawnSync("opencode", ["db", "path"], {
    cwd: repoRoot,
    env: { ...process.env, ...envOverrides },
    encoding: "utf-8"
  })
  if (probe.status !== 0) return ""
  return `${probe.stdout || ""}`.trim().split("\n").map((line) => line.trim()).filter(Boolean)[0] || ""
}

function mirrorOpencodeSession(repoRoot, crewId, sessionId, envOverrides = {}) {
  if (!crewId || !sessionId) return
  const sessionRoot = path.join(repoRoot, ".opencode", "crew", crewId, "sessions", sessionId)
  mkdirSync(sessionRoot, { recursive: true })

  const dbPath = resolveOpencodeDbPath(repoRoot, envOverrides)
  if (dbPath && existsSync(dbPath)) {
    forceSymlink(dbPath, path.join(sessionRoot, "opencode.db.link"))
  }

  const exported = spawnSync("opencode", ["export", sessionId], {
    cwd: repoRoot,
    env: { ...process.env, ...envOverrides },
    encoding: "utf-8"
  })
  const exportedPayload = exported.status === 0 ? parseJsonPayload(exported.stdout) : null
  if (exportedPayload && typeof exportedPayload === "object") {
    writeJson(path.join(sessionRoot, "session.export.json"), exportedPayload)
  } else if (`${exported.stdout || ""}`.trim() || `${exported.stderr || ""}`.trim()) {
    writeFileSync(
      path.join(sessionRoot, "session.export.log"),
      `${exported.stdout || ""}${exported.stderr || ""}`,
      "utf-8"
    )
  }

  writeJson(path.join(sessionRoot, "session.alias.json"), {
    runtime: "opencode",
    crew: crewId,
    session_id: sessionId,
    db_path: dbPath || "",
    export_file: exportedPayload ? "session.export.json" : "",
    mirrored_at: new Date().toISOString()
  })
}

function getAllowDelegateForCrew(repoRoot, crew) {
  const metaPath = path.join(repoRoot, "meta-agents.yaml")
  if (!existsSync(metaPath)) return null
  try {
    const meta = YAML.parse(readFileSync(metaPath, "utf-8"))
    const crewConfig = meta?.crews?.find((item) => item.id === crew)
    return crewConfig?.runtime_overrides?.opencode?.permission?.task?.allow_delegate || null
  } catch {
    return null
  }
}

function patchOpencodeOrchestratorPrompt(repoRoot, crew, promptContent) {
  const match = `${promptContent || ""}`.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return promptContent
  let frontmatter = {}
  try {
    frontmatter = YAML.parse(match[1]) || {}
  } catch {
    return promptContent
  }

  const allowDelegate = getAllowDelegateForCrew(repoRoot, crew)
  const taskPermission = { "*": "deny" }
  if (allowDelegate && typeof allowDelegate === "object") {
    for (const [agent, allowedTargets] of Object.entries(allowDelegate)) {
      if (agent !== "orchestrator" || !Array.isArray(allowedTargets)) continue
      for (const target of allowedTargets) taskPermission[target] = "allow"
    }
  } else {
    taskPermission["planning-lead"] = "allow"
    taskPermission["engineering-lead"] = "allow"
    taskPermission["validation-lead"] = "allow"
  }

  frontmatter.permission = frontmatter.permission || {}
  frontmatter.permission.task = taskPermission
  const updatedFrontmatter = YAML.stringify(frontmatter).trimEnd()
  return `---\n${updatedFrontmatter}\n---\n${match[2]}`
}

function materializeOpencodeAgents(repoRoot, crew, hierarchy) {
  const runtimeRoot = path.join(repoRoot, ".opencode")
  const sourceAgents = path.join(runtimeRoot, "crew", crew, "agents")
  const activeAgentsPath = path.join(runtimeRoot, "agents")
  removeIfExists(activeAgentsPath)
  mkdirSync(activeAgentsPath, { recursive: true })
  writeFileSync(path.join(activeAgentsPath, ".gitkeep"), "", "utf-8")

  const files = readdirSync(sourceAgents).filter((entry) => entry.endsWith(".md")).sort((left, right) => left.localeCompare(right))
  for (const file of files) {
    const sourcePath = path.join(sourceAgents, file)
    const targetPath = path.join(activeAgentsPath, file)
    if (hierarchy && file === "orchestrator.md") {
      writeFileSync(targetPath, patchOpencodeOrchestratorPrompt(repoRoot, crew, readFileSync(sourcePath, "utf-8")), "utf-8")
    } else {
      const relativeTarget = path.relative(path.dirname(targetPath), sourcePath)
      symlinkSync(relativeTarget, targetPath)
    }
  }
}

function shouldBootstrapHermes(args = [], envOverrides = {}) {
  const sessionId = `${envOverrides.HERMES_SESSION_ID || process.env.HERMES_SESSION_ID || ""}`.trim()
  if (sessionId) return false
  return !args.some((token) => {
    return token === "-q" || token === "--query" || token === "-r" || token === "--resume" || token === "-c" || token === "--continue"
  })
}

function stripContinueFlags(argv = []) {
  return argv.filter((token) => token !== "-c" && token !== "--continue")
}

function latestHermesSessionId(repoRoot, envOverrides = {}) {
  const probe = spawnSync("hermes", ["sessions", "list", "--limit", "1"], {
    cwd: repoRoot,
    env: { ...process.env, ...envOverrides },
    encoding: "utf-8"
  })
  if (probe.status !== 0) return ""
  const lines = `${probe.stdout || ""}`.split("\n").map((line) => line.trim()).filter(Boolean)
  const candidate = lines.find((line) => /^.+\s+\S+$/.test(line) && !line.startsWith("usage:") && !line.startsWith("Preview") && !line.startsWith("─"))
  if (!candidate) return ""
  const tokens = candidate.split(/\s+/)
  return `${tokens[tokens.length - 1] || ""}`.trim()
}

function parseHermesResumeSessionId(args = []) {
  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`.trim()
    if (!token) continue
    if ((token === "--resume" || token === "-r") && args[i + 1]) {
      return `${args[i + 1] || ""}`.trim()
    }
    if (token.startsWith("--resume=")) {
      return token.slice("--resume=".length).trim()
    }
  }
  return ""
}

function trackHermesSessionAlias(repoRoot, crewId, sessionRoot, sessionId, metadata = {}) {
  const cleanCrew = `${crewId || ""}`.trim()
  const cleanSessionId = `${sessionId || ""}`.trim()
  if (!cleanCrew || !cleanSessionId) return

  const canonicalSessionDir = path.join(repoRoot, ".hermes", "crew", cleanCrew, "sessions", cleanSessionId)
  const configuredRoot = `${sessionRoot || ""}`.trim() ? resolveFromRepo(repoRoot, sessionRoot) : ""
  const configuredSessionDir = configuredRoot
    ? path.basename(configuredRoot) === cleanSessionId
      ? configuredRoot
      : path.join(configuredRoot, cleanSessionId)
    : ""

  const targetDirs = new Set([canonicalSessionDir, configuredSessionDir].filter(Boolean))
  for (const targetDir of targetDirs) {
    mkdirSync(targetDir, { recursive: true })
    writeJson(path.join(targetDir, "session.alias.json"), {
      runtime: "hermes",
      crew: cleanCrew,
      session_id: cleanSessionId,
      source_session_root: configuredRoot ? rel(repoRoot, configuredRoot) : "",
      tracked_at: new Date().toISOString(),
      ...metadata
    })
  }
}

function exportHermesSessionSnapshot(repoRoot, crewId, sessionId, envOverrides = {}) {
  const cleanCrew = `${crewId || ""}`.trim()
  const cleanSessionId = `${sessionId || ""}`.trim()
  if (!cleanCrew || !cleanSessionId) return { export_file: "", export_error: "" }

  const sessionDir = path.join(repoRoot, ".hermes", "crew", cleanCrew, "sessions", cleanSessionId)
  mkdirSync(sessionDir, { recursive: true })
  const exported = spawnSync("hermes", ["sessions", "export", "-", "--session-id", cleanSessionId], {
    cwd: repoRoot,
    env: { ...process.env, ...envOverrides },
    encoding: "utf-8"
  })
  const lines = `${exported.stdout || ""}`.split("\n").map((line) => line.trim()).filter(Boolean)
  const entries = []
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line))
    } catch {
      // Ignore non-JSONL lines from CLI logs/banners.
    }
  }

  if (entries.length > 0) {
    const payload = entries.length === 1 ? entries[0] : entries
    writeJson(path.join(sessionDir, "session.export.json"), payload)
    return { export_file: "session.export.json", export_error: "" }
  }

  const combinedLogs = `${exported.stdout || ""}${exported.stderr || ""}`.trim()
  if (combinedLogs) {
    writeFileSync(path.join(sessionDir, "session.export.log"), `${combinedLogs}\n`, "utf-8")
  }
  return {
    export_file: "",
    export_error: combinedLogs ? "export-output-not-jsonl" : `exit-${typeof exported.status === "number" ? exported.status : "unknown"}`
  }
}

function hasHermesModelFlag(args = []) {
  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`
    if (token === "-m" || token === "--model" || token.startsWith("--model=")) return true
  }
  return false
}

function hasHermesProviderFlag(args = []) {
  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`
    if (token === "--provider" || token.startsWith("--provider=")) return true
  }
  return false
}

function splitProviderModel(model = "") {
  const value = `${model || ""}`.trim()
  if (!value || !value.includes("/")) return { provider: "", model: value }
  const slashIndex = value.indexOf("/")
  if (slashIndex <= 0 || slashIndex >= value.length - 1) return { provider: "", model: value }
  const providerRaw = value.slice(0, slashIndex).trim()
  const providerAliases = {
    "zai-coding-plan": "zai",
    "minimax-coding-plan": "minimax"
  }
  const provider = providerAliases[providerRaw] || providerRaw
  return {
    provider,
    model: value.slice(slashIndex + 1).trim()
  }
}

function getHermesModelArgs(agentModel = "", passthroughArgs = []) {
  if (!agentModel || hasHermesModelFlag(passthroughArgs)) return []
  const { provider, model } = splitProviderModel(agentModel)
  if (!model) return []
  if (hasHermesProviderFlag(passthroughArgs)) return ["-m", model]
  if (provider) return ["--provider", provider, "-m", model]
  return ["-m", model]
}

function hasHermesQueryFlag(args = []) {
  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`
    if (token === "-q" || token === "--query" || token.startsWith("--query=")) return true
  }
  return false
}

function normalizeHermesPassthroughArgs(args = []) {
  if (!Array.isArray(args) || args.length === 0 || hasHermesQueryFlag(args)) return args

  const flagsWithValue = new Set(["-r", "--resume", "-c", "--continue", "-s", "--skills", "-m", "--model"])
  const mahOnlyFlags = new Set(["--with-context-memory", "--context-limit", "--context-mode"])
  const passthrough = []
  const promptTokens = []

  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`
    if (!token) continue
    if (token === "--context-limit" || token === "--context-mode") {
      if (args[i + 1] && !`${args[i + 1] || ""}`.startsWith("-")) {
        i += 1
      }
      continue
    }
    if (mahOnlyFlags.has(token) || token.startsWith("--context-limit=") || token.startsWith("--context-mode=")) {
      continue
    }
    if (token.startsWith("-")) {
      passthrough.push(token)
      if (flagsWithValue.has(token) && args[i + 1] && !`${args[i + 1] || ""}`.startsWith("-")) {
        passthrough.push(`${args[i + 1] || ""}`)
        i += 1
      }
      continue
    }
    promptTokens.push(token)
  }

  if (promptTokens.length === 0) return args
  return [...passthrough, "-q", promptTokens.join(" ")]
}

function stripHermesManagedArgs(args = []) {
  if (!Array.isArray(args) || args.length === 0) return []

  const managed = []
  for (let i = 0; i < args.length; i += 1) {
    const token = `${args[i] || ""}`
    if (!token) continue

    if (token === "--with-context-memory") {
      continue
    }

    if (token === "--context-limit" || token === "--context-mode") {
      if (args[i + 1] && !`${args[i + 1] || ""}`.startsWith("-")) {
        i += 1
      }
      continue
    }

    if (token.startsWith("--context-limit=") || token.startsWith("--context-mode=")) {
      continue
    }

    managed.push(token)
  }

  return managed
}

function readHermesAgentContext(repoRoot, configPath, multiTeamPath, envOverrides = {}) {
  const config = readYaml(configPath)
  const multiTeam = readYaml(multiTeamPath)
  const requestedAgent = `${envOverrides.MAH_AGENT || process.env.MAH_AGENT || config?.orchestrator?.name || "orchestrator"}`.trim()

  const byName = new Map()
  const orchestrator = multiTeam?.orchestrator || null
  if (orchestrator?.name) byName.set(orchestrator.name, { role: "orchestrator", team: "orchestration", ...orchestrator })
  for (const team of Array.isArray(multiTeam?.teams) ? multiTeam.teams : []) {
    if (team?.lead?.name) {
      byName.set(team.lead.name, { role: "lead", team: `${team?.name || ""}`.trim(), ...team.lead })
    }
    for (const member of Array.isArray(team?.members) ? team.members : []) {
      if (member?.name) byName.set(member.name, { role: "worker", team: `${team?.name || ""}`.trim(), ...member })
    }
  }

  const resolvedAgent =
    byName.get(requestedAgent) ||
    (config?.orchestrator?.name ? byName.get(config.orchestrator.name) : null) ||
    { name: requestedAgent || "orchestrator", role: "orchestrator", team: "orchestration" }

  const promptPath = resolveFromRepo(repoRoot, resolvedAgent?.prompt || config?.orchestrator?.prompt || "")
  const promptBody = stripFrontmatter(safeReadText(promptPath))
  const responsibilities = Array.isArray(resolvedAgent?.sprint_responsibilities)
    ? resolvedAgent.sprint_responsibilities.map((item) => `- ${item}`).join("\n")
    : "- n/a"
  const tools = Array.isArray(resolvedAgent?.tools) ? resolvedAgent.tools : []
  const skills = Array.isArray(resolvedAgent?.skills) ? resolvedAgent.skills : []

  return {
    config,
    agentName: `${resolvedAgent?.name || requestedAgent || "orchestrator"}`.trim(),
    agentRole: `${resolvedAgent?.role || "orchestrator"}`.trim(),
    agentTeam: `${resolvedAgent?.team || ""}`.trim(),
    agentModel: `${resolvedAgent?.model || config?.orchestrator?.model || ""}`.trim(),
    instructionBlock: `${resolvedAgent?.instruction_block || config?.instruction_block || ""}`.trim(),
    responsibilities,
    tools,
    skills,
    promptBody
  }
}

function buildHermesBootstrapQuery(agentCtx, contextBlock = null) {
  const mission = `${agentCtx?.config?.mission || ""}`.trim()
  const sprintName = `${agentCtx?.config?.sprint_mode?.name || ""}`.trim() || "n/a"
  const targetRelease = `${agentCtx?.config?.sprint_mode?.target_release || ""}`.trim() || "n/a"
  const roleLabel = `${agentCtx?.agentRole || "agent"}`.trim()
  const teamLabel = `${agentCtx?.agentTeam || "n/a"}`.trim()
  const toolLines = Array.isArray(agentCtx?.tools) && agentCtx.tools.length > 0
    ? agentCtx.tools.map((item) => `- ${item}`).join("\n")
    : "- n/a"
  const skillLines = Array.isArray(agentCtx?.skills) && agentCtx.skills.length > 0
    ? agentCtx.skills.map((item) => `- ${item}`).join("\n")
    : "- n/a"

  const parts = [
    "Load the following runtime context for this session and keep it active unless the user explicitly overrides it.",
    "",
    "You are not a generic assistant in this session.",
    "You are a Meta Agents Harness crew member for the current repository.",
    "",
    `Crew: ${agentCtx?.config?.crew || ""}`,
    `Current agent: ${agentCtx?.agentName || "orchestrator"}`,
    `Role: ${roleLabel}`,
    `Team: ${teamLabel}`,
    `Model: ${agentCtx?.agentModel || "n/a"}`,
    `Mission: ${mission || "n/a"}`,
    `Sprint: ${sprintName}`,
    `Target release: ${targetRelease}`,
    "",
    "Instruction block:",
    agentCtx?.instructionBlock || "n/a",
    "",
    "Agent responsibilities:",
    agentCtx?.responsibilities || "- n/a",
    "",
    "Expected tools in this role:",
    toolLines,
    "",
    "Crew skills referenced by the runtime:",
    skillLines,
    "",
    "Prompt body:",
    agentCtx?.promptBody || "n/a",
  ]

  // Append context memory block if provided
  if (contextBlock) {
    parts.push("")
    parts.push(contextBlock)
  }

  parts.push("")
  parts.push("Acknowledge with exactly: CONTEXT LOADED")

  return parts.join("\n")
}

export function activatePiCrewState({ repoRoot, crewId }) {
  const runtimeRoot = path.join(repoRoot, ".pi")
  const configPath = path.join(runtimeRoot, "crew", crewId, "multi-team.yaml")
  const sessionRoot = path.join(runtimeRoot, "crew", crewId, "sessions")
  mkdirSync(sessionRoot, { recursive: true })
  const payload = {
    crew: crewId,
    source_config: rel(repoRoot, configPath),
    session_root: rel(repoRoot, sessionRoot),
    activated_at: new Date().toISOString(),
    note: "Used by MAH core to bootstrap PI with selected crew."
  }
  writeJson(path.join(runtimeRoot, ".active-crew.json"), payload)
  return payload
}

export function clearPiCrewState({ repoRoot }) {
  removeIfExists(path.join(repoRoot, ".pi", ".active-crew.json"))
  return true
}

export function preparePiRunContext({ repoRoot, crew, configPath, argv = [], envOverrides = {} }) {
  if (!crew || !configPath) {
    return { ok: false, error: "no PI crew selected. Run 'mah use <crew>' or pass '--crew <crew>'." }
  }

  const extensionParse = parsePiExtensionArgs(repoRoot, argv)
  const session = resolvePiSessionLayout(repoRoot, crew, extensionParse.remaining, envOverrides)
  const extensionPaths = extensionParse.extensionPaths.length > 0
    ? extensionParse.extensionPaths
    : loadPiDefaultExtensions(repoRoot).map((item) => resolvePiAssetPath(repoRoot, item))
  const missingExtension = extensionPaths.find((item) => !existsSync(item))
  if (missingExtension) {
    return { ok: false, error: `PI extension not found locally, in ~/.mah, or in MAH package root: ${rel(repoRoot, missingExtension)}` }
  }

  const loadedEnv = loadPiRuntimeEnv(repoRoot, envOverrides)
  return {
    ok: true,
    exec: "pi",
    args: extensionPaths.flatMap((item) => ["-e", item]),
    passthrough: session.passthrough,
    envOverrides: {
      ...loadedEnv,
      ...envOverrides,
      MAH_RUNTIME: "pi",
      MAH_ACTIVE_CREW: crew,
      PI_MULTI_CONFIG: configPath,
      PI_MULTI_SESSION_ROOT: session.sessionRoot,
      PI_MULTI_SESSION_ID: session.sessionId
    },
    warnings: [],
    internal: {
      crew,
      configPath,
      sessionRoot: session.sessionRoot,
      sessionBaseRoot: session.sessionBaseRoot,
      sessionId: session.sessionId,
      sessionMode: session.sessionMode
    }
  }
}

export function activateClaudeCrewState({ repoRoot, crewId }) {
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
}

export function clearClaudeCrewState({ repoRoot }) {
  removeIfExists(path.join(repoRoot, ".claude", ".active-crew.json"))
  return true
}

export function prepareClaudeRunContext({ repoRoot, crew, configPath, argv = [], envOverrides = {} }) {
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
    exec: "ccr",
    args: [
      "code",
      "--append-system-prompt",
      rootPrompt,
      "--agents",
      JSON.stringify(agents)
    ],
    passthrough: parsed.passthrough,
    envOverrides: {
      ...envOverrides,
      MAH_RUNTIME: "claude",
      MAH_ACTIVE_CREW: crew
    },
    warnings: [
      ...(parsed.sessionMirror === true ? ["claude: session mirroring metadata is not implemented in the MAH-managed path"] : []),
      ...(domainCoverage.granularAgents.length > 0 && !policyTokens.includes("enforce-domain")
        ? [
            `claude: domain rules are declarative in --agents prompts and are not path-enforced by Claude runtime (${domainCoverage.granularAgents.length} agent(s) with granular domain).`
          ]
        : [])
    ],
    internal: {
      crew,
      configPath,
      systemName: config?.name || "MultiTeam",
      strictHierarchy: parsed.strictHierarchy,
      dryRun: parsed.dryRun,
      showLaunchInfo: parsed.showLaunchInfo,
      sessionMirror: parsed.sessionMirror,
      policy: parsed.policy,
      rootModel: parsed.rootModel,
      rootRoute: parsed.rootRoute,
      customAgents: Object.keys(agents).length
    }
  }
}

export function executeClaudePreparedRun({ repoRoot, plan, runCommand }) {
  const internal = plan.internal || {}
  if (internal.showLaunchInfo || internal.dryRun) {
    console.log("Running Claude Code via CCR (MAH-managed runtime)")
    console.log(`- config=${rel(repoRoot, internal.configPath)}`)
    console.log(`- system=${internal.systemName || "MultiTeam"}`)
    console.log(`- hierarchy=${internal.strictHierarchy ? "strict" : "relaxed"}`)
    console.log(`- custom_agents=${internal.customAgents || 0}`)
    console.log(`- runner=${plan.exec}`)
    if (plan.passthrough?.length > 0) console.log(`- args=${plan.passthrough.join(" ")}`)
    console.log("")
  }
  if (internal.dryRun) {
    const rendered = [...(plan.args || []), ...(plan.passthrough || [])]
      .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
      .join(" ")
    console.log(`[dry-run] ${plan.exec} ${rendered}`)
    return 0
  }
  const args = [...(plan.passthrough || [])]
  const envOverrides = { ...(plan.envOverrides || {}) }
  const resumedSessionId = parseClaudeResumeSessionId(args)
  if (resumedSessionId) {
    trackClaudeSessionAlias(repoRoot, internal.crew, resumedSessionId, {
      reason: "resume-arg"
    }, envOverrides)
  }

  const status = runCommand(plan.exec, plan.args || [], args, envOverrides)
  if (internal.sessionMirror === false) return status

  let finalSessionId = resumedSessionId
  if (!finalSessionId && status === 0) {
    finalSessionId = latestClaudeSessionId(repoRoot, envOverrides)
  }
  if (finalSessionId) {
    trackClaudeSessionAlias(repoRoot, internal.crew, finalSessionId, {
      reason: "post-run-latest-session"
    }, envOverrides)
  }
  return status
}

export function activateOpenclaudeCrewState({ repoRoot, crewId }) {
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
}

export function clearOpenclaudeCrewState({ repoRoot }) {
  removeIfExists(path.join(repoRoot, ".openclaude", ".active-crew.json"))
  return true
}

export function prepareOpenclaudeRunContext({ repoRoot, crew, configPath, argv = [], envOverrides = {} }) {
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
  const teamLines = []
  for (const team of config.teams || []) {
    const lead = team?.lead?.name || "(missing-lead)"
    const members = Array.isArray(team?.members) ? team.members.map((m) => m?.name).filter(Boolean) : []
    if (parsed.strictHierarchy) {
      teamLines.push(`- ${team?.name || "unknown"}: ${lead}`)
    } else {
      teamLines.push(`- ${team?.name || "unknown"}: ${lead}${members.length > 0 ? ` -> ${members.join(", ")}` : ""}`)
    }
  }
  const rootPrompt = [
    `Current role: orchestrator`,
    `Current agent: ${config?.orchestrator?.name || "orchestrator"}`,
    `System: ${config?.name || "MultiTeam"}`,
    `Mission: ${config?.mission || ""}`.trim(),
    `Hierarchy mode: ${parsed.strictHierarchy ? "strict" : "relaxed"}`,
    "",
    `Instruction block:`,
    `${config?.instruction_block || ""}`.trim() || "n/a",
    "",
    `Topology:`,
    ...teamLines,
    "",
    `Hard rules:`,
    parsed.strictHierarchy
      ? `- Delegate only to leads.`
      : `- Delegate to leads and workers as needed, with explicit deliverables.`,
    `- Keep responses concise and execution-oriented.`,
    "",
    parsed.fullPrompts && orchestratorPrompt.body ? `Agent operating prompt:\n${orchestratorPrompt.body}` : ""
  ].filter(Boolean).join("\n")

  const agents = {}
  for (const team of config.teams || []) {
    const teamName = team?.name || "unknown-team"
    const lead = team?.lead
    if (lead?.name && lead?.prompt) {
      const promptBody = parsed.fullPrompts ? loadPromptBody(repoRoot, configPath, lead.prompt).body : ""
      agents[lead.name] = {
        description: lead.description || `Lead agent for team ${teamName}`,
        prompt: [
          `Current role: lead`,
          `Current team: ${teamName}`,
          `Current agent: ${lead.name}`,
          `System: ${config?.name || "MultiTeam"}`,
          `Prompt source: ${lead.prompt}`,
          parsed.strictHierarchy
            ? `- Delegate only to workers from your own team.`
            : `- You may delegate within your team as needed.`,
          parsed.fullPrompts && promptBody ? `Agent operating prompt:\n${promptBody}` : ""
        ].filter(Boolean).join("\n")
      }
    }
    for (const member of team.members || []) {
      if (!member?.name || !member?.prompt) continue
      const promptBody = parsed.fullPrompts ? loadPromptBody(repoRoot, configPath, member.prompt).body : ""
      agents[member.name] = {
        description: member.description || `Worker agent for team ${teamName}`,
        prompt: [
          `Current role: worker`,
          `Current team: ${teamName}`,
          `Current agent: ${member.name}`,
          `System: ${config?.name || "MultiTeam"}`,
          `Prompt source: ${member.prompt}`,
          `- Do not delegate unless explicitly instructed.`,
          parsed.fullPrompts && promptBody ? `Agent operating prompt:\n${promptBody}` : ""
        ].filter(Boolean).join("\n")
      }
    }
  }

  const providerEnv = resolveOpenclaudeProviderEnv(parsed.provider, envOverrides)

  return {
    ok: true,
    exec: "openclaude",
    args: ["code", "--append-system-prompt", rootPrompt, "--agents", JSON.stringify(agents)],
    passthrough: parsed.passthrough,
    envOverrides: {
      ...envOverrides,
      ...providerEnv,
      MAH_RUNTIME: "openclaude",
      MAH_ACTIVE_CREW: crew
    },
    warnings: [],
    internal: {
      crew,
      configPath,
      systemName: config?.name || "MultiTeam",
      strictHierarchy: parsed.strictHierarchy,
      dryRun: parsed.dryRun,
      showLaunchInfo: parsed.showLaunchInfo,
      provider: parsed.provider,
      customAgents: Object.keys(agents).length
    }
  }
}

export function executeOpenclaudePreparedRun({ repoRoot, plan, runCommand }) {
  const internal = plan.internal || {}
  if (internal.showLaunchInfo || internal.dryRun) {
    console.log("Running OpenClaude (MAH-managed runtime)")
    console.log(`- config=${rel(repoRoot, internal.configPath)}`)
    console.log(`- system=${internal.systemName || "MultiTeam"}`)
    console.log(`- hierarchy=${internal.strictHierarchy ? "strict" : "relaxed"}`)
    console.log(`- custom_agents=${internal.customAgents || 0}`)
    if (internal.provider) console.log(`- provider=${internal.provider}`)
    if (plan.passthrough?.length > 0) console.log(`- args=${plan.passthrough.join(" ")}`)
    console.log("")
  }
  if (internal.dryRun) {
    const rendered = [...(plan.args || []), ...(plan.passthrough || [])]
      .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
      .join(" ")
    console.log(`[dry-run] ${plan.exec} ${rendered}`)
    return 0
  }
  const args = [...(plan.passthrough || [])]
  const envOverrides = { ...(plan.envOverrides || {}) }
  const resumedSessionId = parseClaudeResumeSessionId(args)
  if (resumedSessionId) {
    trackOpenclaudeSessionAlias(repoRoot, internal.crew, resumedSessionId, {
      reason: "resume-arg"
    }, envOverrides)
  }

  const status = runCommand(plan.exec, plan.args || [], args, envOverrides)

  let finalSessionId = resumedSessionId
  if (!finalSessionId && status === 0) {
    finalSessionId = latestOpenclaudeSessionId(repoRoot, envOverrides)
  }
  if (finalSessionId) {
    trackOpenclaudeSessionAlias(repoRoot, internal.crew, finalSessionId, {
      reason: "post-run-latest-session"
    }, envOverrides)
  }
  return status
}

export function activateOpencodeCrewState({ repoRoot, crewId, argv = [] }) {
  const runtimeRoot = path.join(repoRoot, ".opencode")
  const parse = parseOpencodeRunArgs(argv)
  const hierarchy = parse.hierarchy === true
  const sourceConfig = path.join(runtimeRoot, "crew", crewId, "multi-team.yaml")
  const sourceAgents = path.join(runtimeRoot, "crew", crewId, "agents")
  const sourceExpertise = path.join(runtimeRoot, "crew", crewId, "expertise")
  if (!existsSync(sourceConfig) || !existsSync(sourceAgents) || !existsSync(sourceExpertise)) {
    throw new Error(`OpenCode crew assets are incomplete for '${crewId}'`)
  }

  forceSymlink(sourceConfig, path.join(runtimeRoot, "multi-team.yaml"))
  materializeOpencodeAgents(repoRoot, crewId, hierarchy)

  const payload = {
    crew: crewId,
    source_config: rel(repoRoot, sourceConfig),
    source_agents: rel(repoRoot, sourceAgents),
    source_expertise: rel(repoRoot, sourceExpertise),
    hierarchy,
    selected_at: new Date().toISOString()
  }
  writeJson(path.join(runtimeRoot, ".active-crew.json"), payload)
  return payload
}

export function clearOpencodeCrewState({ repoRoot }) {
  const runtimeRoot = path.join(repoRoot, ".opencode")
  removeIfExists(path.join(runtimeRoot, "multi-team.yaml"))
  removeIfExists(path.join(runtimeRoot, "agents"))
  removeIfExists(path.join(runtimeRoot, ".active-crew.json"))
  removeIfExists(path.join(runtimeRoot, "expertise"))
  return true
}

export function prepareOpencodeRunContext({ repoRoot, crew, configPath, argv = [], envOverrides = {} }) {
  if (!crew || !configPath) {
    return { ok: false, error: "no OpenCode crew selected. Run 'mah use <crew>' or pass '--crew <crew>'." }
  }
  const parsed = parseOpencodeRunArgs(argv)
  const requestedAgent = `${envOverrides.MAH_AGENT || readAgentFlagFromArgs(parsed.passthrough) || process.env.MAH_AGENT || "orchestrator"}`.trim()
  const agentModel = readOpencodeAgentModel(repoRoot, crew, requestedAgent)
  const modelArgs = getOpencodeModelArgs(agentModel, parsed.passthrough)
  const commandArgs = shouldUseOpencodeRunSubcommand(parsed.passthrough) ? ["run"] : []
  return {
    ok: true,
    exec: "opencode",
    args: [...commandArgs, ...modelArgs],
    passthrough: parsed.passthrough,
    envOverrides: {
      ...envOverrides,
      MAH_RUNTIME: "opencode",
      MAH_ACTIVE_CREW: crew,
      ...(agentModel ? { MAH_AGENT_MODEL_CANONICAL: agentModel } : {})
    },
    warnings: [],
    internal: {
      crew,
      configPath,
      hierarchy: parsed.hierarchy,
      agentModel
    }
  }
}

export function executeOpencodePreparedRun({ repoRoot, plan, runCommand }) {
  const internal = plan.internal || {}
  if (internal.crew) {
    activateOpencodeCrewState({
      repoRoot,
      crewId: internal.crew,
      argv: internal.hierarchy === true ? ["--hierarchy"] : internal.hierarchy === false ? ["--no-hierarchy"] : []
    })
  }
  const envOverrides = plan.envOverrides || {}
  const status = runCommand(plan.exec, plan.args || [], plan.passthrough || [], envOverrides)
  try {
    if (internal.crew) {
      const explicitSessionId = parseOpencodeSessionIdFromArgs([...(plan.args || []), ...(plan.passthrough || [])])
      if (status !== 0 && !explicitSessionId) return status
      const sessionId = explicitSessionId || resolveOpencodeSessionIdForMirror(repoRoot, plan, envOverrides)
      if (sessionId) mirrorOpencodeSession(repoRoot, internal.crew, sessionId, envOverrides)
    }
  } catch (error) {
    const message = error?.message || String(error)
    console.error(`WARN: failed to mirror OpenCode session: ${message}`)
  }
  return status
}

export function activateHermesCrewState({ repoRoot, crewId }) {
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
}

export function clearHermesCrewState({ repoRoot }) {
  removeIfExists(path.join(repoRoot, ".hermes", ".active-crew.json"))
  return true
}

export function prepareHermesRunContext({ repoRoot, crew, configPath, argv = [], envOverrides = {} }) {
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
  const agentCtx = readHermesAgentContext(repoRoot, configPath, multiTeamPath, envOverrides)
  const modelArgs = getHermesModelArgs(agentCtx.agentModel, remaining)

  const normalizedPassthrough = stripHermesManagedArgs(normalizeHermesPassthroughArgs(remaining))

  return {
    ok: true,
    exec: "hermes",
    args: ["chat", ...modelArgs],
    passthrough: normalizedPassthrough,
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
      crew,
      configPath,
      multiTeamPath,
      sessionRoot,
      newSessionRequested,
      agentCtx,
      contextArgs: [...remaining]
    }
  }
}

export function executeHermesPreparedRun({ repoRoot, runtime, adapter, plan, runCommand }) {
  const internal = plan.internal || {}
  const active = readActiveCrew(repoRoot, adapter, runtime)
  if (internal.crew && `${active?.crew || ""}`.trim() !== `${internal.crew || ""}`.trim()) {
    activateHermesCrewState({ repoRoot, crewId: internal.crew })
  }

  let args = [...(plan.passthrough || [])]
  const envOverrides = { ...(plan.envOverrides || {}) }
  const explicitSessionId = `${envOverrides.HERMES_SESSION_ID || process.env.HERMES_SESSION_ID || ""}`.trim()
  const continueRequested = hasContinueLikeFlag(args)
  const hasExplicitResume = args.includes("--resume") || args.includes("-r")
  const currentActive = readActiveCrew(repoRoot, adapter, runtime)

  if (explicitSessionId && !hasExplicitResume) {
    args = stripContinueFlags(args)
    args.unshift("--resume", explicitSessionId)
    trackHermesSessionAlias(repoRoot, internal.crew, internal.sessionRoot, explicitSessionId, {
      reason: "env-session-id"
    })
  } else if (!hasExplicitResume && continueRequested) {
    const pinnedSession = `${currentActive?.crew === internal.crew ? currentActive?.orchestrator_session_id || "" : ""}`.trim()
    if (pinnedSession) {
      args = stripContinueFlags(args)
      args.unshift("--resume", pinnedSession)
      trackHermesSessionAlias(repoRoot, internal.crew, internal.sessionRoot, pinnedSession, {
        reason: "continue-pinned-active-crew"
      })
    }
  }

  const resumedSessionId = parseHermesResumeSessionId(args)
  if (resumedSessionId) {
    trackHermesSessionAlias(repoRoot, internal.crew, internal.sessionRoot, resumedSessionId, {
      reason: "resume-arg"
    })
  }

  if (shouldBootstrapHermes(args, envOverrides)) {
    const agentCtx = internal.agentCtx || readHermesAgentContext(repoRoot, internal.configPath, internal.multiTeamPath, envOverrides)

    // Inject context memory if enabled
    let contextBlock = null
    try {
      // Use createRequire for synchronous ESM require
      const req = createRequire(import.meta.url)
      const { buildContextMemoryBlock } = req("../context/context-memory-integration.mjs")
      contextBlock = buildContextMemoryBlock(agentCtx, internal.contextArgs || args, envOverrides)
    } catch (e) {
      // Context memory injection is optional — fail silently
    }

    const bootstrapQuery = buildHermesBootstrapQuery(agentCtx, contextBlock)
    const bootstrapModelArgs = getHermesModelArgs(agentCtx.agentModel, args)
    const bootstrap = spawnSync("hermes", ["chat", ...bootstrapModelArgs, "-Q", "-q", bootstrapQuery, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...envOverrides },
      encoding: "utf-8"
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
      trackHermesSessionAlias(repoRoot, internal.crew, internal.sessionRoot, pinnedSessionId, {
        reason: "bootstrap-pinned-session"
      })
    }
    const status = runCommand(plan.exec, plan.args || [], ["-c", ...args], envOverrides)
    const finalSessionId = pinnedSessionId || latestHermesSessionId(repoRoot, envOverrides)
    if (finalSessionId) {
      const exportMeta = exportHermesSessionSnapshot(repoRoot, internal.crew, finalSessionId, envOverrides)
      trackHermesSessionAlias(repoRoot, internal.crew, internal.sessionRoot, finalSessionId, {
        reason: "post-run-export",
        ...exportMeta
      })
    }
    return status
  }

  const status = runCommand(plan.exec, plan.args || [], args, envOverrides)
  let finalSessionId = resumedSessionId || explicitSessionId
  if (!finalSessionId && status === 0) {
    finalSessionId = latestHermesSessionId(repoRoot, envOverrides)
  }
  if (finalSessionId) {
    const exportMeta = exportHermesSessionSnapshot(repoRoot, internal.crew, finalSessionId, envOverrides)
    trackHermesSessionAlias(repoRoot, internal.crew, internal.sessionRoot, finalSessionId, {
      reason: "post-run-export",
      ...exportMeta
    })
  }
  return status
}

// =============================================================================
// Headless Run Context Preparers
// =============================================================================

/**
 * Prepare headless execution context for PI runtime.
 * PI supports native headless execution via direct CLI with task as argv.
 */
export function preparePiHeadlessRunContext({ repoRoot, task = "", argv = [], envOverrides = {} }) {
  const warnings = []

  if (!task && (!argv || argv.length === 0)) {
    return {
      ok: false,
      error: "PI headless requires a task prompt. Pass task as argument or via -- task."
    }
  }

  // PI can run headless with task passed as argument
  // Extensions are still loaded but in non-interactive mode
  const extensionParse = parsePiExtensionArgs(repoRoot, argv)
  const extensionPaths = extensionParse.extensionPaths.length > 0
    ? extensionParse.extensionPaths
    : loadPiDefaultExtensions(repoRoot).map((item) => resolvePiAssetPath(repoRoot, item))

  const loadedEnv = loadPiRuntimeEnv(repoRoot, envOverrides)

  // Build task args - PI accepts task directly as argument in headless mode
  const taskArgs = []
  if (task) {
    taskArgs.push(task)
  } else if (argv.length > 0) {
    taskArgs.push(...argv)
  }

  return {
    ok: true,
    exec: "pi",
    args: [
      ...extensionPaths.flatMap((item) => ["-e", item]),
      "-p"
    ],
    passthrough: taskArgs,
    envOverrides: {
      ...loadedEnv,
      ...envOverrides,
      PI_MULTI_HEADLESS: "1"
    },
    warnings: extensionPaths.some((item) => !existsSync(item))
      ? [...warnings, "some PI extensions not found locally, in ~/.mah, or in MAH package root, headless run may lack full functionality"]
      : warnings,
    internal: {
      mode: "headless",
      promptMode: "argv",
      runtime: "pi"
    }
  }
}

/**
 * Prepare headless execution context for Claude runtime.
 * Claude supports headless via -p flag for non-interactive output.
 */
export function prepareClaudeHeadlessRunContext({ repoRoot, task = "", argv = [], envOverrides = {} }) {
  const warnings = []

  if (!task && (!argv || argv.length === 0)) {
    return {
      ok: false,
      error: "Claude headless requires a task prompt. Pass task as argument or via -- task."
    }
  }

  // Build task args for Claude headless
  const taskArgs = []
  if (task) {
    taskArgs.push(task)
  } else if (argv.length > 0) {
    taskArgs.push(...argv)
  }

  // Claude in headless mode uses -p to run non-interactively
  return {
    ok: true,
    exec: "ccr",
    args: [
      "code",
      "-p"
    ],
    passthrough: taskArgs,
    envOverrides: {
      ...envOverrides,
      CLAUDE_HEADLESS: "1"
    },
    warnings: [...warnings],
    internal: {
      mode: "headless",
      promptMode: "argv",
      runtime: "claude"
    }
  }
}

/**
 * Prepare headless execution context for OpenClaude runtime.
 * OpenClaude supports headless via -p flag (same as Claude Code).
 */
export function prepareOpenclaudeHeadlessRunContext({ repoRoot, task = "", argv = [], envOverrides = {} }) {
  if (!task && (!argv || argv.length === 0)) {
    return {
      ok: false,
      error: "OpenClaude headless requires a task prompt. Pass task as argument or via -- task."
    }
  }

  const taskArgs = []
  if (task) {
    taskArgs.push(task)
  } else if (argv.length > 0) {
    taskArgs.push(...argv)
  }

  return {
    ok: true,
    exec: "openclaude",
    args: ["-p"],
    passthrough: taskArgs,
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
}

/**
 * Prepare headless execution context for OpenCode runtime.
 * OpenCode supports headless execution with task passed as argument.
 */
export function prepareOpencodeHeadlessRunContext({ repoRoot, task = "", argv = [], envOverrides = {} }) {
  const warnings = []

  if (!task && (!argv || argv.length === 0)) {
    return {
      ok: false,
      error: "OpenCode headless requires a task prompt. Pass task as argument or via -- task."
    }
  }

  // Build task args for OpenCode headless
  const taskArgs = []
  if (task) {
    taskArgs.push(task)
  } else if (argv.length > 0) {
    taskArgs.push(...argv)
  }

  return {
    ok: true,
    exec: "opencode",
    args: ["run"],
    passthrough: taskArgs,
    envOverrides: {
      ...envOverrides,
      OPENCODE_HEADLESS: "1"
    },
    warnings: [...warnings],
    internal: {
      mode: "headless",
      promptMode: "argv",
      runtime: "opencode"
    }
  }
}

/**
 * Prepare headless execution context for Hermes runtime.
 * Hermes requires an active session for headless execution (chat mode).
 */
export function prepareHermesHeadlessRunContext({ repoRoot, task = "", crew, configPath, argv = [], envOverrides = {} }) {
  const warnings = []

  // Hermes requires session for headless - check if we have session context
  const sessionId = `${envOverrides.HERMES_SESSION_ID || process.env.HERMES_SESSION_ID || ""}`.trim()

  if (!crew && !sessionId) {
    return {
      ok: false,
      error: "Hermes headless requires an active session. Use 'mah sessions new' to create one, or pass HERMES_SESSION_ID env var."
    }
  }

  if (!task && (!argv || argv.length === 0)) {
    return {
      ok: false,
      error: "Hermes headless requires a task prompt. Pass task as argument or via -- task."
    }
  }

  // Build task args for Hermes headless
  const taskArgs = []
  if (task) {
    taskArgs.push(task)
  } else if (argv.length > 0) {
    taskArgs.push(...argv)
  }
  const normalizedTaskArgs = stripHermesManagedArgs(normalizeHermesPassthroughArgs(taskArgs))

  // Hermes headless uses chat mode with -c for continue
  return {
    ok: true,
    exec: "hermes",
    args: ["chat"],
    passthrough: sessionId ? ["-c", ...normalizedTaskArgs] : normalizedTaskArgs,
    envOverrides: {
      ...envOverrides,
      HERMES_HEADLESS: "1",
      ...(crew ? { MAH_ACTIVE_CREW: crew } : {})
    },
    warnings: sessionId
      ? [...warnings]
      : [...warnings, "Hermes: running without explicit session-id, will use latest session"],
    internal: {
      mode: "headless",
      promptMode: "argv",
      outputMode: "mixed",
      requiresSession: true,
      runtime: "hermes"
    }
  }
}
