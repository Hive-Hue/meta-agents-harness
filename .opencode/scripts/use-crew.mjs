import { ensureCrewSelected, listCrews } from "./lib/crew-runtime.mjs"

const argv = process.argv.slice(2)
let hierarchy = false
for (const token of argv) {
  if (token === "--hierarchy") hierarchy = true
  if (token === "--no-hierarchy") hierarchy = false
}
const crew = `${argv.find((item) => !item.startsWith("--")) || ""}`.trim()
if (!crew) {
  console.error("ERROR: missing crew name. Usage: ocmh use <crew> [--hierarchy|--no-hierarchy]")
  process.exitCode = 1
} else {
  const crews = listCrews()
  if (!crews.includes(crew)) {
    console.error(`ERROR: crew not found: ${crew}`)
    console.log("Available crews:")
    for (const item of crews) console.log(`- ${item}`)
    process.exitCode = 1
  } else if (!ensureCrewSelected(crew, { hierarchy })) {
    console.error(`ERROR: failed to activate crew: ${crew}`)
    process.exitCode = 1
  } else {
    console.log(`Active OpenCode crew: ${crew}${hierarchy ? " (hierarchy)" : " (no-hierarchy)"}`)
  }
}
