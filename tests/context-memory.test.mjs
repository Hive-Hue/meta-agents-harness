import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildContextMemoryBlock } from "../scripts/context-memory-integration.mjs"
import { buildIndexFromDirs, buildOperationalIndex, retrieveDocuments } from "../scripts/context-memory-schema.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const contextRoot = path.join(repoRoot, ".mah", "context")
const indexPath = path.join(contextRoot, "index", "operational-context.index.json")
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "context-memory")

function snapshotFile(filePath) {
  const existed = existsSync(filePath)
  const previous = existed ? readFileSync(filePath, "utf-8") : null
  return () => {
    if (existed) {
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, previous, "utf-8")
    } else {
      rmSync(filePath, { force: true })
    }
  }
}

test("context memory keeps fixtures out of production indexing and uses task patterns", () => {
  const restoreIndex = snapshotFile(indexPath)

  try {
    const operationalResult = buildOperationalIndex(contextRoot, { rebuild: true })
    assert.equal(operationalResult.total_documents, 0)
    assert.equal(
      operationalResult.entries.some((entry) => `${entry.file_path || ""}`.includes("tests/fixtures/context-memory")),
      false
    )

    const fixtureEntries = buildIndexFromDirs([fixtureDir], repoRoot)
    assert.ok(fixtureEntries.length > 0)

    const retrieval = retrieveDocuments(
      {
        agent: "planning-lead",
        task: "transform spec into backlog with clickup",
        capability_hint: "backlog-planning",
      },
      { entries: fixtureEntries }
    )

    assert.ok(retrieval.matched_docs.length > 0)
    assert.equal(retrieval.matched_docs[0].id, "dev/planning-lead/backlog-planning/clickup-backlog-triage")
    assert.match(retrieval.matched_docs[0].reasons.join(" "), /task pattern/i)
    assert.ok(retrieval.skill_hints.includes("agentic_pert"))

    const tempIndex = {
      schema_version: "mah.context-memory.index.v1",
      generated_at: new Date().toISOString(),
      context_root: contextRoot,
      total_documents: fixtureEntries.length,
      entries: fixtureEntries,
    }
    mkdirSync(path.dirname(indexPath), { recursive: true })
    writeFileSync(indexPath, JSON.stringify(tempIndex, null, 2), "utf-8")

    const block = buildContextMemoryBlock(
      {
        agentName: "planning-lead",
        agentRole: "planning-lead",
        config: {
          mission: "Coordinate the release plan",
          sprint_mode: {
            name: "v0.8.0-context-memory",
            target_release: "v0.8.0",
          },
          mcp_servers: [],
        },
        tools: [],
      },
      ["transform", "spec", "into", "backlog", "with", "clickup"],
      { MAH_CONTEXT_MEMORY: "1" }
    )

    assert.ok(block)
    assert.match(block, /Task context: transform spec into backlog with clickup/)
    assert.match(block, /clickup-backlog-triage/)
  } finally {
    restoreIndex()
  }
})
