import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const opencodeRoot = path.resolve(__dirname, "..", "..")
export const repoRoot = path.resolve(opencodeRoot, "..")
export const crewRoot = path.join(opencodeRoot, "crew")
export const activeMetaPath = path.join(opencodeRoot, ".active-crew.json")
export const activeConfigPath = path.join(opencodeRoot, "multi-team.yaml")
export const activeAgentsPath = path.join(opencodeRoot, "agents")

export function rel(filePath) {
  return path.relative(repoRoot, filePath) || "."
}

export function readJson(filePath) {
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

export function listCrews() {
  if (!existsSync(crewRoot)) return []
  return readdirSync(crewRoot)
    .filter((entry) => {
      const abs = path.join(crewRoot, entry)
      return statSync(abs).isDirectory() && existsSync(path.join(abs, "multi-team.yaml"))
    })
    .sort((a, b) => a.localeCompare(b))
}

export function sourceConfigForCrew(crew) {
  return path.join(crewRoot, crew, "multi-team.yaml")
}

export function sourceAgentsForCrew(crew) {
  return path.join(crewRoot, crew, "agents")
}

export function sourceExpertiseForCrew(crew) {
  return path.join(crewRoot, crew, "expertise")
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
  const relativeTarget = path.relative(path.dirname(linkPath), targetPath)
  symlinkSync(relativeTarget, linkPath)
}

function patchOrchestratorNoHierarchy(promptContent, agentIds) {
  const match = promptContent.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return promptContent
  let frontmatter = {}
  try {
    frontmatter = YAML.parse(match[1]) || {}
  } catch {
    return promptContent
  }

  const taskPermission = { "*": "deny" }
  for (const id of agentIds) {
    if (id === "orchestrator") continue
    taskPermission[id] = "allow"
  }

  frontmatter.permission = frontmatter.permission || {}
  frontmatter.permission.task = taskPermission
  const updatedFrontmatter = YAML.stringify(frontmatter).trimEnd()
  return `---\n${updatedFrontmatter}\n---\n${match[2]}`
}

function materializeActiveAgents(crew, noHierarchy) {
  const sourceAgents = sourceAgentsForCrew(crew)
  removeIfExists(activeAgentsPath)
  mkdirSync(activeAgentsPath, { recursive: true })
  writeFileSync(path.join(activeAgentsPath, ".gitkeep"), "", "utf-8")

  const files = readdirSync(sourceAgents)
    .filter((entry) => entry.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b))

  const agentIds = files.map((file) => file.replace(/\.md$/, ""))
  for (const file of files) {
    const sourcePath = path.join(sourceAgents, file)
    const targetPath = path.join(activeAgentsPath, file)
    if (noHierarchy && file === "orchestrator.md") {
      const patched = patchOrchestratorNoHierarchy(readFileSync(sourcePath, "utf-8"), agentIds)
      writeFileSync(targetPath, patched, "utf-8")
    } else {
      const relativeTarget = path.relative(path.dirname(targetPath), sourcePath)
      symlinkSync(relativeTarget, targetPath)
    }
  }
}

export function ensureCrewSelected(crew, options = {}) {
  const sourceConfig = sourceConfigForCrew(crew)
  const sourceAgents = sourceAgentsForCrew(crew)
  const sourceExpertise = sourceExpertiseForCrew(crew)
  const noHierarchy = Boolean(options?.noHierarchy)
  if (!existsSync(sourceConfig)) return false
  if (!existsSync(sourceAgents)) return false
  if (!existsSync(sourceExpertise)) return false
  forceSymlink(sourceConfig, activeConfigPath)
  materializeActiveAgents(crew, noHierarchy)
  const meta = {
    crew,
    source_config: rel(sourceConfig),
    source_agents: rel(sourceAgents),
    source_expertise: rel(sourceExpertise),
    no_hierarchy: noHierarchy,
    selected_at: new Date().toISOString()
  }
  writeFileSync(activeMetaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf-8")
  return true
}

export function clearCrewSelection() {
  removeIfExists(activeConfigPath)
  removeIfExists(activeAgentsPath)
  removeIfExists(activeMetaPath)
}

export function resolveRuntimeSelection(explicitCrew = "") {
  const crews = listCrews()
  if (explicitCrew) {
    if (!crews.includes(explicitCrew)) return null
    return {
      crew: explicitCrew,
      configPath: sourceConfigForCrew(explicitCrew)
    }
  }

  const active = readJson(activeMetaPath)
  const activeCrew = `${active?.crew || ""}`
  if (activeCrew && crews.includes(activeCrew)) {
    return {
      crew: activeCrew,
      configPath: sourceConfigForCrew(activeCrew)
    }
  }

  if (crews.length === 1) {
    return {
      crew: crews[0],
      configPath: sourceConfigForCrew(crews[0])
    }
  }

  return null
}
