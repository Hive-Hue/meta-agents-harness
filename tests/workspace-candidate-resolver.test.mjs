import test from "node:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolveWorkspaceCandidates } from "../scripts/routing/workspace-candidate-resolver.mjs"

function writeMeta(workspaceRoot) {
  const content = [
    "version: 1",
    "name: resolver-test",
    "crews:",
    "  - id: dev",
    "    source_configs:",
    "      hermes: .hermes/crew/dev/multi-team.yaml",
    "    agents:",
    "      - id: orchestrator",
    "        role: orchestrator",
    "        team: orchestration",
    "        skills: [delegate_bounded]",
    "        domain_profile: runtime_impl",
    "      - id: repo-analyst",
    "        role: worker",
    "        team: planning",
    "        skills: [expertise_model]",
    "        domain_profile: read_only_repo",
    "  - id: marketing",
    "    source_configs:",
    "      hermes: .hermes/crew/marketing/multi-team.yaml",
    "    agents:",
    "      - id: growth-lead",
    "        role: lead",
    "        team: growth",
    "        skills: [zero_micromanagement]",
    "        domain_profile: runtime_impl",
    ""
  ].join("\n")
  writeFileSync(path.join(workspaceRoot, "meta-agents.yaml"), content, "utf-8")
}

function createHermesCrewConfig(workspaceRoot, crewId) {
  const configPath = path.join(workspaceRoot, ".hermes", "crew", crewId, "multi-team.yaml")
  mkdirSync(path.dirname(configPath), { recursive: true })
  writeFileSync(configPath, `crew: ${crewId}\n`, "utf-8")
}

test("active_crew scope returns only local crew candidates", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "mah-resolver-active-"))
  try {
    writeMeta(workspaceRoot)
    createHermesCrewConfig(workspaceRoot, "dev")
    createHermesCrewConfig(workspaceRoot, "marketing")

    const result = resolveWorkspaceCandidates({
      repoRoot: workspaceRoot,
      runtime: "hermes",
      sourceCrew: "dev",
      routingScope: "active_crew",
      runtimeProfile: { markerDir: ".hermes" }
    })

    assert.equal(result.routingScope, "active_crew")
    assert.equal(result.sourceCrew, "dev")
    assert.deepEqual(result.candidateCrews, ["dev"])
    assert.equal(result.candidates.length, 2)
    assert.equal(result.candidates.every((item) => item.crew === "dev"), true)
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test("full_crews scope returns candidates from multiple crews", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "mah-resolver-full-"))
  try {
    writeMeta(workspaceRoot)
    createHermesCrewConfig(workspaceRoot, "dev")
    createHermesCrewConfig(workspaceRoot, "marketing")

    const result = resolveWorkspaceCandidates({
      repoRoot: workspaceRoot,
      runtime: "hermes",
      sourceCrew: "dev",
      routingScope: "full_crews",
      runtimeProfile: { markerDir: ".hermes" }
    })

    assert.equal(result.routingScope, "full_crews")
    assert.equal(result.sourceCrew, "dev")
    assert.equal(result.candidateCrews.includes("dev"), true)
    assert.equal(result.candidateCrews.includes("marketing"), true)
    assert.equal(result.candidates.length, 3)
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test("runtime incompatibilities are filtered out", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "mah-resolver-filter-"))
  try {
    writeMeta(workspaceRoot)
    createHermesCrewConfig(workspaceRoot, "dev")
    // marketing config intentionally missing

    const result = resolveWorkspaceCandidates({
      repoRoot: workspaceRoot,
      runtime: "hermes",
      sourceCrew: "dev",
      routingScope: "full_crews",
      runtimeProfile: { markerDir: ".hermes" }
    })

    assert.deepEqual(result.candidateCrews, ["dev"])
    assert.equal(result.candidates.length, 2)
    assert.equal(result.candidates.every((item) => item.runtimeCompatible === true), true)
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})
