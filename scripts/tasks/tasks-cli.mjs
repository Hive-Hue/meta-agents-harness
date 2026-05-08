import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { collectSessions } from "../session/m3-ops.mjs"
import { buildTaskPrompt, createTask, deleteTask, listTasks, normalizeTaskRuntime, readTaskStore, updateTask } from "./tasks-store.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.resolve(__dirname, "..", "..")
const cliPath = path.join(packageRoot, "scripts", "meta-agents-harness.mjs")

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

function parseDotEnv(raw = "") {
  const out = {}
  for (const line of `${raw || ""}`.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed
    const separator = normalized.indexOf("=")
    if (separator <= 0) continue
    const key = normalized.slice(0, separator).trim()
    let value = normalized.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function loadWorkspaceEnv(repoRoot) {
  const envPath = path.join(repoRoot, ".env")
  if (!existsSync(envPath)) return {}
  return parseDotEnv(readFileSync(envPath, "utf-8"))
}

function printTaskHelp() {
  console.log(`
mah task — Tasks CLI

Usage:
  mah task list [--mission <id>] [--state <state>] [--owner <owner>] [--runtime <runtime>] [--json]
  mah task show <id> [--json]
  mah task create --payload '<json>' [--json]
  mah task update <id> --payload '<json>' [--json]
  mah task delete <id> [--json]
  mah task run --id <id> [--json]

Examples:
  mah task list --mission q4-audit --json
  mah task show TASK-118
  mah task create --payload '{"title":"New task","missionId":"q4-audit","crewId":"dev"}' --json
  mah task update TASK-118 --payload '{"state":"ready"}' --json
  mah task delete TASK-118 --json
  mah task run --id TASK-118 --json
`)
}

function printJson(payload, status = 0) {
  console.log(JSON.stringify(payload, null, 2))
  return status
}

function printTaskList(tasks = []) {
  if (tasks.length === 0) {
    console.log("No tasks found.")
    return 0
  }
  for (const task of tasks) {
    console.log(`${task.id}  ${task.state.padEnd(11)}  ${task.runtime.padEnd(10)}  ${task.title}`)
  }
  return 0
}

function resolveTaskSessionId(repoRoot, task, runPayload = {}) {
  const runtime = normalizeTaskRuntime(task.runtime)
  const crew = `${task.crewId || "dev"}`.trim() || "dev"
  const sessions = collectSessions(repoRoot, { runtime, crew })
  if (sessions[0]?.id) return sessions[0].id

  const rawSessionId = `${runPayload.session_id || ""}`.trim()
  if (rawSessionId) {
    return rawSessionId.includes(":") ? rawSessionId : `${runtime}:${crew}:${rawSessionId}`
  }

  return ""
}

function runMahTask(repoRoot, task) {
  const runtime = normalizeTaskRuntime(task.runtime)
  const crew = `${task.crewId || "dev"}`.trim() || "dev"
  const prompt = buildTaskPrompt(task)
  const workspaceEnv = loadWorkspaceEnv(repoRoot)
  const child = spawnSync(process.execPath, [
    cliPath,
    "run",
    "--runtime",
    runtime,
    "--crew",
    crew,
    "--task",
    prompt,
    "--headless",
    "--json"
  ], {
    cwd: repoRoot,
    env: { ...process.env, ...workspaceEnv },
    encoding: "utf-8"
  })

  let payload = null
  try {
    payload = JSON.parse(`${child.stdout || "{}"}`)
  } catch {
    payload = null
  }

  if (child.status !== 0 || !payload || typeof payload !== "object") {
    return {
      ok: false,
      error: payload?.error || `${child.stderr || child.stdout || "mah run failed"}`.trim() || "mah run failed",
      stdout: child.stdout || "",
      stderr: child.stderr || ""
    }
  }

  return { ok: true, payload }
}

async function main() {
  const argv = process.argv.slice(2)
  const subcommand = argv[0] || "help"
  const rest = argv.slice(1)
  const jsonMode = parseJsonFlag(rest)
  const repoRoot = process.cwd()

  if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printTaskHelp()
    process.exitCode = 0
    return
  }

  if (subcommand === "list") {
    const tasks = listTasks(repoRoot, {
      missionId: parseValueArg(rest, "--mission"),
      state: parseValueArg(rest, "--state"),
      owner: parseValueArg(rest, "--owner"),
      runtime: parseValueArg(rest, "--runtime")
    })
    process.exitCode = jsonMode ? printJson({ ok: true, tasks }) : printTaskList(tasks)
    return
  }

  if (subcommand === "show") {
    const taskId = `${rest.find((token) => !token.startsWith("-")) || ""}`.trim()
    const task = listTasks(repoRoot, { id: taskId })[0]
    if (!task) {
      process.exitCode = jsonMode ? printJson({ ok: false, error: "task not found" }, 1) : 1
      if (!jsonMode) console.error("ERROR: task not found")
      return
    }
    if (jsonMode) {
      process.exitCode = printJson({ ok: true, task })
      return
    }
    console.log(`${task.id} — ${task.title}`)
    console.log(`state: ${task.state}`)
    console.log(`mission: ${task.missionId}`)
    console.log(`crew: ${task.crewId}`)
    console.log(`owner: ${task.owner}`)
    console.log(`runtime: ${task.runtime}`)
    console.log(`estimate: ${task.estimate}`)
    console.log(`session: ${task.sessionId || "none"}`)
    process.exitCode = 0
    return
  }

  if (subcommand === "create") {
    try {
      const payload = parsePayloadArg(rest)
      const result = createTask(repoRoot, payload)
      process.exitCode = jsonMode ? printJson({ ok: true, task: result.task, tasks: result.tasks }) : 0
      if (!jsonMode) console.log(`created ${result.task.id}`)
    } catch (error) {
      process.exitCode = jsonMode ? printJson({ ok: false, error: error.message || String(error) }, 1) : 1
      if (!jsonMode) console.error(`ERROR: ${error.message || String(error)}`)
    }
    return
  }

  if (subcommand === "update") {
    const taskId = `${rest.find((token) => !token.startsWith("-")) || ""}`.trim()
    try {
      const payload = parsePayloadArg(rest)
      const result = updateTask(repoRoot, taskId, payload)
      if (!result.task) {
        process.exitCode = jsonMode ? printJson({ ok: false, error: "task not found" }, 1) : 1
        if (!jsonMode) console.error("ERROR: task not found")
        return
      }
      process.exitCode = jsonMode ? printJson({ ok: true, task: result.task, tasks: result.tasks }) : 0
      if (!jsonMode) console.log(`updated ${result.task.id}`)
    } catch (error) {
      process.exitCode = jsonMode ? printJson({ ok: false, error: error.message || String(error) }, 1) : 1
      if (!jsonMode) console.error(`ERROR: ${error.message || String(error)}`)
    }
    return
  }

  if (subcommand === "run") {
    const taskId = parseValueArg(rest, "--id") || `${rest.find((token) => !token.startsWith("-")) || ""}`.trim()
    const task = listTasks(repoRoot, { id: taskId })[0]
    if (!task) {
      process.exitCode = jsonMode ? printJson({ ok: false, error: "task not found" }, 1) : 1
      if (!jsonMode) console.error("ERROR: task not found")
      return
    }

    const runResult = runMahTask(repoRoot, task)
    if (!runResult.ok) {
      process.exitCode = jsonMode ? printJson(runResult, 1) : 1
      if (!jsonMode) console.error(`ERROR: ${runResult.error}`)
      return
    }

    const linkedSessionId = resolveTaskSessionId(repoRoot, task, runResult.payload)
    const updated = updateTask(repoRoot, task.id, {
      state: "in_progress",
      sessionId: linkedSessionId || undefined,
      lastUpdate: new Date().toISOString()
    })

    const response = {
      ok: true,
      task: updated.task,
      tasks: updated.tasks,
      run: runResult.payload,
      command: updated.task?.command || task.command
    }
    process.exitCode = jsonMode ? printJson(response) : 0
    if (!jsonMode) {
      console.log(`started ${task.id}`)
      if (linkedSessionId) console.log(`session=${linkedSessionId}`)
    }
    return
  }

  if (subcommand === "delete") {
    const taskId = parseValueArg(rest, "--id") || `${rest.find((token) => !token.startsWith("-")) || ""}`.trim()
    const result = deleteTask(repoRoot, taskId)
    if (!result.task) {
      process.exitCode = jsonMode ? printJson({ ok: false, error: "task not found" }, 1) : 1
      if (!jsonMode) console.error("ERROR: task not found")
      return
    }
    process.exitCode = jsonMode ? printJson({ ok: true, task: result.task, tasks: result.tasks }) : 0
    if (!jsonMode) console.log(`deleted ${result.task.id}`)
    return
  }

  printTaskHelp()
  process.exitCode = 1
}

await main()
