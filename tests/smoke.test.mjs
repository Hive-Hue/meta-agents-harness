import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")

function run(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf-8"
  })
}

test("detect resolves a supported runtime in this repository", () => {
  const result = run(["detect"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /runtime=(pi|claude|opencode)/)
})

test("help returns usage", () => {
  const result = run(["--help"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage:/)
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

test("forced hermes list:crews resolves through repo-local runtime wrapper", () => {
  const result = run(["--runtime", "hermes", "list:crews"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /\bdev\b/)
  assert.match(result.stdout, /\bmarketing\b/)
})

test("hermes wrapper does not treat short continue flag as a crew id", () => {
  const useResult = spawnSync(process.execPath, [path.join(repoRoot, ".hermes", "bin", "hermesh"), "use", "dev"], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf-8"
  })
  assert.equal(useResult.status, 0, useResult.stderr)

  const result = spawnSync(process.execPath, [path.join(repoRoot, ".hermes", "bin", "hermesh"), "check:runtime", "-c", "--json"], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf-8"
  })
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.active_crew, "dev")
})

// CCR test - only runs if ccr is available
const ccrAvailable = spawnSync("ccr", ["--version"], { encoding: "utf-8" }).status === 0
const ccrTest = ccrAvailable ? test : (name, opts, fn) => test.skip(name, fn)
ccrTest("claude dry-run works with wrapped instruction blocks in crew config", () => {
  const result = run(["--runtime", "claude", "run", "--crew", "dev", "--dry-run"])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /config=\.claude\/crew\/dev\/multi-team\.yaml/)
  assert.match(result.stdout, /\[dry-run\] claude/)
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
    assert.equal(typeof parsed.runtime_detection?.marker?.hermes, "string")
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
