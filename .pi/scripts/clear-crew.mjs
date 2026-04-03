import { existsSync, unlinkSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const piRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(piRoot, "..")
const activeMetaPath = path.join(piRoot, ".active-crew.json")

function main() {
  if (!existsSync(activeMetaPath)) {
    console.log("No active PI crew metadata found.")
    return
  }

  unlinkSync(activeMetaPath)
  console.log(`Cleared active PI crew selection: ${path.relative(repoRoot, activeMetaPath)}`)
}

main()
