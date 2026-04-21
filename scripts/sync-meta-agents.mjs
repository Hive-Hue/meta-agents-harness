import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"
import { determineAction } from "./sync-utils.mjs"
import { resolveMahHome } from "./mah-home.mjs"
import { normalizeModelId } from "../mah-plugins/shared-model-normalize.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.resolve(__dirname, "..")
const workspaceRoot = process.cwd()
const metaConfigPath = path.join(workspaceRoot, "meta-agents.yaml")
const managedRuntimes = ["pi", "claude", "codex", "kilo", "opencode", "openclaude", "hermes"]
const runtimeMarkerRoots = Object.fromEntries(managedRuntimes.map((runtime) => [runtime, `.${runtime}`]))
const defaultSharedSkills = ["context_memory"]

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exitCode = 1
}

function rel(filePath) {
  return path.relative(workspaceRoot, filePath) || "."
}

function runtimeMarkerDir(runtime) {
  return runtimeMarkerRoots[runtime] || `.${runtime}`
}

function detectActiveRuntimes() {
  return managedRuntimes.filter((runtime) => {
    const markerPath = path.join(workspaceRoot, runtimeMarkerDir(runtime))
    return existsSync(markerPath)
  })
}

function titleCase(value) {
  return `${value || ""}`
    .split(/[-_]/g)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ")
}

function normalizePromptName(agentId) {
  const snake = agentId.replace(/-/g, "_")
  const kebab = agentId.replace(/_/g, "-")
  return Array.from(new Set([snake, kebab]))
}

function resolvePromptPath(runtime, crewId, agentId) {
  const baseDir = path.join(workspaceRoot, `.${runtime}`, "crew", crewId, "agents")
  const variants = normalizePromptName(agentId)
  for (const name of variants) {
    const candidate = path.join(baseDir, `${name}.md`)
    if (existsSync(candidate)) return `.${path.sep}${path.relative(workspaceRoot, candidate)}`.replaceAll(path.sep, "/").replace(/^\.\//, "")
  }
  const fallback = path.join(baseDir, `${variants[0]}.md`)
  return `.${path.sep}${path.relative(workspaceRoot, fallback)}`.replaceAll(path.sep, "/").replace(/^\.\//, "")
}

function listSubdirs(rootPath) {
  if (!existsSync(rootPath)) return []
  return readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

function resolveExpertisePath(runtime, crewId, expertiseName) {
  return `.${runtime}/crew/${crewId}/expertise/${expertiseName}.yaml`
}

function defaultExpertiseContent(agent) {
  return YAML.stringify({
    agent: {
      name: agent.id,
      role: agent.role,
      team: titleCase(agent.team || "")
    },
    meta: {
      version: "1",
      max_lines: "120",
      last_updated: new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z")
    },
    patterns: [],
    risks: [],
    tools: [],
    workflows: [],
    decisions: [],
    lessons: [],
    observations: [],
    open_questions: []
  }, { indent: 2 }).trimEnd()
}

// Note: .mah/expertise/catalog is managed by 'mah expertise seed', not by sync-meta-agents.
// The catalog lives in a gitignored directory and uses v1 schema (different from System A).
// skipCatalogDrift check avoids false drift reports from expertise-seed-generated files.
function syncWorkspaceExpertiseCatalog(crew, mode, records, jsonOutput) {
  const checkOnly = mode !== "sync"
  const expertiseDir = path.join(workspaceRoot, ".mah", "expertise", "catalog", crew.id)
  mkdirSync(expertiseDir, { recursive: true })
  let ok = true
  for (const agent of crew.agents || []) {
    const expertiseFile = path.join(expertiseDir, `${agent.id}.yaml`)
    const currentRaw = existsSync(expertiseFile) ? readFileSync(expertiseFile, "utf-8") : ""
    const nextRaw = defaultExpertiseContent(agent)
    if (checkOnly) {
      // Skip drift check for .mah/expertise/catalog — managed by 'mah expertise seed' (v1 schema),
      // not by sync-meta-agents (System A schema). Silently skip to avoid false drift from
      // expertise-seed-generated v1 entries in gitignored .mah/ directory.
      if (!jsonOutput) console.log(`ok: ${rel(expertiseFile)}`)
      pushRecord(records, { kind: "expertise-catalog", path: rel(expertiseFile), status: "ok", action: determineAction("ok"), crew: crew.id, agent: agent.id })
      continue
    }

    if (currentRaw !== nextRaw) {
      writeFileSync(expertiseFile, nextRaw, "utf-8")
      console.log(`synced: ${rel(expertiseFile)}`)
      pushRecord(records, { kind: "expertise-catalog", path: rel(expertiseFile), status: "synced", action: determineAction("synced"), crew: crew.id, agent: agent.id })
    }
  }
  return ok
}

function runtimeSessionDirRoot(runtime, crew) {
  if (runtime === "pi") {
    return crew.session?.pi_root || `.${runtime}/crew/${crew.id}/sessions`
  }
  if (runtime === "claude") {
    return crew.session?.claude_mirror_root || `.${runtime}/crew/${crew.id}/sessions`
  }
  if (runtime === "codex") {
    return crew.session?.codex_root || `.${runtime}/crew/${crew.id}/sessions`
  }
  if (runtime === "kilo") {
    return crew.session?.kilo_root || `.${runtime}/crew/${crew.id}/sessions`
  }
  if (runtime === "openclaude") {
    return crew.session?.openclaude_root || `.${runtime}/crew/${crew.id}/sessions`
  }
  return crew.session?.opencode_root || `.opencode/crew/${crew.id}/sessions`
}

function parsePromptFrontmatter(raw) {
  const match = `${raw || ""}`.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: `${raw || ""}` }
  let frontmatter = {}
  try {
    frontmatter = YAML.parse(match[1]) || {}
  } catch {
    frontmatter = {}
  }
  return { frontmatter, body: match[2] || "" }
}

function normalizeSprintMode(sprintMode) {
  if (!sprintMode || typeof sprintMode !== "object") return null
  const next = {
    name: `${sprintMode.name || ""}`.trim(),
    active: Boolean(sprintMode.active),
    target_release: `${sprintMode.target_release || ""}`.trim(),
    objective: `${sprintMode.objective || ""}`.trim(),
    execution_mode: `${sprintMode.execution_mode || ""}`.trim(),
    directives: Array.isArray(sprintMode.directives) ? sprintMode.directives.filter(Boolean) : [],
    must_deliver: Array.isArray(sprintMode.must_deliver) ? sprintMode.must_deliver.filter(Boolean) : [],
    must_not_deliver: Array.isArray(sprintMode.must_not_deliver) ? sprintMode.must_not_deliver.filter(Boolean) : []
  }
  return Object.fromEntries(
    Object.entries(next).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0
      if (typeof value === "boolean") return true
      return Boolean(value)
    })
  )
}

function crewRuntimeMetadata(crew) {
  const sprintMode = normalizeSprintMode(crew?.sprint_mode)
  const metadata = {
    mission: `${crew?.mission || ""}`.trim(),
    sprint_mode: sprintMode
  }
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value))
}

function agentRuntimeMetadata(agent) {
  const responsibilities = Array.isArray(agent?.sprint_responsibilities)
    ? agent.sprint_responsibilities.filter(Boolean)
    : []
  if (responsibilities.length === 0) return {}
  return { sprint_responsibilities: responsibilities }
}

function compactInstructionList(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => `${item || ""}`.trim())
    .filter(Boolean)
    .join("; ")
}

function buildCrewInstructionBlock(crew, agent) {
  const mission = `${crew?.mission || ""}`.trim()
  const sprintMode = normalizeSprintMode(crew?.sprint_mode)
  const responsibilities = Array.isArray(agent?.sprint_responsibilities)
    ? agent.sprint_responsibilities.map((item) => `${item || ""}`.trim()).filter(Boolean)
    : []
  const parts = []
  if (crew?.id) parts.push(`crew=${crew.id}`)
  if (mission) parts.push(`mission=${mission}`)
  if (sprintMode) {
    const sprintParts = []
    if (sprintMode.name) sprintParts.push(sprintMode.name)
    if (sprintMode.target_release) sprintParts.push(`release=${sprintMode.target_release}`)
    if (sprintMode.execution_mode) sprintParts.push(`mode=${sprintMode.execution_mode}`)
    if (sprintMode.active) sprintParts.push("active=true")
    if (sprintParts.length > 0) parts.push(`sprint=${sprintParts.join(",")}`)
    if (sprintMode.directives?.length > 0) parts.push(`directives=${compactInstructionList(sprintMode.directives)}`)
    if (sprintMode.must_deliver?.length > 0) parts.push(`do=${compactInstructionList(sprintMode.must_deliver)}`)
    if (sprintMode.must_not_deliver?.length > 0) parts.push(`avoid=${compactInstructionList(sprintMode.must_not_deliver)}`)
  }
  if (responsibilities.length > 0) parts.push(`role=${compactInstructionList(responsibilities)}`)
  return parts.join(" | ").trim()
}

function applyInstructionBlock(body, block) {
  const content = `${body || ""}`.replace(/^\n+/, "")
  if (!block) return content || ""
  const nextBlock = `[MAH_CONTEXT]\n${block}\n[/MAH_CONTEXT]`
  const pattern = /^\[MAH_CONTEXT\]\n[\s\S]*?\n\[\/MAH_CONTEXT\]\n*/m
  if (pattern.test(content)) {
    return content.replace(pattern, `${nextBlock}\n\n`)
  }
  return content ? `${nextBlock}\n\n${content}` : `${nextBlock}\n`
}

function buildAgentPromptFromMeta(meta, crew, agent, currentRaw, runtime) {
  const parsed = parsePromptFrontmatter(currentRaw)
  const existing = parsed.frontmatter && typeof parsed.frontmatter === "object" ? parsed.frontmatter : {}
  const skillsByPath = new Map(
    Array.isArray(existing.skills)
      ? existing.skills
        .map((item) => [item?.path, item?.["use-when"] || item?.use_when || ""])
        .filter((item) => typeof item[0] === "string" && item[0].trim())
      : []
  )

  const next = {
    ...existing,
    name: agent.id,
    model: resolveAgentModel(meta, runtime, agent),
    role: agent.role,
    team: titleCase(agent.team),
    ...crewRuntimeMetadata(crew),
    ...agentRuntimeMetadata(agent),
    instruction_block: buildCrewInstructionBlock(crew, agent),
    expertise: {
      ...(existing.expertise && typeof existing.expertise === "object" ? existing.expertise : {}),
      path: resolveExpertisePath(runtime, crew.id, agent.expertise)
    },
    tools: runtimeTools(agent, runtime),
    skills: runtimeSkillPaths(meta, agent.skills, runtime).map((item) => ({
      path: item,
      "use-when": skillsByPath.get(item) || "Use when relevant to current task."
    })),
    domain: domainFromProfile(meta, agent.domain_profile, runtime)
  }

  const frontmatterText = YAML.stringify(next, { indent: 2 }).trimEnd()
  const baseBody = parsed.body && parsed.body.trim().length > 0
    ? parsed.body.replace(/^\n+/, "")
    : `# ${titleCase(agent.id)}\n`
  const body = applyInstructionBlock(baseBody, buildCrewInstructionBlock(crew, agent))
  return `---\n${frontmatterText}\n---\n\n${body}`
}

function pushRecord(records, entry) {
  records.push(entry)
}

function diffPreview(currentRaw, nextRaw, maxLines = 40) {
  const current = `${currentRaw || ""}`.split("\n")
  const next = `${nextRaw || ""}`.split("\n")
  const max = Math.max(current.length, next.length)
  const lines = []
  for (let i = 0; i < max; i += 1) {
    const a = current[i]
    const b = next[i]
    if (a === b) continue
    if (typeof a !== "undefined") lines.push(`-${a}`)
    if (typeof b !== "undefined") lines.push(`+${b}`)
    if (lines.length >= maxLines) break
  }
  return lines
}

function syncRuntimePrompts(meta, crew, runtime, mode, records, jsonOutput) {
  const checkOnly = mode !== "sync"
  let ok = true
  for (const agent of crew.agents || []) {
    const relativePromptPath = resolvePromptPath(runtime, crew.id, agent.id)
    const promptPath = path.resolve(workspaceRoot, relativePromptPath)
    if (checkOnly && !existsSync(promptPath)) {
      pushRecord(records, { kind: "prompt", path: rel(promptPath), status: "missing", action: determineAction("missing"), crew: crew.id, agent: agent.id })
      if (!jsonOutput) {
        if (mode === "plan") console.log(`plan: create ${rel(promptPath)}`)
        else console.log(`drift: missing ${rel(promptPath)}`)
      }
      ok = false
      continue
    }

    const currentRaw = existsSync(promptPath) ? readFileSync(promptPath, "utf-8") : ""
    const sourcePromptPath = runtime === "hermes" ? path.resolve(workspaceRoot, resolvePromptPath("pi", crew.id, agent.id)) : ""
    const sourceRaw = !currentRaw && sourcePromptPath && existsSync(sourcePromptPath)
      ? readFileSync(sourcePromptPath, "utf-8")
      : currentRaw
    const nextRaw = buildAgentPromptFromMeta(meta, crew, agent, sourceRaw, runtime)
    if (checkOnly) {
      if (currentRaw !== nextRaw) {
        const preview = mode === "diff" ? diffPreview(currentRaw, nextRaw) : []
        pushRecord(records, { kind: "prompt", path: rel(promptPath), status: "out_of_sync", action: determineAction("out_of_sync"), crew: crew.id, agent: agent.id, preview })
        if (!jsonOutput) {
          if (mode === "plan") console.log(`plan: update ${rel(promptPath)}`)
          else {
            console.log(`drift: out-of-sync ${rel(promptPath)}`)
            if (mode === "diff") for (const line of preview) console.log(line)
          }
        }
        ok = false
      } else {
        pushRecord(records, { kind: "prompt", path: rel(promptPath), status: "ok", action: determineAction("ok"), crew: crew.id, agent: agent.id })
        if (!jsonOutput) {
          if (mode === "plan") console.log(`plan: no-change ${rel(promptPath)}`)
          else console.log(`ok: ${rel(promptPath)}`)
        }
      }
      continue
    }

    if (currentRaw !== nextRaw) {
      mkdirSync(path.dirname(promptPath), { recursive: true })
      writeFileSync(promptPath, nextRaw, "utf-8")
      console.log(`synced: ${rel(promptPath)}`)
      pushRecord(records, { kind: "prompt", path: rel(promptPath), status: "synced", action: determineAction("synced"), crew: crew.id, agent: agent.id })
    }
  }
  if (runtime !== "hermes") {
    const expertiseDir = path.join(workspaceRoot, `.${runtime}`, "crew", crew.id, "expertise")
    mkdirSync(expertiseDir, { recursive: true })
    for (const agent of crew.agents || []) {
      const expertiseFile = path.join(expertiseDir, `${agent.expertise}.yaml`)
      const hadExpertiseFile = existsSync(expertiseFile)
      if (hadExpertiseFile) {
        pushRecord(records, { kind: "expertise", path: rel(expertiseFile), status: "ok", action: determineAction("ok"), crew: crew.id, agent: agent.id })
        if (!jsonOutput) console.log(`ok: ${rel(expertiseFile)}`)
      } else {
        const expertiseContent = defaultExpertiseContent(agent)
        if (checkOnly) {
          pushRecord(records, { kind: "expertise", path: rel(expertiseFile), status: "missing", action: determineAction("missing"), crew: crew.id, agent: agent.id })
          if (!jsonOutput) console.log(`drift: missing ${rel(expertiseFile)}`)
          ok = false
        } else {
          writeFileSync(expertiseFile, expertiseContent, "utf-8")
          console.log(`generated: ${rel(expertiseFile)}`)
          pushRecord(records, { kind: "expertise", path: rel(expertiseFile), status: "generated", action: determineAction("generated"), crew: crew.id, agent: agent.id })
        }
      }
    }
  }
  return ok
}

function buildHermesRuntimeConfig(meta, crew) {
  const orchestrator = crew.agents.find((agent) => agent.id === crew.topology?.orchestrator) || crew.agents[0]
  const sessionDir = crew.session?.hermes_root || `.hermes/crew/${crew.id}/sessions`
  const doc = {
    version: 1,
    runtime: "hermes",
    crew: crew.id,
    name: `${crew.id}-hermes-runtime`,
    ...crewRuntimeMetadata(crew),
    instruction_block: buildCrewInstructionBlock(crew, orchestrator),
    source_of_truth: "meta-agents.yaml",
    active_crew_file: ".hermes/.active-crew.json",
    multi_team: `.hermes/crew/${crew.id}/multi-team.yaml`,
    agents_dir: `.hermes/crew/${crew.id}/agents`,
    expertise_dir: `.hermes/crew/${crew.id}/expertise`,
    skills_dir: ".hermes/skills",
    session_dir: sessionDir,
    orchestrator: {
      name: orchestrator?.id || "",
      model: orchestrator ? resolveAgentModel(meta, "hermes", orchestrator) : "",
      prompt: orchestrator ? resolvePromptPath("hermes", crew.id, orchestrator.id) : ""
    }
  }
  return YAML.stringify(doc, { indent: 2 }).trimEnd()
}

function ensureHermesArtifacts(crew) {
  const crewRoot = path.join(workspaceRoot, ".hermes", "crew", crew.id)
  const agentsDir = path.join(crewRoot, "agents")
  const expertiseDir = path.join(crewRoot, "expertise")
  const sessionsDir = path.join(crewRoot, "sessions")
  mkdirSync(agentsDir, { recursive: true })
  mkdirSync(expertiseDir, { recursive: true })
  mkdirSync(sessionsDir, { recursive: true })

  for (const agent of crew.agents || []) {
    const expertiseFile = path.join(expertiseDir, `${agent.expertise}.yaml`)
    if (!existsSync(expertiseFile)) {
      writeFileSync(expertiseFile, defaultExpertiseContent(agent), "utf-8")
      console.log(`generated: ${rel(expertiseFile)}`)
    }
  }
}

let globalOpencodeNeedsValidateDelegationPermission = false

function ensureValidateDelegationTool() {
  const toolsDir = path.join(workspaceRoot, ".opencode", "tools")
  const toolFile = path.join(toolsDir, "validate-delegation.ts")
  mkdirSync(toolsDir, { recursive: true })
  if (!existsSync(toolFile)) {
    const templatePath = path.join(packageRoot, ".opencode", "tools", "validate-delegation.ts")
    if (existsSync(templatePath)) {
      const content = readFileSync(templatePath, "utf-8")
      writeFileSync(toolFile, content, "utf-8")
      console.log("generated: " + rel(toolFile))
    }
  }
}

function ensureValidateDelegationPermission() {
  if (!globalOpencodeNeedsValidateDelegationPermission) return
  const opencodeJsonPath = path.join(workspaceRoot, ".opencode", "opencode.json")
  if (!existsSync(opencodeJsonPath)) return
  const current = readFileSync(opencodeJsonPath, "utf-8")
  let doc
  try { doc = JSON.parse(current) } catch { return }
  if (!doc.permission) doc.permission = {}
  if (!doc.permission["validate-delegation"]) {
    doc.permission["validate-delegation"] = "allow"
    writeFileSync(opencodeJsonPath, JSON.stringify(doc, null, 2), "utf-8")
    console.log("updated: " + rel(opencodeJsonPath) + " (added validate-delegation permission)")
  }
}

function ensureOpencodeArtifacts(crew, mode, records, jsonOutput) {
  const checkOnly = mode !== "sync"
  const agentsDir = path.join(workspaceRoot, ".opencode", "crew", crew.id, "agents")
  const expertiseDir = path.join(workspaceRoot, ".opencode", "crew", crew.id, "expertise")
  const legacyAgentsDir = path.join(workspaceRoot, ".opencode", "agents")
  const referenceRoot = path.resolve(packageRoot, "..", "opencode-multi-harness", ".opencode", "crew", crew.id)
  const referenceAgentsDir = path.join(referenceRoot, "agents")
  mkdirSync(agentsDir, { recursive: true })
  mkdirSync(expertiseDir, { recursive: true })

  const hasAllowDelegate = Boolean(crew.runtime_overrides?.opencode?.permission?.task?.allow_delegate)
  if (hasAllowDelegate) globalOpencodeNeedsValidateDelegationPermission = true
  ensureValidateDelegationTool()

  const allowDelegate = crew.runtime_overrides?.opencode?.permission?.task?.allow_delegate || {}
  const byId = new Map((crew.agents || []).map((a) => [a.id, a]))
  let ok = true

  for (const agent of crew.agents || []) {
    const agentFile = path.join(agentsDir, `${agent.id}.md`)
    const referenceAgentFile = path.join(referenceAgentsDir, `${agent.id}.md`)
    const legacyAgentFile = path.join(legacyAgentsDir, `${agent.id}.md`)
    const hadAgentFile = existsSync(agentFile)

    let baseContent = ""
    if (existsSync(referenceAgentFile)) {
      baseContent = readFileSync(referenceAgentFile, "utf-8")
    } else if (existsSync(legacyAgentFile)) {
      baseContent = readFileSync(legacyAgentFile, "utf-8")
    } else {
      baseContent = `# ${titleCase(agent.id)}\n\nRole: ${agent.role}\nTeam: ${agent.team}\n\nUse this file as the runtime prompt source for ${agent.id}.\n`
    }

    const content = injectAgentPermissions(baseContent, agent, allowDelegate, byId, metaDoc, "opencode")
    const current = hadAgentFile ? readFileSync(agentFile, "utf-8") : ""

    if (checkOnly) {
      if (!hadAgentFile) {
        pushRecord(records, { kind: "prompt", path: rel(agentFile), status: "missing", action: determineAction("missing"), crew: crew.id, agent: agent.id })
        if (!jsonOutput) console.log(`drift: missing ${rel(agentFile)}`)
        ok = false
      } else if (current !== content) {
        const preview = mode === "diff" ? diffPreview(current, content) : []
        pushRecord(records, { kind: "prompt", path: rel(agentFile), status: "out_of_sync", action: determineAction("out_of_sync"), crew: crew.id, agent: agent.id, preview })
        if (!jsonOutput) {
          if (mode === "plan") console.log(`plan: update ${rel(agentFile)}`)
          else { console.log(`drift: out-of-sync ${rel(agentFile)}`); for (const l of preview) console.log(l) }
        }
        ok = false
      } else {
        pushRecord(records, { kind: "prompt", path: rel(agentFile), status: "ok", action: determineAction("ok"), crew: crew.id, agent: agent.id })
        if (!jsonOutput) console.log(`ok: ${rel(agentFile)}`)
      }
    } else if (current !== content) {
      writeFileSync(agentFile, content, "utf-8")
      if (!jsonOutput) console.log(`${hadAgentFile ? "synced" : "generated"}: ${rel(agentFile)}`)
      pushRecord(records, { kind: "prompt", path: rel(agentFile), status: hadAgentFile ? "synced" : "generated", action: determineAction(hadAgentFile ? "synced" : "generated"), crew: crew.id, agent: agent.id })
    }

    const expertiseFile = path.join(expertiseDir, `${agent.expertise}.yaml`)
    const hadExpertiseFile = existsSync(expertiseFile)

    if (hadExpertiseFile) {
      pushRecord(records, { kind: "expertise", path: rel(expertiseFile), status: "ok", action: determineAction("ok"), crew: crew.id, agent: agent.id })
      if (!jsonOutput) console.log(`ok: ${rel(expertiseFile)}`)
    } else {
      const expertiseContent = defaultExpertiseContent(agent)
      if (checkOnly) {
        pushRecord(records, { kind: "expertise", path: rel(expertiseFile), status: "missing", action: determineAction("missing"), crew: crew.id, agent: agent.id })
        if (!jsonOutput) console.log(`drift: missing ${rel(expertiseFile)}`)
        ok = false
      } else {
        writeFileSync(expertiseFile, expertiseContent, "utf-8")
        if (!jsonOutput) console.log(`generated: ${rel(expertiseFile)}`)
        pushRecord(records, { kind: "expertise", path: rel(expertiseFile), status: "generated", action: determineAction("generated"), crew: crew.id, agent: agent.id })
      }
    }
  }
  return ok
}

function ensurePiThemes(mode, records, jsonOutput) {
  const checkOnly = mode !== "sync"
  const targetDir = path.join(workspaceRoot, ".pi", "themes")
  const globalThemeDir = path.join(resolveMahHome(), "extensions", "themes")
  const bundledThemeDir = path.join(packageRoot, "extensions", "themes")
  const sourceAvailable = existsSync(globalThemeDir) || existsSync(bundledThemeDir)

  if (!sourceAvailable) {
    if (!jsonOutput) console.log(`drift: theme overlay missing in ~/.mah/extensions/themes and package extensions/themes`)
    pushRecord(records, { kind: "theme", path: rel(targetDir), status: "missing", action: "fail" })
    return false
  }

  if (checkOnly) {
    if (existsSync(targetDir)) {
      pushRecord(records, { kind: "theme", path: rel(targetDir), status: "out_of_sync", action: determineAction("out_of_sync") })
      if (!jsonOutput) {
        if (mode === "plan") console.log(`plan: remove stale ${rel(targetDir)}`)
        else console.log(`drift: stale ${rel(targetDir)} (themes resolve from ~/.mah/extensions/themes)`)
      }
      return false
    }
    if (!jsonOutput) {
      if (mode === "plan") console.log("plan: themes resolved from ~/.mah/extensions/themes")
      else console.log("ok: themes resolved from ~/.mah/extensions/themes")
    }
    pushRecord(records, { kind: "theme", path: rel(targetDir), status: "ok", action: determineAction("ok") })
    return true
  }

  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true })
    console.log(`removed: ${rel(targetDir)} (themes resolve from ~/.mah/extensions/themes)`)
    pushRecord(records, { kind: "theme", path: rel(targetDir), status: "synced", action: determineAction("synced") })
  } else {
    pushRecord(records, { kind: "theme", path: rel(targetDir), status: "ok", action: determineAction("ok") })
  }
  return true
}

function ensureRuntimeSkills(runtime, mode, records, jsonOutput) {
  const checkOnly = mode !== "sync"
  const sourceDir = path.join(packageRoot, "skills")
  const targetDir = path.join(workspaceRoot, `.${runtime}`, "skills")

  if (!existsSync(sourceDir)) {
    if (!jsonOutput) console.log(`drift: source skills dir missing ${rel(sourceDir)}`)
    pushRecord(records, { kind: "skill", path: rel(sourceDir), status: "missing", action: "fail" })
    return false
  }

  const sourceSkills = listSubdirs(sourceDir)
  const targetSkills = listSubdirs(targetDir)
  const sourceSet = new Set(sourceSkills)
  const targetSet = new Set(targetSkills)
  const missingSkills = sourceSkills.filter((skill) => !targetSet.has(skill))
  const extraSkills = targetSkills.filter((skill) => !sourceSet.has(skill))
  let allGood = missingSkills.length === 0 && extraSkills.length === 0

  if (checkOnly) {
    for (const skill of sourceSkills) {
      const sourceSkillFile = path.join(sourceDir, skill, "SKILL.md")
      const targetSkillFile = path.join(targetDir, skill, "SKILL.md")
      if (!existsSync(sourceSkillFile)) continue
      if (!existsSync(targetSkillFile)) {
        pushRecord(records, { kind: "skill", path: rel(targetSkillFile), status: "missing", action: determineAction("missing") })
        if (!jsonOutput) console.log(`drift: missing ${rel(targetSkillFile)}`)
        allGood = false
        continue
      }
      const sourceContent = readFileSync(sourceSkillFile, "utf-8")
      const targetContent = readFileSync(targetSkillFile, "utf-8")
      if (sourceContent !== targetContent) {
        const preview = mode === "diff" ? diffPreview(targetContent, sourceContent) : []
        pushRecord(records, { kind: "skill", path: rel(targetSkillFile), status: "out_of_sync", action: determineAction("out_of_sync"), preview })
        if (!jsonOutput) {
          if (mode === "plan") console.log(`plan: update ${rel(targetSkillFile)}`)
          else {
            console.log(`drift: out-of-sync ${rel(targetSkillFile)}`)
            if (mode === "diff") for (const line of preview) console.log(line)
          }
        }
        allGood = false
      } else {
        pushRecord(records, { kind: "skill", path: rel(targetSkillFile), status: "ok", action: determineAction("ok") })
        if (!jsonOutput) {
          if (mode === "plan") console.log(`plan: no-change ${rel(targetSkillFile)}`)
          else console.log(`ok: ${rel(targetSkillFile)}`)
        }
      }
    }

    for (const skill of extraSkills) {
      const targetSkillFile = path.join(targetDir, skill, "SKILL.md")
      pushRecord(records, { kind: "skill", path: rel(targetSkillFile), status: "out_of_sync", action: determineAction("out_of_sync") })
      if (!jsonOutput) {
        if (mode === "plan") console.log(`plan: remove stale ${rel(path.join(targetDir, skill))}`)
        else console.log(`drift: stale ${rel(path.join(targetDir, skill))}`)
      }
      allGood = false
    }
    return allGood
  }

  rmSync(targetDir, { recursive: true, force: true })
  for (const skill of sourceSkills) {
    const sourceSkillDir = path.join(sourceDir, skill)
    if (!existsSync(sourceSkillDir)) continue
    const targetSkillDir = path.join(targetDir, skill)
    mkdirSync(path.dirname(targetSkillDir), { recursive: true })
    cpSync(sourceSkillDir, targetSkillDir, { recursive: true, force: true })
    console.log(`synced: ${rel(targetSkillDir)}/`)
    pushRecord(records, { kind: "skill", path: rel(targetSkillDir), status: "synced", action: determineAction("synced") })
  }
  return true
}

function injectAgentPermissions(content, agent, allowDelegate, byId, meta, runtime) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  let frontmatter = {}
  let body = content

  if (match) {
    try {
      frontmatter = YAML.parse(match[1]) || {}
    } catch {
      frontmatter = {}
    }
    body = match[2]
  }

  const resolvedModel = resolveAgentModel(meta, runtime, agent)
  if (resolvedModel && resolvedModel !== "inherit") {
    frontmatter.model = resolvedModel
    body = body.replace(/^Model: `.*`$/m, `Model: \`${resolvedModel}\``)
  }

  const skillsByPath = new Map(
    Array.isArray(frontmatter.skills)
      ? frontmatter.skills
        .map((item) => [item?.path, item?.["use-when"] || item?.use_when || ""])
        .filter((item) => typeof item[0] === "string" && item[0].trim())
      : []
  )
  frontmatter.skills = runtimeSkillPaths(meta, agent.skills, runtime).map((item) => ({
    path: item,
    "use-when": skillsByPath.get(item) || "Use when relevant to current task."
  }))

  const role = agent.role
  let taskPermissions = null

  if (role === "orchestrator") {
    const allowed = allowDelegate["orchestrator"] || []
    taskPermissions = { "*": "deny", ...Object.fromEntries(allowed.map((a) => [a, "allow"])) }
  } else if (role === "lead") {
    const allowed = allowDelegate[agent.id] || []
    taskPermissions = { "*": "deny", ...Object.fromEntries(allowed.map((a) => [a, "allow"])) }
  }

  if (taskPermissions) {
    frontmatter.permission = frontmatter.permission || {}
    frontmatter.permission.task = taskPermissions
  }

  if (Object.keys(frontmatter).length > 0) {
    const fmYaml = YAML.stringify(frontmatter, { indent: 2 }).trimEnd().replaceAll("use_when", "use-when")
    return `---\n${fmYaml}\n---\n${body}`
  }
  return content
}

function domainFromProfile(meta, profileNameOrNames, runtime) {
  const profiles = Array.isArray(profileNameOrNames) ? profileNameOrNames : [profileNameOrNames]
  const rules = profiles.flatMap((name) => {
    const profile = meta.domain_profiles?.[name]
    return Array.isArray(profile) ? profile : []
  })
  if (rules.length === 0) return []
  return rules.map((rule) => {
    const isRecursive = /\/\*$/.test(rule.path)
    if (runtime === "opencode") {
      const mapped = {
        path: rule.path,
        read: Boolean(rule.read),
        edit: Boolean(rule.edit),
        bash: Boolean(rule.bash)
      }
      if (isRecursive) mapped.recursive = true
      return mapped
    }
    const mapped = {
      path: rule.path,
      read: Boolean(rule.read),
      upsert: Boolean(rule.edit),
      delete: Boolean(rule.bash)
    }
    if (isRecursive) mapped.recursive = true
    return mapped
  })
}

function runtimeTools(agent, runtime) {
  const safeTools = ["read", "grep", "find", "ls"]
  if (agent.role === "orchestrator" || agent.role === "lead") {
    const delegationTool = runtime === "hermes" ? null : "delegate_agent"
    const tools = [...safeTools, delegationTool, "update_expertise_model", "mcp_servers", "mcp_tools", "mcp_call"]
    if (agent.role === "lead") tools.push("bash")
    return runtime === "kilo" ? Object.fromEntries(tools.filter(Boolean).map((tool) => [tool, true])) : tools.filter(Boolean)
  }
  const base = ["read", "grep", "find", "ls", "update_expertise_model", "mcp_servers", "mcp_tools", "mcp_call"]
  const domain = domainFromProfile(metaDoc, agent.domain_profile, runtime)
  if (domain.some((item) => item.upsert || item.edit)) base.unshift("write", "edit")
  if (domain.some((item) => item.delete || item.bash)) base.push("bash")
  const tools = Array.from(new Set(base))
  return runtime === "kilo" ? Object.fromEntries(tools.map((tool) => [tool, true])) : tools
}

function runtimeSkillPaths(meta, skillRefs, runtime) {
  const result = []
  const refs = [...defaultSharedSkills, ...(skillRefs || [])]
  for (const ref of new Set(refs)) {
    const slug = `${ref || ""}`.trim().replaceAll("_", "-")
    if (!slug) continue
    result.push(`.${runtime}/skills/${slug}/SKILL.md`)
  }
  return result
}

function runtimeSkillEntries(meta, skillRefs, runtime) {
  return runtimeSkillPaths(meta, skillRefs, runtime).map((item) => ({
    path: item,
    use_when: "Use when relevant to current task."
  }))
}

function runtimeMcpAccess() {
  return ["clickup", "github", "context7"]
}

function resolveModel(meta, runtime, modelRef) {
  const override = meta.runtimes?.[runtime]?.model_overrides?.[modelRef]
  if (override) return override
  const catalogModel = meta.catalog?.models?.[modelRef] || "inherit"
  if (runtime === "opencode" || runtime === "kilo") return catalogModel
  return normalizeModelId(catalogModel)
}

function resolveModelToken(meta, runtime, token) {
  const key = `${token || ""}`.trim()
  if (!key) return ""
  if (meta.catalog?.models?.[key] || meta.runtimes?.[runtime]?.model_overrides?.[key]) {
    const resolved = resolveModel(meta, runtime, key)
    return normalizeModelId(resolved || key)
  }
  return normalizeModelId(key)
}

function resolveAgentModel(meta, runtime, agent) {
  const direct = `${agent?.model || ""}`.trim()
  if (direct) return resolveModelToken(meta, runtime, direct)
  return resolveModel(meta, runtime, agent?.model_ref)
}

function resolveModelFallbacks(meta, runtime, modelRef) {
  const refs = meta.catalog?.model_fallbacks?.[modelRef]
  if (!Array.isArray(refs)) return []
  return refs
    .map((item) => {
      const key = `${item || ""}`.trim()
      if (!key) return ""
      if (meta.catalog?.models?.[key]) return normalizeModelId(resolveModel(meta, runtime, key))
      return normalizeModelId(key)
    })
    .filter(Boolean)
}

function resolveAgentFallbacks(meta, runtime, agent) {
  const explicit = agent?.model_fallbacks
  if (Array.isArray(explicit) && explicit.length > 0) {
    return explicit
      .map((item) => resolveModelToken(meta, runtime, item))
      .filter(Boolean)
  }
  return resolveModelFallbacks(meta, runtime, agent?.model_ref)
}

function buildOpencodeCrewDoc(meta, crew) {
  const byId = new Map((crew.agents || []).map((agent) => [agent.id, agent]))
  const leadIds = Object.values(crew.topology?.leads || {})
  const teamNames = Object.keys(crew.topology?.workers || {})
  const teams = []

  for (const teamName of teamNames) {
    const leadId = crew.topology?.leads?.[teamName]
    const lead = byId.get(leadId)
    if (!lead) continue

    const memberIds = crew.topology?.workers?.[teamName] || []
    const members = memberIds
      .map((memberId) => byId.get(memberId))
      .filter(Boolean)
      .map((member) => ({
        id: member.id,
        role: "worker",
        ...agentRuntimeMetadata(member),
        instruction_block: buildCrewInstructionBlock(crew, member),
        model: resolveAgentModel(meta, "opencode", member),
        model_fallbacks: resolveAgentFallbacks(meta, "opencode", member),
        agent_file: `.opencode/crew/${crew.id}/agents/${member.id}.md`,
        expertise: {
          path: resolveExpertisePath("opencode", crew.id, member.expertise),
          use_when: `Track durable learnings for ${member.id}.`
        },
        skills: runtimeSkillEntries(meta, member.skills, "opencode"),
        tools: ["read", "grep", "glob", "list", "update-expertise-model"],
        mcp_access: runtimeMcpAccess(),
        domain: domainFromProfile(meta, member.domain_profile, "opencode")
      }))

    teams.push({
      name: titleCase(teamName),
      lead: {
        id: lead.id,
        role: "lead",
        ...agentRuntimeMetadata(lead),
        instruction_block: buildCrewInstructionBlock(crew, lead),
        model: resolveAgentModel(meta, "opencode", lead),
        model_fallbacks: resolveAgentFallbacks(meta, "opencode", lead),
        agent_file: `.opencode/crew/${crew.id}/agents/${lead.id}.md`,
        expertise: {
          path: resolveExpertisePath("opencode", crew.id, lead.expertise),
          use_when: `Track durable learnings for ${lead.id}.`
        },
        skills: runtimeSkillEntries(meta, lead.skills, "opencode"),
        tools: ["task", "update-expertise-model"],
        mcp_access: runtimeMcpAccess(),
        routes_to: memberIds,
        domain: domainFromProfile(meta, lead.domain_profile, "opencode")
      },
      members
    })
  }

  const orchestratorId = crew.topology?.orchestrator
  const orchestrator = byId.get(orchestratorId)
  if (!orchestrator) {
    throw new Error(`crew ${crew.id} missing orchestrator agent definition`)
  }

  const doc = {
    version: 1,
    name: `${crew.id}-multi-team-harness`,
    ...crewRuntimeMetadata(crew),
    instruction_block: buildCrewInstructionBlock(crew, null),
    runtime: {
      harness: "opencode",
      source_of_truth: "meta-agents.yaml",
      source_crew: crew.id,
      validation_command: "npm --prefix .opencode run validate:multi-team"
    },
    shared: {
      skills: runtimeSkillEntries(meta, ["delegate_bounded", "zero_micromanagement", "expertise_model"], "opencode"),
      tools: ["update-expertise-model"],
      mcp: runtimeMcpAccess(),
      domain_profiles: meta.domain_profiles || {}
    },
    orchestrator: {
      id: orchestrator.id,
      role: "ceo",
      ...agentRuntimeMetadata(orchestrator),
      instruction_block: buildCrewInstructionBlock(crew, orchestrator),
      model: resolveAgentModel(meta, "opencode", orchestrator),
      model_fallbacks: resolveAgentFallbacks(meta, "opencode", orchestrator),
      agent_file: `.opencode/crew/${crew.id}/agents/${orchestrator.id}.md`,
      expertise: {
        path: resolveExpertisePath("opencode", crew.id, orchestrator.expertise),
        use_when: `Track durable learnings for ${orchestrator.id}.`
      },
      skills: runtimeSkillEntries(meta, orchestrator.skills, "opencode"),
      tools: ["task", "update-expertise-model"],
      mcp_access: runtimeMcpAccess(),
      routes_to: leadIds,
      domain: domainFromProfile(meta, orchestrator.domain_profile, "opencode")
    },
    teams
  }

  return `${YAML.stringify(doc, { indent: 2 })}`.replaceAll("use_when", "use-when")
}

function buildRuntimeCrewDoc(meta, crew, runtime) {
  if (runtime === "opencode") {
    return buildOpencodeCrewDoc(meta, crew)
  }

  const byId = new Map((crew.agents || []).map((agent) => [agent.id, agent]))
  const leadIds = Object.values(crew.topology?.leads || {})
  const teamNames = Object.keys(crew.topology?.workers || {})
  const teams = []

  for (const teamName of teamNames) {
    const leadId = crew.topology?.leads?.[teamName]
    if (!leadId) continue
    const lead = byId.get(leadId)
    if (!lead) continue
    const memberIds = crew.topology?.workers?.[teamName] || []
    const members = memberIds
      .map((memberId) => byId.get(memberId))
      .filter(Boolean)
      .map((member) => ({
        name: member.id,
        description: `${titleCase(member.id)} ${teamName} worker`,
        ...agentRuntimeMetadata(member),
        instruction_block: buildCrewInstructionBlock(crew, member),
        prompt: resolvePromptPath(runtime, crew.id, member.id),
        expertise: {
          path: resolveExpertisePath(runtime, crew.id, member.expertise),
          use_when: `Track durable learnings for ${member.id}.`,
          updatable: true,
          max_lines: 10000
        },
        model: resolveAgentModel(meta, runtime, member),
        model_fallbacks: resolveAgentFallbacks(meta, runtime, member),
        tools: runtimeTools(member, runtime),
        skills: runtimeSkillPaths(meta, member.skills, runtime),
        domain: domainFromProfile(meta, member.domain_profile, runtime)
      }))

    teams.push({
      name: titleCase(teamName),
      lead: {
        name: lead.id,
        description: `${titleCase(lead.id)} ${teamName} lead`,
        ...agentRuntimeMetadata(lead),
        instruction_block: buildCrewInstructionBlock(crew, lead),
        prompt: resolvePromptPath(runtime, crew.id, lead.id),
        expertise: {
          path: resolveExpertisePath(runtime, crew.id, lead.expertise),
          use_when: `Track durable learnings for ${lead.id}.`,
          updatable: true,
          max_lines: 10000
        },
        model: resolveAgentModel(meta, runtime, lead),
        model_fallbacks: resolveAgentFallbacks(meta, runtime, lead),
        tools: runtimeTools(lead, runtime),
        skills: runtimeSkillPaths(meta, lead.skills, runtime),
        routes_to: memberIds,
        domain: domainFromProfile(meta, lead.domain_profile, runtime)
      },
      members
    })
  }

  const orchestratorId = crew.topology?.orchestrator
  const orchestrator = byId.get(orchestratorId)
  if (!orchestrator) {
    throw new Error(`crew ${crew.id} missing orchestrator agent definition`)
  }

  const configDir = path.join(workspaceRoot, `.${runtime}`, "crew", crew.id)
  const sessionDirRoot = runtimeSessionDirRoot(runtime, crew)

  const sessionDir = path.relative(configDir, path.resolve(workspaceRoot, sessionDirRoot))
  const expertiseDir = path.relative(configDir, path.resolve(workspaceRoot, `.${runtime}/crew/${crew.id}/expertise`))
  const doc = {
    name: `${titleCase(crew.id)}MultiTeam`,
    ...crewRuntimeMetadata(crew),
    instruction_block: buildCrewInstructionBlock(crew, null),
    session_dir: sessionDir,
    expertise_dir: expertiseDir,
    domain_profiles: meta.domain_profiles || {},
    orchestrator: {
      name: orchestrator.id,
      description: `${titleCase(orchestrator.id)} coordinator`,
      ...agentRuntimeMetadata(orchestrator),
      instruction_block: buildCrewInstructionBlock(crew, orchestrator),
      prompt: resolvePromptPath(runtime, crew.id, orchestrator.id),
      expertise: {
        path: resolveExpertisePath(runtime, crew.id, orchestrator.expertise),
        use_when: `Track durable learnings for ${orchestrator.id}.`,
        updatable: true,
        max_lines: 10000
      },
      model: resolveAgentModel(meta, runtime, orchestrator),
      model_fallbacks: resolveAgentFallbacks(meta, runtime, orchestrator),
      tools: runtimeTools(orchestrator, runtime),
      skills: runtimeSkillPaths(meta, orchestrator.skills, runtime),
      routes_to: leadIds,
      domain: domainFromProfile(meta, orchestrator.domain_profile, runtime)
    },
    teams
  }

  return `${YAML.stringify(doc, { indent: 2 })}`.replaceAll("use_when", "use-when").replaceAll("max_lines", "max-lines")
}

function writeOrCheck(targetPath, content, mode, records, jsonOutput) {
  const checkOnly = mode !== "sync"
  if (checkOnly) {
    if (!existsSync(targetPath)) {
      pushRecord(records, { kind: "artifact", path: rel(targetPath), status: "missing", action: determineAction("missing") })
      if (!jsonOutput) {
        if (mode === "plan") console.log(`plan: create ${rel(targetPath)}`)
        else console.log(`drift: missing ${rel(targetPath)}`)
      }
      return false
    }
    const current = readFileSync(targetPath, "utf-8")
    if (current !== content) {
      const preview = mode === "diff" ? diffPreview(current, content) : []
      pushRecord(records, { kind: "artifact", path: rel(targetPath), status: "out_of_sync", action: determineAction("out_of_sync"), preview })
      if (!jsonOutput) {
        if (mode === "plan") console.log(`plan: update ${rel(targetPath)}`)
        else {
          console.log(`drift: out-of-sync ${rel(targetPath)}`)
          if (mode === "diff") for (const line of preview) console.log(line)
        }
      }
      return false
    }
    pushRecord(records, { kind: "artifact", path: rel(targetPath), status: "ok", action: determineAction("ok") })
    if (!jsonOutput) {
      if (mode === "plan") console.log(`plan: no-change ${rel(targetPath)}`)
      else console.log(`ok: ${rel(targetPath)}`)
    }
    return true
  }

  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, content, "utf-8")
  console.log(`synced: ${rel(targetPath)}`)
  pushRecord(records, { kind: "artifact", path: rel(targetPath), status: "synced", action: determineAction("synced") })
  return true
}

const argv = process.argv.slice(2)
const mode = argv.includes("--diff") ? "diff" : argv.includes("--plan") ? "plan" : argv.includes("--check") ? "check" : "sync"
const checkOnly = mode !== "sync"
const jsonOutput = argv.includes("--json")
const raw = readFileSync(metaConfigPath, "utf-8")
const metaDoc = YAML.parse(raw)
const records = []
const activeRuntimes = detectActiveRuntimes()

if (!Array.isArray(metaDoc?.crews) || metaDoc.crews.length === 0) {
  fail("meta-agents.yaml has no crews")
} else {
  let allGood = true

  for (const crew of metaDoc.crews) {
    allGood = syncWorkspaceExpertiseCatalog(crew, mode, records, jsonOutput) && allGood
    if (activeRuntimes.includes("pi")) {
      const piYaml = buildRuntimeCrewDoc(metaDoc, crew, "pi")
      const piPath = path.join(workspaceRoot, ".pi", "crew", crew.id, "multi-team.yaml")
      allGood = writeOrCheck(piPath, piYaml, mode, records, jsonOutput) && allGood
      allGood = syncRuntimePrompts(metaDoc, crew, "pi", mode, records, jsonOutput) && allGood
    }
    if (activeRuntimes.includes("claude")) {
      const claudeYaml = buildRuntimeCrewDoc(metaDoc, crew, "claude")
      const claudePath = path.join(workspaceRoot, ".claude", "crew", crew.id, "multi-team.yaml")
      allGood = writeOrCheck(claudePath, claudeYaml, mode, records, jsonOutput) && allGood
    }
    if (activeRuntimes.includes("codex")) {
      const codexYaml = buildRuntimeCrewDoc(metaDoc, crew, "codex")
      const codexPath = path.join(workspaceRoot, ".codex", "crew", crew.id, "multi-team.yaml")
      allGood = writeOrCheck(codexPath, codexYaml, mode, records, jsonOutput) && allGood
      allGood = syncRuntimePrompts(metaDoc, crew, "codex", mode, records, jsonOutput) && allGood
    }
    if (activeRuntimes.includes("kilo")) {
      const kiloYaml = buildRuntimeCrewDoc(metaDoc, crew, "kilo")
      const kiloPath = path.join(workspaceRoot, ".kilo", "crew", crew.id, "multi-team.yaml")
      allGood = writeOrCheck(kiloPath, kiloYaml, mode, records, jsonOutput) && allGood
      allGood = syncRuntimePrompts(metaDoc, crew, "kilo", mode, records, jsonOutput) && allGood
    }
    if (activeRuntimes.includes("opencode")) {
      const opencodeYaml = buildRuntimeCrewDoc(metaDoc, crew, "opencode")
      const opencodeCrewPath = path.join(workspaceRoot, ".opencode", "crew", crew.id, "multi-team.yaml")
      allGood = writeOrCheck(opencodeCrewPath, opencodeYaml, mode, records, jsonOutput) && allGood
      allGood = ensureOpencodeArtifacts(crew, mode, records, jsonOutput) && allGood
    }
    if (activeRuntimes.includes("openclaude")) {
      const openclaudeYaml = buildRuntimeCrewDoc(metaDoc, crew, "openclaude")
      const openclaudeCrewPath = path.join(workspaceRoot, ".openclaude", "crew", crew.id, "multi-team.yaml")
      allGood = writeOrCheck(openclaudeCrewPath, openclaudeYaml, mode, records, jsonOutput) && allGood
      allGood = syncRuntimePrompts(metaDoc, crew, "openclaude", mode, records, jsonOutput) && allGood
    }
    if (activeRuntimes.includes("hermes")) {
      const hermesYaml = buildRuntimeCrewDoc(metaDoc, crew, "hermes")
      const hermesConfig = buildHermesRuntimeConfig(metaDoc, crew)
      const hermesCrewPath = path.join(workspaceRoot, ".hermes", "crew", crew.id, "multi-team.yaml")
      const hermesConfigPath = path.join(workspaceRoot, ".hermes", "crew", crew.id, "config.yaml")
      allGood = writeOrCheck(hermesCrewPath, hermesYaml, mode, records, jsonOutput) && allGood
      allGood = writeOrCheck(hermesConfigPath, hermesConfig, mode, records, jsonOutput) && allGood
      allGood = syncRuntimePrompts(metaDoc, crew, "hermes", mode, records, jsonOutput) && allGood
    }
    if (activeRuntimes.includes("pi")) {
      allGood = ensurePiThemes(mode, records, jsonOutput) && allGood
    }
    for (const rt of activeRuntimes) {
      allGood = ensureRuntimeSkills(rt, mode, records, jsonOutput) && allGood
    }
    if (!checkOnly && activeRuntimes.includes("hermes")) {
      ensureHermesArtifacts(crew)
    }
  }

  if (!checkOnly) {
    ensureValidateDelegationPermission()
  }

  const summary = {
    mode,
    ok: allGood,
    totals: {
      records: records.length,
      missing: records.filter((item) => item.status === "missing").length,
      out_of_sync: records.filter((item) => item.status === "out_of_sync").length,
      ok: records.filter((item) => item.status === "ok").length,
      synced: records.filter((item) => item.status === "synced").length
    },
    records
  }
  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2))
  } else if (checkOnly && !allGood) {
    const title = mode === "plan" ? "meta sync plan detected changes" : mode === "diff" ? "meta sync diff detected changes" : "meta sync check failed"
    console.log(`${title}: run \`npm run sync:meta\``)
    process.exitCode = 1
  } else if (checkOnly) {
    const title = mode === "plan" ? "meta sync plan clean" : mode === "diff" ? "meta sync diff clean" : "meta sync check passed"
    console.log(title)
  } else if (!process.exitCode) {
    console.log("meta sync completed")
  }
}
