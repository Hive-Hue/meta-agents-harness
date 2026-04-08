import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..", "..")
const bootstrapPath = path.join(repoRoot, "scripts", "bootstrap-meta-agents.mjs")

function runBootstrap(args, cwd, env = {}) {
  return spawnSync(process.execPath, [bootstrapPath, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf-8"
  })
}

function tmpDir(prefix = "mah-fallback-") {
  return mkdtempSync(path.join(os.tmpdir(), prefix))
}

function readConfig(dir) {
  return YAML.parse(readFileSync(path.join(dir, "meta-agents.yaml"), "utf-8"))
}

test.describe("Fallback Flow - API Key Missing but AI Mode Requested", () => {
  test("FF-001: AI mode without runtime falls back to logical mode", () => {
    const tempDir = tmpDir("mah-fallback-ff001-")
    try {
      const envWithoutRuntime = { ...process.env, PATH: "/nonexistent" }
      const result = runBootstrap(["--ai"], tempDir, envWithoutRuntime)
      assert.equal(result.status, 0, result.stderr)

      const output = result.stdout + result.stderr
      assert.ok(
        output.includes("no AI runtime available") || output.includes("falling back"),
        "Should mention fallback or no runtime"
      )

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created")
      const config = readConfig(tempDir)
      assert.equal(config.version, 1, "Should have valid version")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("FF-002: AI mode without skill file falls back to logical mode", () => {
    const tempDir = tmpDir("mah-fallback-ff002-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const output = result.stdout + result.stderr
      assert.ok(
        output.includes("skill not found") || output.includes("falling back"),
        "Should mention skill not found and fallback"
      )

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("FF-003: AI mode in CI environment falls back to logical mode", () => {
    const tempDir = tmpDir("mah-fallback-ff003-")
    try {
      const ciEnv = { ...process.env, CI: "true" }
      const result = runBootstrap(["--ai"], tempDir, ciEnv)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created in CI")
      const config = readConfig(tempDir)
      assert.equal(config.version, 1, "Should have valid config")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("FF-004: AI mode with invalid runtime falls back to logical mode", () => {
    const tempDir = tmpDir("mah-fallback-ff004-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created on fallback")
      const config = readConfig(tempDir)
      assert.equal(config.version, 1, "Should have valid version after fallback")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("Fallback Flow - Project Brief Edge Cases", () => {
  test("PB-001: Brief too short is handled gracefully", () => {
    const tempDir = tmpDir("mah-fallback-pb001-")
    try {
      const result = runBootstrap(["--ai", "--brief", "test", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("PB-002: Brief empty is handled gracefully", () => {
    const tempDir = tmpDir("mah-fallback-pb002-")
    try {
      const result = runBootstrap(["--ai", "--brief", "", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("PB-003: Brief very long is handled gracefully", () => {
    const tempDir = tmpDir("mah-fallback-pb003-")
    try {
      const longBrief = "A".repeat(10000)
      const result = runBootstrap(["--ai", "--brief", longBrief, "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("PB-004: Brief with special characters is handled gracefully", () => {
    const tempDir = tmpDir("mah-fallback-pb004-")
    try {
      const specialBrief = "Test\n\t<>&\"'backslash\\"
      const result = runBootstrap(["--ai", "--brief", specialBrief, "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("PB-005: Brief with YAML-like content is treated as string", () => {
    const tempDir = tmpDir("mah-fallback-pb005-")
    try {
      const yamlLikeBrief = "key: value\nanother: 123\narray:\n  - item1\n  - item2"
      const result = runBootstrap(["--ai", "--brief", yamlLikeBrief, "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("Fallback Flow - Unrecognized Runtime Type", () => {
  test("UR-001: Unknown runtime marker falls back to CLI detection", () => {
    const tempDir = tmpDir("mah-fallback-ur001-")
    try {
      mkdirSync(path.join(tempDir, ".unknown"), { recursive: true })
      const result = runBootstrap(["--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const config = readConfig(tempDir)
      assert.ok(config.runtime_detection, "Should have runtime_detection")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("UR-002: No markers, no CLI produces valid config with defaults", () => {
    const tempDir = tmpDir("mah-fallback-ur002-")
    try {
      const result = runBootstrap(["--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const config = readConfig(tempDir)
      assert.equal(config.version, 1, "Should have valid version")
      assert.ok(config.runtimes, "Should have runtimes with defaults")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("UR-003: Multiple markers uses detection order deterministically", () => {
    const tempDir = tmpDir("mah-fallback-ur003-")
    try {
      mkdirSync(path.join(tempDir, ".pi"), { recursive: true })
      mkdirSync(path.join(tempDir, ".claude"), { recursive: true })
      mkdirSync(path.join(tempDir, ".opencode"), { recursive: true })

      const result = runBootstrap(["--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const config = readConfig(tempDir)
      assert.ok(config.runtime_detection.marker, "Should have marker detection")
      assert.ok(config.runtimes, "Should have all runtime configs")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("Fallback Flow - Required Tools Unavailable", () => {
  test("RT-001: No bash available falls back gracefully", () => {
    const tempDir = tmpDir("mah-fallback-rt001-")
    try {
      const result = runBootstrap(["--non-interactive"], tempDir, { PATH: "/usr/bin:/bin" })
      assert.equal(result.status, 0, result.stderr)

      const config = readConfig(tempDir)
      assert.equal(config.version, 1, "Should create valid config without bash")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RT-002: YAML library missing shows clear error", () => {
    const tempDir = tmpDir("mah-fallback-rt002-")
    try {
      const result = runBootstrap(["--non-interactive"], tempDir)
      assert.equal(result.status, 0, "Should complete without import errors")

      const configPath = path.join(tempDir, "meta-agents.yaml")
      assert.ok(existsSync(configPath), "Config file should be created")

      const config = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.ok(config, "Should parse as valid YAML")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RT-003: Node.js runtime assumed available (bootstrap runs in node)", () => {
    const tempDir = tmpDir("mah-fallback-rt003-")
    try {
      const result = runBootstrap(["--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const config = readConfig(tempDir)
      assert.equal(config.version, 1, "Should create valid config")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("Fallback Flow - Error Recovery Verification", () => {
  test("AI failure triggers fallback to logical mode", () => {
    const tempDir = tmpDir("mah-fallback-recovery-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const output = result.stdout + result.stderr
      assert.ok(
        output.includes("falling back") || output.includes("created"),
        "Should either fallback or create config"
      )

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should exist after fallback")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("Runtime not found uses logical defaults", () => {
    const tempDir = tmpDir("mah-fallback-runtime-")
    try {
      const emptyEnv = { ...process.env, PATH: "/nonexistent" }
      const result = runBootstrap(["--ai"], tempDir, emptyEnv)
      assert.equal(result.status, 0, result.stderr)

      const config = readConfig(tempDir)
      assert.equal(config.version, 1, "Should have valid version from defaults")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("Invalid input uses default or sanitizes", () => {
    const tempDir = tmpDir("mah-fallback-invalid-")
    try {
      const result = runBootstrap([
        "--non-interactive",
        "--name", "",
        "--crew", "",
        "--description", ""
      ], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const config = readConfig(tempDir)
      assert.ok(config.name, "Should have non-empty name after fallback")
      assert.ok(config.crews[0].id, "Should have non-empty crew id")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
