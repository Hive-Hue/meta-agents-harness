import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"
import { listCrews, opencodeRoot, repoRoot } from "./lib/crew-runtime.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exitCode = 1
}

function ok(message) {
  console.log(`ok: ${message}`)
}

function checkFile(filePath) {
  if (!existsSync(filePath)) {
    fail(`missing ${path.relative(repoRoot, filePath)}`)
    return false
  }
  ok(path.relative(repoRoot, filePath))
  return true
}

checkFile(path.join(opencodeRoot, "package.json"))
checkFile(path.join(opencodeRoot, "scripts", "sync-multi-team.mjs"))
checkFile(path.join(opencodeRoot, "scripts", "validate-multi-team.mjs"))
checkFile(path.join(opencodeRoot, "scripts", "run-crew-opencode.mjs"))
checkFile(path.join(opencodeRoot, "bin", "ocmh"))

const crews = listCrews()
if (crews.length === 0) {
  fail("no OpenCode crews found under .opencode/crew")
} else {
  ok(`crew_configs: ${crews.length} crew(s): ${crews.join(", ")}`)
}

for (const crew of crews) {
  const crewPath = path.join(opencodeRoot, "crew", crew, "multi-team.yaml")
  if (!checkFile(crewPath)) continue
  try {
    YAML.parse(readFileSync(crewPath, "utf-8"))
    ok(`yaml ${path.relative(repoRoot, crewPath)}`)
  } catch (error) {
    fail(`invalid YAML ${path.relative(repoRoot, crewPath)}: ${error.message}`)
  }
}

if (process.exitCode) {
  process.exitCode = 1
}
