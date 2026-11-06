import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"

import { buildContextMemoryBlock, buildContextMemoryExplainPayload } from "../scripts/context/context-memory-integration.mjs"
import { buildOperationalIndex } from "../scripts/context/context-memory-schema.mjs"
import { buildAssistantStatePayload } from "../scripts/runtime/assistant-state.mjs"

const memoryFixture = ({ id, agent, pattern, heading }) => `---
id: ${id}
kind: operational-memory
crew: dev
agent: ${agent}
capabilities:
  - workspace-memory
task_patterns:
  - "${pattern}"
priority: high
stability: stable
source_type: human-authored
---

# ${heading}

Workspace-specific marker.
`

function createWorkspaceMemory(workspaceRoot, { id, agent, pattern, heading }) {
  const contextRoot = path.join(workspaceRoot, ".mah", "context")
  const documentDir = path.join(contextRoot, "operational", "dev")
  mkdirSync(documentDir, { recursive: true })
  mkdirSync(path.join(contextRoot, "index"), { recursive: true })
  writeFileSync(
    path.join(documentDir, "memory.md"),
    memoryFixture({ id, agent, pattern, heading }),
    "utf-8"
  )
  buildOperationalIndex(contextRoot, { rebuild: true })
}

test("context memory reads only the explicitly selected workspace corpus", () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "mah-context-workspaces-"))
  const alphaRoot = path.join(tempRoot, "alpha")
  const betaRoot = path.join(tempRoot, "beta")
  const alpha = {
    id: "dev/alpha/marker-memory",
    agent: "alpha-agent",
    pattern: "alpha workspace marker task",
    heading: "Alpha Workspace Marker",
  }
  const beta = {
    id: "dev/beta/marker-memory",
    agent: "beta-agent",
    pattern: "beta workspace marker task",
    heading: "Beta Workspace Marker",
  }

  try {
    createWorkspaceMemory(alphaRoot, alpha)
    createWorkspaceMemory(betaRoot, beta)

    const alphaBlock = buildContextMemoryBlock(
      { agentName: alpha.agent, agentRole: "dev", config: {}, tools: [] },
      ["--task", alpha.pattern],
      { MAH_CONTEXT_MEMORY: "1" },
      { workspaceRoot: alphaRoot }
    )
    const betaBlock = buildContextMemoryBlock(
      { agentName: beta.agent, agentRole: "dev", config: {}, tools: [] },
      ["--task", beta.pattern],
      { MAH_CONTEXT_MEMORY: "1" },
      { workspaceRoot: betaRoot }
    )

    assert.match(alphaBlock, /dev\/alpha\/marker-memory/)
    assert.doesNotMatch(alphaBlock, /dev\/beta\/marker-memory/)
    assert.match(betaBlock, /dev\/beta\/marker-memory/)
    assert.doesNotMatch(betaBlock, /dev\/alpha\/marker-memory/)

    const alphaExplain = buildContextMemoryExplainPayload(
      ["--with-context-memory", "--task", alpha.pattern],
      { workspaceRoot: alphaRoot }
    )
    const betaExplain = buildContextMemoryExplainPayload(
      ["--with-context-memory", "--task", beta.pattern],
      { workspaceRoot: betaRoot }
    )

    assert.equal(alphaExplain.status, "matched")
    assert.deepEqual(alphaExplain.matched_docs.map((doc) => doc.id), [alpha.id])
    assert.equal(betaExplain.status, "matched")
    assert.deepEqual(betaExplain.matched_docs.map((doc) => doc.id), [beta.id])

    const assistantState = buildAssistantStatePayload({
      repoRoot: alphaRoot,
      crew: "dev",
      agent: alpha.agent,
      task: alpha.pattern,
      runtime: "test",
    })
    assert.deepEqual(assistantState.context_memory.matched_docs, [alpha.id])
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test("context memory does not fall back to the MAH installation corpus", () => {
  const emptyWorkspace = mkdtempSync(path.join(tmpdir(), "mah-context-empty-workspace-"))
  try {
    const result = buildContextMemoryExplainPayload(
      ["--with-context-memory", "--task", "triage backlog with clickup"],
      { workspaceRoot: emptyWorkspace }
    )
    assert.equal(result.status, "missing-corpus")
    assert.equal(result.matched_docs, undefined)
  } finally {
    rmSync(emptyWorkspace, { recursive: true, force: true })
  }
})
