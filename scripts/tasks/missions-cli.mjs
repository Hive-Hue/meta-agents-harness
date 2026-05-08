import {
  applyMissionReplan,
  commitMissionScope,
  createMission,
  deleteMission,
  listMissions,
  updateMission
} from "./tasks-store.mjs"

function parseValueArg(argv = [], flag, short = "") {
  for (let i = 0; i < argv.length; i += 1) {
    const token = `${argv[i] || ""}`.trim()
    if (!token) continue
    if (token === flag && argv[i + 1]) return `${argv[i + 1] || ""}`.trim()
    if (short && token === short && argv[i + 1]) return `${argv[i + 1] || ""}`.trim()
    if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1).trim()
  }
  return ""
}

function hasFlag(argv = [], flag) {
  return argv.includes(flag)
}

function parseJsonFlag(argv = []) {
  return hasFlag(argv, "--json")
}

function parsePayloadArg(argv = []) {
  const raw = parseValueArg(argv, "--payload")
  if (!raw) return {}
  return JSON.parse(raw)
}

function printMissionHelp() {
  console.log(`
mah mission — Missions CLI

Usage:
  mah mission list [--status <status>] [--json]
  mah mission show <id> [--json]
  mah mission create --payload '<json>' [--json]
  mah mission update <id> --payload '<json>' [--json]
  mah mission delete --id <id> [--cascade] [--json]
  mah mission commit-scope --id <id> [--json]
  mah mission replan --id <id> [--json]
`)
}

function printJson(payload, status = 0) {
  console.log(JSON.stringify(payload, null, 2))
  return status
}

function printMissionList(missions = []) {
  if (missions.length === 0) {
    console.log("No missions found.")
    return 0
  }
  for (const mission of missions) {
    console.log(`${mission.id}  ${mission.status.padEnd(10)}  ${mission.name}`)
  }
  return 0
}

async function main() {
  const argv = process.argv.slice(2)
  const subcommand = argv[0] || "help"
  const rest = argv.slice(1)
  const jsonMode = parseJsonFlag(rest)
  const repoRoot = process.cwd()

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printMissionHelp()
    process.exitCode = 0
    return
  }

  if (subcommand === "list") {
    const missions = listMissions(repoRoot, { status: parseValueArg(rest, "--status") })
    process.exitCode = jsonMode ? printJson({ ok: true, missions }) : printMissionList(missions)
    return
  }

  if (subcommand === "show") {
    const missionId = `${rest.find((token) => !token.startsWith("-")) || ""}`.trim()
    const mission = listMissions(repoRoot, { id: missionId })[0]
    if (!mission) {
      process.exitCode = jsonMode ? printJson({ ok: false, error: "mission not found" }, 1) : 1
      if (!jsonMode) console.error("ERROR: mission not found")
      return
    }
    if (jsonMode) {
      process.exitCode = printJson({ ok: true, mission })
      return
    }
    console.log(`${mission.id} — ${mission.name}`)
    console.log(`status: ${mission.status}`)
    console.log(`due window: ${mission.dueWindow}`)
    console.log(`risk: ${mission.risk}`)
    console.log(`capacity: ${mission.capacity}`)
    console.log(`health: ${mission.health}`)
    process.exitCode = 0
    return
  }

  if (subcommand === "create") {
    try {
      const payload = parsePayloadArg(rest)
      const result = createMission(repoRoot, payload)
      process.exitCode = jsonMode ? printJson({ ok: true, mission: result.mission, missions: result.missions }) : 0
      if (!jsonMode) console.log(`created ${result.mission.id}`)
    } catch (error) {
      process.exitCode = jsonMode ? printJson({ ok: false, error: error.message || String(error) }, 1) : 1
      if (!jsonMode) console.error(`ERROR: ${error.message || String(error)}`)
    }
    return
  }

  if (subcommand === "update") {
    const missionId = `${rest.find((token) => !token.startsWith("-")) || ""}`.trim()
    try {
      const payload = parsePayloadArg(rest)
      const result = updateMission(repoRoot, missionId, payload)
      if (!result.mission) {
        process.exitCode = jsonMode ? printJson({ ok: false, error: "mission not found" }, 1) : 1
        if (!jsonMode) console.error("ERROR: mission not found")
        return
      }
      process.exitCode = jsonMode ? printJson({ ok: true, mission: result.mission, missions: result.missions }) : 0
      if (!jsonMode) console.log(`updated ${result.mission.id}`)
    } catch (error) {
      process.exitCode = jsonMode ? printJson({ ok: false, error: error.message || String(error) }, 1) : 1
      if (!jsonMode) console.error(`ERROR: ${error.message || String(error)}`)
    }
    return
  }

  if (subcommand === "commit-scope") {
    const missionId = parseValueArg(rest, "--id") || `${rest.find((token) => !token.startsWith("-")) || ""}`.trim()
    const result = commitMissionScope(repoRoot, missionId)
    if (!result.mission) {
      process.exitCode = jsonMode ? printJson({ ok: false, error: "mission not found" }, 1) : 1
      if (!jsonMode) console.error("ERROR: mission not found")
      return
    }
    process.exitCode = jsonMode ? printJson({ ok: true, mission: result.mission, missions: result.missions }) : 0
    if (!jsonMode) console.log(`committed ${result.mission.id}`)
    return
  }

  if (subcommand === "delete") {
    const missionId = parseValueArg(rest, "--id") || `${rest.find((token) => !token.startsWith("-")) || ""}`.trim()
    try {
      const result = deleteMission(repoRoot, missionId, { cascade: hasFlag(rest, "--cascade") })
      if (!result.mission) {
        process.exitCode = jsonMode ? printJson({ ok: false, error: "mission not found" }, 1) : 1
        if (!jsonMode) console.error("ERROR: mission not found")
        return
      }
      process.exitCode = jsonMode
        ? printJson({ ok: true, mission: result.mission, missions: result.missions, tasks: result.tasks, removedTasks: result.removedTasks })
        : 0
      if (!jsonMode) console.log(`deleted ${result.mission.id}`)
    } catch (error) {
      process.exitCode = jsonMode ? printJson({ ok: false, error: error.message || String(error) }, 1) : 1
      if (!jsonMode) console.error(`ERROR: ${error.message || String(error)}`)
    }
    return
  }

  if (subcommand === "replan") {
    const missionId = parseValueArg(rest, "--id") || `${rest.find((token) => !token.startsWith("-")) || ""}`.trim()
    const result = applyMissionReplan(repoRoot, missionId)
    if (!result.mission) {
      process.exitCode = jsonMode ? printJson({ ok: false, error: "mission not found" }, 1) : 1
      if (!jsonMode) console.error("ERROR: mission not found")
      return
    }
    process.exitCode = jsonMode
      ? printJson({ ok: true, mission: result.mission, missions: result.missions, tasks: result.tasks, summary: result.summary })
      : 0
    if (!jsonMode) console.log(`replanned ${result.mission.id}`)
    return
  }

  printMissionHelp()
  process.exitCode = 1
}

await main()
