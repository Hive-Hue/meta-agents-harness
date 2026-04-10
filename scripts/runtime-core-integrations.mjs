import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { spawnSync } from "node:child_process"
import YAML from "yaml"
import { readActiveCrew } from "./runtime-core-ops.mjs"

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
    .map((item) => resolveFromRepo(repoRoot, item))
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

function buildClaudeRootPrompt(config, strictHierarchy, fullPrompts, orchestratorPromptBody) {
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
    strictHierarchy
      ? `- Delegate only to leads.`
      : `- Delegate to leads and workers as needed, with explicit deliverables.`,
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
      agents[lead.name] = {
        description: lead.description || `Lead agent for team ${teamName}`,
        prompt: [
          `Current role: lead`,
          `Current team: ${teamName}`,
          `Current agent: ${lead.name}`,
          `System: ${config?.name || "MultiTeam"}`,
          `Prompt source: ${lead.prompt}`,
          strictHierarchy
            ? `- Delegate only to workers from your own team.`
            : `- You may delegate within your team as needed.`,
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

function parseOpencodeRunArgs(argv = []) {
  const hierarchy = argv.includes("--hierarchy")
    ? true
    : argv.includes("--no-hierarchy")
      ? false
      : null
  const passthrough = stripFlags(argv, ["--hierarchy", "--no-hierarchy"])
  return { hierarchy, passthrough }
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
    : loadPiDefaultExtensions(repoRoot).map((item) => resolveFromRepo(repoRoot, item))
  const missingExtension = extensionPaths.find((item) => !existsSync(item))
  if (missingExtension) {
    return { ok: false, error: `PI extension not found: ${rel(repoRoot, missingExtension)}` }
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
  const rootPrompt = buildClaudeRootPrompt(
    config,
    parsed.strictHierarchy,
    parsed.fullPrompts,
    orchestratorPrompt.body
  )
  const agents = buildClaudeAgents(repoRoot, configPath, config, parsed.fullPrompts, parsed.strictHierarchy)

  return {
    ok: true,
    exec: "claude",
    args: [
      "--append-system-prompt",
      rootPrompt,
      "--agents",
      JSON.stringify(agents)
    ],
    passthrough: parsed.passthrough,
    envOverrides,
    warnings: parsed.sessionMirror === true ? ["claude: session mirroring metadata is not implemented in the core-integrated path"] : [],
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
    console.log("Running Claude Code via MAH core-integrated runtime config")
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
  return runCommand(plan.exec, plan.args || [], plan.passthrough || [], plan.envOverrides || {})
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
  return {
    ok: true,
    exec: "opencode",
    args: [],
    passthrough: parsed.passthrough,
    envOverrides,
    warnings: [],
    internal: {
      crew,
      configPath,
      hierarchy: parsed.hierarchy
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
  return runCommand(plan.exec, plan.args || [], plan.passthrough || [], plan.envOverrides || {})
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

  return {
    ok: true,
    exec: "hermes",
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
      crew,
      configPath,
      multiTeamPath,
      sessionRoot,
      newSessionRequested
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
    }
    return runCommand(plan.exec, plan.args || [], ["-c", ...args], envOverrides)
  }

  return runCommand(plan.exec, plan.args || [], args, envOverrides)
}
