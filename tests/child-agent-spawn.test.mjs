import assert from "node:assert/strict"
import test from "node:test"

import {
  SPAWN_MODES,
  isValidSpawnMode,
  validateChildAgentAdapter
} from "../scripts/child-agent-adapter-contract.mjs"
import { resolveDelegationTarget } from "../scripts/delegation-resolution.mjs"
import {
  buildSpawnContext,
  clearAdapters,
  determineSpawnMode,
  getRegisteredAdapters,
  registerChildAgentAdapter
} from "../scripts/child-agent-spawn.mjs"
import { codexSidecarAdapter } from "../scripts/child-agent-codex-sidecar.mjs"

const repoRoot = process.cwd()

test("SPAWN_MODES constant", () => {
  assert.equal(SPAWN_MODES.NATIVE_SAME_RUNTIME, "native-same-runtime")
  assert.equal(SPAWN_MODES.CROSS_RUNTIME_SIDECAR, "cross-runtime-sidecar")
})

test("isValidSpawnMode validation", () => {
  assert.equal(isValidSpawnMode("native-same-runtime"), true)
  assert.equal(isValidSpawnMode("cross-runtime-sidecar"), true)
  assert.equal(isValidSpawnMode("invalid"), false)
})

test("validateChildAgentAdapter", () => {
  const validation = validateChildAgentAdapter(codexSidecarAdapter)
  assert.equal(validation.ok, true)
  assert.deepStrictEqual(validation.errors, [])
})

test("codexSidecarAdapter interface", () => {
  assert.equal(typeof codexSidecarAdapter.supportsSpawn === "function", true)
  assert.equal(codexSidecarAdapter.supportsSpawn({
    crew: "dev", sourceRuntime: "pi", targetRuntime: "codex", sourceAgent: "engineering-lead", logicalTarget: "backend-dev"
  }), true)

  const modes = codexSidecarAdapter.listSpawnModes({
    crew: "dev", sourceRuntime: "pi", targetRuntime: "codex", sourceAgent: "engineering-lead", logicalTarget: "backend-dev"
  })
  assert.deepStrictEqual(modes, [SPAWN_MODES.CROSS_RUNTIME_SIDECAR])

  const spawnResult = codexSidecarAdapter.prepareSpawn({
    crew: "dev",
    sourceRuntime: "pi",
    targetRuntime: "codex",
    sourceAgent: "engineering-lead",
    logicalTarget: "backend-dev",
    effectiveLogicalTarget: "backend-dev",
    task: "Implement the parser",
    mode: SPAWN_MODES.CROSS_RUNTIME_SIDECAR,
    repoRoot
  })
  assert.equal(spawnResult.ok, true)
  assert.equal(spawnResult.mode, SPAWN_MODES.CROSS_RUNTIME_SIDECAR)
  assert.ok(Array.isArray(spawnResult.args))
  assert.ok(spawnResult.args.includes("exec"))
  assert.ok(spawnResult.args.includes("--full-auto"))
  assert.equal(spawnResult.exec, "codex")
  assert.deepStrictEqual(spawnResult.envOverrides, {
    MAH_ACTIVE_CREW: "dev"
  })
})

test("resolveDelegationTarget - Authorization", () => {
  const selfResult = resolveDelegationTarget({
    crew: "dev",
    sourceAgent: "orchestrator",
    sourceRuntime: "pi",
    logicalTarget: "orchestrator",
    repoRoot
  })
  assert.equal(selfResult.ok, false)
  assert.match(selfResult.error, /self-delegation/)

  const orchResult = resolveDelegationTarget({
    crew: "dev",
    sourceAgent: "orchestrator",
    sourceRuntime: "pi",
    logicalTarget: "planning-lead",
    repoRoot
  })
  assert.equal(orchResult.ok, true)
  assert.equal(orchResult.effectiveTarget, "planning-lead")

  const leadResult = resolveDelegationTarget({
    crew: "dev",
    sourceAgent: "engineering-lead",
    sourceRuntime: "pi",
    logicalTarget: "backend-dev",
    repoRoot
  })
  assert.equal(leadResult.ok, true)
  assert.equal(leadResult.effectiveTarget, "backend-dev")

  const crossTeamResult = resolveDelegationTarget({
    crew: "dev",
    sourceAgent: "engineering-lead",
    sourceRuntime: "pi",
    logicalTarget: "qa-reviewer",
    repoRoot
  })
  assert.equal(crossTeamResult.ok, false)

  const workerResult = resolveDelegationTarget({
    crew: "dev",
    sourceAgent: "backend-dev",
    sourceRuntime: "pi",
    logicalTarget: "frontend-dev",
    repoRoot
  })
  assert.equal(workerResult.ok, false)
  assert.match(workerResult.error, /workers cannot delegate/)
})

test("determineSpawnMode", () => {
  assert.equal(determineSpawnMode("pi", "pi"), SPAWN_MODES.NATIVE_SAME_RUNTIME)
  assert.equal(determineSpawnMode("codex", "codex"), SPAWN_MODES.NATIVE_SAME_RUNTIME)
  assert.equal(determineSpawnMode("pi", "codex"), SPAWN_MODES.CROSS_RUNTIME_SIDECAR)
  assert.equal(determineSpawnMode("pi", "hermes"), SPAWN_MODES.CROSS_RUNTIME_SIDECAR)
})

test("buildSpawnContext - integrates resolution", () => {
  const built = buildSpawnContext({
    crew: "dev",
    sourceAgent: "engineering-lead",
    sourceRuntime: "pi",
    targetRuntime: "codex",
    logicalTarget: "backend-dev",
    task: "Implement the parser",
    repoRoot
  })
  assert.equal(built.ok, true)
  assert.ok(built.context)
  assert.equal(built.context.effectiveLogicalTarget, "backend-dev")
  assert.equal(built.context.mode, SPAWN_MODES.CROSS_RUNTIME_SIDECAR)
})

test("Adapter registry", () => {
  clearAdapters()
  registerChildAgentAdapter(codexSidecarAdapter)
  const adapters = getRegisteredAdapters()
  assert.ok(adapters.length >= 1)
  clearAdapters()
  assert.equal(getRegisteredAdapters().length, 0)
})
