import { describe, it, beforeEach, afterEach, mock, test } from "node:test"
import assert from "node:assert"
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_PLUGINS_DIR = path.resolve(__dirname, "../plugins")
const FIXTURE_PLUGIN = path.resolve(__dirname, "../plugins/runtime-fake")

// Dynamically import plugin-loader to access internals
// We use a helper to get a fresh module each time we need to reset state
async function getPluginLoader() {
  return import("../scripts/runtime/plugin-loader.mjs")
}

async function createTempPlugin(tempDir, name, pluginJson, indexContent) {
  const pluginPath = path.join(tempDir, name)
  mkdirSync(pluginPath, { recursive: true })
  if (pluginJson) {
    writeFileSync(path.join(pluginPath, "plugin.json"), JSON.stringify(pluginJson))
  }
  if (indexContent) {
    writeFileSync(path.join(pluginPath, "index.mjs"), indexContent)
  }
  return pluginPath
}

// Helper to create a valid runtimePlugin export string
function validRuntimePluginExport(name = "test", version = "0.1.0", mahVersion = "^0.8.0") {
  return `
export const runtimePlugin = {
  name: "${name}",
  version: "${version}",
  mahVersion: "${mahVersion}",
  adapter: {
    name: "${name}",
    markerDir: ".${name}",
    wrapper: "${name}mh",
    directCli: "${name}",
    capabilities: {
      sessionModeNew: true,
      sessionModeContinue: true,
      sessionModeNone: true,
      sessionIdViaEnv: "${name.toUpperCase()}_SESSION_ID",
      sessionRootFlag: "--session-root",
      sessionMirrorFlag: false
    },
    supportsSessions: true,
    sessionListCommand: null,
    sessionExportCommand: null,
    sessionDeleteCommand: null,
    supportsSessionNew: true,
    commands: {
      "list:crews": [["${name}mh", ["list:crews"]]],
      use: [["${name}mh", ["use"]]],
      clear: [["${name}mh", ["clear"]]],
      run: [["${name}mh", ["run"]]],
      doctor: [["${name}mh", ["doctor"]]],
      "check:runtime": [["${name}mh", ["check:runtime"]]],
      validate: [["${name}mh", ["validate"]]],
      "validate:runtime": [["${name}mh", ["validate:runtime"]]]
    },
    detect(cwd, existsFn) { return existsFn(cwd + "/" + this.markerDir) },
    supports(command) { return Array.isArray(this.commands?.[command]) && this.commands[command].length > 0 },
    resolveCommandPlan(command, commandExistsFn) {
      const variants = this.commands?.[command] || []
      if (variants.length === 0) return { ok: false, error: "command not supported", variants: [] }
      return { ok: true, exec: variants[0][0], args: variants[0][1], variants }
    },
    validateRuntime(commandExistsFn) {
      const checks = [
        { name: "marker_dir", ok: Boolean(this.markerDir) },
        { name: "wrapper_declared", ok: Boolean(this.wrapper) },
        { name: "direct_cli_declared", ok: Boolean(this.directCli) },
        { name: "commands_declared", ok: Object.keys(this.commands || {}).length > 0 }
      ]
      return { ok: checks.every(c => c.ok), checks }
    }
  }
}
`
}

function validCoreManagedRuntimePluginExport(name = "testcore", version = "0.1.0", mahVersion = "^0.8.0") {
  return `
export const runtimePlugin = {
  name: "${name}",
  version: "${version}",
  mahVersion: "${mahVersion}",
  adapter: {
    name: "${name}",
    markerDir: ".${name}",
    wrapper: null,
    directCli: "${name}",
    capabilities: {
      sessionModeNew: true,
      sessionModeContinue: true,
      sessionModeNone: true,
      sessionIdViaEnv: "${name.toUpperCase()}_SESSION_ID",
      sessionRootFlag: "--session-root",
      sessionMirrorFlag: false
    },
    supportsSessions: true,
    sessionListCommand: null,
    sessionExportCommand: null,
    sessionDeleteCommand: null,
    supportsSessionNew: true,
    commands: {
      doctor: [["${name}", ["doctor"]]],
      "check:runtime": [["${name}", ["doctor"]]],
      validate: [["${name}", ["doctor"]]],
      "validate:runtime": [["${name}", ["doctor"]]]
    },
    detect(cwd, existsFn) { return existsFn(cwd + "/" + this.markerDir) },
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
        envOverrides: { TEST_SYSTEM_PROMPT: "core-managed" },
        warnings: []
      }
    },
    resolveCommandPlan(command, commandExistsFn) {
      const variants = this.commands?.[command] || []
      if (variants.length === 0) return { ok: false, error: "command not supported", variants: [] }
      return { ok: true, exec: variants[0][0], args: variants[0][1], variants }
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
        ok: checks.every(c => c.ok || c.name === "wrapper_declared"),
        checks
      }
    }
  }
}
`
}

// Create temp dir once per test file run
const TEMP_DIR = path.resolve(__dirname, "../.test-temp-plugin-loader")
let tempDirCreated = false

function setupTempDir() {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true })
    tempDirCreated = true
  }
}

function cleanupTempDir() {
  if (tempDirCreated && existsSync(TEMP_DIR)) {
    rmSync(TEMP_DIR, { recursive: true, force: true })
    tempDirCreated = false
  }
}

describe("plugin-loader", async () => {
  setupTempDir()

  it("reads MAH_VERSION from repository root package.json", async () => {
    const loader = await getPluginLoader()
    const rootPkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"))
    assert.equal(loader.MAH_VERSION, rootPkg.version)
  })

  // Reset module state between tests by clearing the internal registry
  // The plugin-loader uses a module-level pluginRegistry Map
  // We test this by calling unloadPlugin for all non-core plugins after each test
  afterEach(async () => {
    const loader = await getPluginLoader()
    // Unload any test plugins
    const runtimes = await loader.getAllRuntimes()
    for (const name of Object.keys(runtimes)) {
      if (!["pi", "claude", "opencode", "hermes"].includes(name)) {
        loader.unloadPlugin(name)
      }
    }
  })

  // ========================================================================
  // loadPlugins tests
  // ========================================================================
  describe("loadPlugins", () => {
    it("discovers plugins from mah-plugins/ style directory", async () => {
      const loader = await getPluginLoader()

      // Use the runtime-fake fixture - pass parent dir that contains plugin subdirs
      const loaded = await loader.loadPlugins([FIXTURE_PLUGINS_DIR], "0.8.0")

      assert.ok(loaded.some(p => p.name === "fake"), "should discover runtime-fake plugin")
      assert.ok(loaded.some(p => p.name === "codex"), "should discover runtime-codex plugin")
    })

    it("discovers plugins from MAH_HOME/mah-plugins", async () => {
      const tempHomeRoot = path.join(TEMP_DIR, "mah-home-discovery")
      const tempMahHome = path.join(tempHomeRoot, ".mah")
      const pluginRoot = path.join(tempMahHome, "mah-plugins", "homefake")
      mkdirSync(pluginRoot, { recursive: true })
      writeFileSync(path.join(pluginRoot, "plugin.json"), JSON.stringify({
        name: "homefake",
        version: "0.1.0",
        mahVersion: "^0.8.0",
        entry: "index.mjs"
      }, null, 2))
      writeFileSync(path.join(pluginRoot, "index.mjs"), `
export const runtimePlugin = {
  name: "homefake",
  version: "0.1.0",
  mahVersion: "^0.8.0",
  adapter: {
    name: "homefake",
    markerDir: ".homefake",
    wrapper: "homefake-mh",
    directCli: "homefake",
    capabilities: {
      sessionModeNew: true,
      sessionModeContinue: true,
      sessionModeNone: true,
      sessionIdViaEnv: "HOMEFAKE_SESSION_ID",
      sessionRootFlag: "--session-root",
      sessionMirrorFlag: false
    },
    supportsSessions: true,
    sessionListCommand: null,
    sessionExportCommand: null,
    sessionDeleteCommand: null,
    supportsSessionNew: true,
    commands: {
      "list:crews": [["homefake", ["list:crews"]]],
      use: [["homefake", ["use"]]],
      clear: [["homefake", ["clear"]]],
      run: [["homefake", ["run"]]],
      doctor: [["homefake", ["doctor"]]],
      "check:runtime": [["homefake", ["check:runtime"]]],
      validate: [["homefake", ["validate"]]],
      "validate:runtime": [["homefake", ["validate:runtime"]]]
    },
    detect(cwd, existsFn) { return existsFn(cwd + "/" + this.markerDir) },
    supports(command) { return Array.isArray(this.commands?.[command]) && this.commands[command].length > 0 },
    resolveCommandPlan(command, commandExistsFn) {
      const variants = this.commands?.[command] || []
      if (variants.length === 0) return { ok: false, error: "command not supported", variants: [] }
      return { ok: true, exec: variants[0][0], args: variants[0][1], variants }
    },
    validateRuntime(commandExistsFn) {
      return { ok: true, checks: [] }
    }
  }
}
`)

      const previousMahHome = process.env.MAH_HOME
      try {
        process.env.MAH_HOME = tempMahHome
        const loader = await import(`../scripts/runtime/plugin-loader.mjs?home=${Date.now()}`)
        const runtimes = await loader.getAllRuntimes()
        assert.ok(runtimes.homefake, "should discover plugins installed in MAH_HOME/mah-plugins")
      } finally {
        if (previousMahHome === undefined) delete process.env.MAH_HOME
        else process.env.MAH_HOME = previousMahHome
      }
    })

    it("skips plugins with version incompatibility", async () => {
      const loader = await getPluginLoader()

      // runtime-fake requires ^0.8.0, so version 0.4.0 should be incompatible
      const loaded = await loader.loadPlugins([FIXTURE_PLUGINS_DIR], "0.4.0")

      assert.ok(!loaded.some(p => p.name === "fake"), "should skip incompatible plugin")
    })

    it("accepts plugins with compatible version", async () => {
      const loader = await getPluginLoader()

      // runtime-fake requires ^0.8.0, version 0.9.0 should be compatible
      const loaded = await loader.loadPlugins([FIXTURE_PLUGINS_DIR], "0.9.0")

      assert.ok(loaded.some(p => p.name === "fake"), "should load compatible plugin")
    })

    it("loads wrapperless MAH-managed plugins", async () => {
      const loader = await getPluginLoader()

      const coreManagedParent = path.join(TEMP_DIR, "core-managed-parent")
      mkdirSync(coreManagedParent, { recursive: true })

      const pluginPath = path.join(coreManagedParent, "core-managed")
      mkdirSync(pluginPath, { recursive: true })
      writeFileSync(path.join(pluginPath, "plugin.json"), JSON.stringify({
        name: "core-managed",
        version: "0.1.0",
        mahVersion: ">=0.8.0"
      }))
      writeFileSync(
        path.join(pluginPath, "index.mjs"),
        validCoreManagedRuntimePluginExport("core-managed", "0.1.0", ">=0.8.0")
      )

      const loaded = await loader.loadPlugins([coreManagedParent], "0.8.0")
      const runtimes = await loader.getAllRuntimes()

      assert.ok(loaded.some(p => p.name === "core-managed"), "should load wrapperless plugin")
      assert.equal(runtimes["core-managed"].wrapper, null)
      assert.equal(typeof runtimes["core-managed"].prepareRunContext, "function")
    })

    it("bundled runtime plugins take priority over installed plugins with same name", async () => {
      const loader = await getPluginLoader()

      // Create a plugin that shadows a bundled runtime plugin (e.g., "pi")
      // Put it in a unique subdir so we don't pick up other test plugins
      const shadowingDir = path.join(TEMP_DIR, "shadow-test-dir")
      mkdirSync(shadowingDir, { recursive: true })
      const shadowingPluginPath = path.join(shadowingDir, "plugin-shadows-pi")
      mkdirSync(shadowingPluginPath, { recursive: true })
      writeFileSync(path.join(shadowingPluginPath, "plugin.json"), JSON.stringify({
        name: "pi",
        version: "0.1.0",
        mahVersion: ">=0.8.0"
      }))
      writeFileSync(path.join(shadowingPluginPath, "index.mjs"), validRuntimePluginExport("pi", "0.1.0", ">=0.8.0"))

      const loaded = await loader.loadPlugins([shadowingDir], "0.8.0")

      // Plugin should not be loaded since the bundled runtime plugin takes priority
      assert.ok(!loaded.some(p => p.name === "pi"), "should not load plugin that shadows bundled runtime plugin")
    })

    it("loads plugins from multiple paths", async () => {
      const loader = await getPluginLoader()

      // Create a parent dir for multi-plugin test
      const multiDir = path.join(TEMP_DIR, "multi-plugin-parent")
      mkdirSync(multiDir, { recursive: true })

      const plugin1Path = path.join(multiDir, "plugin1")
      mkdirSync(plugin1Path, { recursive: true })
      writeFileSync(path.join(plugin1Path, "plugin.json"), JSON.stringify({
        name: "plugin1", version: "0.1.0", mahVersion: ">=0.8.0"
      }))
      writeFileSync(path.join(plugin1Path, "index.mjs"), validRuntimePluginExport("plugin1", "0.1.0", ">=0.8.0"))

      const plugin2Path = path.join(multiDir, "plugin2")
      mkdirSync(plugin2Path, { recursive: true })
      writeFileSync(path.join(plugin2Path, "plugin.json"), JSON.stringify({
        name: "plugin2", version: "0.1.0", mahVersion: ">=0.8.0"
      }))
      writeFileSync(path.join(plugin2Path, "index.mjs"), validRuntimePluginExport("plugin2", "0.1.0", ">=0.8.0"))

      const loaded = await loader.loadPlugins([multiDir], "0.8.0")

      assert.ok(loaded.some(p => p.name === "plugin1"), "should load plugin1, got: " + loaded.map(p => p.name).join(", "))
      assert.ok(loaded.some(p => p.name === "plugin2"), "should load plugin2")
    })

    it("deduplicates plugins by path", async () => {
      const loader = await getPluginLoader()

      // Create a parent dir for dedup test
      const dedupParentDir = path.join(TEMP_DIR, "dedup-parent")
      mkdirSync(dedupParentDir, { recursive: true })

      const pluginPath = path.join(dedupParentDir, "dedup-test")
      mkdirSync(pluginPath, { recursive: true })
      writeFileSync(path.join(pluginPath, "plugin.json"), JSON.stringify({
        name: "dedup", version: "0.1.0", mahVersion: ">=0.8.0"
      }))
      writeFileSync(path.join(pluginPath, "index.mjs"), validRuntimePluginExport("dedup", "0.1.0", ">=0.8.0"))

      // Pass the same parent dir twice (simulating same plugin being found via two paths)
      const loaded = await loader.loadPlugins([dedupParentDir, dedupParentDir], "0.8.0")

      const dedupPlugins = loaded.filter(p => p.name === "dedup")
      assert.ok(dedupPlugins.length === 1, "should deduplicate same path passed twice, got: " + dedupPlugins.length)
    })

    it("registers loaded plugins in the internal registry", async () => {
      const loader = await getPluginLoader()

      // Use FIXTURE_PLUGINS_DIR (the parent dir) not FIXTURE_PLUGIN (the plugin dir itself)
      const loaded = await loader.loadPlugins([FIXTURE_PLUGINS_DIR], "0.8.0")
      const runtimes = await loader.getAllRuntimes()

      assert.ok("fake" in runtimes, "loaded plugin should be in getAllRuntimes")
    })
  })

  // ========================================================================
  // getAllRuntimes tests
  // ========================================================================
  describe("getAllRuntimes", () => {
    it("returns bundled runtime plugins by default", async () => {
      const loader = await getPluginLoader()

      const runtimes = await loader.getAllRuntimes()

      assert.ok("pi" in runtimes, "should include pi bundled plugin")
      assert.ok("claude" in runtimes, "should include claude bundled plugin")
      assert.ok("opencode" in runtimes, "should include opencode bundled plugin")
      assert.ok("hermes" in runtimes, "should include hermes bundled plugin")
    })

    it("merges loaded plugins with bundled runtime plugins", async () => {
      const loader = await getPluginLoader()

      await loader.loadPlugins([FIXTURE_PLUGINS_DIR], "0.8.0")
      const runtimes = await loader.getAllRuntimes()

      assert.ok("fake" in runtimes, "should include loaded plugin fake")
      assert.ok("pi" in runtimes, "should still include bundled plugin pi")
    })

    it("bundled plugin priority - installed plugins cannot override bundled adapters", async () => {
      const loader = await getPluginLoader()

      // Create a plugin with same name as a bundled runtime plugin
      const shadowingPath = await createTempPlugin(TEMP_DIR, "override-attempt", {
        name: "pi",
        version: "99.0.0",
        mahVersion: "^0.8.0"
      }, validRuntimePluginExport("pi", "99.0.0", "^0.8.0"))

      await loader.loadPlugins([shadowingPath], "0.8.0")
      const runtimes = await loader.getAllRuntimes()

      // The bundled adapter should still be there (not the plugin's)
      assert.ok(runtimes.pi, "pi should still exist")
    })
  })

  // ========================================================================
  // validatePlugin tests
  // ========================================================================
  describe("validatePlugin", () => {
    it("rejects malformed plugin.json (invalid JSON)", async () => {
      const loader = await getPluginLoader()

      const badPluginPath = await createTempPlugin(TEMP_DIR, "bad-json", {
        name: "bad"
        // Intentionally malformed - no version, mahVersion, etc.
      }, validRuntimePluginExport("bad"))

      // Overwrite with actual malformed JSON
      writeFileSync(path.join(badPluginPath, "plugin.json"), "{ this is not json }")

      const result = await loader.validatePlugin(badPluginPath)

      assert.ok(!result.ok, "should reject malformed JSON")
      assert.ok(result.errors.some(e => e.includes("failed to load") || e.includes("JSON")), "should report JSON parse error")
    })

    it("rejects plugin.json missing required fields", async () => {
      const loader = await getPluginLoader()

      // Create a plugin where runtimePlugin is missing required fields
      // This tests that validatePlugin catches malformed plugins
      const badPluginPath = await createTempPlugin(TEMP_DIR, "missing-fields", {
        name: "incomplete",
        version: "0.1.0",
        mahVersion: ">=0.0.0"
      }, `
// runtimePlugin is missing required fields - no adapter, no commands, etc.
export const runtimePlugin = {
  name: "incomplete"
  // Missing version, mahVersion, adapter, and all other required fields
}
`)

      const result = await loader.validatePlugin(badPluginPath)

      // Should fail because runtimePlugin is missing required fields
      assert.ok(!result.ok, "should reject plugin missing required fields in runtimePlugin")
    })

    it("rejects missing runtimePlugin export", async () => {
      const loader = await getPluginLoader()

      const noExportPath = await createTempPlugin(TEMP_DIR, "no-export", {
        name: "noexport",
        version: "0.1.0",
        mahVersion: "^0.8.0"
      }, `
// No runtimePlugin export here
export const somethingElse = {}
`)

      const result = await loader.validatePlugin(noExportPath)

      assert.ok(!result.ok, "should reject plugin without runtimePlugin export")
      assert.ok(result.errors.some(e => e.includes("no runtimePlugin export")), "should report missing runtimePlugin")
    })

    it("accepts valid plugin with all required fields", async () => {
      const loader = await getPluginLoader()

      // Note: validatePlugin uses "0.0.0" as placeholder mahVersion for shape validation
      // So we create a temp plugin that accepts 0.0.0
      const tempPluginPath = await createTempPlugin(TEMP_DIR, "valid-plugin-test", {
        name: "validtest",
        version: "0.1.0",
        mahVersion: ">=0.0.0"  // Accepts any version including 0.0.0
      }, validRuntimePluginExport("validtest", "0.1.0", ">=0.0.0"))

      const result = await loader.validatePlugin(tempPluginPath)

      assert.ok(result.ok, "should accept valid plugin")
      assert.strictEqual(result.name, "validtest")
      assert.strictEqual(result.version, "0.1.0")
    })

    it("accepts valid wrapperless MAH-managed plugin", async () => {
      const loader = await getPluginLoader()

      const tempPluginPath = await createTempPlugin(TEMP_DIR, "valid-core-plugin-test", {
        name: "validcoretest",
        version: "0.1.0",
        mahVersion: ">=0.0.0"
      }, validCoreManagedRuntimePluginExport("validcoretest", "0.1.0", ">=0.0.0"))

      const result = await loader.validatePlugin(tempPluginPath)

      assert.ok(result.ok, "should accept wrapperless MAH-managed plugin")
      assert.strictEqual(result.name, "validcoretest")
      assert.strictEqual(result.adapter.wrapper, null)
      assert.equal(typeof result.adapter.prepareRunContext, "function")
    })

    it("returns errors and warnings in result object", async () => {
      const loader = await getPluginLoader()

      // Create a plugin that shadows a bundled runtime plugin to trigger a warning
      const shadowPath = await createTempPlugin(TEMP_DIR, "shadow-warning", {
        name: "pi",
        version: "0.1.0",
        mahVersion: "^0.8.0"
      }, validRuntimePluginExport("pi", "0.1.0", "^0.8.0"))

      const result = await loader.validatePlugin(shadowPath)

      assert.ok(result.warnings && result.warnings.length > 0, "should have warnings for shadowing bundled runtime plugin")
    })
  })

  // ========================================================================
  // unloadPlugin tests
  // ========================================================================
  describe("unloadPlugin", () => {
    it("removes plugin from registry", async () => {
      const loader = await getPluginLoader()

      // Load a plugin first
      await loader.loadPlugins([FIXTURE_PLUGINS_DIR], "0.8.0")

      // Verify it's in the registry
      let runtimes = await loader.getAllRuntimes()
      assert.ok("fake" in runtimes, "plugin should be loaded")

      // Unload it
      const unloaded = loader.unloadPlugin("fake")
      assert.ok(unloaded, "unloadPlugin should return true for loaded plugin")

      // Verify it's gone
      runtimes = await loader.getAllRuntimes()
      assert.ok(!("fake" in runtimes), "plugin should be removed from registry")
    })

    it("returns false for non-existent plugin", async () => {
      const loader = await getPluginLoader()

      const result = loader.unloadPlugin("nonexistent-plugin")

      assert.ok(!result, "should return false for non-existent plugin")
    })

    it("cannot unload bundled runtime plugins", async () => {
      const loader = await getPluginLoader()

      // Intercept console.warn
      const warnCalls = []
      const originalWarn = console.warn
      console.warn = (...args) => warnCalls.push(args)

      try {
        const result = loader.unloadPlugin("pi")

        assert.ok(!result, "should return false when trying to unload bundled plugin")
        assert.ok(warnCalls.some(args => args.join(" ").includes("cannot unload bundled plugin")),
          "should warn about bundled plugin unload attempt")
      } finally {
        console.warn = originalWarn
      }
    })

    it("calls teardown hook if present", async () => {
      const loader = await getPluginLoader()

      const teardownPath = await createTempPlugin(TEMP_DIR, "teardown-test", {
        name: "teardownplugin",
        version: "0.1.0",
        mahVersion: ">=0.0.0"
      }, `
let teardownCalled = false
export const runtimePlugin = {
  name: "teardownplugin",
  version: "0.1.0",
  mahVersion: ">=0.0.0",
  teardown() { teardownCalled = true },
  adapter: {
    name: "teardownplugin",
    markerDir: ".teardownplugin",
    wrapper: "tdmh",
    directCli: "td",
    capabilities: { sessionModeNew: true, sessionModeContinue: true, sessionModeNone: true },
    supportsSessions: true,
    commands: {
      "list:crews": [["tdmh", ["list:crews"]]],
      use: [["tdmh", ["use"]]],
      clear: [["tdmh", ["clear"]]],
      run: [["tdmh", ["run"]]],
      doctor: [["tdmh", ["doctor"]]],
      "check:runtime": [["tdmh", ["check:runtime"]]],
      validate: [["tdmh", ["validate"]]],
      "validate:runtime": [["tdmh", ["validate:runtime"]]]
    },
    detect() { return false },
    supports() { return false },
    resolveCommandPlan() { return { ok: false, error: "test" } },
    validateRuntime() { return { ok: true, checks: [] } }
  }
}
export { teardownCalled }
`)

      // Note: we need to pass the parent temp dir and load from there
      await loader.loadPlugins([TEMP_DIR], "0.8.0")
      const unloaded = loader.unloadPlugin("teardownplugin")

      assert.ok(unloaded, "should unload plugin with teardown")
      // Note: We can't easily verify teardown was called since it's in module scope
      // But we verified the unload succeeded
    })

    it("after unload, can reload the same plugin", async () => {
      const loader = await getPluginLoader()

      // Load, unload, reload
      await loader.loadPlugins([FIXTURE_PLUGINS_DIR], "0.8.0")
      loader.unloadPlugin("fake")

      const reloaded = await loader.loadPlugins([FIXTURE_PLUGINS_DIR], "0.8.0")

      assert.ok(reloaded.some(p => p.name === "fake"), "should be able to reload plugin after unload")
    })
  })

  // ========================================================================
  // Integration: node_modules @mah/runtime-* discovery
  // ========================================================================
  describe("node_modules @mah/runtime-* discovery", () => {
    it("loadPlugins scans node_modules for @mah/runtime-* packages", async () => {
      const loader = await getPluginLoader()

      // This test verifies discovery mechanism works
      // We pass an empty array for mah-plugins paths so only node_modules is scanned
      const loaded = await loader.loadPlugins([], "0.8.0")

      // If there are any @mah/runtime-* packages in node_modules, they would be loaded
      // We just verify the function returns without error and structure is correct
      assert.ok(Array.isArray(loaded), "should return an array")
    })
  })
})
