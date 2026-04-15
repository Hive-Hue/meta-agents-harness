import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const piRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(piRoot, "..")
const crewRoot = path.join(piRoot, "crew")
const activeMetaPath = path.join(piRoot, ".active-crew.json")

function listCrews() {
  if (!existsSync(crewRoot)) return []
  return readdirSync(crewRoot)
    .filter((entry) => {
      const abs = path.join(crewRoot, entry)
      return statSync(abs).isDirectory() && existsSync(path.join(abs, "multi-team.yaml"))
    })
    .sort((a, b) => a.localeCompare(b))
}

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exitCode = 1
}

function main() {
  const crew = process.argv[2]
  const crews = listCrews()

  if (!crew) {
    console.log("Usage: pimh use <crew>")
    console.log("")
    console.log("Available crews:")
    for (const item of crews) console.log(`- ${item}`)
    process.exitCode = 1
    return
  }

  if (!crews.includes(crew)) {
    fail(`crew not found: ${crew}`)
    console.log("Available crews:")
    for (const item of crews) console.log(`- ${item}`)
    return
  }

  const configPath = path.join(crewRoot, crew, "multi-team.yaml")
  const sessionRoot = path.join(crewRoot, crew, "sessions")
  mkdirSync(sessionRoot, { recursive: true })

  const meta = {
    crew,
    source_config: path.relative(repoRoot, configPath),
    session_root: path.relative(repoRoot, sessionRoot),
    activated_at: new Date().toISOString(),
    note: "Used by .pi/scripts/run-crew.mjs to bootstrap PI with selected crew."
  }

  writeFileSync(activeMetaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf-8")

  console.log(`Activated PI crew: ${crew}`)
  console.log(`- config: ${meta.source_config}`)
  console.log(`- sessions: ${meta.session_root}`)
  console.log(`- metadata: ${path.relative(repoRoot, activeMetaPath)}`)
  console.log("")
  console.log("Run:")
  console.log("pimh run -c")
}

main()
