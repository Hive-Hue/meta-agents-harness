import test from "node:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")

function writeWorkspaceConfig(workspaceRoot, cooperativeBlock = "") {
  const content = [
    "version: 1",
    "name: coop-config-test",
    "runtimes:",
    "  hermes: {}",
    "catalog:",
    "  models:",
    "    worker_default: gpt-5.4-mini",
    "domain_profiles:",
    "  runtime_impl:",
    "    - path: .",
    "      read: true",
    "crews:",
    "  - id: dev",
    "    topology:",
    "      orchestrator: orchestrator",
    "      leads:",
    "        engineering: engineering-lead",
    "      workers:",
    "        engineering:",
    "          - backend-dev",
    "    agents:",
    "      - id: orchestrator",
    "        role: orchestrator",
    "        team: orchestration",
    "        skills: [context_memory]",
    "      - id: engineering-lead",
    "        role: lead",
    "        team: engineering",
    "        skills: [context_memory]",
    "      - id: backend-dev",
    "        role: worker",
    "        team: engineering",
    "        skills: [context_memory]",
    cooperativeBlock,
    ""
  ].join("\n")
  writeFileSync(path.join(workspaceRoot, "meta-agents.yaml"), content, "utf-8")
  mkdirSync(path.join(workspaceRoot, ".hermes", "crew", "dev"), { recursive: true })
  writeFileSync(path.join(workspaceRoot, ".hermes", "crew", "dev", "multi-team.yaml"), "crew: dev\n", "utf-8")
}

test("validate:config rejects unknown cooperative_routing.allowed_crews entries", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "mah-coop-config-"))
  try {
    writeWorkspaceConfig(workspaceRoot, [
      "cooperative_routing:",
      "  enabled: true",
      "  default_scope: full_crews",
      "  allowed_crews:",
      "    - dev",
      "    - ghost-crew"
    ].join("\n"))
    const result = spawnSync(process.execPath, [cliPath, "validate:config"], { cwd: workspaceRoot, encoding: "utf-8" })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /cooperative_routing\.allowed_crews references unknown crew 'ghost-crew'/)
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test("validate:config rejects full_crews default when cooperative routing is disabled", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "mah-coop-config-disabled-"))
  try {
    writeWorkspaceConfig(workspaceRoot, [
      "cooperative_routing:",
      "  enabled: false",
      "  default_scope: full_crews"
    ].join("\n"))
    const result = spawnSync(process.execPath, [cliPath, "validate:config"], { cwd: workspaceRoot, encoding: "utf-8" })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /default_scope cannot be 'full_crews'/)
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test("mah run --full-crews is blocked when cooperative routing is disabled in config", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "mah-coop-config-run-block-"))
  try {
    writeWorkspaceConfig(workspaceRoot, [
      "cooperative_routing:",
      "  enabled: false",
      "  default_scope: active_crew"
    ].join("\n"))
    const result = spawnSync(process.execPath, [
      cliPath,
      "--runtime", "hermes",
      "run",
      "--headless",
      "--output=json",
      "--full-crews",
      "--crew", "dev",
      "--task", "should fail"
    ], { cwd: workspaceRoot, encoding: "utf-8", timeout: 30000 })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /cooperative routing is disabled by config/)
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})
