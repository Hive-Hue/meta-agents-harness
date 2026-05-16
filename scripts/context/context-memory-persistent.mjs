import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import {
  CONTEXT_PERSISTENT_MEMORY_VERSION,
  DEFAULT_PERSISTENT_MEMORY_CHAR_LIMIT,
  DEFAULT_PERSISTENT_MEMORY_ENTRY_LIMIT,
} from "../../types/context-memory-types.mjs"

function toSafeSegment(value, fallback = "unknown") {
  const raw = `${value || ""}`.trim()
  if (!raw) return fallback
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return safe || fallback
}

function parseLimit(raw, fallback, min, max) {
  const n = Number.parseInt(`${raw ?? ""}`, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function normalizeText(value) {
  return `${value || ""}`.replace(/\s+/g, " ").trim()
}

function stripAnsi(value) {
  return `${value || ""}`.replace(/\u001b\[[0-9;]*m/g, "")
}

function normalizeSessionSignal(value) {
  return normalizeText(stripAnsi(value || ""))
}

function parseTagsInput(raw) {
  if (Array.isArray(raw)) return raw.map((tag) => normalizeText(tag)).filter(Boolean)
  return `${raw || ""}`.split(",").map((tag) => normalizeText(tag)).filter(Boolean)
}

function normalizeBlockedReason(reason = "") {
  return normalizeSessionSignal(reason)
    .replace(/\/home\/[^\s"'`]+/g, "<path>")
    .replace(/[a-zA-Z]:\\[^\s"'`]+/g, "<path>")
}

function looksLikePermissionIssue(text = "") {
  const normalized = `${text}`.toLowerCase()
  return (
    normalized.includes("permission denied")
    || normalized.includes("write permission")
    || normalized.includes("grant access")
    || normalized.includes("/permit")
    || normalized.includes("blocked by your permission")
  )
}

function pushCandidate(candidates, dedupe, content, source, tags = []) {
  const normalized = normalizeText(content)
  if (!normalized) return
  if (normalized.length < 20) return
  const key = normalized.toLowerCase()
  if (dedupe.has(key)) return
  dedupe.add(key)
  candidates.push({
    content: normalized,
    source: normalizeText(source || "session") || "session",
    tags: parseTagsInput(tags),
  })
}

function buildMemoryEntry(content, source = "manual", tags = []) {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    content: normalizeText(content),
    source: normalizeText(source) || "manual",
    tags: parseTagsInput(tags),
    created_at: now,
    updated_at: now,
    last_used_at: "",
    use_count: 0,
  }
}

function canFitEntry(store, content) {
  const usage = computePersistentMemoryUsage(store)
  if (usage.entry_count + 1 > usage.entry_limit) return false
  if (usage.used_chars + normalizeText(content).length > usage.char_limit) return false
  return true
}

function sortEntriesForEviction(entries = []) {
  const toTimestamp = (entry) => {
    const iso = entry?.last_used_at || entry?.updated_at || entry?.created_at || ""
    const ms = Date.parse(iso)
    return Number.isFinite(ms) ? ms : 0
  }
  const toUseCount = (entry) => Number.isFinite(entry?.use_count) ? Number(entry.use_count) : 0
  const toLength = (entry) => normalizeText(entry?.content || "").length

  return [...entries].sort((left, right) => {
    const leftUse = toUseCount(left)
    const rightUse = toUseCount(right)
    if (leftUse !== rightUse) return leftUse - rightUse
    const leftTs = toTimestamp(left)
    const rightTs = toTimestamp(right)
    if (leftTs !== rightTs) return leftTs - rightTs
    return toLength(right) - toLength(left)
  })
}

function sanitizeSessionSourceLabel(value = "") {
  return normalizeText(value).replace(/\s+/g, "-").toLowerCase()
}

function parseSessionReference(sessionRef = "") {
  const normalized = normalizeText(sessionRef)
  const parts = normalized.split(":")
  if (parts.length !== 3) return null
  const runtime = normalizeText(parts[0]).toLowerCase()
  const crew = normalizeText(parts[1])
  const sessionId = normalizeText(parts[2])
  if (!runtime || !crew || !sessionId) return null
  return { runtime, crew, sessionId, normalized: `${runtime}:${crew}:${sessionId}` }
}

function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
}

function scoreEntry(entry, task) {
  const taskTokens = tokenize(task)
  if (taskTokens.length === 0) return { score: 0, reasons: [] }
  const content = normalizeText(entry?.content || "").toLowerCase()
  if (!content) return { score: 0, reasons: [] }
  let overlap = 0
  for (const token of taskTokens) {
    if (content.includes(token)) overlap += 1
  }
  if (overlap === 0) return { score: 0, reasons: [] }
  const density = overlap / taskTokens.length
  const recencyBoost = entry?.last_used_at ? 0.05 : 0
  return {
    score: Math.min(1, density + recencyBoost),
    reasons: [`token overlap: ${overlap}/${taskTokens.length}`],
  }
}

function buildDefaultStore({ crew, agent, charLimit, entryLimit }) {
  return {
    schema_version: CONTEXT_PERSISTENT_MEMORY_VERSION,
    crew,
    agent,
    char_limit: charLimit,
    entry_limit: entryLimit,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    entries: [],
  }
}

export function getPersistentMemoryFilePath(repoRoot, crew = "dev", agent = "orchestrator") {
  const safeCrew = toSafeSegment(crew, "dev")
  const safeAgent = toSafeSegment(agent, "orchestrator")
  return resolve(repoRoot, ".mah", "context", "persistent", "agents", safeCrew, `${safeAgent}.memory.json`)
}

export function loadPersistentMemoryStore(repoRoot, crew = "dev", agent = "orchestrator", options = {}) {
  const filePath = getPersistentMemoryFilePath(repoRoot, crew, agent)
  const charLimit = parseLimit(
    options.charLimit ?? process.env.MAH_CONTEXT_PERSISTENT_MEMORY_CHAR_LIMIT,
    DEFAULT_PERSISTENT_MEMORY_CHAR_LIMIT,
    256,
    20000,
  )
  const entryLimit = parseLimit(
    options.entryLimit ?? process.env.MAH_CONTEXT_PERSISTENT_MEMORY_ENTRY_LIMIT,
    DEFAULT_PERSISTENT_MEMORY_ENTRY_LIMIT,
    1,
    500,
  )
  if (!existsSync(filePath)) {
    return {
      ok: true,
      exists: false,
      file_path: filePath,
      store: buildDefaultStore({ crew, agent, charLimit, entryLimit }),
    }
  }
  try {
    const raw = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") throw new Error("invalid store format")
    const entries = Array.isArray(parsed.entries) ? parsed.entries : []
    const store = {
      schema_version: CONTEXT_PERSISTENT_MEMORY_VERSION,
      crew: `${parsed.crew || crew}`.trim() || crew,
      agent: `${parsed.agent || agent}`.trim() || agent,
      char_limit: parseLimit(parsed.char_limit, charLimit, 256, 20000),
      entry_limit: parseLimit(parsed.entry_limit, entryLimit, 1, 500),
      created_at: `${parsed.created_at || new Date().toISOString()}`,
      updated_at: `${parsed.updated_at || new Date().toISOString()}`,
      entries: entries
        .map((entry) => ({
          id: `${entry?.id || randomUUID()}`.trim(),
          content: normalizeText(entry?.content || ""),
          source: `${entry?.source || "manual"}`.trim() || "manual",
          tags: Array.isArray(entry?.tags) ? entry.tags.map((tag) => normalizeText(tag)).filter(Boolean) : [],
          created_at: `${entry?.created_at || new Date().toISOString()}`,
          updated_at: `${entry?.updated_at || new Date().toISOString()}`,
          last_used_at: entry?.last_used_at ? `${entry.last_used_at}` : "",
          use_count: Number.isFinite(entry?.use_count) ? Number(entry.use_count) : 0,
        }))
        .filter((entry) => entry.content.length > 0),
    }
    return { ok: true, exists: true, file_path: filePath, store }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), file_path: filePath }
  }
}

export function computePersistentMemoryUsage(store) {
  const entries = Array.isArray(store?.entries) ? store.entries : []
  const usedChars = entries.reduce((sum, entry) => sum + normalizeText(entry?.content || "").length, 0)
  const charLimit = parseLimit(store?.char_limit, DEFAULT_PERSISTENT_MEMORY_CHAR_LIMIT, 256, 20000)
  const entryLimit = parseLimit(store?.entry_limit, DEFAULT_PERSISTENT_MEMORY_ENTRY_LIMIT, 1, 500)
  return {
    used_chars: usedChars,
    char_limit: charLimit,
    entry_count: entries.length,
    entry_limit: entryLimit,
    usage_percent: Math.min(100, Math.round((usedChars / Math.max(1, charLimit)) * 100)),
  }
}

export function savePersistentMemoryStore(repoRoot, store) {
  try {
    const filePath = getPersistentMemoryFilePath(repoRoot, store?.crew || "dev", store?.agent || "orchestrator")
    mkdirSync(dirname(filePath), { recursive: true })
    const usage = computePersistentMemoryUsage(store)
    const now = new Date().toISOString()
    const payload = {
      schema_version: CONTEXT_PERSISTENT_MEMORY_VERSION,
      crew: `${store?.crew || "dev"}`.trim(),
      agent: `${store?.agent || "orchestrator"}`.trim(),
      char_limit: usage.char_limit,
      entry_limit: usage.entry_limit,
      created_at: `${store?.created_at || now}`,
      updated_at: now,
      entries: (store?.entries || []).map((entry) => ({
        id: `${entry?.id || randomUUID()}`.trim(),
        content: normalizeText(entry?.content || ""),
        source: `${entry?.source || "manual"}`.trim() || "manual",
        tags: Array.isArray(entry?.tags) ? entry.tags.map((tag) => normalizeText(tag)).filter(Boolean) : [],
        created_at: `${entry?.created_at || now}`,
        updated_at: `${entry?.updated_at || now}`,
        last_used_at: entry?.last_used_at ? `${entry.last_used_at}` : "",
        use_count: Number.isFinite(entry?.use_count) ? Number(entry.use_count) : 0,
      })),
    }
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
    return { ok: true, file_path: filePath, usage }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function findUniqueEntryBySubstring(entries, oldText) {
  const needle = normalizeText(oldText).toLowerCase()
  if (!needle) return { ok: false, error: "old text cannot be empty" }
  const matches = entries.filter((entry) => `${entry?.content || ""}`.toLowerCase().includes(needle))
  if (matches.length === 0) return { ok: false, error: "no memory entry matches old text" }
  if (matches.length > 1) return { ok: false, error: "old text matches multiple memory entries; provide a more specific substring" }
  return { ok: true, entry: matches[0] }
}

export function addPersistentMemoryEntry(repoRoot, options = {}) {
  const crew = `${options.crew || "dev"}`.trim() || "dev"
  const agent = `${options.agent || "orchestrator"}`.trim() || "orchestrator"
  const content = normalizeText(options.content || "")
  if (!content) return { ok: false, error: "content is required" }
  const loaded = loadPersistentMemoryStore(repoRoot, crew, agent, options)
  if (!loaded.ok) return loaded
  const store = loaded.store
  const existing = store.entries.find((entry) => normalizeText(entry.content) === content)
  if (existing) {
    return {
      ok: true,
      duplicate: true,
      message: "memory already contains this exact entry",
      entry: existing,
      usage: computePersistentMemoryUsage(store),
      file_path: loaded.file_path,
    }
  }
  const usage = computePersistentMemoryUsage(store)
  if (usage.entry_count >= usage.entry_limit) {
    return {
      ok: false,
      error: `entry limit reached (${usage.entry_count}/${usage.entry_limit}). Replace or remove existing entries first.`,
      usage,
      current_entries: store.entries.map((entry) => entry.content),
    }
  }
  if (usage.used_chars + content.length > usage.char_limit) {
    return {
      ok: false,
      error: `memory at ${usage.used_chars}/${usage.char_limit} chars. Adding this entry (${content.length} chars) would exceed the limit. Replace or remove existing entries first.`,
      usage,
      current_entries: store.entries.map((entry) => entry.content),
    }
  }
  const now = new Date().toISOString()
  const entry = {
    id: randomUUID(),
    content,
    source: normalizeText(options.source || "manual") || "manual",
    tags: parseTagsInput(options.tags),
    created_at: now,
    updated_at: now,
    last_used_at: "",
    use_count: 0,
  }
  store.entries.push(entry)
  const saved = savePersistentMemoryStore(repoRoot, store)
  if (!saved.ok) return saved
  return { ok: true, duplicate: false, entry, usage: saved.usage, file_path: saved.file_path }
}

export function replacePersistentMemoryEntry(repoRoot, options = {}) {
  const crew = `${options.crew || "dev"}`.trim() || "dev"
  const agent = `${options.agent || "orchestrator"}`.trim() || "orchestrator"
  const content = normalizeText(options.content || "")
  if (!content) return { ok: false, error: "content is required" }
  const loaded = loadPersistentMemoryStore(repoRoot, crew, agent, options)
  if (!loaded.ok) return loaded
  const store = loaded.store
  const match = findUniqueEntryBySubstring(store.entries, options.old_text || options.oldText || "")
  if (!match.ok) return match
  const target = match.entry
  const previous = normalizeText(target.content)
  target.content = content
  target.updated_at = new Date().toISOString()
  target.source = normalizeText(options.source || target.source || "manual") || "manual"
  const usage = computePersistentMemoryUsage(store)
  if (usage.used_chars > usage.char_limit) {
    target.content = previous
    target.updated_at = new Date().toISOString()
    return {
      ok: false,
      error: `replacement would exceed char limit (${usage.used_chars}/${usage.char_limit}).`,
      usage,
    }
  }
  const saved = savePersistentMemoryStore(repoRoot, store)
  if (!saved.ok) return saved
  return { ok: true, entry: target, usage: saved.usage, file_path: saved.file_path }
}

export function removePersistentMemoryEntry(repoRoot, options = {}) {
  const crew = `${options.crew || "dev"}`.trim() || "dev"
  const agent = `${options.agent || "orchestrator"}`.trim() || "orchestrator"
  const loaded = loadPersistentMemoryStore(repoRoot, crew, agent, options)
  if (!loaded.ok) return loaded
  const store = loaded.store
  const match = findUniqueEntryBySubstring(store.entries, options.old_text || options.oldText || "")
  if (!match.ok) return match
  const target = match.entry
  store.entries = store.entries.filter((entry) => entry.id !== target.id)
  const saved = savePersistentMemoryStore(repoRoot, store)
  if (!saved.ok) return saved
  return { ok: true, removed: target, usage: saved.usage, file_path: saved.file_path }
}

export function compactPersistentMemoryStore(repoRoot, options = {}) {
  const crew = `${options.crew || "dev"}`.trim() || "dev"
  const agent = `${options.agent || "orchestrator"}`.trim() || "orchestrator"
  const targetPercent = parseLimit(options.targetPercent ?? options.target_percent, 80, 10, 95)
  const loaded = loadPersistentMemoryStore(repoRoot, crew, agent, options)
  if (!loaded.ok) return loaded
  const store = loaded.store
  const usageBefore = computePersistentMemoryUsage(store)
  const targetChars = Math.max(1, Math.floor((usageBefore.char_limit * targetPercent) / 100))
  const evicted = []

  if (usageBefore.used_chars <= targetChars) {
    return {
      ok: true,
      compacted: false,
      crew,
      agent,
      target_percent: targetPercent,
      usage_before: usageBefore,
      usage_after: usageBefore,
      evicted,
      file_path: loaded.file_path,
    }
  }

  const ordered = sortEntriesForEviction(store.entries)
  const toRemove = new Set()
  let usedChars = usageBefore.used_chars
  for (const entry of ordered) {
    if (usedChars <= targetChars) break
    const len = normalizeText(entry?.content || "").length
    usedChars -= len
    toRemove.add(entry.id)
    evicted.push({
      id: entry.id,
      content: entry.content,
      source: entry.source,
      use_count: entry.use_count,
    })
  }

  if (!toRemove.size) {
    return {
      ok: false,
      error: "unable to compact memory store; no removable entries found",
      usage_before: usageBefore,
      file_path: loaded.file_path,
    }
  }

  store.entries = store.entries.filter((entry) => !toRemove.has(entry.id))
  const saved = savePersistentMemoryStore(repoRoot, store)
  if (!saved.ok) return saved
  return {
    ok: true,
    compacted: true,
    crew,
    agent,
    target_percent: targetPercent,
    usage_before: usageBefore,
    usage_after: saved.usage,
    evicted,
    file_path: saved.file_path,
  }
}

export function ingestPersistentMemoryCandidates(repoRoot, options = {}) {
  const crew = `${options.crew || "dev"}`.trim() || "dev"
  const agent = `${options.agent || "orchestrator"}`.trim() || "orchestrator"
  const compact = options.compact !== false
  const loaded = loadPersistentMemoryStore(repoRoot, crew, agent, options)
  if (!loaded.ok) return loaded
  const store = loaded.store
  const candidatesRaw = Array.isArray(options.candidates) ? options.candidates : []
  const candidates = candidatesRaw
    .map((candidate) => ({
      content: normalizeText(candidate?.content || candidate || ""),
      source: normalizeText(candidate?.source || options.source || "session") || "session",
      tags: parseTagsInput(candidate?.tags || options.tags),
    }))
    .filter((candidate) => candidate.content.length > 0)

  const added = []
  const duplicates = []
  const skipped = []
  const evicted = []
  let changed = false

  const canonicalSeen = new Set(
    store.entries
      .map((entry) => normalizeText(entry.content).toLowerCase())
      .filter(Boolean)
  )

  for (const candidate of candidates) {
    const canonical = candidate.content.toLowerCase()
    if (canonicalSeen.has(canonical)) {
      duplicates.push(candidate.content)
      continue
    }

    const entry = buildMemoryEntry(candidate.content, candidate.source, candidate.tags)
    while (!canFitEntry(store, entry.content)) {
      if (!compact) {
        skipped.push({ content: entry.content, reason: "capacity reached" })
        break
      }
      const evictionTarget = sortEntriesForEviction(store.entries)[0]
      if (!evictionTarget) {
        skipped.push({ content: entry.content, reason: "capacity reached; no entries available for eviction" })
        break
      }
      store.entries = store.entries.filter((item) => item.id !== evictionTarget.id)
      evicted.push({
        id: evictionTarget.id,
        content: evictionTarget.content,
        source: evictionTarget.source,
        use_count: evictionTarget.use_count,
      })
      changed = true
    }
    if (!canFitEntry(store, entry.content)) {
      continue
    }

    store.entries.push(entry)
    canonicalSeen.add(canonical)
    added.push(entry)
    changed = true
  }

  const usageBeforeSave = computePersistentMemoryUsage(store)
  if (!changed) {
    return {
      ok: true,
      crew,
      agent,
      added,
      duplicates,
      skipped,
      evicted,
      usage: usageBeforeSave,
      file_path: loaded.file_path,
      changed: false,
    }
  }

  const saved = savePersistentMemoryStore(repoRoot, store)
  if (!saved.ok) return saved
  return {
    ok: true,
    crew,
    agent,
    added,
    duplicates,
    skipped,
    evicted,
    usage: saved.usage,
    file_path: saved.file_path,
    changed: true,
  }
}

export function extractPersistentMemoryCandidatesFromSessionPath(sessionPath, options = {}) {
  const normalizedPath = resolve(`${sessionPath || ""}`)
  if (!normalizedPath || !existsSync(normalizedPath)) {
    return { ok: false, error: `session path not found: ${sessionPath}` }
  }

  const limit = parseLimit(options.limit, 8, 1, 50)
  const sourceRef = normalizeText(options.source_ref || options.session_ref || options.source || "session")
  const source = sanitizeSessionSourceLabel(`session:${sourceRef || "unknown"}`)
  const baseTags = parseTagsInput(options.tags)
  const candidates = []
  const dedupe = new Set()
  const signals = {
    blocked_restrictions: [],
    expertise_updates: 0,
    delegate_summaries: 0,
    export_permission_mentions: 0,
    final_preview_used: false,
  }

  const push = (content, tags = []) => pushCandidate(candidates, dedupe, content, source, [...baseTags, ...tags])

  const eventsPath = join(normalizedPath, "events.jsonl")
  if (existsSync(eventsPath)) {
    const rows = readFileSync(eventsPath, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    const blockedByReason = new Map()

    for (const row of rows) {
      let event
      try {
        event = JSON.parse(row)
      } catch {
        continue
      }
      if (!event || typeof event !== "object") continue

      if (event.type === "expertise_update" && event.note) {
        const note = normalizeSessionSignal(event.note)
        const rightSide = note.includes("->") ? normalizeSessionSignal(note.split("->").pop()) : note
        if (rightSide) {
          push(`Session pattern: ${rightSide}`, ["expertise-update", `${event.target || event.agent || "agent"}`])
          signals.expertise_updates += 1
        }
      }

      if (event.type === "delegate_end" && event.summary) {
        const summary = normalizeSessionSignal(event.summary)
        if (summary && !/no concise summary returned/i.test(summary)) {
          push(`Delegation outcome pattern: ${summary}`, ["delegate-end", `${event.target || "worker"}`])
          signals.delegate_summaries += 1
        }
      }

      if (event.type === "tool_blocked" && event.reason) {
        const tool = normalizeText(event.tool || "tool")
        const reason = normalizeBlockedReason(event.reason)
        const key = `${tool}:${reason}`
        const prev = blockedByReason.get(key) || { tool, reason, count: 0 }
        prev.count += 1
        blockedByReason.set(key, prev)
      }
    }

    for (const item of blockedByReason.values()) {
      if (item.count < 2) continue
      push(
        `Repeated restriction: ${item.tool} blocked ${item.count}x (${item.reason}). Plan alternate execution path early.`,
        ["tool-blocked", item.tool],
      )
      signals.blocked_restrictions.push({ tool: item.tool, reason: item.reason, count: item.count })
    }
  }

  const indexPath = join(normalizedPath, "session_index.json")
  if (existsSync(indexPath)) {
    try {
      const index = JSON.parse(readFileSync(indexPath, "utf-8"))
      const finalPreview = normalizeSessionSignal(index?.finalPreview || "")
      if (finalPreview) {
        push(`Final session outcome: ${finalPreview}`, ["final-preview"])
        signals.final_preview_used = true
      }
      const blockedTools = Number(index?.counts?.blocked_tools || 0)
      if (blockedTools >= 2) {
        push(
          `Session reported ${blockedTools} blocked tool calls. Keep fallback execution paths ready when write tools are constrained.`,
          ["session-index", "blocked-tools"],
        )
      }
    } catch {
      // no-op
    }
  }

  const exportPath = join(normalizedPath, "session.export.json")
  if (existsSync(exportPath)) {
    try {
      const payload = JSON.parse(readFileSync(exportPath, "utf-8"))
      const messages = Array.isArray(payload?.messages) ? payload.messages : []
      let permissionMentions = 0
      const touchedFiles = new Set()
      for (const message of messages) {
        const parts = Array.isArray(message?.parts) ? message.parts : []
        for (const part of parts) {
          if (part?.type === "text" && looksLikePermissionIssue(part?.text || "")) {
            permissionMentions += 1
          }
        }
        const diffs = Array.isArray(message?.info?.summary?.diffs) ? message.info.summary.diffs : []
        for (const diff of diffs) {
          const file = normalizeText(diff?.file || "")
          if (file) touchedFiles.add(file)
        }
      }
      if (permissionMentions > 0) {
        push(
          "Runtime may require explicit write permission before file mutations. Confirm permission posture before delegating write tasks.",
          ["permissions"],
        )
        signals.export_permission_mentions = permissionMentions
      }
      if (touchedFiles.size > 0) {
        push(
          `Session export recorded file diffs (${[...touchedFiles].slice(0, 3).join(", ")}). Prefer export metadata for artifact reconciliation.`,
          ["export-diffs"],
        )
      }
    } catch {
      // no-op
    }
  }

  return {
    ok: true,
    session_path: normalizedPath,
    source,
    candidates: candidates.slice(0, limit),
    total_candidates: candidates.length,
    signals,
  }
}

export async function capturePersistentMemoryFromSession(repoRoot, options = {}) {
  const fromSession = normalizeText(options.from_session || options.session_ref || options.fromSession || "")
  const fromPath = normalizeText(options.from_path || options.session_path || options.fromPath || "")
  const limit = parseLimit(options.limit, 8, 1, 50)
  const compact = options.compact !== false
  const tags = parseTagsInput(options.tags)

  let sessionRef = fromSession
  let sessionPath = fromPath
  let defaultCrew = normalizeText(options.crew || process.env.MAH_ACTIVE_CREW || "dev") || "dev"
  let defaultAgent = normalizeText(options.agent || process.env.MAH_AGENT || "orchestrator") || "orchestrator"

  if (!sessionPath) {
    if (!sessionRef) {
      return { ok: false, error: "capture requires --from-session <runtime:crew:sessionId> or --from-path <session-dir>" }
    }
    const parsed = parseSessionReference(sessionRef)
    if (!parsed) {
      return { ok: false, error: `invalid session reference: ${sessionRef} (expected runtime:crew:sessionId)` }
    }
    const { collectSessions } = await import("../session/m3-ops.mjs")
    const { getAllRuntimes } = await import("../runtime/plugin-loader.mjs")
    const runtimeRegistry = await getAllRuntimes()
    const sessions = collectSessions(repoRoot, { runtime: parsed.runtime, crew: parsed.crew }, runtimeRegistry)
    const fallbackBySessionId = sessions.find((session) => `${session.session_id || ""}` === parsed.sessionId)
    const resolvedSession = sessions.find((session) => session.id === parsed.normalized) || fallbackBySessionId
    if (!resolvedSession) {
      return { ok: false, error: `session not found: ${sessionRef}` }
    }
    sessionPath = resolvedSession.source_path || ""
    defaultCrew = normalizeText(options.crew || resolvedSession.crew || defaultCrew) || defaultCrew
    defaultAgent = normalizeText(options.agent || resolvedSession.agent || defaultAgent) || defaultAgent
  }

  const extracted = extractPersistentMemoryCandidatesFromSessionPath(sessionPath, {
    source_ref: sessionRef || sessionPath,
    limit,
    tags,
  })
  if (!extracted.ok) return extracted

  const ingested = ingestPersistentMemoryCandidates(repoRoot, {
    crew: defaultCrew,
    agent: defaultAgent,
    candidates: extracted.candidates,
    compact,
    tags,
    source: extracted.source,
  })
  if (!ingested.ok) return ingested

  return {
    ok: true,
    crew: ingested.crew,
    agent: ingested.agent,
    source_ref: sessionRef || sessionPath,
    source_path: sessionPath,
    extraction: {
      total_candidates: extracted.total_candidates,
      selected_candidates: extracted.candidates.length,
      signals: extracted.signals,
    },
    capture: {
      added: ingested.added,
      duplicates: ingested.duplicates,
      skipped: ingested.skipped,
      evicted: ingested.evicted,
      usage: ingested.usage,
      file_path: ingested.file_path,
      changed: ingested.changed,
    },
  }
}

export function searchPersistentMemory(repoRoot, options = {}) {
  const crew = `${options.crew || "dev"}`.trim() || "dev"
  const agent = `${options.agent || "orchestrator"}`.trim() || "orchestrator"
  const task = normalizeText(options.task || "")
  const limit = parseLimit(options.limit, 5, 1, 20)
  const loaded = loadPersistentMemoryStore(repoRoot, crew, agent, options)
  if (!loaded.ok) return loaded
  const store = loaded.store
  const scored = store.entries
    .map((entry) => {
      const ranked = scoreEntry(entry, task)
      return { entry, score: ranked.score, reasons: ranked.reasons }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  const usage = computePersistentMemoryUsage(store)
  return {
    ok: true,
    crew,
    agent,
    task,
    usage,
    file_path: loaded.file_path,
    matches: scored.map((item) => ({
      id: item.entry.id,
      score: item.score,
      reasons: item.reasons,
      content: item.entry.content,
      source: item.entry.source,
      tags: item.entry.tags || [],
    })),
  }
}

export function renderPersistentMemoryBlock(repoRoot, options = {}) {
  const result = searchPersistentMemory(repoRoot, options)
  if (!result.ok) return { ok: false, error: result.error || "persistent memory search failed" }
  const lines = []
  const usage = result.usage || { used_chars: 0, char_limit: DEFAULT_PERSISTENT_MEMORY_CHAR_LIMIT, usage_percent: 0 }
  lines.push("PERSISTENT AGENT MEMORY")
  lines.push(`Store: ${result.crew}/${result.agent} [${usage.usage_percent}% — ${usage.used_chars}/${usage.char_limit} chars]`)
  if (!result.matches || result.matches.length === 0) {
    lines.push("No relevant persistent memory entries matched this task.")
    return { ok: true, block: lines.join("\n"), matches: [] }
  }
  for (const match of result.matches) {
    lines.push("§")
    lines.push(`${match.content}`)
  }
  return { ok: true, block: lines.join("\n"), matches: result.matches, usage }
}
