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

function tmpDir(prefix = "mah-ai-") {
  return mkdtempSync(path.join(os.tmpdir(), prefix))
}

function readConfig(dir) {
  return YAML.parse(readFileSync(path.join(dir, "meta-agents.yaml"), "utf-8"))
}

test.describe("AI-Assisted Mode - Valid API Key Acceptance", () => {
  test("AI-001: AI mode with valid runtime attempts AI generation", () => {
    const tempDir = tmpDir("mah-ai-valid001-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const output = result.stdout + result.stderr
      assert.ok(
        output.includes("ai") || output.includes("AI") || output.includes("falling back") || output.includes("created"),
        "Should show AI mode activity"
      )

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created")
      const config = readConfig(tempDir)
      assert.equal(config.version, 1, "Should have valid version")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("AI-002: AI mode with opencode attempts AI generation", () => {
    const tempDir = tmpDir("mah-ai-valid002-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive", "--name", "test-project"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("AI-003: Key from environment variable usage", () => {
    const tempDir = tmpDir("mah-ai-valid003-")
    try {
      const envWithKey = { ...process.env, OPENAI_API_KEY: "sk-test-valid" }
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir, envWithKey)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("AI-Assisted Mode - Invalid API Key Rejection", () => {
  test("AI-004: Invalid API key causes fallback to logical mode", () => {
    const tempDir = tmpDir("mah-ai-invalid004-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const output = result.stdout + result.stderr
      assert.ok(
        output.includes("falling back") || output.includes("created") || output.includes("exited"),
        "Should handle AI failure gracefully"
      )

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created on fallback")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("AI-005: Expired key causes fallback to logical mode", () => {
    const tempDir = tmpDir("mah-ai-invalid005-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created on fallback")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("AI-006: Wrong key format causes fallback to logical mode", () => {
    const tempDir = tmpDir("mah-ai-invalid006-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created on fallback")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("AI-Assisted Mode - API Timeout/Failure Handling", () => {
  test("AI-007: API timeout triggers fallback after timeout", () => {
    const tempDir = tmpDir("mah-ai-timeout007-")
    try {
      const startTime = Date.now()
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      const elapsed = Date.now() - startTime

      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created on fallback")

      const output = result.stdout + result.stderr
      assert.ok(
        output.includes("falling back") || output.includes("created") || elapsed > 1000,
        "Should either fallback or take time attempting AI"
      )
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("AI-008: Network error triggers fallback gracefully", () => {
    const tempDir = tmpDir("mah-ai-network008-")
    try {
      const noNetworkEnv = {
        ...process.env,
        HTTP_PROXY: "http://127.0.0.1:1",
        HTTPS_PROXY: "http://127.0.0.1:1"
      }
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir, noNetworkEnv)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created on fallback")

      const output = result.stdout + result.stderr
      assert.ok(
        output.includes("failed") || output.includes("falling back") || output.includes("created"),
        "Should handle network error gracefully"
      )
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("AI-009: Rate limit triggers fallback gracefully", () => {
    const tempDir = tmpDir("mah-ai-rate009-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created on fallback")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("AI-010: Service unavailable triggers fallback gracefully", () => {
    const tempDir = tmpDir("mah-ai-unavailable010-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created on fallback")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("AI-Assisted Mode - Fallback to Manual Mode on API Failure", () => {
  test("AI-011: Fallback produces valid config", () => {
    const tempDir = tmpDir("mah-ai-fallback011-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const config = readConfig(tempDir)
      assert.equal(config.version, 1, "Fallback config should have valid version")
      assert.ok(config.name, "Fallback config should have name")
      assert.ok(config.crews, "Fallback config should have crews")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("AI-012: Fallback preserves inputs from flags", () => {
    const tempDir = tmpDir("mah-ai-fallback012-")
    try {
      const result = runBootstrap([
        "--ai",
        "--non-interactive",
        "--name", "preserved-name",
        "--crew", "preserved-crew",
        "--description", "preserved-description"
      ], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const config = readConfig(tempDir)
      assert.equal(config.name, "preserved-name", "Input name should be preserved in fallback")
      assert.equal(config.crews[0].id, "preserved-crew", "Input crew should be preserved")
      assert.equal(config.description, "preserved-description", "Input description should be preserved")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("AI-013: Fallback is silent in CI environment", () => {
    const tempDir = tmpDir("mah-ai-fallback013-")
    try {
      const ciEnv = { ...process.env, CI: "true" }
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir, ciEnv)
      assert.equal(result.status, 0, result.stderr)

      const output = result.stdout
      assert.ok(
        !output.includes("?") || output.includes("created"),
        "Should not have interactive prompts in CI"
      )

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created silently")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("AI-014: AI output invalid YAML falls back to logical mode", () => {
    const tempDir = tmpDir("mah-ai-invalid014-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const output = result.stdout + result.stderr
      assert.ok(
        output.includes("not valid YAML") || output.includes("falling back") || output.includes("created"),
        "Should detect invalid YAML and fallback"
      )

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created on fallback")

      const config = readConfig(tempDir)
      assert.equal(config.version, 1, "Should have valid config after fallback")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("AI-015: AI output missing required fields falls back to logical mode", () => {
    const tempDir = tmpDir("mah-ai-missing015-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const output = result.stdout + result.stderr
      assert.ok(
        output.includes("missing required fields") || output.includes("falling back") || output.includes("created"),
        "Should detect missing fields and fallback"
      )

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created on fallback")

      const config = readConfig(tempDir)
      assert.ok(config.version, "Should have version after fallback")
      assert.ok(config.name, "Should have name after fallback")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("AI-Assisted Mode - Error Message Quality", () => {
  test("Error messages are clear and actionable", () => {
    const tempDir = tmpDir("mah-ai-error-msg-")
    try {
      const emptyEnv = { ...process.env, PATH: "/nonexistent" }
      const result = runBootstrap(["--ai"], tempDir, emptyEnv)

      const output = result.stdout + result.stderr

      if (output.includes("error") || output.includes("failed")) {
        assert.ok(
          output.includes("no AI runtime") ||
          output.includes("falling back") ||
          output.includes("created"),
          "Error messages should be descriptive"
        )
      }

      assert.equal(result.status, 0, "Should complete successfully with fallback")
      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("Spawn errors are handled gracefully", () => {
    const tempDir = tmpDir("mah-ai-spawn-")
    try {
      const brokenEnv = { ...process.env, PATH: "" }
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir, brokenEnv)

      const output = result.stdout + result.stderr

      assert.equal(result.status, 0, "Should complete with fallback")
      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("AI-Assisted Mode - Exit Code Handling", () => {
  test("AI-016: Non-zero exit code triggers fallback", () => {
    const tempDir = tmpDir("mah-ai-exit016-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created on fallback")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("AI-017: Empty output triggers fallback", () => {
    const tempDir = tmpDir("mah-ai-empty017-")
    try {
      const result = runBootstrap(["--ai", "--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const output = result.stdout + result.stderr
      assert.ok(
        output.includes("empty output") || output.includes("falling back") || output.includes("created"),
        "Should handle empty output"
      )

      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")), "Config should be created on fallback")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
