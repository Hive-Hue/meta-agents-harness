import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const runtimeScriptsRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(runtimeScriptsRoot, "..")
const runtimeRoot = resolveRuntimeRoot(repoRoot)
const crewRoot = path.join(runtimeRoot, "crew")
const activeMetaPath = path.join(runtimeRoot, ".active-crew.json")

function resolveRuntimeRoot(baseRepoRoot) {
  const envPath = process.env.MULTI_HOME?.trim() || process.env.PI_MULTI_HOME?.trim()
  if (envPath) return path.isAbsolute(envPath) ? envPath : path.resolve(baseRepoRoot, envPath)

  const claudeRoot = path.join(baseRepoRoot, ".claude")
  if (
    existsSync(path.join(claudeRoot, "crew")) ||
    existsSync(path.join(claudeRoot, ".active-crew.json"))
  ) return claudeRoot

  return path.join(baseRepoRoot, ".claude")
}

function listCrews() {
  if (!existsSync(crewRoot)) return []
  return readdirSync(crewRoot)
    .filter((entry) => {
      const abs = path.join(crewRoot, entry)
      return statSync(abs).isDirectory() && existsSync(path.join(abs, "multi-team.yaml"))
    })
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      configPath: path.join(crewRoot, name, "multi-team.yaml"),
      sessionRoot: path.join(crewRoot, name, "sessions")
    }))
}

function readActiveCrew() {
  if (!existsSync(activeMetaPath)) return null
  try {
    return JSON.parse(readFileSync(activeMetaPath, "utf-8"))
  } catch {
    return null
  }
}

function main() {
  const crews = listCrews()
  const active = readActiveCrew()

  console.log("Crews available:")
  if (crews.length === 0) {
    console.log("- none")
    console.log("")
    console.log(`Create folders under ${path.relative(repoRoot, crewRoot)}/<crew>/multi-team.yaml`)
    process.exitCode = 1
    return
  }

  for (const crew of crews) {
    const marker = active?.crew === crew.name ? "*" : "-"
    const relConfig = path.relative(repoRoot, crew.configPath)
    const relSession = path.relative(repoRoot, crew.sessionRoot)
    console.log(`${marker} ${crew.name}`)
    console.log(`  config: ${relConfig}`)
    console.log(`  sessions: ${relSession}`)
  }

  if (!active) {
    console.log("")
    console.log("No active crew selected.")
  }
}

main()
