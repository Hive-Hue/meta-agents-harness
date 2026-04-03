import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const runtimeRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(runtimeRoot, "..")

function statusLine(ok, label, detail) {
  const mark = ok ? "OK" : "ERROR"
  console.log(`[${mark}] ${label}: ${detail}`)
}

function listCrewNames(crewRoot) {
  if (!existsSync(crewRoot)) return []
  return readdirSync(crewRoot)
    .filter((entry) => {
      const crewDir = path.join(crewRoot, entry)
      const configPath = path.join(crewDir, "multi-team.yaml")
      try {
        return statSync(crewDir).isDirectory() && existsSync(configPath)
      } catch {
        return false
      }
    })
    .sort((a, b) => a.localeCompare(b))
}

function main() {
  const checks = []
  const requiredFiles = [
    path.join(runtimeRoot, "package.json"),
    path.join(runtimeRoot, "bin", "pimh"),
    path.join(runtimeRoot, "scripts", "list-crews.mjs"),
    path.join(runtimeRoot, "scripts", "use-crew.mjs"),
    path.join(runtimeRoot, "scripts", "clear-crew.mjs"),
    path.join(runtimeRoot, "scripts", "run-crew.mjs"),
    path.join(runtimeRoot, "scripts", "check-runtime.mjs"),
    path.join(runtimeRoot, "scripts", "doctor.mjs"),
    path.join(runtimeRoot, "tests", "smoke.test.mjs")
  ]

  for (const filePath of requiredFiles) {
    checks.push({
      ok: existsSync(filePath),
      label: "required_file",
      detail: path.relative(repoRoot, filePath)
    })
  }

  const crewRoot = path.join(runtimeRoot, "crew")
  const crews = listCrewNames(crewRoot)
  checks.push({
    ok: crews.length > 0,
    label: "crew_configs",
    detail: crews.length > 0 ? `${crews.length} crew(s): ${crews.join(", ")}` : "no crew configs found"
  })

  let hasErrors = false
  for (const check of checks) {
    statusLine(check.ok, check.label, check.detail)
    if (!check.ok) hasErrors = true
  }

  if (hasErrors) {
    process.exitCode = 1
    return
  }
  console.log("Runtime check completed successfully.")
}

main()
