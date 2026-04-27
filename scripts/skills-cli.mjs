import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import YAML from "yaml"
import { findMahSkillFile, resolveMahHome } from "./mah-home.mjs"
import { resolveWorkspaceRoot } from "./workspace-root.mjs"

const repoRoot = resolveWorkspaceRoot(process.cwd())

function parseValueArg(argv, flag, short = "") {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === flag && argv[i + 1]) return argv[i + 1]
    if (short && token === short && argv[i + 1]) return argv[i + 1]
    if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1)
  }
  return ""
}

function hasFlag(argv, flag) {
  return argv.includes(flag)
}

function normalizeSkillSlug(value = "") {
  return `${value || ""}`.trim().replaceAll("_", "-").toLowerCase()
}

function resolveSkillFile(skillRef = "") {
  const normalized = normalizeSkillSlug(skillRef)
  if (!normalized) return ""
  const direct = findMahSkillFile(normalized, { repoRoot })
  if (direct) return direct
  return findMahSkillFile(`${skillRef || ""}`.trim(), { repoRoot })
}

function loadMetaDocument(metaPath) {
  if (!existsSync(metaPath)) {
    throw new Error(`meta config not found: ${metaPath}`)
  }
  const raw = readFileSync(metaPath, "utf-8")
  return YAML.parseDocument(raw)
}

function resolveMetaPath(argv) {
  const configured = parseValueArg(argv, "--config")
  if (configured) return path.resolve(configured)
  return path.join(repoRoot, "meta-agents.yaml")
}

function walkAgents(metaConfig = {}) {
  const rows = []
  for (const crew of Array.isArray(metaConfig?.crews) ? metaConfig.crews : []) {
    for (const agent of Array.isArray(crew?.agents) ? crew.agents : []) {
      rows.push({
        crew: `${crew.id || ""}`.trim(),
        agent: `${agent.id || ""}`.trim(),
        role: `${agent.role || ""}`.trim(),
        skills: Array.isArray(agent.skills) ? agent.skills : [],
      })
    }
  }
  return rows
}

function collectSkillDirs(baseDir) {
  if (!baseDir || !existsSync(baseDir)) return []
  const names = []
  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillPath = path.join(baseDir, entry.name, "SKILL.md")
    if (!existsSync(skillPath)) continue
    names.push(entry.name)
  }
  return names
}

function readSkillDocMetadata(skillFilePath, fallbackName = "") {
  const raw = readFileSync(skillFilePath, "utf-8")
  const lines = raw.split(/\r?\n/)
  const titleLine = lines.find((line) => /^#\s+/.test(line.trim()))
  const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : fallbackName
  const sections = lines
    .filter((line) => /^##\s+/.test(line.trim()))
    .map((line) => line.replace(/^##\s+/, "").trim())

  const summary = lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("```") && !line.startsWith("- "))
    .slice(0, 3)
    .join(" ")

  // Parse description from YAML frontmatter
  let description = ""
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (fmMatch) {
    const frontmatter = fmMatch[1]
    const descMatch = frontmatter.match(/^description:\s*(?:>?\s*\n)?([\s\S]*?)(?=\n[a-zA-Z]|\n---|$)/m)
    if (descMatch) {
      description = descMatch[1]
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l)
        .join(" ")
        .trim()
    }
  }

  return {
    title: title || fallbackName,
    sections,
    summary: summary || "No summary paragraph found in SKILL.md.",
    description: description || summary || "",
    raw,
  }
}

function locateAgent(metaConfig, { agentId = "", crewId = "" }) {
  const matches = []
  const crews = Array.isArray(metaConfig?.crews) ? metaConfig.crews : []
  for (let crewIndex = 0; crewIndex < crews.length; crewIndex += 1) {
    const crew = crews[crewIndex]
    if (crewId && `${crew?.id || ""}`.trim() !== crewId) continue
    const agents = Array.isArray(crew?.agents) ? crew.agents : []
    for (let agentIndex = 0; agentIndex < agents.length; agentIndex += 1) {
      const agent = agents[agentIndex]
      if (`${agent?.id || ""}`.trim() !== agentId) continue
      matches.push({ crewIndex, agentIndex, crew: crew.id, agent })
    }
  }

  if (matches.length === 0) {
    return { ok: false, error: `agent not found: ${agentId}${crewId ? ` (crew ${crewId})` : ""}` }
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `agent '${agentId}' is ambiguous across crews; pass --crew <id>`,
      candidates: matches.map((item) => item.crew),
    }
  }
  return { ok: true, match: matches[0] }
}

function printSkillsHelp() {
  console.log(`mah skills — Skills Catalog & Assignment CLI

Usage:
  mah skills list [--crew <crew>] [--agent <agent>] [--json]
  mah skills inspect <skill> [--json]
  mah skills explain <skill> [--json]
  mah skills add <skill> --agent <agent> [--crew <crew>] [--dry-run] [--json]
  mah skills remove <skill> --agent <agent> [--crew <crew>] [--dry-run] [--json]

Subcommands:
  list       List installed and assigned skills
  inspect    Inspect skill metadata and references
  explain    Explain what the skill is for and where it is used
  add        Attach a skill to an agent in meta-agents.yaml
  remove     Detach a skill from an agent in meta-agents.yaml

Options:
  --crew <crew>     Crew filter/selector for list/add/remove
  --agent <agent>   Agent filter/selector for list/add/remove
  --config <path>   Alternate meta-agents.yaml path
  --dry-run         Preview add/remove without writing
  --json            JSON output mode
  -h, --help        Show this help
`)
}

function formatAssignmentRows(rows = []) {
  if (rows.length === 0) return "none"
  return rows.map((row) => `${row.crew}:${row.agent}`).join(", ")
}

async function main() {
  const argv = process.argv.slice(2)
  const sub = argv[0]
  const subArgv = argv.slice(1)
  const jsonMode = hasFlag(subArgv, "--json")
  const dryRun = hasFlag(subArgv, "--dry-run")
  const metaPath = resolveMetaPath(subArgv)

  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    printSkillsHelp()
    return
  }

  const metaDoc = loadMetaDocument(metaPath)
  const metaConfig = metaDoc.toJS()
  const agentRows = walkAgents(metaConfig)
  const assignmentBySkill = new Map()
  for (const row of agentRows) {
    for (const ref of row.skills) {
      const slug = normalizeSkillSlug(ref)
      if (!slug) continue
      const list = assignmentBySkill.get(slug) || []
      list.push({ crew: row.crew, agent: row.agent, ref })
      assignmentBySkill.set(slug, list)
    }
  }

  if (sub === "list") {
    const crewFilter = parseValueArg(subArgv, "--crew")
    const agentFilter = parseValueArg(subArgv, "--agent")
    const skillsRootLocal = path.join(repoRoot, "skills")
    const skillsRootHome = path.join(resolveMahHome(), "skills")
    const fromDirs = [...collectSkillDirs(skillsRootHome), ...collectSkillDirs(skillsRootLocal)]
    const fromAssignments = [...assignmentBySkill.keys()]
    const allSkills = [...new Set([...fromDirs, ...fromAssignments])].sort((a, b) => a.localeCompare(b))

    const skills = allSkills.map((slug) => {
      const assigned = (assignmentBySkill.get(slug) || []).filter((entry) => {
        if (crewFilter && entry.crew !== crewFilter) return false
        if (agentFilter && entry.agent !== agentFilter) return false
        return true
      })
      const filePath = resolveSkillFile(slug)
      return {
        skill: slug,
        status: filePath ? "installed" : "missing",
        assigned_count: assigned.length,
        assigned_to: assigned.map((item) => `${item.crew}:${item.agent}`),
        refs: [...new Set((assignmentBySkill.get(slug) || []).map((item) => item.ref))].sort((a, b) => a.localeCompare(b)),
        file_path: filePath,
      }
    }).filter((item) => {
      if (agentFilter || crewFilter) return item.assigned_count > 0
      return true
    })

    if (jsonMode) {
      console.log(JSON.stringify({ skills, count: skills.length, filters: { crew: crewFilter || "", agent: agentFilter || "" } }, null, 2))
      return
    }

    if (skills.length === 0) {
      console.log("No skills found for current filters.")
      return
    }

    console.log("=== Skills ===")
    console.log("")
    console.log("Skill".padEnd(34) + " Status".padEnd(12) + " Assigned".padEnd(10) + " Agents")
    console.log("─".repeat(34) + " " + "─".repeat(12) + " " + "─".repeat(10) + " " + "─".repeat(40))
    for (const item of skills) {
      console.log(
        item.skill.padEnd(34)
        + " "
        + item.status.padEnd(12)
        + " "
        + String(item.assigned_count).padEnd(10)
        + " "
        + formatAssignmentRows((item.assigned_to || []).map((value) => {
          const [crew, agent] = `${value}`.split(":")
          return { crew, agent }
        })),
      )
    }
    console.log(`\n${skills.length} skill(s).`)
    return
  }

  if (sub === "inspect" || sub === "explain") {
    const target = subArgv.find((item) => item && !item.startsWith("-"))
    if (!target) {
      console.error(`ERROR: usage: mah skills ${sub} <skill> [--json]`)
      process.exitCode = 1
      return
    }

    const skillFile = resolveSkillFile(target)
    if (!skillFile) {
      console.error(`ERROR: skill not found: ${target}`)
      process.exitCode = 1
      return
    }

    const slug = normalizeSkillSlug(target)
    const assignments = assignmentBySkill.get(slug) || []
    const metadata = readSkillDocMetadata(skillFile, slug)
    const payload = {
      skill: slug,
      file_path: skillFile,
      title: metadata.title,
      summary: metadata.summary,
      description: metadata.description,
      sections: metadata.sections,
      assignments: assignments.map((item) => ({ crew: item.crew, agent: item.agent, ref: item.ref })),
      assignment_count: assignments.length,
      references: {
        local_skill: path.join(repoRoot, "skills", slug, "SKILL.md"),
        home_skill: path.join(resolveMahHome(), "skills", slug, "SKILL.md"),
      },
    }

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    if (sub === "inspect") {
      console.log(`=== Skill Inspect: ${payload.skill} ===`)
      console.log(`Title: ${payload.title}`)
      console.log(`File: ${payload.file_path}`)
      console.log(`Assigned: ${payload.assignment_count}`)
      if (payload.sections.length > 0) console.log(`Sections: ${payload.sections.join(", ")}`)
      console.log(`Summary: ${payload.summary}`)
      if (payload.description) console.log(`Description: ${payload.description}`)
      return
    }

    console.log(`=== Skill Explain: ${payload.skill} ===`)
    console.log(`What it is: ${payload.summary}`)
    console.log(`Where defined: ${payload.file_path}`)
    console.log(`Used by: ${payload.assignment_count === 0 ? "no agents currently assigned" : payload.assignments.map((item) => `${item.crew}:${item.agent}`).join(", ")}`)
    console.log("How to inspect deeper: mah skills inspect " + payload.skill)
    return
  }

  if (sub === "add" || sub === "remove") {
    const target = subArgv.find((item) => item && !item.startsWith("-"))
    const agentId = parseValueArg(subArgv, "--agent")
    const crewId = parseValueArg(subArgv, "--crew")
    if (!target || !agentId) {
      console.error(`ERROR: usage: mah skills ${sub} <skill> --agent <agent> [--crew <crew>] [--dry-run] [--json]`)
      process.exitCode = 1
      return
    }

    const skillFile = resolveSkillFile(target)
    if (!skillFile) {
      console.error(`ERROR: skill not found: ${target}`)
      process.exitCode = 1
      return
    }

    const locate = locateAgent(metaConfig, { agentId, crewId })
    if (!locate.ok) {
      console.error(`ERROR: ${locate.error}`)
      process.exitCode = 1
      return
    }

    const { crewIndex, agentIndex, crew } = locate.match
    const skillsPath = ["crews", crewIndex, "agents", agentIndex, "skills"]
    const existingSkills = Array.isArray(locate.match?.agent?.skills) ? [...locate.match.agent.skills] : []
    const targetSlug = normalizeSkillSlug(target)
    const exists = existingSkills.some((item) => normalizeSkillSlug(item) === targetSlug)

    let changed = false
    let nextSkills = [...existingSkills]
    if (sub === "add") {
      if (!exists) {
        nextSkills = [...existingSkills, `${target}`.trim()]
        changed = true
      }
    } else if (exists) {
      nextSkills = existingSkills.filter((item) => normalizeSkillSlug(item) !== targetSlug)
      changed = true
    }

    if (changed) {
      metaDoc.setIn(skillsPath, nextSkills)
      if (!dryRun) {
        writeFileSync(metaPath, metaDoc.toString(), "utf-8")
      }
    }

    const payload = {
      ok: true,
      command: sub,
      skill: targetSlug,
      agent: agentId,
      crew,
      changed,
      dry_run: dryRun,
      meta_path: metaPath,
      total_skills: nextSkills.length,
      before: existingSkills,
      after: nextSkills,
    }

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2))
      return
    }

    if (!changed) {
      console.log(`${sub}: no changes (${targetSlug} already ${sub === "add" ? "assigned" : "not assigned"} to ${crew}:${agentId})`)
      return
    }

    console.log(`${sub}: ${targetSlug} ${sub === "add" ? "attached to" : "removed from"} ${crew}:${agentId}${dryRun ? " (dry-run)" : ""}`)
    console.log(`skills: ${nextSkills.join(", ")}`)
    return
  }

  console.error(`ERROR: unknown skills subcommand '${sub}'. Run 'mah skills --help'.`)
  process.exitCode = 1
}

main().catch((error) => {
  console.error(`ERROR: ${error?.message || error}`)
  process.exitCode = 1
})
