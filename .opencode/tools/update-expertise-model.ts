import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"
import YAML from "yaml"
import { tool } from "@opencode-ai/plugin"

type ExpertiseEntry = { date: string; note: string }
type ExpertiseDoc = {
  agent: { name: string; role: string; team: string }
  meta: { version: number; max_lines: number; last_updated: string }
  observations: ExpertiseEntry[]
  open_questions: ExpertiseEntry[]
  [key: string]: unknown
}

const DEFAULT_MAX_LINES = 120
const NOTE_MAX_CHARS = 2000
const DECAY_AFTER_DAYS = 14
const SIMILARITY_THRESHOLD = 0.55

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function normalizeAgentName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-")
}

function shortText(value: string, limit: number): string {
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > limit ? text.slice(0, limit - 3) + "..." : text
}

function toCategoryKey(category?: string): string {
  const normalized = (category || "observations").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_")
  if (!normalized) return "observations"
  if (normalized === "question") return "open_questions"
  if (normalized.endsWith("s")) return normalized
  return normalized + "s"
}

function cosineSimilarityTokens(a: string, b: string): number {
  const tokenize = (s: string): Set<string> =>
    new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean))
  const setA = tokenize(a)
  const setB = tokenize(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let dot = 0
  for (const t of setA) {
    if (setB.has(t)) dot++
  }
  return dot / (Math.sqrt(setA.size) * Math.sqrt(setB.size))
}

function notesAreSimilar(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) / Math.max(a.length, b.length, 1) > 0.7) return false
  return cosineSimilarityTokens(a, b) >= SIMILARITY_THRESHOLD
}

function daysBetweenDates(a: string, b: string): number {
  const parse = (d: string) => {
    const match = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (!match) return Date.now()
    return Date.UTC(+match[1], +match[2] - 1, +match[3])
  }
  return Math.abs(parse(a) - parse(b)) / (1000 * 60 * 60 * 24)
}

function lineCount(text: string): number {
  if (!text) return 0
  return text.split("\n").length
}

function byteCount(text: string): number {
  return Buffer.byteLength(text, "utf-8")
}

function trimAndClean(doc: ExpertiseDoc): ExpertiseDoc {
  const clone = structuredClone(doc)
  const preferred = ["open_questions", "observations", "lessons", "workflows", "patterns", "tools", "decisions", "risks"]
  const dynamic = Object.keys(clone).filter((key) => Array.isArray(clone[key]) && !preferred.includes(key))
  const allSections = [...preferred, ...dynamic]

  // Phase 1: deduplicate similar notes
  for (const section of allSections) {
    const items = clone[section] as ExpertiseEntry[]
    if (!Array.isArray(items)) continue
    const keep: ExpertiseEntry[] = []
    for (const item of items) {
      const idx = keep.findIndex((k) => notesAreSimilar(k.note, item.note))
      if (idx >= 0) {
        if (item.note.length > keep[idx].note.length || item.date >= keep[idx].date) {
          keep[idx] = item
        }
      } else {
        keep.push(item)
      }
    }
    clone[section] = keep
  }

  // Phase 2: evict stale open_questions
  const todayStr = today()
  const questions = clone["open_questions"] as ExpertiseEntry[]
  if (Array.isArray(questions)) {
    clone["open_questions"] = questions.filter((q) => daysBetweenDates(q.date, todayStr) <= DECAY_AFTER_DAYS)
  }

  // Phase 3: line + byte limit enforcement
  const maxLines = Math.min(clone.meta.max_lines || DEFAULT_MAX_LINES, 500)
  const maxBytes = 32_000
  let rendered = YAML.stringify(clone)
  const trimOrder = [...allSections]
  while ((lineCount(rendered) > maxLines || byteCount(rendered) > maxBytes) && trimOrder.length > 0) {
    const section = trimOrder.find((key) => Array.isArray(clone[key]) && (clone[key] as ExpertiseEntry[]).length > 0)
    if (!section) break
    ;(clone[section] as ExpertiseEntry[]).shift()
    rendered = YAML.stringify(clone)
  }

  return clone
}

function resolveExpertisePath(root: string, agent: string): string {
  const activeMetaPath = path.join(root, ".opencode", ".active-crew.json")
  if (existsSync(activeMetaPath)) {
    try {
      const active = JSON.parse(readFileSync(activeMetaPath, "utf-8")) as { crew?: string }
      const crew = `${active?.crew || ""}`.trim()
      if (crew) {
        return path.join(root, ".opencode", "crew", crew, "expertise", `${agent}-expertise-model.yaml`)
      }
    } catch {}
  }

  const activeAgentPrompt = path.join(root, ".opencode", "agents", `${agent}.md`)
  if (existsSync(activeAgentPrompt)) {
    const body = readFileSync(activeAgentPrompt, "utf-8")
    const match = body.match(/\.opencode\/crew\/[^/\s]+\/expertise\/[a-z0-9_-]+-expertise-model\.yaml/i)
    if (match?.[0]) {
      return path.join(root, match[0])
    }
  }

  return path.join(root, ".opencode", "expertise", `${agent}-expertise-model.yaml`)
}

export default tool({
  description: "Append a durable note to the current OpenCode agent expertise model YAML file.",
  args: {
    note: tool.schema.string().describe("Durable insight, risk, pattern, or lesson learned."),
    category: tool.schema.string().optional().describe("Optional category (observations, risks, tools, open_questions, etc)."),
    team: tool.schema.string().optional().describe("Optional team override for initial file creation.")
  },
  async execute(args, context) {
    const root = context.worktree || context.directory
    const agent = normalizeAgentName(context.agent || "unknown-agent")
    const filePath = resolveExpertisePath(root, agent)
    const expertiseDir = path.dirname(filePath)

    mkdirSync(expertiseDir, { recursive: true })

    const base: ExpertiseDoc = {
      agent: {
        name: agent,
        role: "worker",
        team: args.team || "global"
      },
      meta: {
        version: 1,
        max_lines: DEFAULT_MAX_LINES,
        last_updated: new Date().toISOString()
      },
      observations: [],
      open_questions: []
    }

    let doc = base
    if (existsSync(filePath)) {
      try {
        const parsed = YAML.parse(readFileSync(filePath, "utf-8")) as ExpertiseDoc
        if (parsed && parsed.meta && parsed.agent) doc = parsed
      } catch {
        doc = base
      }
    }

    const key = toCategoryKey(args.category)
    if (!Array.isArray(doc[key])) doc[key] = []
    ;(doc[key] as ExpertiseEntry[]).push({
      date: today(),
      note: shortText(args.note, NOTE_MAX_CHARS)
    })
    doc.meta.last_updated = new Date().toISOString()
    doc = trimAndClean(doc)
    writeFileSync(filePath, YAML.stringify(doc), "utf-8")

    return `ok agent=${agent} category=${key} path=${filePath}`
  }
})
