import test from "node:test"
import assert from "node:assert/strict"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const runtimeRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(runtimeRoot, "..")

function createFixture(t) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pimh-smoke-"))
  const fixtureRuntimeRoot = path.join(tempRoot, ".pi")
  cpSync(path.join(runtimeRoot, "bin"), path.join(fixtureRuntimeRoot, "bin"), { recursive: true })
  cpSync(path.join(runtimeRoot, "scripts"), path.join(fixtureRuntimeRoot, "scripts"), { recursive: true })
  cpSync(path.join(runtimeRoot, "tests"), path.join(fixtureRuntimeRoot, "tests"), { recursive: true })
  cpSync(path.join(runtimeRoot, "crew"), path.join(fixtureRuntimeRoot, "crew"), { recursive: true })
  cpSync(path.join(runtimeRoot, "package.json"), path.join(fixtureRuntimeRoot, "package.json"))

  t.after(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  return {
    tempRoot,
    fixtureRuntimeRoot
  }
}

function runNode(filePath, args, env = {}, cwd = repoRoot) {
  return spawnSync(process.execPath, [filePath, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf-8"
  })
}

test("pimh list:crews reports available crews", (t) => {
  const fixture = createFixture(t)
  const pimhPath = path.join(fixture.fixtureRuntimeRoot, "bin", "pimh")
  const result = runNode(pimhPath, ["list:crews"], {}, fixture.tempRoot)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /dev/)
  assert.match(result.stdout, /marketing/)
})

test("pimh use writes active crew metadata and pimh clear removes it", (t) => {
  const fixture = createFixture(t)
  const pimhPath = path.join(fixture.fixtureRuntimeRoot, "bin", "pimh")

  const useResult = runNode(pimhPath, ["use", "marketing"], {}, fixture.tempRoot)
  assert.equal(useResult.status, 0, useResult.stderr)
  assert.match(useResult.stdout, /Activated PI crew: marketing/)

  const activeMetaPath = path.join(fixture.fixtureRuntimeRoot, ".active-crew.json")
  assert.equal(existsSync(activeMetaPath), true)
  const activeMeta = JSON.parse(readFileSync(activeMetaPath, "utf-8"))
  assert.equal(activeMeta.crew, "marketing")

  const clearResult = runNode(pimhPath, ["clear"], {}, fixture.tempRoot)
  assert.equal(clearResult.status, 0, clearResult.stderr)
  assert.equal(existsSync(activeMetaPath), false)
})

test("check-runtime succeeds in fixture runtime", (t) => {
  const fixture = createFixture(t)
  const checkRuntimePath = path.join(fixture.fixtureRuntimeRoot, "scripts", "check-runtime.mjs")
  const result = runNode(checkRuntimePath, [], {}, fixture.tempRoot)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Runtime check completed successfully/)
})

test("doctor reports healthy status in ci json mode", (t) => {
  const fixture = createFixture(t)
  const doctorPath = path.join(fixture.fixtureRuntimeRoot, "scripts", "doctor.mjs")
  const result = runNode(doctorPath, ["--ci", "--json"], {}, fixture.tempRoot)

  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.ok, true)

  const crewCheck = payload.results.find((entry) => entry.label === "crews")
  assert.equal(crewCheck.status, "ok")

  const runtimeCheck = payload.results.find((entry) => entry.label === "runtime_files")
  assert.equal(runtimeCheck.status, "ok")
})
