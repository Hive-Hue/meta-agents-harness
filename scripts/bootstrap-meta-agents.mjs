import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline/promises"
import { spawnSync } from "node:child_process"
import YAML from "yaml"
import { RUNTIME_ADAPTERS } from "./runtime-adapters.mjs"
import { findMahSkillFile, getMahPluginSearchPaths, resolveMahHome } from "./mah-home.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const cwd = process.cwd()
const targetPath = path.join(cwd, "meta-agents.yaml")

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
    brief: getValue("--brief")
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

MODES:
  1. Logical (default): Generates config using templates and defaults
  2. AI-assisted: Invokes an AI model with the bootstrap skill
     to generate a tailored configuration based on project context

AI-ASSISTED MODE:
  Requires opencode, codex, kilo, or pi CLI to be available.
  Tries available runtimes in priority order until one succeeds.
  Uses the bootstrap skill to analyze repository context
  and generate a production-ready meta-agents.yaml.

EXAMPLES:
  # Interactive mode
  node bootstrap-meta-agents.mjs

  # Non-interactive with defaults
  node bootstrap-meta-agents.mjs --yes

  # AI-assisted generation
  node bootstrap-meta-agents.mjs --ai --brief "E-commerce platform with microservices"

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
  delete next.domain_profiles
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
  next.runtimes = next.runtimes || {}

  next.catalog = next.catalog || {}
  next.catalog.models = {
    orchestrator_default: "zai/glm-4.7",
    lead_default: "zai/glm-4.7",
    worker_default: "zai/glm-5-turbo",
    ...(next.catalog.models || {})
  }
  next.catalog.domain_profiles = next.catalog.domain_profiles || {}
  next.catalog.domain_profiles.read_only_repo = next.catalog.domain_profiles.read_only_repo || [{ path: ".", read: true, edit: false, bash: false }]

  return next
}

function buildMinimalCrew(crewId, mission) {
  return {
    id: crewId,
    display_name: `${crewId[0].toUpperCase()}${crewId.slice(1)} Crew`,
    mission,
    source_configs: {
      pi: `.pi/crew/${crewId}/multi-team.yaml`,
      claude: `.claude/crew/${crewId}/multi-team.yaml`,
      codex: `.codex/crew/${crewId}/multi-team.yaml`,
      kilo: `.kilo/crew/${crewId}/multi-team.yaml`,
      opencode: `.opencode/crew/${crewId}/multi-team.yaml`
    },
    session: {
      pi_root: `.pi/crew/${crewId}/sessions`,
      claude_mirror_root: `.claude/crew/${crewId}/sessions`,
      codex_root: `.codex/crew/${crewId}/sessions`,
      kilo_root: `.kilo/crew/${crewId}/sessions`,
      hermes_root: `.hermes/crew/${crewId}/sessions`
    },
    topology: {
      orchestrator: "orchestrator",
      leads: { planning: "planning-lead" },
      workers: { planning: ["repo-analyst"] }
    },
    agents: [
      { id: "orchestrator", role: "orchestrator", team: "orchestration", model_ref: "orchestrator_default", expertise: "orchestrator-expertise-model", skills: ["delegate_bounded", "zero_micromanagement", "expertise_model"], domain_profile: "read_only_repo" },
      { id: "planning-lead", role: "lead", team: "planning", model_ref: "lead_default", expertise: "planning-lead-expertise-model", skills: ["delegate_bounded", "zero_micromanagement", "expertise_model"], domain_profile: "read_only_repo" },
      { id: "repo-analyst", role: "worker", team: "planning", model_ref: "worker_default", expertise: "repo-analyst-expertise-model", skills: ["expertise_model"], domain_profile: "read_only_repo" }
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
   - runtimes (pi, claude, kilo, opencode, hermes with wrapper/config_root/config_pattern)
   - catalog (models, domain_profiles)
   - domain_profiles (at minimum: read_only_repo)
   - crews (id, display_name, mission, topology, agents)
5. Do NOT include runtime_detection; MAH applies runtime detection defaults internally
6. Do NOT include a per-runtime skills path matrix; skill paths are resolved internally by convention
7. Do NOT include an adapters block; MAH applies adapter mappings internally
8. Follow the skill guidelines for config quality
9. Use appropriate topology based on project complexity
10. Configure all runtimes (pi, claude, kilo, opencode, hermes) based on detected markers

Generate the complete meta-agents.yaml now:`
  return prompt
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
  let yamlContent = output
  if (output.includes("```yaml") || output.includes("```yml") || output.includes("```YAML")) {
    yamlContent = output.replace(/```ya?ml?\n?/gi, "").replace(/\n?```$/m, "").trim()
  } else if (output.includes("```")) {
    yamlContent = output.replace(/```\n?/g, "").trim()
  }
  const yamlStartMatch = yamlContent.match(/^(version:\s*1\n[\s\S]*)/m)
  if (yamlStartMatch) {
    yamlContent = yamlStartMatch[1]
  }
  yamlContent = yamlContent.split("\n").filter(line => {
    const trimmed = line.trim()
    return !trimmed.startsWith("#") || trimmed.startsWith("#!")
  }).join("\n").trim()
  try {
    const parsed = YAML.parse(yamlContent)
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Parsed YAML is not a valid object")
    }
    if (!parsed.version || !parsed.name) {
      throw new Error("YAML missing required fields (version, name)")
    }
    yamlContent = `${YAML.stringify(ensureDefaults(parsed), { indent: 2 })}`.replaceAll("use_when", "use-when").replaceAll("max_lines", "max-lines")
  } catch (parseError) {
    console.log(`bootstrap: AI output is not valid YAML: ${parseError.message}`)
    return { success: false, reason: "invalid_yaml", error: parseError, output }
  }
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, yamlContent)
  return { success: true, runtime: runtime.name }
}

async function runAiAssistedGeneration(inputs, repoContext, skillPath) {
  const runtimes = detectAvailableRuntimes()
  if (runtimes.length === 0) {
    console.log("bootstrap: no AI runtime available (opencode, codex, kilo or pi required for AI-assisted mode)")
    return { success: false, reason: "no_runtime" }
  }

  let env = { ...process.env }
  const envPath = path.join(cwd, ".env")
  if (existsSync(envPath)) {
    try {
      const envContent = readFileSync(envPath, "utf-8")
      envContent.split("\n").forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/)
        if (match) {
          const key = match[1].trim()
          const value = match[2].trim()
          if (key && value && !key.startsWith("#")) {
            env[key] = value
          }
        }
      })
    } catch {}
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
      brief = `${(await rl.question("Project brief (describe your project goals and context): ")).trim()}`
      projectType = `${(await rl.question("Project type [engineering/marketing/research/ops/docs/product/mixed] (default: engineering): ")).trim() || "engineering"}`
      topologyPreference = `${(await rl.question("Topology preference [minimal/standard/advanced] (default: standard): ")).trim() || "standard"}`
      modelPreference = `${(await rl.question("Model preference (e.g., zai/glm-4.7, anthropic/claude-sonnet, or leave empty for defaults): ")).trim()}`
      if (brief) {
        if (userProvidedMission) {
          mission = `${mission} | Brief: ${brief}`
        } else {
          mission = `Deliver project outcomes aligned to: ${brief}`
        }
      }
    }
    return { projectName, description, crewId, mission, mode, brief, projectType, topologyPreference, modelPreference }
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
    modelPreference: ""
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
        console.log("bootstrap: ai-assisted generation complete")
        return
      }
      console.log("bootstrap: ai-assisted generation failed, falling back to logical mode")
      inputs.mode = "1"
    }
  }

  const doc = ensureDefaults(template)
  doc.name = inputs.projectName
  doc.description = inputs.description
  doc.crews = [buildMinimalCrew(inputs.crewId, inputs.mission)]

  const out = `${YAML.stringify(doc, { indent: 2 })}`.replaceAll("use_when", "use-when").replaceAll("max_lines", "max-lines")
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, out)
  console.log(`bootstrap: created ${path.relative(cwd, targetPath)}`)
}

await main()
