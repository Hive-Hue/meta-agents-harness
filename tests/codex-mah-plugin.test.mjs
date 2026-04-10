import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  loadActiveContext,
  listAgentsForContext,
  resolveDelegationTarget
} from "../plugins/mah/mcp/lib/runtime-context.mjs"
import { getActiveContextHandler } from "../plugins/mah/mcp/handlers/get-active-context.mjs"
import { listAgentsHandler } from "../plugins/mah/mcp/handlers/list-agents.mjs"
import { delegateAgentHandler } from "../plugins/mah/mcp/handlers/delegate-agent.mjs"

function createFixtureRepo() {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "mah-codex-plugin-"))
  mkdirSync(path.join(repoRoot, ".codex", "crew", "dev"), { recursive: true })
  writeFileSync(
    path.join(repoRoot, ".codex", ".active-crew.json"),
    JSON.stringify({ crew: "dev", source_config: ".codex/crew/dev/multi-team.yaml" }, null, 2)
  )
  writeFileSync(
    path.join(repoRoot, ".codex", "crew", "dev", "multi-team.yaml"),
    [
      "name: Dev Crew",
      "mission: Build the plugin",
      "sprint_mode:",
      "  name: v0.5.0",
      "  target_release: v0.5.0",
      "  objective: Ship bounded Codex plugin support",
      "  execution_mode: spec-bound",
      "orchestrator:",
      "  name: orchestrator",
      "teams:",
      "  - name: Platform",
      "    lead:",
      "      name: engineering_lead",
      "    members:",
      "      - name: backend_dev",
      "      - name: frontend_dev",
      "  - name: Validation",
      "    lead:",
      "      name: validation_lead",
      "    members:",
      "      - name: qa_reviewer",
      ""
    ].join("\n")
  )
  return repoRoot
}

test("getActiveContext resolves crew and agent from env plus .codex state", async () => {
  const repoRoot = createFixtureRepo()
  try {
    const result = await getActiveContextHandler({}, {
      repoRoot,
      env: {
        MAH_ACTIVE_CREW: "dev",
        MAH_AGENT: "engineering_lead"
      }
    })

    assert.equal(result.ok, true)
    assert.equal(result.context.crew, "dev")
    assert.equal(result.context.agent, "engineering_lead")
    assert.equal(result.context.role, "lead")
    assert.equal(result.context.team, "Platform")
  } finally {
    rmSync(repoRoot, { recursive: true, force: true })
  }
})

test("listAgents returns only allowed targets for a lead", async () => {
  const repoRoot = createFixtureRepo()
  try {
    const result = await listAgentsHandler({}, {
      repoRoot,
      env: {
        MAH_ACTIVE_CREW: "dev",
        MAH_AGENT: "engineering_lead"
      }
    })

    assert.equal(result.ok, true)
    assert.deepEqual(
      result.topology.allowed_targets.map((item) => item.name),
      ["backend_dev", "frontend_dev"]
    )
  } finally {
    rmSync(repoRoot, { recursive: true, force: true })
  }
})

test("resolveDelegationTarget reroutes orchestrator -> worker through owning lead", () => {
  const repoRoot = createFixtureRepo()
  try {
    const state = loadActiveContext({
      repoRoot,
      env: {
        MAH_ACTIVE_CREW: "dev",
        MAH_AGENT: "orchestrator"
      }
    })
    const resolution = resolveDelegationTarget(state, "backend_dev")

    assert.equal(resolution.ok, true)
    assert.equal(resolution.effectiveTarget, "engineering_lead")
    assert.deepEqual(resolution.rerouted, {
      originalTarget: "backend_dev",
      lead: "engineering_lead",
      team: "Platform",
      worker: "backend_dev"
    })
  } finally {
    rmSync(repoRoot, { recursive: true, force: true })
  }
})

test("delegateAgent executes the MAH CLI with autonomous mode", async () => {
  const repoRoot = createFixtureRepo()
  try {
    let captured = null
    const result = await delegateAgentHandler(
      {
        target: "backend_dev",
        task: "Implement the plugin bridge.",
        include_full_output: true
      },
      {
        repoRoot,
        env: {
          MAH_ACTIVE_CREW: "dev",
          MAH_AGENT: "orchestrator"
        },
        exec(command, args, execOptions) {
          captured = { command, args, execOptions }
          return {
            status: 0,
            stdout: "Delegation completed successfully.",
            stderr: ""
          }
        }
      }
    )

    assert.equal(result.ok, true)
    assert.equal(result.effective_target, "engineering_lead")
    assert.equal(captured.command, process.execPath)
    assert.equal(captured.execOptions.env.MAH_CODEX_AUTONOMOUS, "1")
    assert.match(captured.args.join(" "), /--runtime codex/)
    assert.match(captured.args.join(" "), /--agent engineering_lead/)
  } finally {
    rmSync(repoRoot, { recursive: true, force: true })
  }
})

test("listAgentsForContext returns orchestrator routes for workers", () => {
  const repoRoot = createFixtureRepo()
  try {
    const state = loadActiveContext({
      repoRoot,
      env: {
        MAH_ACTIVE_CREW: "dev",
        MAH_AGENT: "orchestrator"
      }
    })

    const topology = listAgentsForContext(state)
    assert.deepEqual(
      topology.allowed_targets.map((item) => item.name),
      ["engineering_lead", "validation_lead"]
    )
    assert.equal(topology.reroute_for_workers.length, 2)
  } finally {
    rmSync(repoRoot, { recursive: true, force: true })
  }
})
