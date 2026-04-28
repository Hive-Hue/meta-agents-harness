import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline/promises"
import { spawnSync } from "node:child_process"
import YAML from "yaml"
import { RUNTIME_ADAPTERS } from "../runtime/runtime-adapters.mjs"
import { findMahSkillFile, getMahPluginSearchPaths, resolveMahHome } from "../core/mah-home.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..", "..")
const cwd = process.cwd()
const targetPath = path.join(cwd, "meta-agents.yaml")
const AI_PROVIDER_PRESETS = [
  {
    id: "zai",
    label: "Z.ai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    endpoint: "/chat/completions",
    defaultModel: "glm-5",
    authPrompt: "Z.ai API key"
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    endpoint: "/chat/completions",
    defaultModel: "nvidia/nemotron-3-super-120b-a12b:free",
    authPrompt: "OpenRouter API key"
  },
  {
    id: "codex-oauth",
    label: "Codex (OAuth)",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    endpoint: "/responses",
    defaultModel: "gpt-5.4",
    authPrompt: "Codex OAuth access token"
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimax.io/v1",
    endpoint: "/chat/completions",
    defaultModel: "MiniMax-M2.5",
    authPrompt: "MiniMax API key"
  }
]

function parseArgs(argv) {
  const flags = new Set(argv.filter((item) => item.startsWith("--")))
  const getValue = (name) => {
    const idx = argv.findIndex((a) => a === name || a.startsWith(`${name}=`))
    if (idx === -1) return null
    if (argv[idx].includes("=")) return argv[idx].split("=").slice(1).join("=")
    return argv[idx + 1] || null
  }
  return {
    help: flags.has("--help") || flags.has("-h"),
    nonInteractive: flags.has("--non-interactive") || flags.has("--yes"),
    force: flags.has("--force"),
    ai: flags.has("--ai") || flags.has("--ai-assisted"),
    crew: getValue("--crew"),
    name: getValue("--name"),
    description: getValue("--description"),
    brief: getValue("--brief"),
    provider: getValue("--provider") || getValue("--ai-provider"),
    model: getValue("--model") || getValue("--ai-model"),
    apiKey: getValue("--api-key") || getValue("--ai-api-key"),
    baseUrl: getValue("--base-url") || getValue("--ai-base-url")
  }
}

function printHelp() {
  console.log(`
bootstrap-meta-agents - Generate a meta-agents.yaml configuration file

USAGE:
  node bootstrap-meta-agents.mjs [options]

OPTIONS:
  -h, --help              Show this help message
  --non-interactive, --yes  Run without prompts, use defaults
  --force                 Overwrite existing meta-agents.yaml
  --ai, --ai-assisted     Use AI-assisted generation mode
  --crew <id>             Primary crew ID (default: dev)
  --name <name>           Project name
  --description <desc>    Project description
  --brief <text>          Project brief for AI-assisted mode
  --provider <id>         AI provider preset: zai, openrouter, codex-oauth, minimax
  --model <id>            Model for direct HTTP AI bootstrap
  --api-key <key>         API key for direct HTTP AI bootstrap
  --base-url <url>        Override provider base URL

MODES:
  1. Logical (default): Generates config using templates and defaults
  2. AI-assisted: Invokes an AI model with the bootstrap skill
     to generate a tailored configuration based on project context

AI-ASSISTED MODE (optional acceleration):
  Uses direct HTTP calls through a provider preset when an API key is available.
  If no key is provided, MAH can still try installed AI runtimes
  (opencode, codex, kilo, or pi) before falling back to logical mode.

  What v0.9 adds to the generated config:
  - Expertise-aware routing: agents selected by skill match, not just order
  - Context Manager: operational memory fetched per task at runtime
  - Visible execution: lifecycle events, session status, trace on demand

  AI bootstrap is OPTIONAL. Logical mode produces a valid config without
  any runtime or API key. Use --ai only when you want topology suggestions.

EXAMPLES:
  # Interactive mode
  node bootstrap-meta-agents.mjs

  # Non-interactive with defaults
  node bootstrap-meta-agents.mjs --yes

  # AI-assisted generation
  node bootstrap-meta-agents.mjs --ai --provider openrouter --brief "E-commerce platform with microservices"

  # Force overwrite with AI
  node bootstrap-meta-agents.mjs --force --ai --name "my-project" --brief "CLI tool for data processing"
`)
}

function loadTemplateDoc() {
  const candidates = [
    path.join(repoRoot, "meta-agents.yaml"),
    path.join(repoRoot, "examples", "meta-agents.yaml.example"),
    path.join(repoRoot, "examples", "hermes", "meta-agents.hermes.example.yaml")
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const raw = readFileSync(candidate, "utf-8")
    const parsed = YAML.parse(raw)
    if (parsed && typeof parsed === "object") return parsed
  }
  return null
}

/**
 * Discover installed plugins from mah-plugins/ directory.
 * Reads each plugin's plugin.json to get all runtime configuration hints.
 * Returns a Map: pluginName -> { markerDir, directCli, wrapper, configRoot, configPattern }
 */
function discoverInstalledPlugins() {
  const plugins = new Map()
  const searchPaths = getMahPluginSearchPaths({ packageRoot: repoRoot, homeRoot: resolveMahHome() })
  for (const mahPluginsDir of searchPaths) {
    if (!existsSync(mahPluginsDir)) continue
    try {
      const entries = readdirSync(mahPluginsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const pluginJsonPath = path.join(mahPluginsDir, entry.name, "plugin.json")
        if (!existsSync(pluginJsonPath)) continue
        try {
          const meta = JSON.parse(readFileSync(pluginJsonPath, "utf-8"))
          if (!meta.name || plugins.has(meta.name)) continue
          plugins.set(meta.name, {
            markerDir: meta.markerDir || null,
            directCli: meta.directCli || null,
            wrapper: meta.wrapper || null,
            configRoot: meta.configRoot || null,
            configPattern: meta.configPattern || null
          })
        } catch {
          // skip malformed plugin.json
        }
      }
    } catch {
      // mah-plugins dir not readable
    }
  }
  return plugins
}

function ensureDefaults(doc) {
  const next = { ...(doc || {}) }
  delete next.runtime_detection
  delete next.catalog?.skills
  delete next.catalog?.shared_skills
  delete next.adapters
  next.version = 1
  next.name = `${next.name || path.basename(cwd) || "my-project"}`.trim()
  next.description = `${next.description || "Bootstrap configuration generated by MAH setup."}`.trim()
  // Runtime detection is now internal to MAH and intentionally omitted from YAML.
  // Installed plugins remain discoverable through runtime metadata rather than config.

  // runtimes: NOT generated from code. The YAML stores ONLY user-specific overrides
  // (e.g. model_overrides for opencode). All runtime properties come from
  // bundled runtime plugins and plugin.json (plugins) — those are code, not config.
  // Preserve existing YAML runtimes entries only if they contain user-specific config.
  // Bundled/installed plugin entries should not be duplicated in YAML.
  const allowedRuntimeOverrideKeys = new Set([
    "model_overrides",
    "permission",
    "ccr",
    "multi_team",
    "headless",
    "env",
    "args",
    "notes"
  ])
  const sanitizedRuntimes = {}
  const inputRuntimes = next.runtimes && typeof next.runtimes === "object" ? next.runtimes : {}
  for (const runtime of ["pi", "claude", "opencode", "openclaude", "hermes", "kilo", "codex"]) {
    const rawRuntime = inputRuntimes[runtime]
    const cleanedRuntime = {}
    if (rawRuntime && typeof rawRuntime === "object" && !Array.isArray(rawRuntime)) {
      for (const [key, value] of Object.entries(rawRuntime)) {
        if (!allowedRuntimeOverrideKeys.has(key)) continue
        if (key === "ccr" && value && typeof value === "object" && !Array.isArray(value)) {
          const cleanedCcr = {}
          if ("policy" in value) cleanedCcr.policy = value.policy
          if ("team_routes" in value) cleanedCcr.team_routes = value.team_routes
          if (Object.keys(cleanedCcr).length > 0) cleanedRuntime[key] = cleanedCcr
          continue
        }
        cleanedRuntime[key] = value
      }
    }
    sanitizedRuntimes[runtime] = cleanedRuntime
  }
  next.runtimes = sanitizedRuntimes

  next.catalog = next.catalog || {}
  next.catalog.models = {
    orchestrator_default: "minimax-coding-plan/MiniMax-M2.7",
    lead_default: "minimax-coding-plan/MiniMax-M2.7",
    worker_default: "openai-codex/gpt-5.3-codex",
    qa_default: "openai-codex/gpt-5.4-mini",
    ...(next.catalog.models || {})
  }
  next.catalog.model_fallbacks = next.catalog.model_fallbacks || {
    orchestrator_default: [
      "nvidia/nemotron-3-super-120b-a12b:free",
      "zai/glm-5",
      "minimax/minimax-m2.7",
      "openai/gpt-5.4-mini"
    ],
    lead_default: [
      "minimax/minimax-m2.7",
      "nvidia/nemotron-3-super-120b-a12b:free"
    ],
    worker_default: [
      "zai/glm-5",
      "minimax/minimax-m2.7",
      "nvidia/nemotron-3-super-120b-a12b:free"
    ]
  }
  next.domain_profiles = {
    read_only_cwd: [{ path: ".", read: true }],
    write_cwd: [{ path: ".", read: true, edit: true, bash: true, recursive: true }],
    write_user_home_with_approval: [
      {
        path: os.homedir(),
        read: true,
        upsert: true,
        delete: false,
        recursive: true,
        approval_required: true,
        approval_mode: "explicit_tui",
        grant_scope: "subtree"
      }
    ]
  }

  return next
}

function buildDefaultCrew(crewId, mission) {
  const displayName = crewId === "dev"
    ? "Development Crew"
    : `${crewId.split(/[-_\s]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ")} Crew`
  return {
    id: crewId,
    display_name: displayName,
    mission,
    topology: {
      orchestrator: "orchestrator",
      leads: {
        planning: "planning-lead",
        engineering: "engineering-lead",
        validation: "validation-lead"
      },
      workers: {
        planning: ["repo-analyst", "solution-architect"],
        engineering: ["frontend-dev", "backend-dev"],
        validation: ["qa-reviewer", "security-reviewer"]
      }
    },
    agents: [
      { id: "orchestrator", role: "orchestrator", team: "orchestration", model_ref: "orchestrator_default", expertise: "orchestrator-expertise-model", skills: ["delegate_bounded", "zero_micromanagement", "expertise_model"], domain_profile: "read_only_cwd" },
      { id: "planning-lead", role: "lead", team: "planning", model_ref: "lead_default", expertise: "planning-lead-expertise-model", skills: ["delegate_bounded", "zero_micromanagement", "expertise_model"], domain_profile: "read_only_cwd" },
      { id: "engineering-lead", role: "lead", team: "engineering", model_ref: "lead_default", expertise: "engineering-lead-expertise-model", skills: ["delegate_bounded", "zero_micromanagement", "expertise_model"], domain_profile: "read_only_cwd" },
      { id: "validation-lead", role: "lead", team: "validation", model_ref: "qa_default", expertise: "validation-lead-expertise-model", skills: ["delegate_bounded", "zero_micromanagement", "expertise_model"], domain_profile: "read_only_cwd" },
      { id: "repo-analyst", role: "worker", team: "planning", model_ref: "worker_default", expertise: "repo-analyst-expertise-model", skills: ["expertise_model"], domain_profile: "read_only_cwd" },
      { id: "solution-architect", role: "worker", team: "planning", model_ref: "worker_default", expertise: "solution-architect-expertise-model", skills: ["expertise_model"], domain_profile: "read_only_cwd" },
      { id: "frontend-dev", role: "worker", team: "engineering", model_ref: "worker_default", expertise: "frontend-dev-expertise-model", skills: ["expertise_model"], domain_profile: "write_cwd" },
      { id: "backend-dev", role: "worker", team: "engineering", model_ref: "worker_default", expertise: "backend-dev-expertise-model", skills: ["expertise_model"], domain_profile: "write_cwd" },
      { id: "qa-reviewer", role: "worker", team: "validation", model_ref: "qa_default", expertise: "qa-reviewer-expertise-model", skills: ["expertise_model"], domain_profile: "write_cwd" },
      { id: "security-reviewer", role: "worker", team: "validation", model_ref: "qa_default", expertise: "security-reviewer-expertise-model", skills: ["expertise_model"], domain_profile: "write_cwd" }
    ]
  }
}

function detectAvailableRuntimes() {
  const runtimes = [
    { name: "opencode", cli: "opencode", fileFlag: "-f", runCommand: "run", usesSkillFlag: false },
    { name: "codex", cli: "codex", runCommand: "exec", usesSkillFlag: false },
    { name: "kilo", cli: "kilo", runCommand: "run", usesSkillFlag: false },
    { name: "pi", cli: "pi", skillFlag: "--skill", printFlag: "-p", usesSkillFlag: true }
  ]
  const available = []
  for (const runtime of runtimes) {
    const result = spawnSync("bash", ["-lc", `command -v ${runtime.cli} >/dev/null 2>&1`], { stdio: "pipe" })
    if (result.status === 0) available.push(runtime)
  }
  return available
}

function getRepoContext() {
  const readmeCandidates = ["README.md", "readme.md", "README", "readme"]
  let readmeContent = null
  for (const candidate of readmeCandidates) {
    const readmePath = path.join(cwd, candidate)
    if (existsSync(readmePath)) {
      try {
        readmeContent = readFileSync(readmePath, "utf-8").slice(0, 2000)
      } catch {}
      break
    }
  }
  const detectedMarkers = []
  if (existsSync(path.join(cwd, ".opencode"))) detectedMarkers.push("opencode")
  if (existsSync(path.join(cwd, ".pi"))) detectedMarkers.push("pi")
  if (existsSync(path.join(cwd, ".claude"))) detectedMarkers.push("claude")
  if (existsSync(path.join(cwd, ".codex"))) detectedMarkers.push("codex")
  if (existsSync(path.join(cwd, ".kilo"))) detectedMarkers.push("kilo")
  if (existsSync(path.join(cwd, ".hermes"))) detectedMarkers.push("hermes")
  return { readmeContent, detectedMarkers, cwd }
}

function buildAiPrompt(inputs, repoContext) {
  const prompt = `Generate a meta-agents.yaml configuration file using the bootstrap skill guidelines.

OPERATOR INPUTS:
- Project name: ${inputs.projectName}
- Project description: ${inputs.description}
- Primary crew id: ${inputs.crewId}
- Crew mission: ${inputs.mission}
${inputs.brief ? `- Project brief: ${inputs.brief}` : ""}
${inputs.projectType ? `- Project type: ${inputs.projectType}` : ""}
${inputs.topologyPreference ? `- Topology preference: ${inputs.topologyPreference}` : ""}

REPOSITORY CONTEXT:
- Working directory: ${repoContext.cwd}
- Detected runtime markers: ${repoContext.detectedMarkers.length > 0 ? repoContext.detectedMarkers.join(", ") : "none"}
${repoContext.readmeContent ? `- README excerpt (first 1500 chars):\n\`\`\`\n${repoContext.readmeContent.slice(0, 1500)}\n\`\`\`` : ""}

CRITICAL OUTPUT REQUIREMENTS:
1. Output ONLY the raw YAML content - no explanations, no markdown code fences, no introductory text
2. Start directly with: version: 1
3. The output must be valid, parseable YAML
4. MUST include all required sections:
   - runtimes (pi, claude, kilo, opencode, hermes, openclaude, codex as override maps only)
   - catalog (models)
   - domain_profiles (at minimum: read_only_cwd)
   - crews (id, display_name, mission, topology, agents)
5. Do NOT emit legacy runtime wiring fields such as:
   - wrapper
   - config_root
   - extension_root
   - config_pattern
   - route_map
   - task_policy
   - default_extensions
5. Do NOT include runtime_detection; MAH applies runtime detection defaults internally
6. Do NOT include a per-runtime skills path matrix; skill paths are resolved internally by convention
7. Do NOT include an adapters block; MAH applies adapter mappings internally
8. Follow the skill guidelines for config quality
9. Use appropriate topology based on project complexity
10. Configure all runtimes (pi, claude, kilo, opencode, hermes) based on detected markers

Generate the complete meta-agents.yaml now:`
  return prompt
}

function loadDotEnv(env) {
  const next = { ...env }
  const envPath = path.join(cwd, ".env")
  if (!existsSync(envPath)) return next
  try {
    const envContent = readFileSync(envPath, "utf-8")
    envContent.split("\n").forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/)
      if (match) {
        const key = match[1].trim()
        const value = match[2].trim()
        if (key && value && !key.startsWith("#")) {
          next[key] = value.replace(/^["']|["']$/g, "")
        }
      }
    })
  } catch {}
  return next
}

function findAiProviderPreset(providerId) {
  const normalized = `${providerId || ""}`.trim().toLowerCase()
  if (!normalized) return null
  return AI_PROVIDER_PRESETS.find((provider) => provider.id === normalized || provider.label.toLowerCase() === normalized) || null
}

function resolveDirectAiOptions(inputs, env) {
  const provider = findAiProviderPreset(inputs.provider || env.MAH_AI_PROVIDER) || AI_PROVIDER_PRESETS[0]
  const providerEnvKey = `MAH_AI_${provider.id.toUpperCase().replaceAll("-", "_")}_API_KEY`
  const providerRawEnvKey = `${provider.id.toUpperCase().replaceAll("-", "_")}_API_KEY`
  const baseUrl = `${inputs.baseUrl || env.MAH_AI_BASE_URL || provider.baseUrl}`.trim().replace(/\/+$/, "")
  const apiKey = `${inputs.apiKey || env[providerEnvKey] || env[providerRawEnvKey] || env.MAH_AI_API_KEY || env.OPENAI_API_KEY || env.OPENROUTER_API_KEY || ""}`.trim()
  const model = `${inputs.modelPreference || env.MAH_AI_MODEL || provider.defaultModel}`.trim()
  const endpoint = `${inputs.endpoint || provider.endpoint || "/chat/completions"}`.trim()
  return { provider, baseUrl, apiKey, model, endpoint }
}

function extractYamlFromAiOutput(output) {
  let yamlContent = `${output || ""}`.trim()
  if (yamlContent.includes("```yaml") || yamlContent.includes("```yml") || yamlContent.includes("```YAML")) {
    yamlContent = yamlContent.replace(/```ya?ml?\n?/gi, "").replace(/\n?```$/m, "").trim()
  } else if (yamlContent.includes("```")) {
    yamlContent = yamlContent.replace(/```\n?/g, "").trim()
  }
  const yamlStartMatch = yamlContent.match(/^(version:\s*1\n[\s\S]*)/m)
  if (yamlStartMatch) {
    yamlContent = yamlStartMatch[1]
  }
  return yamlContent.split("\n").filter(line => {
    const trimmed = line.trim()
    return !trimmed.startsWith("#") || trimmed.startsWith("#!")
  }).join("\n").trim()
}

function parseAndNormalizeAiYaml(output) {
  const yamlContent = extractYamlFromAiOutput(output)
  const parsed = YAML.parse(yamlContent)
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Parsed YAML is not a valid object")
  }
  if (!parsed.version || !parsed.name) {
    throw new Error("YAML missing required fields (version, name)")
  }
  return `${YAML.stringify(ensureDefaults(parsed), { indent: 2 })}`.replaceAll("use_when", "use-when").replaceAll("max_lines", "max-lines")
}

function buildDirectAiRequestBody(options, skillContent, prompt) {
  if (options.endpoint === "/responses") {
    return {
      model: options.model,
      stream: false,
      store: false,
      input: [
        {
          role: "system",
          content: `${skillContent}\n\nYou generate only valid meta-agents.yaml content.`
        },
        { role: "user", content: prompt }
      ]
    }
  }
  return {
    model: options.model,
    messages: [
      {
        role: "system",
        content: `${skillContent}\n\nYou generate only valid meta-agents.yaml content.`
      },
      { role: "user", content: prompt }
    ]
  }
}

function extractDirectAiText(payload) {
  const chatText = payload?.choices?.[0]?.message?.content
  if (chatText) return `${chatText}`.trim()
  if (payload?.output_text) return `${payload.output_text}`.trim()
  const responseOutput = Array.isArray(payload?.output) ? payload.output : []
  const parts = []
  for (const item of responseOutput) {
    const content = Array.isArray(item?.content) ? item.content : []
    for (const contentItem of content) {
      if (contentItem?.text) parts.push(contentItem.text)
      if (contentItem?.type === "output_text" && contentItem?.text) parts.push(contentItem.text)
    }
  }
  return parts.join("\n").trim()
}

async function invokeDirectAiHttp(inputs, repoContext, skillPath, env) {
  const options = resolveDirectAiOptions(inputs, env)
  if (!options.apiKey) {
    console.log(`bootstrap: no ${options.provider.authPrompt} provided for direct HTTP mode`)
    return { success: false, reason: "no_api_key" }
  }
  if (!options.model) {
    console.log("bootstrap: no AI model provided for direct HTTP mode")
    return { success: false, reason: "no_model" }
  }

  const skillContent = readFileSync(skillPath, "utf-8")
  const prompt = buildAiPrompt(inputs, repoContext)
  console.log(`bootstrap: invoking ${options.provider.label} model ${options.model} via direct HTTP...`)
  if (env.MAH_TEST_AI_HTTP_STATUS) {
    const code = Number.parseInt(env.MAH_TEST_AI_HTTP_STATUS, 10) || 500
    console.log(`bootstrap: direct HTTP AI call failed with status ${code}`)
    return { success: false, reason: "http_status", code }
  }
  if (env.MAH_TEST_AI_HTTP_RESPONSE) {
    try {
      const yamlContent = parseAndNormalizeAiYaml(env.MAH_TEST_AI_HTTP_RESPONSE)
      mkdirSync(path.dirname(targetPath), { recursive: true })
      writeFileSync(targetPath, yamlContent)
      return { success: true, runtime: "direct-http" }
    } catch (parseError) {
      console.log(`bootstrap: direct HTTP AI output is not valid YAML: ${parseError.message}`)
      return { success: false, reason: "invalid_yaml", error: parseError, output: env.MAH_TEST_AI_HTTP_RESPONSE }
    }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180000)
  try {
    const response = await fetch(`${options.baseUrl}${options.endpoint}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`
      },
      body: JSON.stringify(buildDirectAiRequestBody(options, skillContent, prompt))
    })
    const bodyText = await response.text()
    if (!response.ok) {
      console.log(`bootstrap: direct HTTP AI call failed with status ${response.status}`)
      return { success: false, reason: "http_status", code: response.status, output: bodyText }
    }
    let payload
    try {
      payload = JSON.parse(bodyText)
    } catch (error) {
      console.log(`bootstrap: direct HTTP AI response is not JSON: ${error.message}`)
      return { success: false, reason: "invalid_json", error, output: bodyText }
    }
    const output = extractDirectAiText(payload)
    if (!output) {
      console.log("bootstrap: direct HTTP AI model returned empty output")
      return { success: false, reason: "empty_output" }
    }
    let yamlContent
    try {
      yamlContent = parseAndNormalizeAiYaml(output)
    } catch (parseError) {
      console.log(`bootstrap: direct HTTP AI output is not valid YAML: ${parseError.message}`)
      return { success: false, reason: "invalid_yaml", error: parseError, output }
    }
    mkdirSync(path.dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, yamlContent)
    return { success: true, runtime: "direct-http" }
  } catch (error) {
    const reason = error?.name === "AbortError" ? "timeout" : "network_error"
    console.log(`bootstrap: direct HTTP AI call failed: ${error.message}`)
    return { success: false, reason, error }
  } finally {
    clearTimeout(timeout)
  }
}

async function invokeAiRuntime(runtime, inputs, repoContext, skillPath, env) {
  const prompt = buildAiPrompt(inputs, repoContext)
  console.log(`bootstrap: invoking ${runtime.name} with bootstrap skill...`)
  let args, command
  if (runtime.usesSkillFlag) {
    args = [runtime.skillFlag, skillPath, runtime.printFlag, prompt]
    command = runtime.cli
  } else {
    const skillContent = readFileSync(skillPath, "utf-8")
    const fullPrompt = `${skillContent}

---

${prompt}`
    args = [runtime.runCommand || "run", fullPrompt]
    command = runtime.cli
  }
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    cwd,
    env,
    maxBuffer: 1024 * 1024 * 10,
    timeout: 180000
  })
  if (result.error) {
    console.log(`bootstrap: failed to invoke ${runtime.name}: ${result.error.message}`)
    return { success: false, reason: "spawn_error", error: result.error }
  }
  if (result.status !== 0) {
    console.log(`bootstrap: ${runtime.name} exited with status ${result.status}`)
    if (result.stderr) console.log(result.stderr)
    return { success: false, reason: "exit_code", code: result.status }
  }
  const output = result.stdout.trim()
  if (!output) {
    console.log("bootstrap: AI model returned empty output")
    return { success: false, reason: "empty_output" }
  }
  let yamlContent
  try {
    yamlContent = parseAndNormalizeAiYaml(output)
  } catch (parseError) {
    console.log(`bootstrap: AI output is not valid YAML: ${parseError.message}`)
    return { success: false, reason: "invalid_yaml", error: parseError, output }
  }
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, yamlContent)
  return { success: true, runtime: runtime.name }
}

async function runAiAssistedGeneration(inputs, repoContext, skillPath) {
  let env = loadDotEnv(process.env)
  const directResult = await invokeDirectAiHttp(inputs, repoContext, skillPath, env)
  if (directResult.success) return directResult
  if (!["no_api_key", "no_model"].includes(directResult.reason)) {
    return directResult
  }

  const runtimes = detectAvailableRuntimes()
  if (runtimes.length === 0) {
    console.log("bootstrap: no AI runtime available (opencode, codex, kilo or pi required for AI-assisted mode)")
    return { success: false, reason: "no_runtime" }
  }

  let lastFailure = null
  for (const runtime of runtimes) {
    const result = await invokeAiRuntime(runtime, inputs, repoContext, skillPath, env)
    if (result.success) return result
    lastFailure = result
    if (result.reason === "spawn_error" || result.reason === "exit_code" || result.reason === "empty_output" || result.reason === "invalid_yaml") {
      continue
    }
  }
  return lastFailure || { success: false, reason: "unknown_failure" }
}

function renderProviderMenu(selectedIndex) {
  process.stdout.write("\x1b[2K\rSelect AI provider (↑/↓, Enter):\n")
  AI_PROVIDER_PRESETS.forEach((provider, index) => {
    const pointer = index === selectedIndex ? ">" : " "
    process.stdout.write(`${pointer} ${provider.label}  ${provider.defaultModel}\n`)
  })
}

async function selectAiProviderWithKeys() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return AI_PROVIDER_PRESETS[0]
  const wasRaw = process.stdin.isRaw === true
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding("utf8")
  let selectedIndex = 0
  renderProviderMenu(selectedIndex)
  return await new Promise((resolve) => {
    const rerender = () => {
      process.stdout.write(`\x1b[${AI_PROVIDER_PRESETS.length + 1}A`)
      renderProviderMenu(selectedIndex)
    }
    const cleanup = () => {
      process.stdin.off("data", onData)
      process.stdin.setRawMode(Boolean(wasRaw))
      if (!wasRaw) process.stdin.pause()
    }
    const onData = (chunk) => {
      if (chunk === "\u001b[B") {
        selectedIndex = (selectedIndex + 1) % AI_PROVIDER_PRESETS.length
        rerender()
        return
      }
      if (chunk === "\u001b[A") {
        selectedIndex = (selectedIndex - 1 + AI_PROVIDER_PRESETS.length) % AI_PROVIDER_PRESETS.length
        rerender()
        return
      }
      if (chunk === "\r" || chunk === "\n") {
        cleanup()
        process.stdout.write("\n")
        resolve(AI_PROVIDER_PRESETS[selectedIndex])
        return
      }
      if (chunk === "\u0003") {
        cleanup()
        process.stdout.write("\n")
        process.exit(130)
      }
    }
    process.stdin.on("data", onData)
  })
}

async function collectInteractiveInputs(defaultName, defaultDescription) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const mode = `${(await rl.question("Bootstrap mode [1=logical, 2=ai-assisted] (default 1): ")).trim() || "1"}`
    const projectName = `${(await rl.question(`Project name (default: ${defaultName}): `)).trim() || defaultName}`
    let description = `${(await rl.question(`Project description (default: ${defaultDescription}): `)).trim() || defaultDescription}`
    const crewId = `${(await rl.question("Primary crew id (default: dev): ")).trim() || "dev"}`
    const defaultMission = "Execute bounded delivery for this repository."
    let mission = `${(await rl.question("Primary crew mission (default: Execute bounded delivery for this repository.): ")).trim() || defaultMission}`
    let brief = ""
    let projectType = ""
    let topologyPreference = ""
    let modelPreference = ""
    const userProvidedMission = mission !== defaultMission
    if (mode === "2") {
      const provider = await selectAiProviderWithKeys()
      const apiKey = `${(await rl.question(`${provider.authPrompt} (paste and press Enter, leave empty for env/runtime fallback): `)).trim()}`
      modelPreference = `${(await rl.question(`AI model (default: ${provider.defaultModel}): `)).trim() || provider.defaultModel}`
      brief = `${(await rl.question("Project brief (describe your project goals and context): ")).trim()}`
      projectType = `${(await rl.question("Project type [engineering/marketing/research/ops/docs/product/mixed] (default: engineering): ")).trim() || "engineering"}`
      topologyPreference = `${(await rl.question("Topology preference [minimal/standard/advanced] (default: standard): ")).trim() || "standard"}`
      if (brief) {
        if (userProvidedMission) {
          mission = `${mission} | Brief: ${brief}`
        } else {
          mission = `Deliver project outcomes aligned to: ${brief}`
        }
      }
      return { projectName, description, crewId, mission, mode, brief, projectType, topologyPreference, modelPreference, apiKey, baseUrl: provider.baseUrl, endpoint: provider.endpoint, provider: provider.id }
    }
    return { projectName, description, crewId, mission, mode, brief, projectType, topologyPreference, modelPreference }
  } finally {
    rl.close()
  }
}

async function collectAiProviderInputs(inputs) {
  let provider = findAiProviderPreset(inputs.provider)
  if (!provider) {
    provider = await selectAiProviderWithKeys()
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const apiKey = inputs.apiKey || `${(await rl.question(`${provider.authPrompt} (paste and press Enter, leave empty for env/runtime fallback): `)).trim()}`
    const modelPreference = inputs.modelPreference || `${(await rl.question(`AI model (default: ${provider.defaultModel}): `)).trim() || provider.defaultModel}`
    const brief = inputs.brief || `${(await rl.question("Project brief (describe your project goals and context, optional): ")).trim()}`
    return {
      ...inputs,
      provider: provider.id,
      apiKey,
      modelPreference,
      brief,
      baseUrl: inputs.baseUrl || provider.baseUrl,
      endpoint: inputs.endpoint || provider.endpoint,
      mission: brief && inputs.mission === "Execute bounded delivery for this repository."
        ? `Deliver project outcomes aligned to: ${brief}`
        : inputs.mission
    }
  } finally {
    rl.close()
  }
}

function normalizeTextOption(value) {
  return `${value || ""}`.trim()
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  if (existsSync(targetPath) && !options.force) {
    console.log("bootstrap: skipped (meta-agents.yaml already exists)")
    return
  }

  const template = ensureDefaults(loadTemplateDoc() || {})
  const defaultName = `${path.basename(cwd) || template.name || "my-project"}`.trim()
  const defaultDescription = `${template.description || "Unified configuration for MAH runtimes."}`.trim()
  const canPrompt = process.stdin.isTTY && process.stdout.isTTY && !options.nonInteractive && !process.env.CI

  let inputs = {
    projectName: defaultName,
    description: defaultDescription,
    crewId: normalizeTextOption(options.crew) || "dev",
    mission: "Execute bounded delivery for this repository.",
    mode: options.ai ? "2" : "1",
    brief: options.brief || "",
    projectType: "engineering",
    topologyPreference: "standard",
    provider: normalizeTextOption(options.provider),
    modelPreference: normalizeTextOption(options.model),
    apiKey: normalizeTextOption(options.apiKey),
    baseUrl: normalizeTextOption(options.baseUrl)
  }
  if (canPrompt && !options.ai) {
    console.log("bootstrap: creating meta-agents.yaml with interactive setup")
    inputs = await collectInteractiveInputs(defaultName, defaultDescription)
  } else if (!canPrompt) {
    console.log("bootstrap: non-interactive mode detected, using logical defaults")
    const requestedName = normalizeTextOption(options.name)
    const requestedDescription = normalizeTextOption(options.description)
    const requestedCrew = normalizeTextOption(options.crew)
    if (requestedName) inputs.projectName = requestedName
    if (requestedDescription) inputs.description = requestedDescription
    if (requestedCrew) inputs.crewId = requestedCrew
    if (options.provider) inputs.provider = normalizeTextOption(options.provider)
    if (options.model) inputs.modelPreference = normalizeTextOption(options.model)
    if (options.apiKey) inputs.apiKey = normalizeTextOption(options.apiKey)
    if (options.baseUrl) inputs.baseUrl = normalizeTextOption(options.baseUrl)
    if (options.ai) {
      console.log("bootstrap: --ai flag specified, attempting AI-assisted generation")
    }
  } else if (options.ai) {
    console.log("bootstrap: --ai flag specified, using AI-assisted mode")
    const requestedName = normalizeTextOption(options.name)
    const requestedDescription = normalizeTextOption(options.description)
    const requestedCrew = normalizeTextOption(options.crew)
    if (requestedName) inputs.projectName = requestedName
    if (requestedDescription) inputs.description = requestedDescription
    if (requestedCrew) inputs.crewId = requestedCrew
    if (options.provider) inputs.provider = normalizeTextOption(options.provider)
    if (options.model) inputs.modelPreference = normalizeTextOption(options.model)
    if (options.apiKey) inputs.apiKey = normalizeTextOption(options.apiKey)
    if (options.baseUrl) inputs.baseUrl = normalizeTextOption(options.baseUrl)
    inputs = await collectAiProviderInputs(inputs)
  }

    if (inputs.mode === "2") {
    const skillPath =
      findMahSkillFile("bootstrap", { repoRoot }) ||
      findMahSkillFile("bootstrap-config-architect", { repoRoot })
    if (!skillPath) {
      console.log("bootstrap: bootstrap skill not found, falling back to logical mode")
      inputs.mode = "1"
    } else {
      const repoContext = getRepoContext()
      const result = await runAiAssistedGeneration(inputs, repoContext, skillPath)
      if (result.success) {
        console.log(`bootstrap: created ${path.relative(cwd, targetPath)} via ${result.runtime}`)
        console.log("bootstrap: expertise-aware topology generated")
        console.log(`bootstrap: next: run \`mah expertise recommend --task "your first task"\` to route by capability`)
        console.log("bootstrap: see .mah/expertise/ for the catalog")
        return
      }
      console.log("bootstrap: ai-assisted generation failed, falling back to logical mode")
      inputs.mode = "1"
    }
  }

  const doc = ensureDefaults(template)
  doc.name = inputs.projectName
  doc.description = inputs.description
  doc.crews = [buildDefaultCrew(inputs.crewId, inputs.mission)]

  const orderedDoc = {
    version: doc.version,
    name: doc.name,
    description: doc.description,
    runtimes: doc.runtimes,
    catalog: doc.catalog,
    domain_profiles: doc.domain_profiles,
    crews: doc.crews
  }

  const out = `${YAML.stringify(orderedDoc, { indent: 2 })}`.replaceAll("use_when", "use-when").replaceAll("max_lines", "max-lines")
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, out)
  console.log(`bootstrap: created ${path.relative(cwd, targetPath)}`)
  console.log("bootstrap: expertise-aware topology generated — run `mah expertise recommend --task \"your first task\"` to route by capability")
}

await main()
