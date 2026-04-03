import { existsSync, unlinkSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const runtimeScriptsRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(runtimeScriptsRoot, "..")
const runtimeRoot = resolveRuntimeRoot(repoRoot)
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

function main() {
  if (!existsSync(activeMetaPath)) {
    console.log("No active crew metadata found.")
    return
  }

  unlinkSync(activeMetaPath)
  console.log(`Cleared active crew selection: ${path.relative(repoRoot, activeMetaPath)}`)
}

main()
