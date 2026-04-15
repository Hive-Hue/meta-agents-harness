import { existsSync, rmSync } from "node:fs"
import path from "node:path"
import { activeMetaPath, clearCrewSelection, opencodeRoot } from "./lib/crew-runtime.mjs"

if (
  existsSync(activeMetaPath) ||
  existsSync(path.join(opencodeRoot, "agents")) ||
  existsSync(path.join(opencodeRoot, "expertise")) ||
  existsSync(path.join(opencodeRoot, "multi-team.yaml"))
) {
  clearCrewSelection()
  const legacyExpertisePath = path.join(opencodeRoot, "expertise")
  if (existsSync(legacyExpertisePath)) {
    rmSync(legacyExpertisePath, { recursive: true, force: true })
  }
  console.log("Cleared active OpenCode crew selection and runtime symlinks.")
} else {
  console.log("No active OpenCode crew selection.")
}
