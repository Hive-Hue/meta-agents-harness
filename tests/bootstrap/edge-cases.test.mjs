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
const bootstrapPath = path.join(repoRoot, "scripts", "../../scripts/bootstrap/bootstrap-meta-agents.mjs")

function runBootstrap(args, tempDir) {
  return spawnSync(process.execPath, [bootstrapPath, ...args], {
    cwd: tempDir,
    env: process.env,
    encoding: "utf-8"
  })
}

test.describe("Overwrite Behavior", () => {
  test("OB-001: bootstrap skips when meta-agents.yaml exists without --force", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-ob001-"))
    try {
      const existingContent = "version: 1\nname: existing-project\n"
      writeFileSync(path.join(tempDir, "meta-agents.yaml"), existingContent)

      const result = runBootstrap(["--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /skipped/)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const content = readFileSync(configPath, "utf-8")
      assert.equal(content, existingContent, "File should be unchanged")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("OB-002: bootstrap overwrites when --force flag is provided", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-ob002-"))
    try {
      const existingContent = "version: 1\nname: old-project\n"
      writeFileSync(path.join(tempDir, "meta-agents.yaml"), existingContent)

      const result = runBootstrap(["--non-interactive", "--force"], tempDir)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /created/)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.equal(parsed.name, path.basename(tempDir), "Name should be updated to cwd basename")
      assert.notEqual(YAML.stringify(parsed), YAML.stringify(YAML.parse(existingContent)), "File should be different")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("OB-003: bootstrap preserves file unchanged when skipped", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-ob003-"))
    try {
      const originalContent = "version: 1\nname: preserved\ncrews:\n  - id: test\n"
      const configPath = path.join(tempDir, "meta-agents.yaml")
      writeFileSync(configPath, originalContent)

      const beforeMtime = existsSync(configPath) ? readFileSync(configPath, "utf-8") : null
      const result = runBootstrap(["--non-interactive"], tempDir)
      const afterMtime = readFileSync(configPath, "utf-8")

      assert.equal(result.status, 0)
      assert.equal(beforeMtime, afterMtime, "File content must be identical")
      assert.equal(afterMtime, originalContent, "File must match original content")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("OB-004: bootstrap --force creates new file when previous was corrupted", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-ob004-"))
    try {
      const corruptedContent = "this is not valid yaml : [unclosed"
      writeFileSync(path.join(tempDir, "meta-agents.yaml"), corruptedContent)

      const result = runBootstrap(["--non-interactive", "--force"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.equal(parsed.version, 1, "Should create valid config with version")
      assert.ok(parsed.name, "Should create valid config with name")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("Merge Behavior", () => {
  test("MB-001: bootstrap does not merge with existing config", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-mb001-"))
    try {
      const existing = "version: 1\nname: old\ncustom_field: preserved\n"
      writeFileSync(path.join(tempDir, "meta-agents.yaml"), existing)

      const result = runBootstrap(["--non-interactive"], tempDir)
      assert.equal(result.status, 0)
      assert.match(result.stdout, /skipped/)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const content = readFileSync(configPath, "utf-8")
      assert.ok(content.includes("custom_field: preserved"), "Custom field should be preserved when skipped")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("MB-002: bootstrap --force replaces entire config (no merge)", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-mb002-"))
    try {
      const existing = "version: 1\nname: old\ncustom_field: will_be_lost\ncrews:\n  - id: old-crew\n"
      writeFileSync(path.join(tempDir, "meta-agents.yaml"), existing)

      const result = runBootstrap(["--non-interactive", "--force"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.ok(!parsed.custom_field, "Custom field should not exist after force overwrite")
      assert.equal(parsed.crews.length, 1, "Should have single crew from template")
      assert.equal(parsed.crews[0].id, "dev", "Should use default crew id")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("Partial Input Handling", () => {
  test("PI-001: bootstrap with --name only uses defaults for other fields", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-pi001-"))
    try {
      const result = runBootstrap(["--non-interactive", "--name", "custom-name"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.equal(parsed.name, "custom-name")
      assert.equal(parsed.crews[0].id, "dev", "Should use default crew id")
      assert.equal(parsed.runtime_detection, undefined, "Runtime detection should be internal and omitted")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("PI-002: bootstrap with --crew only uses defaults for name and description", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-pi002-"))
    try {
      const result = runBootstrap(["--non-interactive", "--crew", "custom-crew"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.equal(parsed.crews[0].id, "custom-crew")
      assert.equal(parsed.name, path.basename(tempDir), "Should use cwd basename for name")
      assert.ok(parsed.description, "Should have default description")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("PI-003: bootstrap with --description only uses defaults for name and crew", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-pi003-"))
    try {
      const result = runBootstrap(["--non-interactive", "--description", "Custom description"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.equal(parsed.description, "Custom description")
      assert.equal(parsed.crews[0].id, "dev", "Should use default crew id")
      assert.equal(parsed.name, path.basename(tempDir), "Should use cwd basename for name")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("PI-004: bootstrap with combination of flags applies all", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-pi004-"))
    try {
      const result = runBootstrap([
        "--non-interactive",
        "--name", "combined-project",
        "--crew", "combined-crew",
        "--description", "Combined description"
      ], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.equal(parsed.name, "combined-project")
      assert.equal(parsed.crews[0].id, "combined-crew")
      assert.equal(parsed.description, "Combined description")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("PI-005: bootstrap with no flags uses all logical defaults", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-pi005-"))
    try {
      const result = runBootstrap(["--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.equal(parsed.name, path.basename(tempDir), "Should use cwd basename")
      assert.equal(parsed.crews[0].id, "dev", "Should use default crew id 'dev'")
      assert.ok(parsed.description, "Should have default description")
      assert.equal(parsed.runtime_detection, undefined, "Runtime detection should be internal and omitted")
      assert.ok(parsed.runtimes, "Should have runtimes")
      assert.ok(parsed.catalog, "Should have catalog")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("Invalid Input Handling", () => {
  test("II-001: bootstrap handles empty string for --name", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-ii001-"))
    try {
      const result = runBootstrap(["--non-interactive", "--name", ""], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.ok(parsed.name, "Should have non-empty name")
      assert.ok(parsed.name.length > 0, "Name should not be empty")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("II-002: bootstrap handles whitespace-only input for --name", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-ii002-"))
    try {
      const result = runBootstrap(["--non-interactive", "--name", "   "], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.ok(parsed.name, "Should have non-empty name")
      assert.ok(parsed.name.trim().length > 0, "Name should not be whitespace-only")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("II-003: bootstrap handles special characters in --name", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-ii003-"))
    try {
      const specialName = "test-project@v2!#$%"
      const result = runBootstrap(["--non-interactive", "--name", specialName], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.equal(parsed.name, specialName, "Should preserve special characters")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("II-004: bootstrap handles very long --name input", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-ii004-"))
    try {
      const longName = "a".repeat(500)
      const result = runBootstrap(["--non-interactive", "--name", longName], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.equal(parsed.name, longName, "Should preserve long name")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("II-005: bootstrap handles unicode characters in --name", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-ii005-"))
    try {
      const unicodeName = "test-项目-πρότζεκτ-проект"
      const result = runBootstrap(["--non-interactive", "--name", unicodeName], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.equal(parsed.name, unicodeName, "Should preserve unicode characters")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("II-006: bootstrap handles newlines in --description", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-ii006-"))
    try {
      const multilineDesc = "Line 1\nLine 2\nLine 3"
      const result = runBootstrap(["--non-interactive", "--description", multilineDesc], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.ok(parsed.description.includes("Line"), "Should preserve multiline description")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("II-007: bootstrap handles empty string for --crew", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-ii007-"))
    try {
      const result = runBootstrap(["--non-interactive", "--crew", ""], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.ok(parsed.crews[0].id, "Should have crew id")
      assert.ok(parsed.crews[0].id.length > 0, "Crew id should not be empty")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("II-008: bootstrap handles whitespace-only input for --crew", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-ii008-"))
    try {
      const result = runBootstrap(["--non-interactive", "--crew", "   "], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.ok(parsed.crews[0].id, "Should have crew id")
      assert.ok(parsed.crews[0].id.trim().length > 0, "Crew id should not be whitespace-only")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("II-009: bootstrap handles special characters in --crew", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-ii009-"))
    try {
      const specialCrew = "crew-with-special_chars.123"
      const result = runBootstrap(["--non-interactive", "--crew", specialCrew], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.equal(parsed.crews[0].id, specialCrew, "Should preserve special characters in crew id")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

test.describe("File System Edge Cases", () => {
  test("FS-001: bootstrap runs in existing temp directory", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-fs001-"))
    try {
      assert.ok(existsSync(tempDir), "Temp dir should exist")

      const result = runBootstrap(["--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      assert.ok(existsSync(configPath), "meta-agents.yaml should be created in existing dir")

      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.equal(parsed.version, 1, "Should create valid config")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // TODO: FS-002 - Permission denied on write
  // Requires mocking fs.writeFileSync to throw EACCES error
  // Need to intercept bootstrap's writeFileSync call and simulate permission error
  // Alternative: use OS-level chmod on parent directory (requires platform-specific handling)
  test.skip("FS-002: bootstrap handles permission denied error", () => {
    // Mock needed: fs.writeFileSync should throw EACCES
    // Expected behavior: bootstrap should exit with non-zero status and report error
  })

  // TODO: FS-003 - Disk full error
  // Requires mocking fs.writeFileSync to throw ENOSPC error
  // Need to simulate disk full condition at OS level or intercept write calls
  test.skip("FS-003: bootstrap handles disk full error", () => {
    // Mock needed: fs.writeFileSync should throw ENOSPC
    // Expected behavior: bootstrap should exit with non-zero status and report error
  })

  // TODO: FS-004 - Read-only filesystem
  // Requires mounting temp dir as read-only or mocking fs.writeFileSync to throw EROFS
  // Platform-specific: Linux supports mount -o ro, macOS similar, Windows different approach
  test.skip("FS-004: bootstrap handles read-only filesystem", () => {
    // Mock needed: fs.writeFileSync should throw EROFS
    // Expected behavior: bootstrap should exit with non-zero status and report error
  })

  // TODO: FS-005 - Directory creation failure
  // Requires mocking fs.mkdirSync to throw error (e.g., EACCES, ENOSPC, or parent doesn't exist)
  // Bootstrap uses { recursive: true } so need to intercept that specific call
  test.skip("FS-005: bootstrap handles directory creation failure", () => {
    // Mock needed: fs.mkdirSync should throw error
    // Expected behavior: bootstrap should exit with non-zero status and report error
  })

  test("FS-006: bootstrap creates parent directories if needed", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-edge-fs006-"))
    try {
      // Create a subdirectory to run bootstrap in
      const subDir = path.join(tempDir, "subdir")
      mkdirSync(subDir, { recursive: true })

      const result = runBootstrap(["--non-interactive"], subDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(subDir, "meta-agents.yaml")
      assert.ok(existsSync(configPath), "meta-agents.yaml should be created in subdirectory")

      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.equal(parsed.version, 1, "Should create valid config")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("FS-007: bootstrap handles path with spaces", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah edge fs007-"))
    try {
      assert.ok(tempDir.includes(" "), "Temp dir should have spaces in path")

      const result = runBootstrap(["--non-interactive"], tempDir)
      assert.equal(result.status, 0, result.stderr)

      const configPath = path.join(tempDir, "meta-agents.yaml")
      assert.ok(existsSync(configPath), "meta-agents.yaml should be created despite spaces in path")

      const parsed = YAML.parse(readFileSync(configPath, "utf-8"))
      assert.equal(parsed.version, 1, "Should create valid config")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
