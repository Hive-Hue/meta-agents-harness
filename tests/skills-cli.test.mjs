import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import os from "node:os"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import YAML from "yaml"

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")
const fixturePath = path.join(repoRoot, "tests", "fixtures", "minimal-config.yaml")

function runSkills(args = [], cwd = repoRoot) {
  return spawnSync(process.execPath, [cliPath, "skills", ...args], {
    cwd,
    encoding: "utf-8",
    env: process.env,
  })
}

test("mah skills --help shows command usage", () => {
  const result = runSkills(["--help"])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /mah skills/)
  assert.match(result.stdout, /add <skill> --agent/)
})

test("mah skills list --json returns a skill list", () => {
  const result = runSkills(["list", "--json"])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.ok(Array.isArray(payload.skills))
  assert.ok(payload.skills.length > 0)
})

test("mah skills inspect returns metadata for known skill", () => {
  const result = runSkills(["inspect", "delegate-bounded", "--json"])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.skill, "delegate-bounded")
  assert.match(payload.file_path, /SKILL\.md$/)
})

test("mah skills add/remove updates meta-agents.yaml when --config is provided", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mah-skills-cli-"))
  const configPath = path.join(tmp, "meta-agents.yaml")
  writeFileSync(configPath, readFileSync(fixturePath, "utf-8"), "utf-8")

  const addResult = runSkills(["add", "stitch-react-handoff", "--agent", "repo-analyst", "--crew", "test-crew", "--config", configPath, "--json"], tmp)
  assert.equal(addResult.status, 0, addResult.stderr)
  const addPayload = JSON.parse(addResult.stdout)
  assert.equal(addPayload.changed, true)

  let updated = YAML.parse(readFileSync(configPath, "utf-8"))
  let repoAnalyst = updated.crews[0].agents.find((a) => a.id === "repo-analyst")
  assert.ok(repoAnalyst.skills.includes("stitch-react-handoff"))

  const removeResult = runSkills(["remove", "stitch-react-handoff", "--agent", "repo-analyst", "--crew", "test-crew", "--config", configPath, "--json"], tmp)
  assert.equal(removeResult.status, 0, removeResult.stderr)
  const removePayload = JSON.parse(removeResult.stdout)
  assert.equal(removePayload.changed, true)

  updated = YAML.parse(readFileSync(configPath, "utf-8"))
  repoAnalyst = updated.crews[0].agents.find((a) => a.id === "repo-analyst")
  assert.equal(repoAnalyst.skills.includes("stitch-react-handoff"), false)
})
