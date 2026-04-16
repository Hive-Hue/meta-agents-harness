import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { delegateAgentHandler } from "../plugins/mah/mcp/handlers/delegate-agent.mjs"

function createCodexContextFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "mah-delegate-"))
  mkdirSync(path.join(root, ".codex", "crew", "dev"), { recursive: true })
  writeFileSync(
    path.join(root, ".codex", ".active-crew.json"),
    `${JSON.stringify({ crew: "dev" }, null, 2)}\n`,
    "utf-8"
  )
  writeFileSync(
    path.join(root, ".codex", "crew", "dev", "multi-team.yaml"),
    [
      "orchestrator:",
      "  name: orchestrator",
      "teams:",
      "  - name: Engineering",
      "    lead:",
      "      name: engineering-lead",
      "    members:",
      "      - name: backend-dev"
    ].join("\n"),
    "utf-8"
  )
  return root
}

test("delegateAgentHandler routes through mah delegate pipeline with runtime hint", async () => {
  const repoRoot = createCodexContextFixture()
  try {
    let captured = null
    const result = await delegateAgentHandler(
      {
        target: "backend-dev",
        task: "Implement parser",
        target_runtime: "codex"
      },
      {
        repoRoot,
        env: {
          MAH_AGENT: "engineering-lead"
        },
        exec(command, args, execOptions) {
          captured = { command, args, execOptions }
          return { status: 0, stdout: "Delegation completed", stderr: "" }
        }
      }
    )

    assert.equal(result.ok, true)
    assert.equal(result.mechanism, "mah-cli-delegate-pipeline")
    assert.equal(result.requested_target_runtime, "codex")
    assert.ok(captured)
    assert.equal(captured.command, process.execPath)
    assert.deepEqual(captured.args.slice(0, 2), ["scripts/meta-agents-harness.mjs", "delegate"])
    assert.ok(captured.args.includes("--target"))
    assert.ok(captured.args.includes("backend-dev"))
    assert.ok(captured.args.includes("--runtime"))
    assert.ok(captured.args.includes("codex"))
    assert.ok(captured.args.includes("--execute"))
  } finally {
    rmSync(repoRoot, { recursive: true, force: true })
  }
})

test("delegateAgentHandler omits runtime flag when no runtime hint is provided", async () => {
  const repoRoot = createCodexContextFixture()
  try {
    let captured = null
    const result = await delegateAgentHandler(
      {
        target: "backend-dev",
        task: "Implement parser"
      },
      {
        repoRoot,
        env: {
          MAH_AGENT: "engineering-lead"
        },
        exec(command, args, execOptions) {
          captured = { command, args, execOptions }
          return { status: 0, stdout: "Delegation completed", stderr: "" }
        }
      }
    )

    assert.equal(result.ok, true)
    assert.equal(result.requested_target_runtime, null)
    assert.ok(captured)
    assert.equal(captured.args.includes("--runtime"), false)
  } finally {
    rmSync(repoRoot, { recursive: true, force: true })
  }
})

