import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  getPersistentMemoryFilePath,
  loadPersistentMemoryStore,
  savePersistentMemoryStore,
  addPersistentMemoryEntry,
  replacePersistentMemoryEntry,
  removePersistentMemoryEntry,
  searchPersistentMemory,
  compactPersistentMemoryStore,
  extractPersistentMemoryCandidatesFromSessionPath,
  capturePersistentMemoryFromSession,
} from "../scripts/context/context-memory-persistent.mjs"
import { buildContextMemoryBlock } from "../scripts/context/context-memory-integration.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

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

test("persistent memory CRUD + search semantics", () => {
  const crew = "dev"
  const agent = "persistent-test-agent"
  const filePath = getPersistentMemoryFilePath(repoRoot, crew, agent)
  const restore = snapshotFile(filePath)

  try {
    const loaded = loadPersistentMemoryStore(repoRoot, crew, agent)
    assert.equal(loaded.ok, true)
    assert.equal(Array.isArray(loaded.store.entries), true)

    const addOne = addPersistentMemoryEntry(repoRoot, {
      crew,
      agent,
      content: "Project uses ClickUp MCP for backlog triage.",
      source: "test",
      tags: ["clickup", "backlog"],
    })
    assert.equal(addOne.ok, true)
    assert.equal(addOne.duplicate, false)

    const addDup = addPersistentMemoryEntry(repoRoot, {
      crew,
      agent,
      content: "Project uses ClickUp MCP for backlog triage.",
      source: "test",
    })
    assert.equal(addDup.ok, true)
    assert.equal(addDup.duplicate, true)

    const replaced = replacePersistentMemoryEntry(repoRoot, {
      crew,
      agent,
      old_text: "ClickUp MCP",
      content: "Project uses ClickUp MCP + milestones cadence for backlog triage.",
      source: "test",
    })
    assert.equal(replaced.ok, true)

    const searched = searchPersistentMemory(repoRoot, {
      crew,
      agent,
      task: "triage backlog and plan milestones",
      limit: 3,
    })
    assert.equal(searched.ok, true)
    assert.ok(searched.matches.length > 0)
    assert.match(searched.matches[0].content, /milestones cadence/i)

    const removed = removePersistentMemoryEntry(repoRoot, {
      crew,
      agent,
      old_text: "milestones cadence",
    })
    assert.equal(removed.ok, true)

    const afterRemoval = searchPersistentMemory(repoRoot, {
      crew,
      agent,
      task: "triage backlog and plan milestones",
      limit: 3,
    })
    assert.equal(afterRemoval.ok, true)
    assert.equal(afterRemoval.matches.length, 0)
  } finally {
    restore()
  }
})

test("buildContextMemoryBlock includes persistent memory slice when available", () => {
  const crew = "dev"
  const agent = "persistent-bootstrap-agent"
  const filePath = getPersistentMemoryFilePath(repoRoot, crew, agent)
  const restore = snapshotFile(filePath)

  try {
    const add = addPersistentMemoryEntry(repoRoot, {
      crew,
      agent,
      content: "Always run backlog triage with dependency ordering first.",
      source: "test",
    })
    assert.equal(add.ok, true)

    const block = buildContextMemoryBlock(
      {
        agentName: agent,
        agentRole: "worker",
        config: {
          crew,
          mission: "Test persistent memory runtime injection",
          sprint_mode: { name: "v-test", target_release: "v-test" },
          mcp_servers: [],
        },
        tools: [],
      },
      ["--task", "triage backlog with dependencies"],
      { MAH_CONTEXT_MEMORY: "1" },
    )

    assert.ok(block)
    assert.match(block, /PERSISTENT AGENT MEMORY/)
    assert.match(block, /dependency ordering first/i)
  } finally {
    restore()
  }
})

test("extractPersistentMemoryCandidatesFromSessionPath captures durable session signals", () => {
  const tempSessionDir = mkdtempSync(path.join(os.tmpdir(), "mah-context-memory-session-"))
  try {
    const events = [
      {
        type: "tool_blocked",
        tool: "bash",
        reason: "bash upsert access denied for /home/alysson/Github/meta-agents-harness/dummy.md",
      },
      {
        type: "tool_blocked",
        tool: "bash",
        reason: "bash upsert access denied for /home/alysson/Github/meta-agents-harness/dummy.md",
      },
      {
        type: "expertise_update",
        target: "backend-dev",
        note: "bash only task -> Known pattern: use script-file approach when direct write is blocked.",
      },
      {
        type: "delegate_end",
        summary: "Dummy.md created successfully via backend-dev script-file approach.",
      },
    ]
    writeFileSync(path.join(tempSessionDir, "events.jsonl"), `${events.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf-8")
    writeFileSync(path.join(tempSessionDir, "session_index.json"), JSON.stringify({
      finalPreview: "Dummy.md created with verification.",
      counts: { blocked_tools: 3 },
    }, null, 2), "utf-8")
    writeFileSync(path.join(tempSessionDir, "session.export.json"), JSON.stringify({
      messages: [
        {
          parts: [
            {
              type: "text",
              text: "I don't have write permission for that location yet. Run /permit.",
            },
          ],
          info: {
            summary: {
              diffs: [{ file: "dummy.md" }],
            },
          },
        },
      ],
    }, null, 2), "utf-8")

    const extracted = extractPersistentMemoryCandidatesFromSessionPath(tempSessionDir, {
      source_ref: "pi:dev:test-session",
      limit: 10,
      tags: "session,test",
    })

    assert.equal(extracted.ok, true)
    assert.ok(extracted.candidates.length > 0)
    assert.equal(extracted.signals.expertise_updates > 0, true)
    assert.equal(extracted.signals.delegate_summaries > 0, true)
    assert.equal(extracted.signals.export_permission_mentions > 0, true)
    assert.ok(
      extracted.candidates.some((item) => /repeated restriction/i.test(item.content)),
      "expected repeated restriction memory candidate",
    )
    assert.ok(
      extracted.candidates.some((item) => /script-file approach/i.test(item.content)),
      "expected expertise update candidate",
    )
  } finally {
    rmSync(tempSessionDir, { recursive: true, force: true })
  }
})

test("capturePersistentMemoryFromSession ingests candidates and compacts when needed", async () => {
  const crew = "dev"
  const agent = "persistent-capture-agent"
  const filePath = getPersistentMemoryFilePath(repoRoot, crew, agent)
  const restoreStore = snapshotFile(filePath)
  const sessionId = `test-capture-${Date.now()}`
  const sessionDir = path.join(repoRoot, ".kilo", "crew", crew, "sessions", sessionId)

  try {
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(path.join(sessionDir, "session.export.json"), JSON.stringify({
      info: {
        title: "capture test",
        summary: { files: 1, additions: 2, deletions: 0 },
      },
      messages: [
        {
          parts: [
            {
              type: "text",
              text: "I don't have write permission for that location yet. Run /permit.",
            },
          ],
          info: {
            summary: {
              diffs: [{ file: "dummy.md" }],
            },
          },
        },
      ],
    }, null, 2), "utf-8")
    writeFileSync(path.join(sessionDir, "session_index.json"), JSON.stringify({
      finalPreview: "Created dummy.md after fallback approach.",
      counts: { blocked_tools: 2 },
    }, null, 2), "utf-8")
    writeFileSync(path.join(sessionDir, "events.jsonl"), `${JSON.stringify({
      type: "expertise_update",
      target: "backend-dev",
      note: "task failed first -> Known pattern: prefer script-file fallback for constrained writes.",
    })}\n`, "utf-8")

    const seedStore = {
      crew,
      agent,
      char_limit: 120,
      entry_limit: 2,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      entries: [
        {
          id: "seed-1",
          content: "Seed entry one occupying space.",
          source: "test",
          tags: ["seed"],
          use_count: 0,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          last_used_at: "",
        },
        {
          id: "seed-2",
          content: "Seed entry two occupying more room.",
          source: "test",
          tags: ["seed"],
          use_count: 0,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          last_used_at: "",
        },
      ],
    }
    const seeded = savePersistentMemoryStore(repoRoot, seedStore)
    assert.equal(seeded.ok, true)

    const captured = await capturePersistentMemoryFromSession(repoRoot, {
      from_session: `kilo:${crew}:${sessionId}`,
      crew,
      agent,
      limit: 2,
      compact: true,
      tags: "captured",
    })
    assert.equal(captured.ok, true)
    assert.ok(captured.capture.added.length > 0, "expected new persistent memory entries")
    assert.ok(captured.capture.evicted.length > 0, "expected compaction to evict at least one entry")
    assert.equal(captured.capture.usage.used_chars <= captured.capture.usage.char_limit, true)
    assert.equal(captured.capture.usage.entry_count <= captured.capture.usage.entry_limit, true)

    const compacted = compactPersistentMemoryStore(repoRoot, {
      crew,
      agent,
      target_percent: 70,
    })
    assert.equal(compacted.ok, true)
    assert.equal(compacted.usage_after.used_chars <= compacted.usage_before.used_chars, true)
  } finally {
    restoreStore()
    rmSync(sessionDir, { recursive: true, force: true })
  }
})
