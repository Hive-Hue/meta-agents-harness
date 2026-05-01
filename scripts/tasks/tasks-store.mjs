import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import yaml from "yaml"

const TASKS_STORAGE_DIR = path.join(".mah", "tasks")
const TASKS_FILE = "tasks.yaml"
const MISSIONS_FILE = "missions.yaml"

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

export function defaultTaskRecords() {
  return [
    {
      id: "TASK-118",
      title: "Consolidate auth baseline evidence",
      state: "backlog",
      priority: "medium",
      missionId: "q4-audit",
      crewId: "dev",
      owner: "planning-lead",
      runtime: "openclaude",
      dependencies: [],
      estimate: "1h 10m",
      confidence: 81,
      risk: "Scope drift",
      summary: "Collect incident notes, policy deltas, and previous rollout logs to establish a clean baseline.",
      lastUpdate: "8m ago",
      rationale: "Planning starts by locking a factual baseline to avoid rework in downstream validation.",
      command: buildTaskCommand({ id: "TASK-118" })
    },
    {
      id: "TASK-126",
      title: "Generate runtime policy diff",
      state: "ready",
      priority: "medium",
      missionId: "q4-audit",
      crewId: "dev",
      owner: "ops-lead",
      runtime: "pi",
      dependencies: ["TASK-118"],
      estimate: "50m",
      confidence: 84,
      risk: "Low",
      summary: "Build structured diff across runtime policy files to highlight auth-impacting changes.",
      lastUpdate: "4m ago",
      rationale: "Ops lead owns runtime drift analysis and can expose precise deltas for security review.",
      command: buildTaskCommand({ id: "TASK-126" })
    },
    {
      id: "TASK-142",
      title: "Verify auth middleware behavior",
      state: "in_progress",
      priority: "high",
      missionId: "q4-audit",
      crewId: "dev",
      owner: "security-lead",
      runtime: "pi",
      dependencies: ["TASK-126"],
      estimate: "2h 20m",
      confidence: 90,
      risk: "Auth regression",
      summary: "Run targeted auth scenarios against middleware changes and confirm deny/allow behavior.",
      lastUpdate: "active now",
      sessionId: "pi:dev:ses_01j4f82x",
      rationale: "Security lead is responsible for policy enforcement quality and high-risk regression coverage.",
      command: buildTaskCommand({ id: "TASK-142" })
    },
    {
      id: "TASK-154",
      title: "Resolve legacy context dependency",
      state: "blocked",
      priority: "medium",
      missionId: "q4-audit",
      crewId: "dev",
      owner: "context-lead",
      runtime: "openclaude",
      dependencies: ["TASK-118"],
      estimate: "1h 05m",
      confidence: 69,
      risk: "Knowledge gap",
      summary: "Normalize legacy docs and map old terminology to current runtime controls.",
      lastUpdate: "12m ago",
      blockedReason: "Pending archive access approval from compliance workspace",
      rationale: "Context normalization reduces interpretation errors but should not block core security verification.",
      command: buildTaskCommand({ id: "TASK-154" })
    },
    {
      id: "TASK-160",
      title: "Validate release readiness bundle",
      state: "review",
      priority: "high",
      missionId: "q4-audit",
      crewId: "dev",
      owner: "validation-lead",
      runtime: "hermes",
      dependencies: ["TASK-142", "TASK-154"],
      estimate: "55m",
      confidence: 82,
      risk: "Release gate",
      summary: "Consolidate security checks and context updates into final evidence package for go/no-go.",
      lastUpdate: "17m ago",
      rationale: "Validation lead owns the final release gate and cross-team evidence consistency check.",
      command: buildTaskCommand({ id: "TASK-160" })
    }
  ]
}

export function defaultMissionRecords() {
  return [
    {
      id: "q4-audit",
      name: "Q4 Auth Reliability Hardening",
      objective: "Prepare a release-ready auth reliability package with policy diff, regression verification, and traceable evidence.",
      status: "active",
      dueWindow: "Nov 04 - Nov 28",
      risk: "Medium",
      capacity: "88%",
      progress: 62,
      health: "Critical path stable; context branch constrained",
      successCriteria: [
        "Auth middleware verified with zero high-severity regressions",
        "Runtime policy diff approved by security and ops leads",
        "Release readiness bundle accepted by validation lead"
      ],
      command: buildMissionCommand({ id: "q4-audit" })
    },
    {
      id: "infra-sync",
      name: "Infrastructure Sync",
      objective: "Normalize generated runtime artifacts before the next operator rollout.",
      status: "draft",
      dueWindow: "Nov 21 - Nov 29",
      risk: "Low",
      capacity: "44%",
      progress: 12,
      health: "Scoping",
      successCriteria: ["Diff reviewed", "Sync policy agreed"],
      command: buildMissionCommand({ id: "infra-sync" })
    },
    {
      id: "migration",
      name: "System Migration",
      objective: "Move legacy mission routing to the new governed runtime core.",
      status: "at_risk",
      dueWindow: "Nov 04 - Dec 02",
      risk: "High",
      capacity: "96%",
      progress: 54,
      health: "Blocked by shared runtime constraint",
      successCriteria: ["Parallel path restored", "Fallback policy tested"],
      command: buildMissionCommand({ id: "migration" })
    }
  ]
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
    writeFileSync(tasksPath, yaml.stringify({ tasks: defaultTaskRecords() }), "utf-8")
  }
  if (!existsSync(missionsPath)) {
    writeFileSync(missionsPath, yaml.stringify({ missions: defaultMissionRecords() }), "utf-8")
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
  const id = `${input.id || nextTaskId(existingTasks)}`.trim()
  const crewId = `${input.crewId || "dev"}`.trim() || "dev"
  const owner = `${input.owner || "planning-lead"}`.trim() || "planning-lead"
  const runtime = toTaskRuntime(input.runtime)
  return {
    id,
    title: `${input.title || "New Task"}`.trim(),
    state: `${input.state || "backlog"}`.trim(),
    priority: `${input.priority || "medium"}`.trim(),
    missionId: `${input.missionId || "q4-audit"}`.trim(),
    crewId,
    owner,
    runtime,
    dependencies: Array.isArray(input.dependencies) ? input.dependencies.map((item) => `${item}`) : [],
    estimate: `${input.estimate || "45m"}`.trim(),
    confidence: Number.isFinite(input.confidence) ? Number(input.confidence) : 78,
    risk: `${input.risk || "Medium"}`.trim(),
    summary: `${input.summary || "Task created from the Tasks workspace."}`.trim(),
    lastUpdate: `${input.lastUpdate || "just now"}`.trim(),
    sessionId: input.sessionId ? `${input.sessionId}`.trim() : undefined,
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
  const { tasksPath } = ensureTaskStorage(repoRoot)
  writeFileSync(tasksPath, yaml.stringify({ tasks }), "utf-8")
}

export function writeMissionStore(repoRoot, missions = []) {
  const { missionsPath } = ensureTaskStorage(repoRoot)
  writeFileSync(missionsPath, yaml.stringify({ missions }), "utf-8")
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
  const { tasks } = readTaskStore(repoRoot)
  const task = normalizeTaskRecord(payload, tasks)
  const nextTasks = [task, ...tasks]
  writeTaskStore(repoRoot, nextTasks)
  return { task, tasks: nextTasks }
}

export function updateTask(repoRoot, taskId, updates = {}) {
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
  writeTaskStore(repoRoot, nextTasks)
  return { task: updatedTask, tasks: nextTasks }
}

export function deleteTask(repoRoot, taskId) {
  const { tasks } = readTaskStore(repoRoot)
  const task = tasks.find((item) => item.id === taskId) || null
  if (!task) return { task: null, tasks }
  const nextTasks = tasks.filter((item) => item.id !== taskId)
  writeTaskStore(repoRoot, nextTasks)
  return { task, tasks: nextTasks }
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
  const { missions } = readTaskStore(repoRoot)
  const mission = normalizeMissionRecord(payload, missions)
  const nextMissions = [mission, ...missions]
  writeMissionStore(repoRoot, nextMissions)
  return { mission, missions: nextMissions }
}

export function updateMission(repoRoot, missionId, updates = {}) {
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
  writeMissionStore(repoRoot, nextMissions)
  return { mission: updatedMission, missions: nextMissions }
}

export function deleteMission(repoRoot, missionId, options = {}) {
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

  writeMissionStore(repoRoot, nextMissions)
  if (linkedTasks.length > 0) writeTaskStore(repoRoot, nextTasks)

  return {
    mission,
    missions: nextMissions,
    tasks: nextTasks,
    removedTasks: linkedTasks,
  }
}

export function commitMissionScope(repoRoot, missionId) {
  return updateMission(repoRoot, missionId, {
    status: "active",
    health: "Scope committed",
    progress: Math.max(5, Number(listMissions(repoRoot, { id: missionId })[0]?.progress || 0))
  })
}

export function applyMissionReplan(repoRoot, missionId) {
  const { tasks, missions } = readTaskStore(repoRoot)
  const nextTasks = tasks.map((task) => {
    if (task.missionId !== missionId) return task
    if (task.id === "TASK-142") {
      return normalizeTaskRecord({
        ...task,
        owner: "eng-lead",
        runtime: "pi/local",
        dependencies: ["TASK-126"],
        confidence: Math.min(task.confidence + 3, 99),
        rationale: "Replanned to eng-lead after expertise rebalance and lower queue delay on pi/local.",
        lastUpdate: "replanned now"
      }, tasks)
    }
    if (task.id === "TASK-154") {
      return normalizeTaskRecord({
        ...task,
        state: "ready",
        blockedReason: undefined,
        rationale: "Context prefetch resolved the bottleneck and unlocked downstream execution.",
        lastUpdate: "replanned now"
      }, tasks)
    }
    if (task.id === "TASK-160") {
      return normalizeTaskRecord({
        ...task,
        dependencies: ["TASK-142", "TASK-154"],
        lastUpdate: task.lastUpdate || "replanned now",
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

  writeTaskStore(repoRoot, nextTasks)
  writeMissionStore(repoRoot, nextMissions)
  return {
    mission: updatedMission,
    missions: nextMissions,
    tasks: nextTasks,
    summary: "Agentic replan moved TASK-142 to eng-lead on pi/local and unlocked TASK-154 via context prefetch."
  }
}
