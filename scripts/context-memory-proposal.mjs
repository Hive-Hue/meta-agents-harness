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

// ---------------------------------------------------------------------------
// Governance helpers: YAML frontmatter parsing (no external deps)
// ---------------------------------------------------------------------------

function parseProposalFrontmatter(filePath) {
  const raw = readFileSync(filePath, "utf-8")
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith("---")) return { ok: false, error: "missing frontmatter delimiter" }
  const closeIdx = trimmed.indexOf("\n---", 3)
  if (closeIdx < 0) return { ok: false, error: "unclosed frontmatter" }
  const yamlStr = trimmed.slice(3, closeIdx)
  const body = trimmed.slice(closeIdx + 4)
  const fm = {}
  for (const line of yamlStr.split("\n")) {
    const l = line.trim()
    if (!l || l.startsWith("#")) continue
    const colonIdx = l.indexOf(":")
    if (colonIdx < 0) continue
    const key = l.slice(0, colonIdx).trim()
    let val = l.slice(colonIdx + 1).trim()
    // Strip quotes
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1)
    }
    // Handle array items ("  - value")
    if (key.startsWith("- ")) {
      // skip array items at this level — they belong to a parent key parsed above
      continue
    }
    // Simple array parsing for single-line arrays like reviewers: ["a", "b"]
    if (val.startsWith("[") && val.endsWith("]")) {
      fm[key] = val.slice(1, -1).split(",").map(s => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean)
    } else {
      fm[key] = val
    }
  }
  return { ok: true, frontmatter: fm, body, raw }
}

function writeProposalFile(filePath, frontmatter, body) {
  const lines = ["---"]
  for (const [key, val] of Object.entries(frontmatter)) {
    if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(key + ": []")
      } else {
        lines.push(key + ":")
        for (const item of val) lines.push("  - " + item)
      }
    } else {
      const strVal = String(val)
      // Quote if contains special chars
      if (strVal.includes(":") || strVal.includes("'") || strVal.includes("#") || strVal.includes("{") || strVal.includes("[")) {
        lines.push(key + ": '" + strVal.replace(/'/g, "\\'") + "'")
      } else {
        lines.push(key + ": " + strVal)
      }
    }
  }
  lines.push("---")
  lines.push(body)
  writeFileSync(filePath, lines.join("\n"), "utf-8")
}

// ---------------------------------------------------------------------------
// Governance: listProposalSummaries
// ---------------------------------------------------------------------------

export function listProposalSummaries(repoRoot) {
  const proposalsDir = join(repoRoot, ".mah", "context", "proposals")
  if (!existsSync(proposalsDir)) return []
  const results = []
  for (const file of readdirSync(proposalsDir)) {
    if (!file.endsWith(".md") || file === ".gitkeep") continue
    const filePath = join(proposalsDir, file)
    try {
      const parsed = parseProposalFrontmatter(filePath)
      if (!parsed.ok) continue
      const fm = parsed.frontmatter
      results.push({
        id: fm.id || "",
        status: fm.status || "unknown",
        proposed_document_id: fm.proposed_document_id || "",
        source_ref: fm.source_ref || "",
        generated_at: fm.generated_at || "",
        summary: fm.summary || "",
        file_path: filePath,
      })
    } catch {
      // skip unparseable
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Governance: showProposal
// ---------------------------------------------------------------------------

export function showProposal(repoRoot, proposalId) {
  const proposalsDir = join(repoRoot, ".mah", "context", "proposals")
  if (!existsSync(proposalsDir)) return { ok: false, error: "proposals directory not found" }

  for (const file of readdirSync(proposalsDir)) {
    if (!file.endsWith(".md") || file === ".gitkeep") continue
    const filePath = join(proposalsDir, file)
    try {
      const parsed = parseProposalFrontmatter(filePath)
      if (!parsed.ok) continue
      if (parsed.frontmatter.id !== proposalId) continue

      const proposal = parsed.frontmatter
      const overlaps = detectOverlaps(repoRoot, { ...proposal, file_path: filePath, body: parsed.body })
      return { ok: true, proposal, overlaps, file_path: filePath, body: parsed.body }
    } catch {
      continue
    }
  }
  return { ok: false, error: "proposal not found: " + proposalId }
}

// ---------------------------------------------------------------------------
// Governance: detectOverlaps
// ---------------------------------------------------------------------------

export function detectOverlaps(repoRoot, proposal) {
  const warnings = []
  const operationalDir = join(repoRoot, ".mah", "context", "operational")
  const proposalsDir = join(repoRoot, ".mah", "context", "proposals")

  // Parse proposed_frontmatter from body if it's there (code block)
  let proposedFm = proposal.proposed_frontmatter || {}
  if (!proposedFm.agent && proposal.body) {
    // Try to extract from ```yaml block
    const yamlMatch = proposal.body.match(/```yaml\n([\s\S]*?)```/)
    if (yamlMatch) {
      for (const line of yamlMatch[1].split("\n")) {
        const ci = line.indexOf(":")
        if (ci < 0) continue
        const k = line.slice(0, ci).trim()
        let v = line.slice(ci + 1).trim()
        if (k === "capabilities" && v.startsWith("-")) {
          proposedFm[k] = [v.replace(/^-\s*/, "").trim()]
          continue
        }
        if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
          v = v.slice(1, -1)
        }
        proposedFm[k] = v
      }
    }
  }

  // a. Same proposed_document_id in operational
  if (existsSync(operationalDir)) {
    const opFiles = scanDir(operationalDir)
    for (const opFile of opFiles) {
      try {
        const raw = readFileSync(opFile, "utf-8")
        const fm = parseSimpleFrontmatter(raw)
        if (fm.id === proposal.proposed_document_id) {
          warnings.push({
            type: "same-document-id",
            message: "operational document with same id already exists: " + fm.id,
            existing: opFile,
          })
        }
      } catch { /* skip */ }
    }
  }

  // b. Same agent + overlapping capability
  if (proposedFm.agent && proposedFm.capabilities && existsSync(operationalDir)) {
    const propCaps = normalizeCaps(proposedFm.capabilities)
    const opFiles = scanDir(operationalDir)
    for (const opFile of opFiles) {
      try {
        const raw = readFileSync(opFile, "utf-8")
        const fm = parseSimpleFrontmatter(raw)
        if (fm.agent === proposedFm.agent && Array.isArray(fm.capabilities)) {
          const overlap = normalizeCaps(fm.capabilities).filter(c => propCaps.includes(c))
          if (overlap.length > 0) {
            warnings.push({
              type: "agent-capability-overlap",
              message: "agent '" + proposedFm.agent + "' has overlapping capabilities (" + overlap.join(", ") + ") in " + (fm.id || opFile),
              existing: fm.id || opFile,
            })
          }
        }
      } catch { /* skip */ }
    }
  }

  // c. Same source session in other non-rejected proposals
  if (proposal.source_ref && existsSync(proposalsDir)) {
    for (const file of readdirSync(proposalsDir)) {
      if (!file.endsWith(".md") || file === ".gitkeep") continue
      const fp = join(proposalsDir, file)
      if (fp === (proposal.file_path || "")) continue
      try {
        const parsed = parseProposalFrontmatter(fp)
        if (!parsed.ok) continue
        const fm = parsed.frontmatter
        if (fm.source_ref === proposal.source_ref && fm.status !== "rejected") {
          warnings.push({
            type: "same-source-session",
            message: "another proposal from same source session exists: " + fm.id + " (status: " + fm.status + ")",
            existing: fm.id,
          })
        }
      } catch { /* skip */ }
    }
  }

  // d. High title/heading overlap (Levenshtein distance or substring)
  if (proposal.proposed_document_id && existsSync(operationalDir)) {
    const opFiles = scanDir(operationalDir)
    for (const opFile of opFiles) {
      try {
        const raw = readFileSync(opFile, "utf-8")
        const fm = parseSimpleFrontmatter(raw)
        if (fm.id && (fm.id.includes(proposal.proposed_document_id) || proposal.proposed_document_id.includes(fm.id))) {
          warnings.push({
            type: "title-overlap",
            message: "operational document id overlaps: " + fm.id,
            existing: fm.id,
          })
        } else if (fm.id && levenshtein(proposal.proposed_document_id, fm.id) < 3) {
          warnings.push({
            type: "title-overlap",
            message: "operational document id is near-identical (Levenshtein < 3): " + fm.id,
            existing: fm.id,
          })
        }
      } catch { /* skip */ }
    }
  }

  return warnings
}

function scanDir(dir) {
  const files = []
  try {
    function walk(d) {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (entry.name.endsWith(".md") || entry.name.endsWith(".qmd")) files.push(full)
      }
    }
    walk(dir)
  } catch { /* empty */ }
  return files
}

function parseSimpleFrontmatter(raw) {
  const fm = {}
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith("---")) return fm
  const closeIdx = trimmed.indexOf("\n---", 3)
  if (closeIdx < 0) return fm
  const yamlStr = trimmed.slice(3, closeIdx)
  for (const line of yamlStr.split("\n")) {
    const l = line.trim()
    if (!l || l.startsWith("#")) continue
    if (l.startsWith("- ")) continue
    const ci = l.indexOf(":")
    if (ci < 0) continue
    const key = l.slice(0, ci).trim()
    let val = l.slice(ci + 1).trim()
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1)
    }
    if (val.startsWith("[") && val.endsWith("]")) {
      fm[key] = val.slice(1, -1).split(",").map(s => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean)
    } else {
      fm[key] = val
    }
  }
  return fm
}

function normalizeCaps(caps) {
  if (Array.isArray(caps)) return caps.map(c => String(c).toLowerCase().trim()).filter(Boolean)
  if (typeof caps === "string") return caps.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
  return []
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
    }
  }
  return dp[m][n]
}

// ---------------------------------------------------------------------------
// Governance: promoteProposal
// ---------------------------------------------------------------------------

export async function promoteProposal(repoRoot, proposalId, stability = "curated", options = {}) {
  const proposalsDir = join(repoRoot, ".mah", "context", "proposals")
  const operationalDir = join(repoRoot, ".mah", "context", "operational")

  if (!existsSync(proposalsDir)) return { ok: false, error: "proposals directory not found" }

  // Find proposal
  let targetFile = null
  let parsed = null
  for (const file of readdirSync(proposalsDir)) {
    if (!file.endsWith(".md") || file === ".gitkeep") continue
    const filePath = join(proposalsDir, file)
    try {
      const p = parseProposalFrontmatter(filePath)
      if (!p.ok) continue
      if (p.frontmatter.id !== proposalId) continue
      targetFile = filePath
      parsed = p
      break
    } catch { continue }
  }

  if (!targetFile) return { ok: false, error: "proposal not found: " + proposalId }

  const fm = parsed.frontmatter

  // Status guard
  if (fm.status !== "draft" && fm.status !== "reviewed") {
    return { ok: false, error: "proposal status is '" + fm.status + "' (must be draft or reviewed)" }
  }

  // Run validation
  const { validateContextMemoryProposal } = await import("./context-memory-validate.mjs")
  const proposalObj = {
    proposal_version: fm.proposal_version,
    id: fm.id,
    status: fm.status,
    generated_at: fm.generated_at,
    source_type: fm.source_type === "session" ? "derived" : fm.source_type,
    source_ref: fm.source_ref,
    proposed_document_id: fm.proposed_document_id,
    proposed_frontmatter: {},
    proposed_content: parsed.body,
    summary: fm.summary || "proposal promotion",
    rationale: fm.summary || "promote proposal to operational context",
    reviewers: fm.reviewers || ["orchestrator"],
    existing_refs: [],
  }
  const vr = validateContextMemoryProposal(proposalObj, true)
  if (!vr.valid) {
    return { ok: false, error: "proposal validation failed: " + vr.errors.join("; ") }
  }

  // Path traversal check
  const docId = fm.proposed_document_id || ""
  if (!docId || /[.]{2}|\/|\\|\0/.test(docId)) {
    return { ok: false, error: "invalid proposed_document_id (path traversal or empty)" }
  }

  // Overlap detection
  const overlaps = detectOverlaps(repoRoot, { ...fm, file_path: targetFile, body: parsed.body })
  if (overlaps.length > 0 && !options.force) {
    return { ok: false, error: "overlaps detected. Use --force to override.", overlaps }
  }

  // Build target path — use docId segments to create subdirectories
  const segments = docId.split("/")
  const targetFileName = segments.pop() + ".md"
  const targetDir = join(operationalDir, ...segments)
  const targetPath = join(targetDir, targetFileName)

  // No overwrite without force
  if (existsSync(targetPath) && !options.force) {
    return { ok: false, error: "target file already exists: " + targetPath + ". Use --force to overwrite." }
  }

  // Extract proposed document from body
  const body = parsed.body || ""
  let docFrontmatter = {}
  let docContent = body

  // Try to extract ```yaml block
  const yamlMatch = body.match(/```yaml\n([\s\S]*?)```/)
  if (yamlMatch) {
    for (const line of yamlMatch[1].split("\n")) {
      const ci = line.indexOf(":")
      if (ci < 0) continue
      const k = line.slice(0, ci).trim()
      let v = line.slice(ci + 1).trim()
      if (k === "capabilities" && v.startsWith("-")) {
        docFrontmatter[k] = [v.replace(/^-\s*/, "").trim()]
        // Parse subsequent lines
        continue
      }
      if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
        v = v.slice(1, -1)
      }
      docFrontmatter[k] = v
    }
    // Content is everything after the yaml block
    const afterYaml = body.indexOf("```", body.indexOf("```", body.indexOf("```yaml")) + 3)
    if (afterYaml > 0) {
      docContent = body.slice(afterYaml + 3).trim()
    }
  }

  // Normalize extracted frontmatter for legacy proposal shapes
  if (!Array.isArray(docFrontmatter.capabilities) || docFrontmatter.capabilities.length === 0) {
    const capMatch = body.match(/capabilities:\s*\n([\s\S]*?)(?:\n\w[\w-]*:\s|$)/)
    if (capMatch) {
      const caps = capMatch[1]
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) => line.replace(/^-\s*/, "").replace(/^['"]|['"]$/g, "").trim())
        .filter(Boolean)
      if (caps.length > 0) docFrontmatter.capabilities = caps
    }
  }
  if (!Array.isArray(docFrontmatter.capabilities) || docFrontmatter.capabilities.length === 0) {
    docFrontmatter.capabilities = ["general"]
  }

  if (typeof docFrontmatter.id !== "string" || !docFrontmatter.id.includes("/")) {
    const agentSegment = String(docFrontmatter.agent || "agent").toLowerCase().replace(/[^a-z0-9-]/g, "-")
    const docSegment = String(fm.proposed_document_id || "operational-memory").toLowerCase().replace(/[^a-z0-9-]/g, "-")
    docFrontmatter.id = `dev/${agentSegment}/${docSegment}`
  }

  if (docFrontmatter.source_type === "proposal") {
    docFrontmatter.source_type = "derived"
  }

  // Set stability
  docFrontmatter.stability = stability

  // Validate proposed document
  const { validateContextMemoryDocument } = await import("./context-memory-validate.mjs")
  const docVr = validateContextMemoryDocument(docFrontmatter, true)
  if (!docVr.valid) {
    return { ok: false, error: "proposed document validation failed: " + docVr.errors.join("; ") }
  }

  // Write operational document
  mkdirSync(targetDir, { recursive: true })
  const docLines = ["---"]
  for (const [key, val] of Object.entries(docFrontmatter)) {
    if (Array.isArray(val)) {
      if (val.length === 0) {
        docLines.push(key + ": []")
      } else {
        docLines.push(key + ":")
        for (const item of val) docLines.push("  - " + item)
      }
    } else {
      docLines.push(key + ": " + String(val))
    }
  }
  docLines.push("---")
  docLines.push("")
  docLines.push(docContent)
  writeFileSync(targetPath, docLines.join("\n"), "utf-8")

  // Update proposal status
  const newFm = { ...fm }
  newFm.status = "promoted"
  newFm.promoted_at = new Date().toISOString()
  newFm.promoted_to = targetPath
  writeProposalFile(targetFile, newFm, parsed.body)

  return { ok: true, target_path: targetPath, overlaps }
}

// ---------------------------------------------------------------------------
// Governance: rejectProposal
// ---------------------------------------------------------------------------

export function rejectProposal(repoRoot, proposalId, reason) {
  const proposalsDir = join(repoRoot, ".mah", "context", "proposals")
  if (!existsSync(proposalsDir)) return { ok: false, error: "proposals directory not found" }

  for (const file of readdirSync(proposalsDir)) {
    if (!file.endsWith(".md") || file === ".gitkeep") continue
    const filePath = join(proposalsDir, file)
    try {
      const parsed = parseProposalFrontmatter(filePath)
      if (!parsed.ok) continue
      if (parsed.frontmatter.id !== proposalId) continue

      const fm = parsed.frontmatter
      if (fm.status !== "draft" && fm.status !== "reviewed") {
        return { ok: false, error: "proposal status is '" + fm.status + "' (must be draft or reviewed)" }
      }

      const newFm = { ...fm }
      newFm.status = "rejected"
      newFm.rejected_at = new Date().toISOString()
      newFm.rejection_reason = reason || "no reason provided"
      writeProposalFile(filePath, newFm, parsed.body)

      return { ok: true, file_path: filePath }
    } catch { continue }
  }

  return { ok: false, error: "proposal not found: " + proposalId }
}
