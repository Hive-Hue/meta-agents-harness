import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const opencodeRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(opencodeRoot, "..")
const configPath = path.join(opencodeRoot, "multi-team.yaml")

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exitCode = 1
}

function ok(message) {
  console.log(`OK: ${message}`)
}

function resolveFromRepo(filePath) {
  if (path.isAbsolute(filePath)) return filePath
  return path.resolve(repoRoot, filePath)
}

function assertFileExists(filePath, label) {
  const resolved = resolveFromRepo(filePath)
  if (!existsSync(resolved)) {
    fail(`${label} not found: ${filePath}`)
    return false
  }
  return true
}

function validateSkillList(skills, ownerLabel) {
  if (!Array.isArray(skills)) return
  for (const skill of skills) {
    if (!skill?.path) {
      fail(`${ownerLabel} has skill entry without path`)
      continue
    }
    assertFileExists(skill.path, `${ownerLabel} skill`)
  }
}

function validateExpertise(expertise, ownerLabel) {
  if (!expertise?.path) {
    fail(`${ownerLabel} missing expertise.path`)
    return
  }
  assertFileExists(expertise.path, `${ownerLabel} expertise`)
}

function collectAgent(agent, label, registry) {
  if (!agent?.id) {
    fail(`${label} missing id`)
    return
  }
  if (registry.has(agent.id)) {
    fail(`duplicate agent id: ${agent.id}`)
    return
  }

  registry.set(agent.id, { ...agent, label })

  if (!agent.agent_file) fail(`${label} missing agent_file`)
  else assertFileExists(agent.agent_file, `${label} agent_file`)

  validateExpertise(agent.expertise, label)
  validateSkillList(agent.skills, label)
}

function main() {
  if (!existsSync(configPath)) {
    fail(`config file not found at ${configPath}`)
    return
  }

  const raw = readFileSync(configPath, "utf-8")
  let doc
  try {
    doc = YAML.parse(raw)
  } catch (error) {
    fail(`invalid YAML: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  if (!doc?.orchestrator) fail("missing orchestrator block")
  if (!Array.isArray(doc?.teams) || doc.teams.length === 0) fail("missing teams array")

  if (process.exitCode) return

  const agents = new Map()
  collectAgent(doc.orchestrator, "orchestrator", agents)

  const leadIds = []
  for (const team of doc.teams) {
    if (!team?.name) {
      fail("team entry missing name")
      continue
    }
    if (!team.lead) {
      fail(`team ${team.name} missing lead`)
      continue
    }

    const leadLabel = `team ${team.name} lead`
    collectAgent(team.lead, leadLabel, agents)
    leadIds.push(team.lead.id)

    if (!Array.isArray(team.members) || team.members.length === 0) {
      fail(`team ${team.name} has no members`)
      continue
    }

    const memberIds = []
    for (const member of team.members) {
      const memberLabel = `team ${team.name} member`
      collectAgent(member, memberLabel, agents)
      if (member?.id) memberIds.push(member.id)
    }

    const leadRoutes = Array.isArray(team.lead.routes_to) ? team.lead.routes_to : []
    for (const target of leadRoutes) {
      if (!memberIds.includes(target)) {
        fail(`team ${team.name} lead routes_to unknown member: ${target}`)
      }
    }
  }

  const orchestratorRoutes = Array.isArray(doc.orchestrator.routes_to) ? doc.orchestrator.routes_to : []
  for (const target of orchestratorRoutes) {
    if (!leadIds.includes(target)) {
      fail(`orchestrator routes_to unknown lead: ${target}`)
    }
  }

  if (process.exitCode) return

  ok(`parsed .opencode/multi-team.yaml`)
  ok(`validated ${agents.size} unique agents`)
  ok(`validated topology routes (orchestrator -> leads, leads -> members)`)
  ok(`validated referenced files (agents, expertise, skills)`)
}

main()
