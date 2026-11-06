import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync, statSync, rmdirSync } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import yaml from "yaml"

const TASKS_STORAGE_DIR = path.join(".mah", "tasks")
const TASKS_FILE = "tasks.yaml"
const MISSIONS_FILE = "missions.yaml"
const pause = new Int32Array(new SharedArrayBuffer(4))
const lockAgeMs = 30_000

function withStoreLock(repoRoot, action) {
  const { baseDir } = getTaskStoragePaths(repoRoot)
  mkdirSync(baseDir, { recursive: true })
  const lockPath = path.join(baseDir, ".store.lock")
  const deadline = Date.now() + 10_000
  let owned = false
  while (!owned) {
    try {
      mkdirSync(lockPath)
      writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, time: Date.now() }))
      owned = true
    } catch (error) {
      if (error.code !== "EEXIST") throw error
      let stale = false
      try {
        const owner = JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf8"))
        if (Date.now() - owner.time > lockAgeMs) {
          try { process.kill(owner.pid, 0) } catch (probe) { stale = probe.code === "ESRCH" }
        }
      } catch {
        try { stale = Date.now() - statSync(lockPath).mtimeMs > lockAgeMs } catch { /* another writer removed it */ }
      }
      if (stale) {
        // Serialize reclaimers and re-check ownership inside the recovery lock.
        // A second reclaimer must never remove a new writer's owner file based
        // on its earlier observation of a dead process.
        const recoveryPath = path.join(baseDir, ".store.recovery.lock")
        let recovering = false
        try {
          mkdirSync(recoveryPath)
          recovering = true
          const owner = JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf8"))
          let dead = false
          try { process.kill(owner.pid, 0) } catch (probe) { dead = probe.code === "ESRCH" }
          if (dead && Date.now() - owner.time > lockAgeMs) {
            unlinkSync(path.join(lockPath, "owner.json"))
            rmdirSync(lockPath)
          }
        } catch { /* Contended/missing/invalid ownership fails closed. */ }
        finally { if (recovering) rmdirSync(recoveryPath) }
      }
      if (Date.now() > deadline) throw new Error("task store lock timeout")
      Atomics.wait(pause, 0, 0, 20)
    }
  }
  try { return action() } finally {
    try { unlinkSync(path.join(lockPath, "owner.json")) } catch { /* missing */ }
    rmdirSync(lockPath)
  }
}

function atomicYamlWrite(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  let fd
  try {
    fd = openSync(temporary, "wx")
    writeFileSync(fd, yaml.stringify(value), "utf8")
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temporary, filePath)
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temporary) } catch { /* renamed or never created */ }
  }
}

function toTaskRuntime(runtime = "") {
  return `${runtime || "openclaude"}`.trim() || "openclaude"
}

export function normalizeTaskRuntime(runtime = "") {
  const clean = toTaskRuntime(runtime).toLowerCase()
  return clean.includes("/") ? clean.split("/")[0] : clean
}

export function buildTaskCommand(task) {
  return `mah task run --id ${task.id}`
}

export function buildMissionCommand(mission) {
  return `mah mission show ${mission.id}`
}

function formatMinutes(totalMinutes = 0) {
  const minutes = Math.max(0, Math.round(Number(totalMinutes) || 0))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours > 0 && rest > 0) return `${hours}h ${rest}m`
  if (hours > 0) return `${hours}h`
  return `${rest}m`
}

export function defaultTaskRecords() {
  return []
}

export function defaultMissionRecords() {
  return []
}

function getTaskStoragePaths(repoRoot) {
  const baseDir = path.join(repoRoot, TASKS_STORAGE_DIR)
  return {
    baseDir,
    tasksPath: path.join(baseDir, TASKS_FILE),
    missionsPath: path.join(baseDir, MISSIONS_FILE)
  }
}

export function ensureTaskStorage(repoRoot) {
  const { baseDir, tasksPath, missionsPath } = getTaskStoragePaths(repoRoot)
  if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true })
  if (!existsSync(tasksPath)) {
    try { writeFileSync(tasksPath, yaml.stringify({ tasks: defaultTaskRecords() }), { flag: "wx" }) } catch (error) { if (error.code !== "EEXIST") throw error }
  }
  if (!existsSync(missionsPath)) {
    try { writeFileSync(missionsPath, yaml.stringify({ missions: defaultMissionRecords() }), { flag: "wx" }) } catch (error) { if (error.code !== "EEXIST") throw error }
  }
  return { tasksPath, missionsPath }
}

function nextTaskId(tasks = []) {
  const next = tasks.reduce((max, task) => {
    const match = `${task?.id || ""}`.match(/^TASK-(\d+)$/)
    if (!match) return max
    const value = Number.parseInt(match[1], 10)
    return Number.isFinite(value) ? Math.max(max, value) : max
  }, 100)
  return `TASK-${next + 1}`
}

function nextMissionId(missions = []) {
  const candidate = `mission-${missions.length + 1}`
  let suffix = missions.length + 1
  const existing = new Set(missions.map((mission) => `${mission?.id || ""}`))
  while (existing.has(`mission-${suffix}`)) suffix += 1
  return existing.has(candidate) ? `mission-${suffix}` : candidate
}

function normalizeMissionId(value = "", existingMissions = []) {
  const base = `${value || nextMissionId(existingMissions)}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return base || nextMissionId(existingMissions)
}

export function normalizeTaskRecord(input = {}, existingTasks = []) {
  const summaryWords = `${input.summary || ""}`.trim().split(/\s+/).filter(Boolean).length
  const dependenciesCount = Array.isArray(input.dependencies) ? input.dependencies.length : 0
  const priority = `${input.priority || "medium"}`.trim()
  const derivedMinutes = Math.max(
    20,
    Math.round(30 + dependenciesCount * 10 + summaryWords * 0.8 + (priority === "high" ? 25 : priority === "medium" ? 10 : 0)),
  )
  const derivedEstimate = formatMinutes(derivedMinutes)
  const id = `${input.id || nextTaskId(existingTasks)}`.trim()
  const crewId = `${input.crewId || "dev"}`.trim() || "dev"
  const owner = `${input.owner || "planning-lead"}`.trim() || "planning-lead"
  const runtime = toTaskRuntime(input.runtime)
  return {
    id,
    title: `${input.title || "New Task"}`.trim(),
    state: `${input.state || "backlog"}`.trim(),
    priority: `${input.priority || "medium"}`.trim(),
    missionId: `${input.missionId || ""}`.trim(),
    crewId,
    owner,
    runtime,
    dependencies: Array.isArray(input.dependencies) ? input.dependencies.map((item) => `${item}`) : [],
    estimate: `${input.estimate || derivedEstimate}`.trim(),
    confidence: Number.isFinite(input.confidence) ? Number(input.confidence) : 78,
    risk: `${input.risk || "Medium"}`.trim(),
    summary: `${input.summary || "Task created from the Tasks workspace."}`.trim(),
    lastUpdate: `${input.lastUpdate || "just now"}`.trim(),
    sessionId: input.sessionId ? `${input.sessionId}`.trim() : undefined,
    attemptId: input.attemptId ? `${input.attemptId}`.trim() : undefined,
    startedAt: input.startedAt ? `${input.startedAt}`.trim() : undefined,
    finishedAt: input.finishedAt ? `${input.finishedAt}`.trim() : undefined,
    failureReason: input.failureReason ? `${input.failureReason}`.trim() : undefined,
    blockedReason: input.blockedReason ? `${input.blockedReason}`.trim() : undefined,
    rationale: `${input.rationale || "Created from the Tasks page for operator planning."}`.trim(),
    command: buildTaskCommand({ id })
  }
}

export function normalizeMissionRecord(input = {}, existingMissions = []) {
  const id = normalizeMissionId(input.id || input.name, existingMissions)
  return {
    id,
    name: `${input.name || "New Mission"}`.trim(),
    objective: `${input.objective || "Mission objective pending definition."}`.trim(),
    status: `${input.status || "draft"}`.trim(),
    dueWindow: `${input.dueWindow || "TBD"}`.trim(),
    risk: `${input.risk || "Low"}`.trim(),
    capacity: `${input.capacity || "0%"}`.trim(),
    progress: Number.isFinite(input.progress) ? Number(input.progress) : 0,
    health: `${input.health || "Scoping"}`.trim(),
    successCriteria: Array.isArray(input.successCriteria) ? input.successCriteria.map((item) => `${item}`) : ["Define scope"],
    command: buildMissionCommand({ id })
  }
}

export function readTaskStore(repoRoot) {
  const { tasksPath, missionsPath } = ensureTaskStorage(repoRoot)
  const raw = yaml.parse(readFileSync(tasksPath, "utf-8")) || {}
  const rawMissions = yaml.parse(readFileSync(missionsPath, "utf-8")) || {}
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map((task) => normalizeTaskRecord(task)) : []
  const missions = Array.isArray(rawMissions.missions) ? rawMissions.missions.map((mission) => normalizeMissionRecord(mission)) : []
  return { tasks, missions }
}

export function writeTaskStore(repoRoot, tasks = []) {
  return withStoreLock(repoRoot, () => writeTaskStoreUnlocked(repoRoot, tasks))
}

function writeTaskStoreUnlocked(repoRoot, tasks) {
  const { tasksPath } = ensureTaskStorage(repoRoot)
  atomicYamlWrite(tasksPath, { tasks })
}

export function writeMissionStore(repoRoot, missions = []) {
  return withStoreLock(repoRoot, () => writeMissionStoreUnlocked(repoRoot, missions))
}

function writeMissionStoreUnlocked(repoRoot, missions) {
  const { missionsPath } = ensureTaskStorage(repoRoot)
  atomicYamlWrite(missionsPath, { missions })
}

export function listTasks(repoRoot, filters = {}) {
  const { tasks } = readTaskStore(repoRoot)
  return tasks.filter((task) => {
    if (filters.id && task.id !== filters.id) return false
    if (filters.missionId && task.missionId !== filters.missionId) return false
    if (filters.state && task.state !== filters.state) return false
    if (filters.owner && task.owner !== filters.owner) return false
    if (filters.runtime && normalizeTaskRuntime(task.runtime) !== normalizeTaskRuntime(filters.runtime)) return false
    return true
  })
}

export function createTask(repoRoot, payload = {}) {
 return withStoreLock(repoRoot, () => {
  const { tasks } = readTaskStore(repoRoot)
  const task = normalizeTaskRecord(payload, tasks)
  if (tasks.some((item) => item.id === task.id)) throw new Error(`task already exists: ${task.id}`)
  const nextTasks = [task, ...tasks]
  writeTaskStoreUnlocked(repoRoot, nextTasks)
  return { task, tasks: nextTasks }
 })
}

export function updateTask(repoRoot, taskId, updates = {}) {
 return withStoreLock(repoRoot, () => updateTaskUnlocked(repoRoot, taskId, updates))
}

function updateTaskUnlocked(repoRoot, taskId, updates = {}) {
  const { tasks } = readTaskStore(repoRoot)
  let updatedTask = null
  const nextTasks = tasks.map((task) => {
    if (task.id !== taskId) return task
    updatedTask = normalizeTaskRecord({
      ...task,
      ...updates,
      id: task.id,
      lastUpdate: updates.lastUpdate || "just now",
      sessionId: Object.prototype.hasOwnProperty.call(updates, "sessionId") ? updates.sessionId : task.sessionId,
      blockedReason: Object.prototype.hasOwnProperty.call(updates, "blockedReason") ? updates.blockedReason : task.blockedReason
    }, tasks)
    return updatedTask
  })
  if (!updatedTask) return { task: null, tasks }
  writeTaskStoreUnlocked(repoRoot, nextTasks)
  return { task: updatedTask, tasks: nextTasks }
}

export function deleteTask(repoRoot, taskId) {
 return withStoreLock(repoRoot, () => {
  const { tasks } = readTaskStore(repoRoot)
  const task = tasks.find((item) => item.id === taskId) || null
  if (!task) return { task: null, tasks }
  const nextTasks = tasks.filter((item) => item.id !== taskId)
  writeTaskStoreUnlocked(repoRoot, nextTasks)
  return { task, tasks: nextTasks }
 })
}

export function acquireTaskRun(repoRoot, taskId) {
  return withStoreLock(repoRoot, () => {
    const { tasks } = readTaskStore(repoRoot)
    const task = tasks.find((item) => item.id === taskId)
    if (!task) throw new Error("task not found")
    if (task.state === "in_progress") throw new Error(`task already running: ${taskId}`)
    if (!["ready", "backlog", "failed"].includes(task.state)) throw new Error(`task cannot run from state ${task.state}`)
    for (const dependencyId of task.dependencies) {
      const dependency = tasks.find((item) => item.id === dependencyId)
      if (!dependency || dependency.state !== "done") throw new Error(`dependency not complete: ${dependencyId}`)
    }
    const attemptId = randomUUID()
    return updateTaskUnlocked(repoRoot, taskId, { state: "in_progress", attemptId, startedAt: new Date().toISOString(), finishedAt: undefined, failureReason: undefined, sessionId: undefined, lastUpdate: new Date().toISOString() }).task
  })
}

export function finishTaskRun(repoRoot, taskId, attemptId, result = {}) {
  return withStoreLock(repoRoot, () => {
    const task = readTaskStore(repoRoot).tasks.find((item) => item.id === taskId)
    if (!task || task.attemptId !== attemptId || task.state !== "in_progress") throw new Error(`task attempt no longer active: ${taskId}`)
    return updateTaskUnlocked(repoRoot, taskId, {
      state: result.ok ? "review" : "failed",
      sessionId: result.sessionId || undefined,
      failureReason: result.ok ? undefined : String(result.error || "run failed"),
      finishedAt: new Date().toISOString(),
      lastUpdate: new Date().toISOString()
    }).task
  })
}

export function buildTaskPrompt(task) {
  const dependencies = Array.isArray(task.dependencies) && task.dependencies.length > 0
    ? task.dependencies.join(", ")
    : "none"
  return [
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    `Mission: ${task.missionId}`,
    `Owner: ${task.owner}`,
    `Priority: ${task.priority}`,
    `Estimate: ${task.estimate}`,
    `Summary: ${task.summary}`,
    `Rationale: ${task.rationale}`,
    `Dependencies: ${dependencies}`,
    task.blockedReason ? `Blocked reason: ${task.blockedReason}` : ""
  ].filter(Boolean).join("\n")
}

export function listMissions(repoRoot, filters = {}) {
  const { missions } = readTaskStore(repoRoot)
  return missions.filter((mission) => {
    if (filters.id && mission.id !== filters.id) return false
    if (filters.status && mission.status !== filters.status) return false
    return true
  })
}

export function createMission(repoRoot, payload = {}) {
 return withStoreLock(repoRoot, () => {
  const { missions } = readTaskStore(repoRoot)
  const mission = normalizeMissionRecord(payload, missions)
  if (missions.some((item) => item.id === mission.id)) throw new Error(`mission already exists: ${mission.id}`)
  const nextMissions = [mission, ...missions]
  writeMissionStoreUnlocked(repoRoot, nextMissions)
  return { mission, missions: nextMissions }
 })
}

export function updateMission(repoRoot, missionId, updates = {}) {
 return withStoreLock(repoRoot, () => {
  const { missions } = readTaskStore(repoRoot)
  let updatedMission = null
  const nextMissions = missions.map((mission) => {
    if (mission.id !== missionId) return mission
    updatedMission = normalizeMissionRecord({
      ...mission,
      ...updates,
      id: mission.id
    }, missions)
    return updatedMission
  })
  if (!updatedMission) return { mission: null, missions }
  writeMissionStoreUnlocked(repoRoot, nextMissions)
  return { mission: updatedMission, missions: nextMissions }
 })
}

export function deleteMission(repoRoot, missionId, options = {}) {
 return withStoreLock(repoRoot, () => {
  const { missions, tasks } = readTaskStore(repoRoot)
  const mission = missions.find((item) => item.id === missionId) || null
  if (!mission) return { mission: null, missions, tasks, removedTasks: [] }

  const linkedTasks = tasks.filter((task) => task.missionId === missionId)
  if (linkedTasks.length > 0 && !options.cascade) {
    throw new Error(`mission has ${linkedTasks.length} linked task(s); rerun with cascade`)
  }

  const nextMissions = missions.filter((item) => item.id !== missionId)
  const removedTaskIds = new Set(linkedTasks.map((task) => task.id))
  const nextTasks = linkedTasks.length > 0 ? tasks.filter((task) => !removedTaskIds.has(task.id)) : tasks

  writeMissionStoreUnlocked(repoRoot, nextMissions)
  if (linkedTasks.length > 0) writeTaskStoreUnlocked(repoRoot, nextTasks)

  return {
    mission,
    missions: nextMissions,
    tasks: nextTasks,
    removedTasks: linkedTasks,
  }
 })
}

export function commitMissionScope(repoRoot, missionId) {
  return updateMission(repoRoot, missionId, {
    status: "active",
    health: "Scope committed",
    progress: Math.max(5, Number(listMissions(repoRoot, { id: missionId })[0]?.progress || 0))
  })
}

export function applyMissionReplan(repoRoot, missionId) {
 return withStoreLock(repoRoot, () => {
  const { tasks, missions } = readTaskStore(repoRoot)
  const missionTasks = tasks.filter((task) => task.missionId === missionId)
  const firstBlocked = missionTasks.find((task) => task.state === "blocked")
  const firstActive = missionTasks.find((task) => task.state === "in_progress" || task.state === "ready")
  const unlockedTaskIds = []
  const tunedTaskIds = []

  const nextTasks = tasks.map((task) => {
    if (task.missionId !== missionId) return task

    if (firstBlocked && task.id === firstBlocked.id) {
      unlockedTaskIds.push(task.id)
      return normalizeTaskRecord({
        ...task,
        state: "ready",
        blockedReason: undefined,
        rationale: "Replan removed the immediate blocker and queued this task for execution.",
        lastUpdate: "replanned now"
      }, tasks)
    }

    if (firstActive && task.id === firstActive.id) {
      tunedTaskIds.push(task.id)
      return normalizeTaskRecord({
        ...task,
        confidence: Math.min(Number(task.confidence || 0) + 3, 99),
        rationale: "Replan prioritized this active task to reduce downstream wait time.",
        lastUpdate: "replanned now"
      }, tasks)
    }

    return task
  })

  let updatedMission = null
  const nextMissions = missions.map((mission) => {
    if (mission.id !== missionId) return mission
    updatedMission = normalizeMissionRecord({
      ...mission,
      risk: "Lower",
      health: "Replanned to reduce bottleneck",
      progress: Math.max(mission.progress, 72),
      id: mission.id
    }, missions)
    return updatedMission
  })

  if (!updatedMission) return { mission: null, missions, tasks, summary: "" }

  writeTaskStoreUnlocked(repoRoot, nextTasks)
  writeMissionStoreUnlocked(repoRoot, nextMissions)
  return {
    mission: updatedMission,
    missions: nextMissions,
    tasks: nextTasks,
    summary: [
      tunedTaskIds.length > 0 ? `Prioritized ${tunedTaskIds.join(", ")}` : "",
      unlockedTaskIds.length > 0 ? `unblocked ${unlockedTaskIds.join(", ")}` : "",
    ].filter(Boolean).join(" and ") || "Agentic replan applied with no task-level changes."
  }
 })
}
