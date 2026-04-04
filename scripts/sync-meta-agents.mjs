import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const metaConfigPath = path.join(repoRoot, "meta-agents.yaml")

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exitCode = 1
}

function rel(filePath) {
  return path.relative(repoRoot, filePath) || "."
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
  const baseDir = path.join(repoRoot, `.${runtime}`, "crew", crewId, "agents")
  const variants = normalizePromptName(agentId)
  for (const name of variants) {
    const candidate = path.join(baseDir, `${name}.md`)
    if (existsSync(candidate)) return `.${path.sep}${path.relative(repoRoot, candidate)}`.replaceAll(path.sep, "/").replace(/^\.\//, "")
  }
  const fallback = path.join(baseDir, `${variants[0]}.md`)
  return `.${path.sep}${path.relative(repoRoot, fallback)}`.replaceAll(path.sep, "/").replace(/^\.\//, "")
}

function resolveExpertisePath(runtime, crewId, expertiseName) {
  return `.${runtime}/crew/${crewId}/expertise/${expertiseName}.yaml`
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

function buildPiPromptFromMeta(meta, crew, agent, currentRaw) {
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
    model: resolveAgentModel(meta, "pi", agent),
    role: agent.role,
    team: titleCase(agent.team),
    expertise: {
      ...(existing.expertise && typeof existing.expertise === "object" ? existing.expertise : {}),
      path: resolveExpertisePath("pi", crew.id, agent.expertise)
    },
    tools: runtimeTools(agent, "pi"),
    skills: runtimeSkillPaths(meta, agent.skills, "pi").map((item) => ({
      path: item,
      "use-when": skillsByPath.get(item) || "Use when relevant to current task."
    })),
    domain: domainFromProfile(meta, agent.domain_profile, "pi")
  }

  const frontmatterText = YAML.stringify(next, { indent: 2 }).trimEnd()
  const body = parsed.body && parsed.body.trim().length > 0
    ? parsed.body.replace(/^\n+/, "")
    : `# ${titleCase(agent.id)}\n`
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

function syncPiPrompts(meta, crew, mode, records, jsonOutput) {
  const checkOnly = mode !== "sync"
  let ok = true
  for (const agent of crew.agents || []) {
    const relativePromptPath = resolvePromptPath("pi", crew.id, agent.id)
    const promptPath = path.resolve(repoRoot, relativePromptPath)
    if (checkOnly && !existsSync(promptPath)) {
      pushRecord(records, { kind: "prompt", path: rel(promptPath), status: "missing", crew: crew.id, agent: agent.id })
      if (!jsonOutput) {
        if (mode === "plan") console.log(`plan: create ${rel(promptPath)}`)
        else console.log(`drift: missing ${rel(promptPath)}`)
      }
      ok = false
      continue
    }

    const currentRaw = existsSync(promptPath) ? readFileSync(promptPath, "utf-8") : ""
    const nextRaw = buildPiPromptFromMeta(meta, crew, agent, currentRaw)
    if (checkOnly) {
      if (currentRaw !== nextRaw) {
        const preview = mode === "diff" ? diffPreview(currentRaw, nextRaw) : []
        pushRecord(records, { kind: "prompt", path: rel(promptPath), status: "out_of_sync", crew: crew.id, agent: agent.id, preview })
        if (!jsonOutput) {
          if (mode === "plan") console.log(`plan: update ${rel(promptPath)}`)
          else {
            console.log(`drift: out-of-sync ${rel(promptPath)}`)
            if (mode === "diff") for (const line of preview) console.log(line)
          }
        }
        ok = false
      } else {
        pushRecord(records, { kind: "prompt", path: rel(promptPath), status: "ok", crew: crew.id, agent: agent.id })
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
      pushRecord(records, { kind: "prompt", path: rel(promptPath), status: "synced", crew: crew.id, agent: agent.id })
    }
  }
  return ok
}

function ensureOpencodeArtifacts(crew) {
  const agentsDir = path.join(repoRoot, ".opencode", "crew", crew.id, "agents")
  const expertiseDir = path.join(repoRoot, ".opencode", "crew", crew.id, "expertise")
  const legacyAgentsDir = path.join(repoRoot, ".opencode", "agents")
  const legacyExpertiseDir = path.join(repoRoot, ".opencode", "expertise")
  const referenceRoot = path.resolve(repoRoot, "..", "opencode-multi-harness", ".opencode", "crew", crew.id)
  const referenceAgentsDir = path.join(referenceRoot, "agents")
  const referenceExpertiseDir = path.join(referenceRoot, "expertise")
  mkdirSync(agentsDir, { recursive: true })
  mkdirSync(expertiseDir, { recursive: true })

  for (const agent of crew.agents || []) {
    const agentFile = path.join(agentsDir, `${agent.id}.md`)
    const referenceAgentFile = path.join(referenceAgentsDir, `${agent.id}.md`)
    const legacyAgentFile = path.join(legacyAgentsDir, `${agent.id}.md`)
    const hadAgentFile = existsSync(agentFile)
    const content = existsSync(referenceAgentFile)
      ? readFileSync(referenceAgentFile, "utf-8")
      : existsSync(legacyAgentFile)
        ? readFileSync(legacyAgentFile, "utf-8")
        : `# ${titleCase(agent.id)}\n\nRole: ${agent.role}\nTeam: ${agent.team}\n\nUse this file as the runtime prompt source for ${agent.id}.\n`
    const current = hadAgentFile ? readFileSync(agentFile, "utf-8") : ""
    if (current !== content) {
      writeFileSync(agentFile, content, "utf-8")
      console.log(`${hadAgentFile ? "synced" : "generated"}: ${rel(agentFile)}`)
    }

    const expertiseFile = path.join(expertiseDir, `${agent.expertise}.yaml`)
    const referenceExpertiseFile = path.join(referenceExpertiseDir, `${agent.expertise}.yaml`)
    const legacyExpertiseFile = path.join(legacyExpertiseDir, `${agent.expertise}.yaml`)
    const hadExpertiseFile = existsSync(expertiseFile)
    const expertiseContent = existsSync(referenceExpertiseFile)
      ? readFileSync(referenceExpertiseFile, "utf-8")
      : existsSync(legacyExpertiseFile)
        ? readFileSync(legacyExpertiseFile, "utf-8")
        : `agent: ${agent.id}\nsummary: []\n`
    const currentExpertise = hadExpertiseFile ? readFileSync(expertiseFile, "utf-8") : ""
    if (currentExpertise !== expertiseContent) {
      writeFileSync(expertiseFile, expertiseContent, "utf-8")
      console.log(`${hadExpertiseFile ? "synced" : "generated"}: ${rel(expertiseFile)}`)
    }
  }
}

function domainFromProfile(meta, profileName, runtime) {
  const rules = meta.catalog?.domain_profiles?.[profileName]
  if (!Array.isArray(rules)) return []
  return rules.map((rule) => {
    if (runtime === "opencode") {
      return {
        path: rule.path,
        read: Boolean(rule.read),
        edit: Boolean(rule.edit),
        bash: Boolean(rule.bash)
      }
    }
    return {
      path: rule.path,
      read: Boolean(rule.read),
      upsert: Boolean(rule.edit),
      delete: Boolean(rule.bash)
    }
  })
}

function runtimeTools(agent, runtime) {
  if (agent.role === "orchestrator" || agent.role === "lead") {
    return ["delegate_agent", "update_mental_model", "mcp_servers", "mcp_tools", "mcp_call"]
  }
  const base = ["read", "grep", "find", "ls", "update_mental_model", "mcp_servers", "mcp_tools", "mcp_call"]
  const domain = domainFromProfile(metaDoc, agent.domain_profile, runtime)
  if (domain.some((item) => item.upsert || item.edit)) base.unshift("write", "edit")
  if (domain.some((item) => item.delete || item.bash)) base.push("bash")
  return Array.from(new Set(base))
}

function runtimeSkillPaths(meta, skillRefs, runtime) {
  const result = []
  for (const ref of skillRefs || []) {
    const mapped = meta.catalog?.skills?.[ref]?.[runtime]
    if (mapped) result.push(mapped)
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
  if (runtime === "opencode") {
    const override = meta.runtimes?.opencode?.model_overrides?.[modelRef]
    if (override) return override
  }
  return meta.catalog?.models?.[modelRef] || "inherit"
}

function resolveModelToken(meta, runtime, token) {
  const key = `${token || ""}`.trim()
  if (!key) return ""
  if (meta.catalog?.models?.[key] || runtime === "opencode") {
    const resolved = resolveModel(meta, runtime, key)
    return resolved || key
  }
  return key
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
      if (meta.catalog?.models?.[key]) return resolveModel(meta, runtime, key)
      return key
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
        model: resolveAgentModel(meta, "opencode", member),
        model_fallbacks: resolveAgentFallbacks(meta, "opencode", member),
        agent_file: `.opencode/crew/${crew.id}/agents/${member.id}.md`,
        expertise: {
          path: resolveExpertisePath("opencode", crew.id, member.expertise),
          use_when: `Track durable learnings for ${member.id}.`
        },
        skills: runtimeSkillEntries(meta, member.skills, "opencode"),
        tools: ["read", "grep", "glob", "list", "update-mental-model"],
        mcp_access: runtimeMcpAccess(),
        domain: domainFromProfile(meta, member.domain_profile, "opencode")
      }))

    teams.push({
      name: titleCase(teamName),
      lead: {
        id: lead.id,
        role: "lead",
        model: resolveAgentModel(meta, "opencode", lead),
        model_fallbacks: resolveAgentFallbacks(meta, "opencode", lead),
        agent_file: `.opencode/crew/${crew.id}/agents/${lead.id}.md`,
        expertise: {
          path: resolveExpertisePath("opencode", crew.id, lead.expertise),
          use_when: `Track durable learnings for ${lead.id}.`
        },
        skills: runtimeSkillEntries(meta, lead.skills, "opencode"),
        tools: ["task", "update-mental-model"],
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
    runtime: {
      harness: "opencode",
      source_of_truth: "meta-agents.yaml",
      source_crew: crew.id,
      validation_command: "npm --prefix .opencode run validate:multi-team"
    },
    shared: {
      skills: runtimeSkillEntries(meta, ["delegate_bounded", "zero_micromanagement", "mental_model"], "opencode"),
      tools: ["update-mental-model"],
      mcp: runtimeMcpAccess()
    },
    orchestrator: {
      id: orchestrator.id,
      role: "ceo",
      model: resolveAgentModel(meta, "opencode", orchestrator),
      model_fallbacks: resolveAgentFallbacks(meta, "opencode", orchestrator),
      agent_file: `.opencode/crew/${crew.id}/agents/${orchestrator.id}.md`,
      expertise: {
        path: resolveExpertisePath("opencode", crew.id, orchestrator.expertise),
        use_when: `Track durable learnings for ${orchestrator.id}.`
      },
      skills: runtimeSkillEntries(meta, orchestrator.skills, "opencode"),
      tools: ["task", "update-mental-model"],
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

  const sessionDir =
    runtime === "pi"
      ? crew.session?.pi_root || `.${runtime}/crew/${crew.id}/sessions`
      : runtime === "claude"
        ? crew.session?.claude_mirror_root || `.${runtime}/crew/${crew.id}/sessions`
      : crew.session?.opencode_root || `.opencode/crew/${crew.id}/sessions`

  const expertiseDir = `.${runtime}/crew/${crew.id}/expertise`
  const doc = {
    name: `${titleCase(crew.id)}MultiTeam`,
    session_dir: sessionDir,
    expertise_dir: expertiseDir,
    orchestrator: {
      name: orchestrator.id,
      description: `${titleCase(orchestrator.id)} coordinator`,
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
      pushRecord(records, { kind: "artifact", path: rel(targetPath), status: "missing" })
      if (!jsonOutput) {
        if (mode === "plan") console.log(`plan: create ${rel(targetPath)}`)
        else console.log(`drift: missing ${rel(targetPath)}`)
      }
      return false
    }
    const current = readFileSync(targetPath, "utf-8")
    if (current !== content) {
      const preview = mode === "diff" ? diffPreview(current, content) : []
      pushRecord(records, { kind: "artifact", path: rel(targetPath), status: "out_of_sync", preview })
      if (!jsonOutput) {
        if (mode === "plan") console.log(`plan: update ${rel(targetPath)}`)
        else {
          console.log(`drift: out-of-sync ${rel(targetPath)}`)
          if (mode === "diff") for (const line of preview) console.log(line)
        }
      }
      return false
    }
    pushRecord(records, { kind: "artifact", path: rel(targetPath), status: "ok" })
    if (!jsonOutput) {
      if (mode === "plan") console.log(`plan: no-change ${rel(targetPath)}`)
      else console.log(`ok: ${rel(targetPath)}`)
    }
    return true
  }

  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, content, "utf-8")
  console.log(`synced: ${rel(targetPath)}`)
  pushRecord(records, { kind: "artifact", path: rel(targetPath), status: "synced" })
  return true
}

const argv = process.argv.slice(2)
const mode = argv.includes("--diff") ? "diff" : argv.includes("--plan") ? "plan" : argv.includes("--check") ? "check" : "sync"
const checkOnly = mode !== "sync"
const jsonOutput = argv.includes("--json")
const raw = readFileSync(metaConfigPath, "utf-8")
const metaDoc = YAML.parse(raw)
const records = []

if (!Array.isArray(metaDoc?.crews) || metaDoc.crews.length === 0) {
  fail("meta-agents.yaml has no crews")
} else {
  let allGood = true

  for (const crew of metaDoc.crews) {
    const piYaml = buildRuntimeCrewDoc(metaDoc, crew, "pi")
    const claudeYaml = buildRuntimeCrewDoc(metaDoc, crew, "claude")
    const opencodeYaml = buildRuntimeCrewDoc(metaDoc, crew, "opencode")

    const piPath = path.join(repoRoot, ".pi", "crew", crew.id, "multi-team.yaml")
    const claudePath = path.join(repoRoot, ".claude", "crew", crew.id, "multi-team.yaml")
    const opencodeCrewPath = path.join(repoRoot, ".opencode", "crew", crew.id, "multi-team.yaml")

    allGood = writeOrCheck(piPath, piYaml, mode, records, jsonOutput) && allGood
    allGood = writeOrCheck(claudePath, claudeYaml, mode, records, jsonOutput) && allGood
    allGood = writeOrCheck(opencodeCrewPath, opencodeYaml, mode, records, jsonOutput) && allGood
    allGood = syncPiPrompts(metaDoc, crew, mode, records, jsonOutput) && allGood

    if (!checkOnly) {
      ensureOpencodeArtifacts(crew)
    }
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
