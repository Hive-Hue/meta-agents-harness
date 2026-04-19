import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

function tmpDir(prefix = "mah-runtime-selection-") {
  return mkdtempSync(path.join(os.tmpdir(), prefix))
}

function makeExecutable(filePath, scriptBody) {
  writeFileSync(filePath, `#!/usr/bin/env bash\nset -euo pipefail\n${scriptBody}\n`)
  chmodSync(filePath, 0o755)
}

function readConfig(dir) {
  return YAML.parse(readFileSync(path.join(dir, "meta-agents.yaml"), "utf-8"))
}

test.describe("AI-Assisted Runtime Selection", () => {
  test("RS-001: bootstrap prefers opencode before pi when opencode succeeds", () => {
    const tempDir = tmpDir("mah-runtime-selection-001-")
    const binDir = path.join(tempDir, "bin")
    const opencodeLog = path.join(tempDir, "opencode.log")
    const piLog = path.join(tempDir, "pi.log")
    try {
      mkdirSync(binDir, { recursive: true })
      writeFileSync(opencodeLog, "")
      writeFileSync(piLog, "")
      makeExecutable(path.join(binDir, "opencode"), `
printf '%s\\n' "$*" >> "${opencodeLog}"
cat <<'YAML'
version: 1
name: opencode-success
crews:
  - id: dev
    display_name: Dev Crew
    mission: Test mission
YAML
`)
      makeExecutable(path.join(binDir, "pi"), `
printf '%s\\n' "$*" >> "${piLog}"
echo "pi should not run when opencode succeeds" >&2
exit 1
`)

      const result = runBootstrap(["--ai", "--non-interactive", "--force"], tempDir, {
        PATH: `${binDir}:${process.env.PATH}`
      })

      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout + result.stderr, /invoking opencode/)
      assert.doesNotMatch(result.stdout + result.stderr, /invoking pi/)
      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")))
      assert.equal(readConfig(tempDir).name, "opencode-success")
      assert.equal(readFileSync(piLog, "utf-8").trim(), "", "pi should not be invoked when opencode succeeds")
      assert.match(readFileSync(opencodeLog, "utf-8"), /\S/, "opencode should be invoked")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("RS-002: bootstrap falls through to pi when earlier runtimes fail", () => {
    const tempDir = tmpDir("mah-runtime-selection-002-")
    const binDir = path.join(tempDir, "bin")
    const opencodeLog = path.join(tempDir, "opencode.log")
    const piLog = path.join(tempDir, "pi.log")
    try {
      mkdirSync(binDir, { recursive: true })
      writeFileSync(opencodeLog, "")
      writeFileSync(piLog, "")
      makeExecutable(path.join(binDir, "opencode"), `
printf '%s\\n' "$*" >> "${opencodeLog}"
echo "opencode failed intentionally" >&2
exit 1
`)
      makeExecutable(path.join(binDir, "pi"), `
printf '%s\\n' "$*" >> "${piLog}"
cat <<'YAML'
version: 1
name: pi-success
crews:
  - id: dev
    display_name: Dev Crew
    mission: Test mission
YAML
`)

      const result = runBootstrap(["--ai", "--non-interactive", "--force"], tempDir, {
        PATH: `${binDir}:${process.env.PATH}`
      })

      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout + result.stderr, /opencode exited with status 1/)
      assert.match(result.stdout + result.stderr, /invoking pi/)
      assert.ok(existsSync(path.join(tempDir, "meta-agents.yaml")))
      assert.equal(readConfig(tempDir).name, "pi-success")
      assert.match(readFileSync(opencodeLog, "utf-8"), /\S/, "opencode should be invoked first")
      assert.match(readFileSync(piLog, "utf-8"), /\S/, "pi should be invoked after opencode failure")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
