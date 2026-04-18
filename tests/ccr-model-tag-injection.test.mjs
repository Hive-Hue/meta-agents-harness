import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

import { mapModelToCcrRef } from "../scripts/ccr-model-helper.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

// ============================================================================
// Section 1: Unit tests for mapModelToCcrRef
// ============================================================================

test("mapModelToCcrRef: zai/glm-5", () => {
  assert.equal(mapModelToCcrRef("zai/glm-5"), "Zai Coding Plan,glm-5")
})

test("mapModelToCcrRef: zai/glm-5.1", () => {
  assert.equal(mapModelToCcrRef("zai/glm-5.1"), "Zai Coding Plan,glm-5.1")
})

test("mapModelToCcrRef: minimax/minimax-m2.7", () => {
  assert.equal(mapModelToCcrRef("minimax/minimax-m2.7"), "Minimax,minimax-m2.7")
})

test("mapModelToCcrRef: openai-codex/gpt-5.3-codex", () => {
  assert.equal(mapModelToCcrRef("openai-codex/gpt-5.3-codex"), "openrouter,gpt-5.3-codex")
})

test("mapModelToCcrRef: empty string returns empty", () => {
  assert.equal(mapModelToCcrRef(""), "")
})

test("mapModelToCcrRef: no slash returns empty", () => {
  assert.equal(mapModelToCcrRef("noprovider"), "")
})

test("mapModelToCcrRef: unknown provider passes through", () => {
  assert.equal(mapModelToCcrRef("unknown/model"), "unknown,model")
})

test("mapModelToCcrRef: legacy zai-coding-plan prefix", () => {
  assert.equal(mapModelToCcrRef("zai-coding-plan/glm-5"), "Zai Coding Plan,glm-5")
})

test("mapModelToCcrRef: null returns empty", () => {
  assert.equal(mapModelToCcrRef(null), "")
})

test("mapModelToCcrRef: undefined returns empty", () => {
  assert.equal(mapModelToCcrRef(undefined), "")
})

// ============================================================================
// Section 2: Tag format validation tests
// ============================================================================

test("CCR-SUBAGENT-MODEL tag format", () => {
  const tag = mapModelToCcrRef("zai/glm-5")
  assert.equal(tag, "Zai Coding Plan,glm-5")
  assert.ok(tag.length > 0)
  const fullTag = `<CCR-SUBAGENT-MODEL>${tag}</CCR-SUBAGENT-MODEL>`
  assert.match(fullTag, /^<CCR-SUBAGENT-MODEL>.+<\/CCR-SUBAGENT-MODEL>$/)
})

test("CCR-ROOT-MODEL tag format", () => {
  const rootTag = mapModelToCcrRef("minimax/minimax-m2.7")
  const fullRootTag = `<CCR-ROOT-MODEL>${rootTag}</CCR-ROOT-MODEL>`
  assert.equal(fullRootTag, "<CCR-ROOT-MODEL>Minimax,minimax-m2.7</CCR-ROOT-MODEL>")
})

// ============================================================================
// Section 3: Integration — verify source code has correct CCR plumbing
// ============================================================================

test("Claude runtime config YAML loads correctly", () => {
  const configPath = path.join(repoRoot, ".claude", "crew", "dev", "multi-team.yaml")
  const raw = readFileSync(configPath, "utf-8")
  const config = YAML.parse(raw)
  assert.ok(config, "YAML should parse")
  assert.ok(config.orchestrator, "Should have orchestrator")
  assert.ok(config.orchestrator.model, "Orchestrator should have a model")
})

test("Claude runtime config has teams with leads and workers", () => {
  const configPath = path.join(repoRoot, ".claude", "crew", "dev", "multi-team.yaml")
  const raw = readFileSync(configPath, "utf-8")
  const config = YAML.parse(raw)
  assert.ok(Array.isArray(config.teams), "Should have teams array")
  assert.ok(config.teams.length > 0, "Should have at least one team")
  for (const team of config.teams) {
    assert.ok(team.lead, `Team ${team.name} should have a lead`)
    assert.ok(team.lead.model, `Lead of team ${team.name} should have a model`)
    if (Array.isArray(team.workers)) {
      for (const worker of team.workers) {
        assert.ok(worker.model, `Worker ${worker.name} should have a model`)
      }
    }
  }
})

test("runtime-core-integrations.mjs has exec: ccr and code arg", () => {
  const source = readFileSync(path.join(repoRoot, "scripts", "runtime-core-integrations.mjs"), "utf-8")
  assert.ok(source.includes('exec: "ccr"'), "exec should be ccr")
  assert.ok(source.includes('"code",') && source.includes('"--append-system-prompt"'), "code should be prepended before --append-system-prompt")
})

test("runtime-core-integrations.mjs has CCR tag injection", () => {
  const source = readFileSync(path.join(repoRoot, "scripts", "runtime-core-integrations.mjs"), "utf-8")
  assert.ok(source.includes("CCR-ROOT-MODEL"), "CCR-ROOT-MODEL tag should be in source")
  assert.ok(source.includes("CCR-SUBAGENT-MODEL"), "CCR-SUBAGENT-MODEL tag should be in source")
  assert.ok(source.includes("mapModelToCcrRef"), "mapModelToCcrRef should be used in source")
})

test("runtime-adapters.mjs has ccr directCli and commands", () => {
  const source = readFileSync(path.join(repoRoot, "scripts", "runtime-adapters.mjs"), "utf-8")
  assert.ok(source.includes('directCli: "ccr"'), "directCli should be ccr")
  assert.ok(source.includes('["ccr", ["--help"]]'), "commands should use ccr")
})
