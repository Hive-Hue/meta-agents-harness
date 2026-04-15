import { readFileSync } from "node:fs"
import path from "node:path"
import { activeMetaPath, listCrews, opencodeRoot, readJson, repoRoot } from "./lib/crew-runtime.mjs"

const active = readJson(activeMetaPath)
const crews = listCrews()

console.log("OpenCode runtime doctor")
console.log(`- root=${path.relative(repoRoot, opencodeRoot)}`)
console.log(`- crews=${crews.length > 0 ? crews.join(", ") : "(none)"}`)
console.log(`- active_crew=${active?.crew || "(none)"}`)
if (active?.source_config) console.log(`- source_config=${active.source_config}`)
if (active?.session_root) console.log(`- session_root=${active.session_root}`)

try {
  const pkg = JSON.parse(readFileSync(path.join(opencodeRoot, "package.json"), "utf-8"))
  console.log(`- package=${pkg.name || "unknown"}`)
} catch {
  console.log("- package=(invalid package.json)")
}
