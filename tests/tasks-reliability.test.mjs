import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { acquireTaskRun, createTask, finishTaskRun, listTasks, updateTask } from "../scripts/tasks/tasks-store.mjs"
import { runBoundedProcess } from "../scripts/runtime/process-supervisor.mjs"
import { executeTaskAttempt } from "../scripts/tasks/task-runner.mjs"

const storeModule = fileURLToPath(new URL("../scripts/tasks/tasks-store.mjs", import.meta.url))
function tempRoot() { return mkdtempSync(path.join(os.tmpdir(), "mah-tasks-reliable-")) }
function launchCreate(root, count) {
  return new Promise((resolve, reject) => {
    const code = `import {createTask} from ${JSON.stringify(pathToFileURL(storeModule).href)}; for(let i=0;i<${count};i++) createTask(${JSON.stringify(root)}, {title:'parallel'});`
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (status) => status === 0 ? resolve() : reject(new Error(stderr)))
  })
}

test("concurrent writers keep every task and unique IDs", async () => {
  const root = tempRoot()
  try {
    await Promise.all(Array.from({ length: 5 }, () => launchCreate(root, 12)))
    const tasks = listTasks(root)
    assert.equal(tasks.length, 60)
    assert.equal(new Set(tasks.map((task) => task.id)).size, 60)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("stale dead-owner lock is recovered and interrupted temporary file is ignored", () => {
  const root = tempRoot()
  try {
    createTask(root, { title: "first" })
    const directory = path.join(root, ".mah", "tasks")
    const yamlBefore = readFileSync(path.join(directory, "tasks.yaml"), "utf8")
    writeFileSync(path.join(directory, "tasks.yaml.abandoned.tmp"), "partial")
    const lock = path.join(directory, ".store.lock")
    mkdirSync(lock)
    writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: 99999999, time: Date.now() - 120_000 }))
    utimesSync(lock, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000))
    createTask(root, { title: "second" })
    assert.equal(listTasks(root).length, 2)
    assert.match(yamlBefore, /first/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("attempt acquisition checks dependencies, prevents double dispatch and finalizes exact attempt", () => {
  const root = tempRoot()
  try {
    const first = createTask(root, { title: "dependency", state: "ready" }).task
    const second = createTask(root, { title: "dependent", state: "ready", dependencies: [first.id] }).task
    assert.throws(() => acquireTaskRun(root, second.id), /dependency not complete/)
    updateTask(root, first.id, { state: "done" })
    const running = acquireTaskRun(root, second.id)
    assert.equal(running.state, "in_progress")
    assert.ok(running.attemptId)
    assert.throws(() => acquireTaskRun(root, second.id), /already running/)
    assert.throws(() => finishTaskRun(root, second.id, "wrong", { ok: true }), /no longer active/)
    const failed = finishTaskRun(root, second.id, running.attemptId, { ok: false, error: "mock runtime failed" })
    assert.equal(failed.state, "failed")
    assert.equal(failed.failureReason, "mock runtime failed")
    const retry = acquireTaskRun(root, second.id)
    const reviewed = finishTaskRun(root, second.id, retry.attemptId, { ok: true, sessionId: "pi:dev:exact-run" })
    assert.equal(reviewed.state, "review")
    assert.equal(reviewed.sessionId, "pi:dev:exact-run")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("mock runtime observes running state and result links its own session", async () => {
  const root = tempRoot()
  try {
    const task = createTask(root, { title: "simulated", state: "ready", runtime: "pi", crewId: "dev" }).task
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const pending = executeTaskAttempt(root, task.id, async () => {
      assert.equal(listTasks(root, { id: task.id })[0].state, "in_progress")
      await gate
      return { ok: true, payload: { session_id: "new-session" } }
    })
    assert.equal(listTasks(root, { id: task.id })[0].state, "in_progress")
    await assert.rejects(() => executeTaskAttempt(root, task.id, async () => ({ ok: true })), /already running/)
    release()
    const result = await pending
    assert.equal(result.task.state, "review")
    assert.equal(result.task.sessionId, "pi:dev:new-session")
    const failing = createTask(root, { title: "failure", state: "ready" }).task
    const failed = await executeTaskAttempt(root, failing.id, async () => { throw new Error("mock exit error") })
    assert.equal(failed.task.state, "failed")
    assert.equal(failed.task.failureReason, "mock exit error")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("bounded child process enforces deadline, cancellation and output cap", async () => {
  const alreadyCancelled = new AbortController()
  alreadyCancelled.abort()
  const notStarted = await runBoundedProcess('command-that-does-not-exist', [], { signal: alreadyCancelled.signal })
  assert.equal(notStarted.reason, "cancelled")
  const hang = await runBoundedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 80, graceMs: 80 })
  assert.equal(hang.reason, "deadline exceeded")
  const controller = new AbortController()
  const pending = runBoundedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 5000, signal: controller.signal })
  setTimeout(() => controller.abort(), 50)
  assert.equal((await pending).reason, "cancelled")
  const output = await runBoundedProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(200000))"], { maxOutputBytes: 4096 })
  assert.equal(output.status, 0)
  assert.equal(output.truncated, true)
  assert.ok(Buffer.byteLength(output.stdout) <= 4096)
})

test("concurrent stale-lock reclaimers cannot remove a new writer lock", async () => {
  const root = tempRoot()
  try {
    createTask(root, { title: "baseline" })
    const lock = path.join(root, ".mah", "tasks", ".store.lock")
    mkdirSync(lock)
    writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: 99999999, time: Date.now() - 120_000 }))
    await Promise.all(Array.from({ length: 6 }, () => launchCreate(root, 10)))
    assert.equal(listTasks(root).length, 61)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
