import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

import { buildOperationalIndex } from "../scripts/context/context-memory-schema.mjs"
import { buildContextMemoryExplainPayload } from "../scripts/context/context-memory-integration.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const contextRoot = path.join(repoRoot, ".mah", "context")
const indexPath = path.join(contextRoot, "index", "operational-context.index.json")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")

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

function run(args, options = {}) {
  const env = { ...process.env, ...(options.env || {}) }
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf-8"
  })
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" }
}

test("buildContextMemoryExplainPayload: disabled when flag absent", () => {
  const result = buildContextMemoryExplainPayload([])
  assert.equal(result.enabled, false)
  assert.equal(result.status, "disabled")
})

test("buildContextMemoryExplainPayload: matched with enabled context memory", () => {
  const restoreIndex = snapshotFile(indexPath)
  try {
    buildOperationalIndex(contextRoot, { rebuild: true })
    const result = buildContextMemoryExplainPayload([
      "--with-context-memory",
      "--task",
      "transform spec into backlog with clickup"
    ])
    assert.equal(result.enabled, true)
    assert.equal(result.status, "matched")
    assert.equal(Array.isArray(result.matched_docs), true)
    assert.equal(result.matched_docs.length > 0, true)
    assert.ok(result.matched_docs[0].id)
    assert.equal(Array.isArray(result.matched_docs[0].reasons), true)
  } finally {
    restoreIndex()
  }
})

test("buildContextMemoryExplainPayload: missing-corpus when index unavailable", () => {
  const contextBackup = path.join(repoRoot, ".mah", "context.__bak_test")
  const hadContext = existsSync(contextRoot)
  try {
    if (existsSync(contextBackup)) rmSync(contextBackup, { recursive: true, force: true })
    if (hadContext) renameSync(contextRoot, contextBackup)
    mkdirSync(contextRoot, { recursive: true })

    const result = buildContextMemoryExplainPayload(["--with-context-memory", "--task", "test"])
    assert.equal(result.enabled, true)
    assert.equal(result.status, "missing-corpus")
  } finally {
    rmSync(contextRoot, { recursive: true, force: true })
    if (hadContext && existsSync(contextBackup)) renameSync(contextBackup, contextRoot)
  }
})

test("buildContextMemoryExplainPayload: no-match when index has non-matching draft docs", () => {
  const restoreIndex = snapshotFile(indexPath)
  try {
    mkdirSync(path.dirname(indexPath), { recursive: true })
    writeFileSync(indexPath, JSON.stringify({
      schema_version: "mah.context-memory.index.v1",
      generated_at: new Date().toISOString(),
      context_root: contextRoot,
      total_documents: 1,
      entries: [
        {
          id: "test/no-match",
          file_path: ".mah/context/operational/dev/test/no-match.md",
          sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          tags: [],
          headings: [],
          metadata_summary: {
            crew: "dev",
            agent: "planning-lead",
            capabilities: [],
            tools: [],
            systems: [],
            task_patterns: [],
            stability: "draft"
          }
        }
      ]
    }, null, 2), "utf-8")

    const result = buildContextMemoryExplainPayload(["--with-context-memory", "--task", "nothing relevant here"])
    assert.equal(result.enabled, true)
    assert.equal(result.status, "no-match")
  } finally {
    restoreIndex()
  }
})

test("mah explain run --with-context-memory --json includes context_memory block", () => {
  const result = run([
    "--runtime", "hermes",
    "explain", "run",
    "--crew", "dev",
    "--with-context-memory",
    "--task", "transform spec into backlog with clickup",
    "--json"
  ])
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout)
  const payload = parsed?.data?.payload || parsed
  assert.ok(payload.context_memory)
  assert.equal(typeof payload.context_memory.enabled, "boolean")
  assert.ok(payload.context_memory.status)
})
