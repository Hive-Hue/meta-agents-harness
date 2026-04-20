import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const landingRepoRoot = path.resolve(repoRoot, "..", "mah-lp")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")
const require = createRequire(import.meta.url)

function run(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf-8"
  })
}

function runAt(cwd, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env: process.env,
    encoding: "utf-8"
  })
}

test("detect resolves a supported runtime in this repository", () => {
  const result = run(["detect"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /runtime=(pi|claude|opencode)/)
})

test("detect uses the caller cwd for marker discovery", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-detect-"))
  try {
    writeFileSync(path.join(tempDir, ".opencode"), "")
    const result = runAt(tempDir, ["detect"])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /runtime=opencode/)
    assert.match(result.stdout, /reason=marker/)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("detect walks up to the nearest workspace root", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-root-"))
  const nestedDir = path.join(tempDir, "apps", "landing")
  try {
    mkdirSync(path.join(tempDir, ".opencode"), { recursive: true })
    mkdirSync(nestedDir, { recursive: true })
    const result = runAt(nestedDir, ["detect"])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /runtime=opencode/)
    assert.match(result.stdout, /reason=marker/)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("detect does not inherit markers from HOME", () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "mah-home-"))
  const nestedDir = path.join(tempHome, "Github", "mah-lp")
  const previousHome = process.env.HOME
  try {
    mkdirSync(path.join(tempHome, ".pi"), { recursive: true })
    mkdirSync(nestedDir, { recursive: true })
    const result = spawnSync(process.execPath, [cliPath, "detect"], {
      cwd: nestedDir,
      env: { ...process.env, HOME: tempHome },
      encoding: "utf-8"
    })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stdout, /runtime=unknown/)
    assert.match(result.stdout, /reason=none/)
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test("detect returns unknown in an empty workspace without markers", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-empty-workspace-"))
  try {
    const result = runAt(tempDir, ["detect"])
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stdout, /runtime=unknown/)
    assert.match(result.stdout, /reason=none/)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("mah wrapper materializes ~/.mah layout for global assets", () => {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), "mah-home-layout-"))
  try {
    const binPath = path.join(repoRoot, "bin", "mah")
    const result = spawnSync(process.execPath, [binPath, "--help"], {
      cwd: repoRoot,
      env: { ...process.env, HOME: tempHome },
      encoding: "utf-8"
    })
    assert.equal(result.status, 0, result.stderr)

    const mahHome = path.join(tempHome, ".mah")
    assert.equal(existsSync(mahHome), true)
    assert.equal(existsSync(path.join(mahHome, "mah-plugins")), true)
    assert.equal(existsSync(path.join(mahHome, "skills")), true)
    assert.equal(existsSync(path.join(mahHome, "extensions")), true)
    assert.equal(existsSync(path.join(mahHome, "scripts")), true)
    assert.equal(lstatSync(path.join(mahHome, "skills")).isSymbolicLink(), false)
    assert.equal(lstatSync(path.join(mahHome, "extensions")).isSymbolicLink(), false)
    assert.deepEqual(
      readdirSync(path.join(mahHome, "skills")).sort(),
      ["active-listener", "bootstrap", "context-memory", "delegate-bounded", "expertise-model"]
    )
  } finally {
    rmSync(tempHome, { recursive: true, force: true })
  }
})

test("help returns usage", () => {
  const result = run(["--help"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage:/)
  assert.match(result.stdout, /\bgenerate\b/)
})

test("generate:tree alias materializes artifacts from meta-agents.yaml", () => {
  const result = run(["generate:tree"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /meta sync completed/)
})

test("multi-team parser keeps all teams when list items wrap across lines", () => {
  const source = readFileSync(path.join(repoRoot, "extensions", "multi-team.ts"), "utf-8")
  const start = source.indexOf("function stripYamlComments")
  const end = source.indexOf("function findRepoRoot")
  const slice = source.slice(start, end)
  const ts = require("typescript")
  const js = ts.transpileModule(slice, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const context = {
    module: { exports: {} },
    exports: {},
    require,
    readFileSync,
  }
  vm.createContext(context)
  vm.runInContext(js + "\nmodule.exports = { parseYamlSubset };", context)
  const { parseYamlSubset } = context.module.exports
  const raw = readFileSync(path.join(landingRepoRoot, ".pi", "crew", "dev", "multi-team.yaml"), "utf-8")
  const parsed = parseYamlSubset(raw)
  assert.equal(parsed.teams?.length, 3)
  assert.equal(parsed.teams.map((team) => team.name).join(","), "Planning,Engineering,Validation")
})

test("multi-team extension registers the thinking slash command", () => {
  const source = readFileSync(path.join(repoRoot, "extensions", "multi-team.ts"), "utf-8")
  assert.match(source, /pi\.registerCommand\("thinking"/)
  assert.match(source, /handleThinkingCommand\(commandText\)/)
})

test("forced runtime works when flag appears before command", () => {
  const result = run(["--runtime", "opencode", "detect"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /runtime=opencode/)
  assert.match(result.stdout, /reason=forced/)
})

test("explain detect with trace returns structured output", () => {
  const result = run(["explain", "detect", "--trace"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /"command": "detect"/)
})

test("sessions command returns successfully", () => {
  const result = run(["sessions"])
  assert.equal(result.status, 0, result.stderr)
})

test("forced hermes runtime detection works via --runtime flag", () => {
  const result = run(["--runtime", "hermes", "detect"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /runtime=hermes/)
  assert.match(result.stdout, /reason=forced/)
})

test("hermes runtime appears in help output", () => {
  const result = run(["--help"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /hermes/)
})

test("explain detect with hermes forced returns hermes in payload", () => {
  const result = run(["--runtime", "hermes", "explain", "detect", "--json"])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.data?.runtime, "hermes")
})

test("forced hermes list:crews resolves through the MAH-managed runtime surface", () => {
  const result = run(["--runtime", "hermes", "list:crews"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /\bdev\b/)
})

test("hermes use and list:crews expose MAH-managed active crew state", () => {
  const activeCrewFile = path.join(repoRoot, ".hermes", ".active-crew.json")
  const previous = existsSync(activeCrewFile) ? readFileSync(activeCrewFile, "utf-8") : null
  try {
    const useResult = run(["--runtime", "hermes", "use", "dev", "--json"])
    assert.equal(useResult.status, 0, useResult.stderr)
    const usePayload = JSON.parse(useResult.stdout)
    assert.equal(usePayload.active_crew, "dev")

    const result = run(["--runtime", "hermes", "list:crews", "--json"])
    assert.equal(result.status, 0, result.stderr)
    const payload = JSON.parse(result.stdout)
    assert.equal(payload.active_crew, "dev")
  } finally {
    if (previous === null) rmSync(activeCrewFile, { force: true })
    else writeFileSync(activeCrewFile, previous, "utf-8")
  }
})

test("claude dry-run works with wrapped instruction blocks in crew config", () => {
  const result = run(["--runtime", "claude", "run", "--crew", "dev", "--dry-run"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /config=\.claude\/crew\/dev\/multi-team\.yaml/)
  assert.match(result.stdout, /Running Claude Code via CCR/)
  assert.match(result.stdout, /\[dry-run\] ccr code/)
})

test("bootstrap script creates minimal meta-agents.yaml in non-interactive mode", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-bootstrap-"))
  try {
    const bootstrapPath = path.join(repoRoot, "scripts", "bootstrap-meta-agents.mjs")
    const result = spawnSync(process.execPath, [bootstrapPath, "--non-interactive"], {
      cwd: tempDir,
      env: process.env,
      encoding: "utf-8"
    })
    assert.equal(result.status, 0, result.stderr)
    const configPath = path.join(tempDir, "meta-agents.yaml")
    assert.equal(existsSync(configPath), true)
    const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
    assert.equal(parsed.version, 1)
    assert.ok(Array.isArray(parsed.crews) && parsed.crews.length >= 1)
    assert.equal(parsed.runtime_detection, undefined)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("bootstrap script respects --crew flag in non-interactive mode", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-bootstrap-crew-"))
  try {
    const bootstrapPath = path.join(repoRoot, "scripts", "bootstrap-meta-agents.mjs")
    const result = spawnSync(process.execPath, [bootstrapPath, "--non-interactive", "--crew", "custom-crew"], {
      cwd: tempDir,
      env: process.env,
      encoding: "utf-8"
    })
    assert.equal(result.status, 0, result.stderr)
    const configPath = path.join(tempDir, "meta-agents.yaml")
    const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
    assert.equal(parsed.crews[0].id, "custom-crew")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("bootstrap script skips when file exists without --force", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-bootstrap-force-"))
  try {
    const bootstrapPath = path.join(repoRoot, "scripts", "bootstrap-meta-agents.mjs")
    writeFileSync(path.join(tempDir, "meta-agents.yaml"), "version: 1\n")
    const result = spawnSync(process.execPath, [bootstrapPath, "--non-interactive"], {
      cwd: tempDir,
      env: process.env,
      encoding: "utf-8"
    })
    assert.equal(result.status, 0)
    assert.match(result.stdout, /skipped/)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("mah init invokes bootstrap and creates meta-agents.yaml", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-init-"))
  try {
    const mahPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")
    const result = spawnSync(process.execPath, [mahPath, "init", "--yes"], {
      cwd: tempDir,
      env: process.env,
      encoding: "utf-8"
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /mah init completed/)
    const configPath = path.join(tempDir, "meta-agents.yaml")
    assert.equal(existsSync(configPath), true)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("mah init passes --crew to bootstrap", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-init-crew-"))
  try {
    const mahPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")
    const result = spawnSync(process.execPath, [mahPath, "init", "--yes", "--crew", "test-team"], {
      cwd: tempDir,
      env: process.env,
      encoding: "utf-8"
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /crew_hint=test-team/)
    const configPath = path.join(tempDir, "meta-agents.yaml")
    const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
    assert.equal(parsed.crews[0].id, "test-team")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("mah init forwards --ai to bootstrap", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-init-ai-"))
  try {
    const mahPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")
    const result = spawnSync(process.execPath, [mahPath, "init", "--yes", "--ai", "--name", "ai-test"], {
      cwd: tempDir,
      env: { ...process.env, PATH: "/usr/bin:/bin" },
      encoding: "utf-8"
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout + result.stderr, /--ai flag specified|AI-assisted generation/i)
    assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("mah sync --check works from a repo using the global binary", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-sync-"))
  try {
    const initResult = spawnSync("mah", ["init", "--yes", "--runtime", "pi"], {
      cwd: tempDir,
      env: process.env,
      encoding: "utf-8"
    })
    assert.equal(initResult.status, 0, initResult.stderr)

    const syncResult = spawnSync("mah", ["sync"], {
      cwd: tempDir,
      env: process.env,
      encoding: "utf-8"
    })
    assert.equal(syncResult.status, 0, syncResult.stderr)

    const checkResult = spawnSync("mah", ["sync", "--check"], {
      cwd: tempDir,
      env: process.env,
      encoding: "utf-8"
    })
    assert.equal(checkResult.status, 0, checkResult.stderr)
    assert.match(checkResult.stdout, /sync/i)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("mah sync only materializes runtime markers that exist in the repo", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-sync-markers-"))
  try {
    const initResult = spawnSync("mah", ["init", "--yes", "--runtime", "pi"], {
      cwd: tempDir,
      env: process.env,
      encoding: "utf-8"
    })
    assert.equal(initResult.status, 0, initResult.stderr)
    const meta = YAML.parse(readFileSync(path.join(tempDir, "meta-agents.yaml"), "utf-8"))
    const crewId = meta.crews?.[0]?.id || "dev"

    const syncResult = spawnSync("mah", ["sync"], {
      cwd: tempDir,
      env: process.env,
      encoding: "utf-8"
    })
    assert.equal(syncResult.status, 0, syncResult.stderr)

    assert.equal(existsSync(path.join(tempDir, ".pi")), true)
    assert.equal(existsSync(path.join(tempDir, ".pi", "themes")), false, ".pi/themes should not be materialized")
    for (const marker of [".claude", ".codex", ".kilo", ".opencode", ".hermes"]) {
      assert.equal(existsSync(path.join(tempDir, marker)), false, `${marker} should not be created`)
    }
    assert.equal(existsSync(path.join(tempDir, ".pi", "crew", crewId, "multi-team.yaml")), true)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
