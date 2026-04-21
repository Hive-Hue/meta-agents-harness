import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")
const MAH_PLUGINS_DIR = path.join(repoRoot, "mah-plugins")
const TEST_PLUGIN_NAME = "fake"
const TEST_PLUGIN_DIR = path.join(MAH_PLUGINS_DIR, TEST_PLUGIN_NAME)
const TEST_PLUGIN_MARKER = path.join(repoRoot, ".fake")
const CORE_PLUGIN_NAME = "corefake"
const CORE_PLUGIN_DIR = path.join(MAH_PLUGINS_DIR, CORE_PLUGIN_NAME)
const CORE_PLUGIN_MARKER = path.join(repoRoot, ".corefake")
const TEST_PLUGIN_SOURCE_ROOT = path.join(repoRoot, ".test-temp-plugin-loader", "plugins-e2e")
const TEST_PLUGIN_SOURCE = path.join(TEST_PLUGIN_SOURCE_ROOT, TEST_PLUGIN_NAME)
const CORE_PLUGIN_SOURCE = path.join(TEST_PLUGIN_SOURCE_ROOT, CORE_PLUGIN_NAME)

function runMah(args, options = {}) {
  const env = { ...process.env, ...options.env }
  delete env.NODE_OPTIONS
  delete env.NODE_TEST_CONTEXT
  delete env.NODE_V8_COVERAGE
  const outputDir = mkdtempSync(path.join(os.tmpdir(), "mah-e2e-run-"))
  const stdoutPath = path.join(outputDir, "stdout.txt")
  const stderrPath = path.join(outputDir, "stderr.txt")
  const stdoutFd = openSync(stdoutPath, "w")
  const stderrFd = openSync(stderrPath, "w")
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd || repoRoot,
    env,
    stdio: ["ignore", stdoutFd, stderrFd]
  })
  closeSync(stdoutFd)
  closeSync(stderrFd)
  return {
    status: result.status,
    stdout: existsSync(stdoutPath) ? readFileSync(stdoutPath, "utf-8") : "",
    stderr: existsSync(stderrPath) ? readFileSync(stderrPath, "utf-8") : ""
  }
}

function createTestPlugin(targetDir) {
  mkdirSync(targetDir, { recursive: true })

  const pluginJson = {
    name: "fake",
    version: "0.0.1",
    mahVersion: "^0.5.0",
    entry: "index.mjs"
  }

  writeFileSync(path.join(targetDir, "plugin.json"), JSON.stringify(pluginJson, null, 2))

  const indexContent = `
function createFakeAdapter(definition) {
  return {
    ...definition,
    detect(cwd, existsFn) {
      return existsFn(\`\${cwd}/\${this.markerDir}\`)
    },
    supports(command) {
      return Array.isArray(this.commands?.[command]) && this.commands[command].length > 0
    },
    resolveCommandPlan(command, commandExistsFn) {
      const variants = this.commands?.[command] || []
      if (variants.length === 0) return { ok: false, error: \`command not supported: \${command}\`, variants: [] }
      const candidates = variants.map(([exec, args]) => ({
        exec,
        args,
        exists: commandExistsFn(exec),
        usable: true
      }))
      const selected = candidates.find((item) => item.usable)
      if (!selected) return { ok: false, error: \`no executable available for \${command}\`, variants: candidates }
      return { ok: true, exec: selected.exec, args: selected.args, variants: candidates }
    },
    validateRuntime(commandExistsFn) {
      const checks = [
        { name: "marker_dir", ok: Boolean(this.markerDir) },
        { name: "wrapper_declared", ok: Boolean(this.wrapper) },
        { name: "direct_cli_declared", ok: Boolean(this.directCli) },
        { name: "commands_declared", ok: Object.keys(this.commands || {}).length > 0 }
      ]
      return { ok: checks.every((check) => check.ok), checks }
    }
  }
}

const adapter = createFakeAdapter({
  name: "fake",
  markerDir: ".fake",
  wrapper: "fakemh",
  directCli: "fake",
  runtimePackage: false,
  capabilities: {
    sessionModeNew: true,
    sessionModeContinue: true,
    sessionModeNone: false,
    sessionIdViaEnv: "FAKE_SESSION_ID",
    sessionRootFlag: "--session-root",
    sessionMirrorFlag: false,
    sessionNewArgs: [],
    sessionContinueArgs: ["-c"]
  },
  supportsSessions: true,
  sessionListCommand: null,
  sessionExportCommand: null,
  sessionDeleteCommand: null,
  supportsSessionNew: true,
  commands: {
    "list:crews": [["fakemh", ["list:crews"]], ["fake", ["list:crews"]]],
    use: [["fakemh", ["use"]], ["fake", ["use"]]],
    clear: [["fakemh", ["clear"]], ["fake", ["clear"]]],
    run: [["fakemh", ["run"]], ["fake", ["run"]]],
    doctor: [["fakemh", ["doctor"]], ["fake", ["doctor"]]],
    "check:runtime": [["fakemh", ["check:runtime"]], ["fake", ["check:runtime"]]],
    validate: [["fakemh", ["validate"]], ["fake", ["validate"]]],
    "validate:runtime": [["fakemh", ["validate:runtime"]], ["fake", ["validate:runtime"]]]
  }
})

export const runtimePlugin = {
  name: "fake",
  version: "0.0.1",
  mahVersion: "^0.5.0",
  adapter
}
`

  writeFileSync(path.join(targetDir, "index.mjs"), indexContent)
}

function createCoreManagedTestPlugin(targetDir) {
  mkdirSync(targetDir, { recursive: true })

  const pluginJson = {
    name: CORE_PLUGIN_NAME,
    version: "0.0.1",
    mahVersion: "^0.5.0",
    entry: "index.mjs"
  }

  writeFileSync(path.join(targetDir, "plugin.json"), JSON.stringify(pluginJson, null, 2))

  const indexContent = `
function createFakeAdapter(definition) {
  return {
    ...definition,
    detect(cwd, existsFn) {
      return existsFn(\`\${cwd}/\${this.markerDir}\`)
    },
    supports(command) {
      if (["list:crews", "use", "clear"].includes(command)) return true
      if (command === "run") return true
      return Array.isArray(this.commands?.[command]) && this.commands[command].length > 0
    },
    prepareRunContext({ argv = [] }) {
      return {
        ok: true,
        exec: this.directCli,
        args: Array.isArray(argv) && argv.length > 0 ? ["run"] : [],
        passthrough: Array.isArray(argv) ? argv : [],
        envOverrides: { COREFAKE_PROMPT: "from-core" },
        warnings: []
      }
    },
    resolveCommandPlan(command, commandExistsFn) {
      const variants = this.commands?.[command] || []
      if (variants.length === 0) return { ok: false, error: \`command not supported: \${command}\`, variants: [] }
      const candidates = variants.map(([exec, args]) => ({
        exec,
        args,
        exists: commandExistsFn(exec),
        usable: true
      }))
      const selected = candidates.find((item) => item.usable)
      if (!selected) return { ok: false, error: \`no executable available for \${command}\`, variants: candidates }
      return { ok: true, exec: selected.exec, args: selected.args, variants: candidates }
    },
    validateRuntime(commandExistsFn) {
      const hasRuntimeEntrypoint = Boolean(this.wrapper) || Boolean(this.directCli)
      const checks = [
        { name: "marker_dir", ok: Boolean(this.markerDir) },
        { name: "wrapper_declared", ok: Boolean(this.wrapper) },
        { name: "direct_cli_declared", ok: Boolean(this.directCli) },
        { name: "runtime_entrypoint_declared", ok: hasRuntimeEntrypoint },
        { name: "commands_declared", ok: Object.keys(this.commands || {}).length > 0 }
      ]
      return {
        ok: checks.every((check) => check.ok || check.name === "wrapper_declared"),
        checks
      }
    }
  }
}

const adapter = createFakeAdapter({
  name: "${CORE_PLUGIN_NAME}",
  markerDir: ".${CORE_PLUGIN_NAME}",
  wrapper: null,
  directCli: "${CORE_PLUGIN_NAME}",
  runtimePackage: false,
  capabilities: {
    sessionModeNew: true,
    sessionModeContinue: true,
    sessionModeNone: false,
    sessionIdViaEnv: "${CORE_PLUGIN_NAME.toUpperCase()}_SESSION_ID",
    sessionRootFlag: "--session-root",
    sessionMirrorFlag: false,
    sessionNewArgs: [],
    sessionContinueArgs: ["-c"]
  },
  supportsSessions: true,
  sessionListCommand: null,
  sessionExportCommand: null,
  sessionDeleteCommand: null,
  supportsSessionNew: true,
  commands: {
    doctor: [["${CORE_PLUGIN_NAME}", ["doctor"]]],
    "check:runtime": [["${CORE_PLUGIN_NAME}", ["check:runtime"]]],
    validate: [["${CORE_PLUGIN_NAME}", ["validate"]]],
    "validate:runtime": [["${CORE_PLUGIN_NAME}", ["validate:runtime"]]]
  }
})

export const runtimePlugin = {
  name: "${CORE_PLUGIN_NAME}",
  version: "0.0.1",
  mahVersion: "^0.5.0",
  adapter
}
`

  writeFileSync(path.join(targetDir, "index.mjs"), indexContent)
}

function cleanup() {
  rmSync(TEST_PLUGIN_DIR, { recursive: true, force: true })
  rmSync(TEST_PLUGIN_MARKER, { recursive: true, force: true })
  rmSync(CORE_PLUGIN_DIR, { recursive: true, force: true })
  rmSync(CORE_PLUGIN_MARKER, { recursive: true, force: true })
  rmSync(TEST_PLUGIN_SOURCE_ROOT, { recursive: true, force: true })
  rmSync(path.join(MAH_PLUGINS_DIR, "broken"), { recursive: true, force: true })
}

test.describe("plugins e2e", () => {
  test.beforeEach(() => {
    cleanup()
    createTestPlugin(TEST_PLUGIN_SOURCE)
    createCoreManagedTestPlugin(CORE_PLUGIN_SOURCE)
  })

  test.afterEach(() => {
    cleanup()
  })

  test("mah plugins install validates and copies a plugin from source path", () => {
    const result = runMah(["plugins", "install", TEST_PLUGIN_SOURCE])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /installed=fake/)
    assert.equal(existsSync(path.join(TEST_PLUGIN_DIR, "plugin.json")), true)
    assert.equal(existsSync(path.join(TEST_PLUGIN_DIR, "index.mjs")), true)

    const installedPlugin = JSON.parse(readFileSync(path.join(TEST_PLUGIN_DIR, "plugin.json"), "utf-8"))
    assert.equal(installedPlugin.name, "fake")
    assert.equal(installedPlugin.version, "0.0.1")
  })

  test("mah plugins install accepts wrapperless MAH-managed plugin", () => {
    const installResult = runMah(["plugins", "install", CORE_PLUGIN_SOURCE])

    assert.equal(installResult.status, 0, installResult.stderr)
    assert.match(installResult.stdout, /installed=corefake/)
    assert.equal(existsSync(path.join(CORE_PLUGIN_DIR, "plugin.json")), true)
    assert.equal(existsSync(path.join(CORE_PLUGIN_DIR, "index.mjs")), true)

    const listResult = runMah(["plugins", "list"])
    assert.equal(listResult.status, 0, listResult.stderr)
    assert.match(listResult.stdout, /plugin corefake version=0\.0\.1/)

    const detectResult = runMah(["detect", "--runtime", "corefake"], { cwd: path.join(repoRoot, "docs") })
    assert.equal(detectResult.status, 0, detectResult.stderr)
    assert.match(detectResult.stdout, /runtime=corefake/)
    assert.match(detectResult.stdout, /reason=forced/)
  })

  test("mah plugins list shows only loaded plugins", () => {
    const installResult = runMah(["plugins", "install", TEST_PLUGIN_SOURCE])
    assert.equal(installResult.status, 0, installResult.stderr)

    mkdirSync(path.join(MAH_PLUGINS_DIR, "broken"), { recursive: true })
    writeFileSync(path.join(MAH_PLUGINS_DIR, "broken", "plugin.json"), "{ invalid json }")

    const result = runMah(["plugins", "list"])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /plugin fake version=0\.0\.1/)
    assert.doesNotMatch(result.stdout, /plugin broken/)
  })

  test("forced plugin runtime detection works outside the repo root", () => {
    const installResult = runMah(["plugins", "install", TEST_PLUGIN_SOURCE])
    assert.equal(installResult.status, 0, installResult.stderr)

    const result = runMah(["detect", "--runtime", "fake"], { cwd: path.join(repoRoot, "docs") })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /runtime=fake/)
    assert.match(result.stdout, /reason=forced/)
  })

  test("plugin runtimes participate in sessions new dry-run", () => {
    const installResult = runMah(["plugins", "install", TEST_PLUGIN_SOURCE])
    assert.equal(installResult.status, 0, installResult.stderr)

    const result = runMah(["sessions", "new", "--runtime", "fake", "--dry-run"])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Would start new session with runtime 'fake'/)
    assert.match(result.stdout, /exec=fakemh/)
  })

  test("mah plugins uninstall removes plugin files and marker", () => {
    const installResult = runMah(["plugins", "install", TEST_PLUGIN_SOURCE])
    assert.equal(installResult.status, 0, installResult.stderr)
    assert.equal(existsSync(TEST_PLUGIN_DIR), true)
    assert.equal(existsSync(TEST_PLUGIN_MARKER), true)

    const result = runMah(["plugins", "uninstall", TEST_PLUGIN_NAME])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /uninstalled=fake/)
    assert.equal(existsSync(TEST_PLUGIN_DIR), false)
    assert.equal(existsSync(TEST_PLUGIN_MARKER), false)
  })
})
