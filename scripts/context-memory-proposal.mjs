/**
 * MAH Context Memory Proposal Generator
 * @fileoverview Derive memory proposals from sessions and provenance
 * @version 0.8.0
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, basename } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { parseSessionId, collectSessions } from "./m3-ops.mjs"
import { CONTEXT_MEMORY_PROPOSAL_VERSION } from "../types/context-memory-types.mjs"

export function findSession(repoRoot, sessionIdFull) {
  const parsed = parseSessionId(sessionIdFull)
  if (!parsed) return { ok: false, error: "invalid session ID format: " + sessionIdFull }
  const sessions = collectSessions(repoRoot, { runtime: parsed.runtime, crew: parsed.crew })
  const session = sessions.find((s) => s.id === sessionIdFull)
  if (!session) return { ok: false, error: "session not found: " + sessionIdFull }
  return { ok: true, session }
}

function extractSessionSignals(session) {
  const signals = []
  const capabilityHints = []
  const summary = (session.summary || "").trim()
  if (summary) signals.push("Session summary: " + summary)
  if (session.crew) signals.push("Crew: " + session.crew)
  if (session.runtime) signals.push("Runtime: " + session.runtime)
  if (session.last_active_at) signals.push("Last active: " + session.last_active_at)
  const keywords = ["backlog", "planning", "implementation", "review", "routing", "expertise", "context", "memory", "delegate", "coordination"]
  for (const kw of keywords) {
    if (summary.toLowerCase().includes(kw)) capabilityHints.push(kw.replace(/-/g, "_"))
  }
  return { signals, agent: session.agent || null, capability_hints: [...new Set(capabilityHints)] }
}

function deriveProposedId(agent, capabilityHints, crew) {
  const cap = (capabilityHints[0] || "operational").replace(/[^a-z]/g, "")
  const date = new Date().toISOString().slice(0, 10)
  const rand = randomUUID().slice(0, 6)
  return crew + "/" + (agent || "agent") + "/" + cap + "/" + date + "-" + cap + "-" + rand
}

function deriveSummary(signals) {
  const s = signals.find(x => x.startsWith("Session summary:")) || ""
  const text = s.replace("Session summary: ", "")
  return text.length > 120 ? text.slice(0, 117) + "..." : text
}

function deriveRationale(session, signals) {
  const parts = []
  parts.push("Derived from session: " + (session.id || "unknown"))
  if (session.crew) parts.push("Crew: " + session.crew)
  if (session.runtime) parts.push("Runtime: " + session.runtime)
  if (session.last_active_at) parts.push("Last active: " + session.last_active_at)
  parts.push("")
  parts.push("Key signals:")
  for (const sig of signals.slice(0, 5)) parts.push("- " + sig)
  return parts.join("\n")
}

export function proposeFromSession(repoRoot, sessionIdFull) {
  const { ok, session, error } = findSession(repoRoot, sessionIdFull)
  if (!ok) return { ok: false, error }
  const { signals, agent, capability_hints } = extractSessionSignals(session)
  const proposalId = randomUUID()
  const proposedId = deriveProposedId(agent, capability_hints, session.crew || "dev")
  const summary = deriveSummary(signals)
  const rationale = deriveRationale(session, signals)
  const proposedFrontmatter = {
    id: proposedId, kind: "operational-memory",
    crew: session.crew || "dev",
    agent: agent || (session.crew ? session.crew + "-lead" : "agent"),
    capabilities: capability_hints.length > 0 ? capability_hints : ["general"],
    stability: "draft", source_type: "derived",
    last_reviewed_at: new Date().toISOString().slice(0, 10),
  }
  const summarySignal = signals.find(x => x.startsWith("Session summary:")) || ""
  const bodyContent = summarySignal ? "# Operational Pattern\n\n" + summarySignal.replace("Session summary: ", "") : "# Operational Pattern\n\nOperational memory derived from session."
  const proposal = {
    proposal_version: CONTEXT_MEMORY_PROPOSAL_VERSION,
    id: proposalId, status: "draft",
    generated_at: new Date().toISOString(),
    source_type: "session", source_ref: sessionIdFull,
    proposed_document_id: proposedId,
    proposed_frontmatter: proposedFrontmatter,
    proposed_content: bodyContent,
    summary, rationale, reviewers: ["orchestrator"], existing_refs: [],
  }
  return { ok: true, proposal, signals }
}

export function writeProposal(repoRoot, proposal) {
  const proposalsDir = join(repoRoot, ".mah", "context", "proposals")
  try { mkdirSync(proposalsDir, { recursive: true }) } catch (e) { return { ok: false, error: e.message } }
  const date = new Date().toISOString().slice(0, 10)
  const cap = (proposal.proposed_frontmatter?.capabilities?.[0] || "general").replace(/[^a-z0-9]/g, "-")
  const shortHash = createHash("sha256").update(proposal.id).digest("hex").slice(0, 8)
  const filename = date + "-" + cap + "-" + shortHash + ".md"
  const filePath = join(proposalsDir, filename)
  const fm = proposal.proposed_frontmatter || {}
  const lines = [
    "---",
    "proposal_version: '" + proposal.proposal_version + "'",
    "id: '" + proposal.id + "'",
    "status: " + proposal.status,
    "generated_at: " + proposal.generated_at,
    "source_type: " + proposal.source_type,
    "source_ref: " + proposal.source_ref,
    "proposed_document_id: " + proposal.proposed_document_id,
    "summary: '" + proposal.summary.replace(/'/g, "\\'") + "'",
    "reviewers:",
  ]
  for (const r of (proposal.reviewers || [])) lines.push("  - " + r)
  lines.push("---")
  lines.push("")
  lines.push("## Proposed Document")
  lines.push("")
  lines.push("```yaml")
  lines.push("id: " + (fm.id || "unknown"))
  lines.push("Kind: " + (fm.kind || "operational-memory"))
  lines.push("crew: " + (fm.crew || "dev"))
  lines.push("agent: " + (fm.agent || "agent"))
  lines.push("capabilities:")
  for (const c of (fm.capabilities || [])) lines.push("  - " + c)
  lines.push("stability: " + (fm.stability || "draft"))
  lines.push("source_type: " + (fm.source_type || "derived"))
  lines.push("```")
  lines.push("")
  lines.push("## Rationale")
  lines.push("")
  for (const line of (proposal.rationale || "").split("\n")) lines.push(line)
  lines.push("")
  lines.push("## Source")
  lines.push("")
  lines.push("- Type: " + proposal.source_type)
  lines.push("- Ref: " + proposal.source_ref)
  lines.push("")
  lines.push(proposal.proposed_content || "")
  try {
    writeFileSync(filePath, lines.join("\n"), "utf-8")
    return { ok: true, file_path: filePath, proposal }
  } catch (e) { return { ok: false, error: e.message } }
}

export function listProposals(repoRoot) {
  const proposalsDir = join(repoRoot, ".mah", "context", "proposals")
  if (!existsSync(proposalsDir)) return []
  const results = []
  try {
    for (const file of readdirSync(proposalsDir)) {
      if (file.endsWith(".md")) results.push({ id: file.replace(/\.md$/, ""), file_path: join(proposalsDir, file) })
    }
  } catch {}
  return results
}
