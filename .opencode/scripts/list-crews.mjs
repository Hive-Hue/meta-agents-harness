import { listCrews, readJson, activeMetaPath } from "./lib/crew-runtime.mjs"

const crews = listCrews()
const active = readJson(activeMetaPath)
const activeCrew = `${active?.crew || ""}`

if (crews.length === 0) {
  console.log("No OpenCode crews found under .opencode/crew")
  process.exitCode = 1
} else {
  for (const crew of crews) {
    const mark = crew === activeCrew ? "*" : "-"
    console.log(`${mark} ${crew}`)
  }
}
