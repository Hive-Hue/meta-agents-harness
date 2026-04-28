import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import YAML from "yaml"
import { scoreCandidates } from "../expertise/expertise-routing.mjs"
import { buildContextMemoryExplainPayload } from "../context/context-memory-integration.mjs"
import { collectSessions, readProvenance } from "../session/m3-ops.mjs"

function readMetaConfigSafe(repoRoot) {
  try {
    const p = resolve(repoRoot, "meta-agents.yaml")
    if (!existsSync(p)) return { crews: [] }
    return YAML.parse(readFileSync(p, "utf-8")) || { crews: [] }
  } catch {
    return { crews: [] }
  }
}

/**
 * Build canonical assistant-state payload for `mah explain state`.
 * Runtime-agnostic — NO runtime execution.
 * @param {Object} ctx
 * @param {string} ctx.repoRoot
 * @param {string} ctx.crew
 * @param {string} ctx.agent
 * @param {string} ctx.task
 * @param {string} ctx.runtime
 * @returns {Object} assistant-state payload
 */
export function buildAssistantStatePayload({ repoRoot, crew, agent, task, runtime }) {
  const safeCrew = `${crew || ""}`.trim() || "unknown"
  const safeAgent = `${agent || ""}`.trim() || "unknown"
  const safeTask = `${task || ""}`.trim()
  const safeRuntime = `${runtime || ""}`.trim()

  /** @type {any} */
  let expertiseSection = { selected: null, status: "no-task" }
  /** @type {any} */
  let cmSection = { status: "disabled", matched_docs: [] }
  /** @type {any} */
  let sessionSection = { mode: "none", session_id: null }
  /** @type {any} */
  let provenanceSection = { status: "none", refs: [] }

  try {
    const meta = readMetaConfigSafe(repoRoot)
    const crews = Array.isArray(meta?.crews) ? meta.crews : []
    const crewObj = crews.find((c) => c?.id === safeCrew) || crews[0] || null
    const agents = Array.isArray(crewObj?.agents) ? crewObj.agents : []

    if (!safeTask) {
      expertiseSection = { selected: null, status: "no-task" }
    } else {
      const candidates = agents.map((a) => ({
        id: a.id,
        expertise: {
          domains: a.domains || [],
          capabilities: a.capabilities || [],
          validation_status: a.validation_status || "declared",
        }
      }))

      const scoring = scoreCandidates({
        task: safeTask,
        sourceAgent: safeAgent === "unknown" ? "orchestrator" : safeAgent,
        candidates,
        options: { allowed_environments: ["production", "staging", "development"] }
      })

      if (!scoring?.selected) {
        expertiseSection = { selected: null, status: "no-match", confidence: 0 }
      } else {
        const winner = agents.find((a) => a.id === scoring.selected) || null
        const winnerScore = scoring?.scores?.[scoring.selected]?.final_score || 0
        expertiseSection = {
          selected: scoring.selected,
          capability_hint: Array.isArray(winner?.capabilities) && winner.capabilities.length > 0 ? winner.capabilities[0] : "",
          confidence: winnerScore
        }
      }
    }
  } catch (err) {
    expertiseSection = { status: "error", error_message: err?.message || String(err) }
  }

  try {
    const cmPayload = buildContextMemoryExplainPayload(["--with-context-memory", "--task", safeTask || ""])
    cmSection = {
      status: cmPayload.status,
      matched_docs: (cmPayload.matched_docs || []).map((d) => d.id)
    }
  } catch {
    cmSection = { status: "error", matched_docs: [] }
  }

  try {
    const sessions = collectSessions(repoRoot, { runtime: safeRuntime, crew: safeCrew === "unknown" ? "" : safeCrew })
    const found = Array.isArray(sessions) && sessions.length > 0 ? sessions[0] : null
    sessionSection = found ? { mode: "continue", session_id: found.id } : { mode: "none", session_id: null }
  } catch {
    sessionSection = { mode: "error", session_id: null }
  }

  try {
    const rows = readProvenance(repoRoot, { limit: 10 })
    if (!Array.isArray(rows) || rows.length === 0) {
      provenanceSection = { status: "none", refs: [] }
    } else {
      provenanceSection = {
        status: "available",
        refs: rows.slice(0, 5).map((r) => ({ run_id: r.run_id, event: r.event, timestamp: r.timestamp || r.at || "" }))
      }
    }
  } catch {
    provenanceSection = { status: "error", refs: [] }
  }

  const notes = []
  let readinessStatus = "ready"

  if (expertiseSection.selected) notes.push(`routing selected ${expertiseSection.selected}`)
  else {
    notes.push("no routing selection")
    readinessStatus = "partial"
  }

  if (cmSection.status === "matched") notes.push(`context memory matched ${cmSection.matched_docs.length} document(s)`)
  else if (cmSection.status === "disabled") notes.push("context memory disabled")
  else notes.push(`context memory: ${cmSection.status}`)

  if (sessionSection.mode === "continue") notes.push("session continuity available")
  else notes.push("no active session")

  if (provenanceSection.status === "none") notes.push("no provenance records")

  return {
    crew: safeCrew,
    agent: safeAgent,
    runtime: safeRuntime,
    expertise: expertiseSection,
    context_memory: cmSection,
    session: sessionSection,
    provenance: provenanceSection,
    readiness: {
      status: readinessStatus,
      notes
    }
  }
}
