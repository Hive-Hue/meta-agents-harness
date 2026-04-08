import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { RUNTIME_ADAPTERS, RUNTIME_ORDER, createAdapter } from "../scripts/runtime-adapters.mjs"
import { validateRuntimeAdapterContract, REQUIRED_RUNTIME_COMMANDS } from "../scripts/runtime-adapter-contract.mjs"

test("runtime adapters satisfy minimal contract", () => {
  const result = validateRuntimeAdapterContract(RUNTIME_ADAPTERS)
  assert.equal(result.ok, true, result.errors.join("\n"))
})

test("hermes adapter exists in RUNTIME_ORDER", () => {
  assert.ok(RUNTIME_ORDER.includes("hermes"), "hermes must be in RUNTIME_ORDER")
})

test("hermes adapter exists in RUNTIME_ADAPTERS", () => {
  assert.ok("hermes" in RUNTIME_ADAPTERS, "hermes must be a key in RUNTIME_ADAPTERS")
})

test("hermes adapter name matches key", () => {
  const adapter = RUNTIME_ADAPTERS.hermes
  assert.equal(adapter.name, "hermes", "adapter.name must match runtime key")
})

test("hermes adapter has correct structural fields", () => {
  const adapter = RUNTIME_ADAPTERS.hermes
  assert.equal(adapter.markerDir, ".hermes")
  assert.equal(adapter.wrapper, "hermesh")
  assert.equal(adapter.directCli, "hermes")
  assert.equal(typeof adapter.detect, "function")
  assert.equal(typeof adapter.supports, "function")
  assert.equal(typeof adapter.resolveCommandPlan, "function")
  assert.equal(typeof adapter.validateRuntime, "function")
})

test("hermes adapter has all required commands", () => {
  const adapter = RUNTIME_ADAPTERS.hermes
  for (const cmd of REQUIRED_RUNTIME_COMMANDS) {
    assert.ok(adapter.commands?.[cmd], `hermes missing command: ${cmd}`)
    assert.ok(Array.isArray(adapter.commands[cmd]), `hermes ${cmd} must be an array of variants`)
    assert.ok(adapter.commands[cmd].length > 0, `hermes ${cmd} must have at least one variant`)
  }
})

test("hermes adapter capabilities include session support", () => {
  const caps = RUNTIME_ADAPTERS.hermes.capabilities
  assert.equal(caps.sessionModeNew, true, "hermes should support sessionModeNew")
  assert.equal(caps.sessionModeContinue, true, "hermes should support sessionModeContinue")
  assert.equal(typeof caps.sessionIdViaEnv, "string", "hermes should use env var for session ID")
  assert.ok(caps.sessionRootFlag, "hermes should declare a sessionRootFlag")
})

test("hermes adapter capabilities include selective absorption metadata", () => {
  const caps = RUNTIME_ADAPTERS.hermes.capabilities
  assert.equal(caps.persistentMemory, true, "hermes should declare persistentMemory")
  assert.equal(caps.supportsBackgroundOperation, true, "hermes should declare supportsBackgroundOperation")
  assert.equal(caps.supportsMultiBackendExecution, true, "hermes should declare supportsMultiBackendExecution")
  assert.equal(caps.gatewayAware, true, "hermes should declare gatewayAware")
})

test("hermes adapter detect uses markerDir", () => {
  const adapter = RUNTIME_ADAPTERS.hermes
  let detectedPath = ""
  adapter.detect("/some/cwd", (p) => {
    detectedPath = p
    return false
  })
  assert.equal(detectedPath, "/some/cwd/.hermes", "detect should check for markerDir")
})

test("hermes adapter supports returns correct results", () => {
  const adapter = RUNTIME_ADAPTERS.hermes
  assert.equal(adapter.supports("run"), true)
  assert.equal(adapter.supports("doctor"), true)
  assert.equal(adapter.supports("nonexistent:cmd"), false)
})

test("hermes wrapper variants use run while direct cli uses chat", () => {
  const variants = RUNTIME_ADAPTERS.hermes.commands.run
  assert.deepEqual(variants[0], ["node", [".hermes/bin/hermesh", "run"]])
  assert.deepEqual(variants[1], ["hermesh", ["run"]])
  assert.deepEqual(variants[2], ["hermes", ["chat"]])
})

test("hermes adapter validateRuntime checks all fields", () => {
  const adapter = RUNTIME_ADAPTERS.hermes
  const result = adapter.validateRuntime(() => false)
  assert.ok(Array.isArray(result.checks))
  assert.ok(result.checks.some((c) => c.name === "marker_dir" && c.ok === true))
  assert.ok(result.checks.some((c) => c.name === "wrapper_declared" && c.ok === true))
  assert.ok(result.checks.some((c) => c.name === "direct_cli_declared" && c.ok === true))
  assert.ok(result.checks.some((c) => c.name === "wrapper_available" && c.ok === false))
  assert.ok(result.checks.some((c) => c.name === "direct_cli_available" && c.ok === false))
  assert.ok(result.checks.some((c) => c.name === "commands_declared" && c.ok === true))
})

test("adapter command resolution skips node variants whose script path is missing", () => {
  const adapter = createAdapter({
    name: "synthetic",
    markerDir: ".synthetic",
    wrapper: "synthetic-wrapper",
    directCli: "synthetic",
    commands: {
      "check:runtime": [["node", [".synthetic/bin/missing.mjs", "check:runtime"]], ["synthetic", ["check:runtime"]]]
    }
  })
  const result = adapter.resolveCommandPlan("check:runtime", (command) => command === "node" || command === "synthetic")
  assert.equal(result.ok, true)
  assert.equal(result.exec, "synthetic")
})

test("adapter command resolution accepts npm prefix variants only when package exists", () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "mah-runtime-adapter-"))
  const prefixDir = path.join(tempRoot, ".synthetic")
  mkdirSync(prefixDir, { recursive: true })
  writeFileSync(path.join(prefixDir, "package.json"), JSON.stringify({ name: "synthetic-runtime" }))
  const previousCwd = process.cwd()
  process.chdir(tempRoot)
  try {
    const adapter = createAdapter({
      name: "synthetic",
      markerDir: ".synthetic",
      wrapper: "synthetic-wrapper",
      directCli: "",
      commands: {
        "check:runtime": [["npm", ["--prefix", ".synthetic", "run", "check:runtime"]]]
      }
    })
    const result = adapter.resolveCommandPlan("check:runtime", (command) => command === "npm")
    assert.equal(result.ok, true)
    assert.equal(result.exec, "npm")
  } finally {
    process.chdir(previousCwd)
  }
})
