import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { mkdtempSync, readFileSync } from "node:fs"
import os from "node:os"
import { appendProvenance } from "../scripts/m3-ops.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")

function runJson(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf-8"
  })
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json: JSON.parse(result.stdout || "{}")
  }
}

test("sessions --json returns stable shape", () => {
  const result = runJson(["sessions", "--json"])
  assert.equal(result.status, 0, result.stderr)
  assert.ok(Array.isArray(result.json.sessions))
})

test("graph --json returns topology and run graph shape", () => {
  const result = runJson(["graph", "--json"])
  assert.equal(result.status, 0, result.stderr)
  assert.ok(Array.isArray(result.json.topology?.nodes))
  assert.ok(Array.isArray(result.json.topology?.edges))
  assert.ok(Array.isArray(result.json.run?.nodes))
  assert.ok(Array.isArray(result.json.run?.edges))
})

test("graph --mermaid returns flowchart syntax", () => {
  const result = spawnSync(process.execPath, [cliPath, "graph", "--mermaid"], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf-8"
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^flowchart LR/m)
  assert.match(result.stdout, /subgraph tier_1\[Leads\]/)
  assert.match(result.stdout, /subgraph tier_2\[Workers\]/)
  assert.match(result.stdout, /subgraph tier_0\[Orchestrator\]/)
  const idxLeads = result.stdout.indexOf("subgraph tier_1[Leads]")
  const idxWorkers = result.stdout.indexOf("subgraph tier_2[Workers]")
  const idxOrch = result.stdout.indexOf("subgraph tier_0[Orchestrator]")
  assert.ok(idxLeads !== -1 && idxWorkers !== -1 && idxOrch !== -1)
  assert.ok(idxOrch > idxWorkers)
  assert.match(result.stdout, /-->\|can delegate\|/)
  assert.doesNotMatch(result.stdout, /-->\|can report\|/)
})

test("graph --mermaid supports basic and group detail levels", () => {
  const basic = spawnSync(process.execPath, [cliPath, "graph", "--mermaid", "--mermaid-level", "basic"], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf-8"
  })
  assert.equal(basic.status, 0, basic.stderr)
  assert.match(basic.stdout, /m_orchestrator/)
  assert.match(basic.stdout, /m_leads/)
  assert.match(basic.stdout, /m_workers/)

  const group = spawnSync(process.execPath, [cliPath, "graph", "--mermaid", "--mermaid-level", "group"], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf-8"
  })
  assert.equal(group.status, 0, group.stderr)
  assert.match(group.stdout, /subgraph tier_1\[Teams\]/)
  assert.match(group.stdout, /grp_planning/)
  assert.match(group.stdout, /grp_engineering/)
  assert.match(group.stdout, /grp_validation/)
})

test("graph --mermaid detailed can render capabilities with legend and colors", () => {
  const result = spawnSync(
    process.execPath,
    [cliPath, "graph", "--crew", "dev", "--mermaid", "--mermaid-level", "detailed", "--mermaid-capabilities"],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf-8"
    }
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /subgraph lead_skill\[Skills\]/)
  assert.match(result.stdout, /subgraph lead_mcp\[MCPs\]/)
  assert.match(result.stdout, /subgraph worker_skill\[Skills\]/)
  assert.match(result.stdout, /subgraph workers_mcp\[MCPs\]/)
  assert.match(result.stdout, /expertise-model/)
  assert.match(result.stdout, /classDef orchestrator/)
  assert.match(result.stdout, /classDef skillNode/)
  assert.match(result.stdout, /subgraph legend\[Legend\]/)
  assert.doesNotMatch(result.stdout, /\|uses skills\|/)
  assert.doesNotMatch(result.stdout, /\|uses MCP\|/)
})

test("provenance retention keeps most recent lines and compacts old entries", () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "mah-prov-"))
  process.env.MAH_PROVENANCE_MAX_LINES = "2"
  process.env.MAH_PROVENANCE_MAX_DAYS = "3650"
  appendProvenance(tempRoot, { run_id: "a", runtime: "pi", command: "run" })
  appendProvenance(tempRoot, { run_id: "b", runtime: "pi", command: "run" })
  appendProvenance(tempRoot, { run_id: "c", runtime: "pi", command: "run" })
  const filePath = path.join(tempRoot, ".mah", "provenance.jsonl")
  const lines = readFileSync(filePath, "utf-8").trim().split("\n")
  assert.equal(lines.length, 2)
  const parsed = lines.map((line) => JSON.parse(line))
  assert.equal(parsed[0].run_id, "b")
  assert.equal(parsed[1].run_id, "c")
})
