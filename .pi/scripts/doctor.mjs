import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const runtimeRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(runtimeRoot, "..")
const activeMetaPath = path.join(runtimeRoot, ".active-crew.json")

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

function readActiveCrew() {
  if (!existsSync(activeMetaPath)) return null
  try {
    return JSON.parse(readFileSync(activeMetaPath, "utf-8"))
  } catch {
    return null
  }
}

function checkPiCli() {
  const probe = spawnSync("bash", ["-lc", "command -v pi >/dev/null 2>&1"], {
    cwd: repoRoot,
    env: process.env
  })
  return probe.status === 0
}

function result(label, status, detail) {
  return { label, status, detail }
}

function main() {
  const args = new Set(process.argv.slice(2))
  const asJson = args.has("--json")
  const ciMode = args.has("--ci")
  const results = []

  const crews = listCrewNames(path.join(runtimeRoot, "crew"))
  results.push(
    crews.length > 0
      ? result("crews", "ok", `${crews.length} crew(s): ${crews.join(", ")}`)
      : result("crews", "error", "No crew configs found in .pi/crew")
  )

  const active = readActiveCrew()
  if (active?.crew) {
    results.push(result("active_crew", "ok", `active=${active.crew}`))
  } else {
    results.push(result("active_crew", "warn", "No active crew selected"))
  }

  if (checkPiCli()) {
    results.push(result("pi_cli", "ok", "pi command available in PATH"))
  } else {
    results.push(result("pi_cli", "warn", "pi command not found in PATH"))
  }

  const runtimeCheck = spawnSync(process.execPath, [path.join(runtimeRoot, "scripts", "check-runtime.mjs")], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf-8"
  })
  if (runtimeCheck.status === 0) {
    results.push(result("runtime_files", "ok", "required runtime files are present"))
  } else {
    const detail = (runtimeCheck.stdout || runtimeCheck.stderr || "").trim() || "runtime check failed"
    results.push(result("runtime_files", "error", detail))
  }

  const hasErrors = results.some((entry) => entry.status === "error")
  const payload = {
    ok: !hasErrors,
    ci: ciMode,
    repo_root: repoRoot,
    runtime_root: runtimeRoot,
    results
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload)}\n`)
  } else {
    console.log("PI runtime doctor")
    for (const entry of results) {
      console.log(`[${entry.status.toUpperCase()}] ${entry.label}: ${entry.detail}`)
    }
  }

  if (hasErrors) process.exitCode = 1
}

main()
