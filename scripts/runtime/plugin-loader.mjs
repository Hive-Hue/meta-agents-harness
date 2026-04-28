import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { RUNTIME_ADAPTERS } from "./runtime-adapters.mjs"
import { validateRuntimeAdapterContract } from "./runtime-adapter-contract.mjs"
import { getMahPluginSearchPaths, resolveMahHome } from "../core/mah-home.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.resolve(__dirname, "..")

// MAH version — used for plugin mahVersion compatibility checks
export const MAH_VERSION = (() => {
  try {
    const pkgPath = path.join(packageRoot, "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    return typeof pkg.version === "string" && pkg.version.trim() ? pkg.version.trim() : "0.0.0"
  } catch {
    return "0.0.0"
  }
})()

// In-memory plugin registry (plugin name -> loaded plugin record)
const pluginRegistry = new Map()

// Tracks whether initial plugin discovery has run
let discoveryRan = false

/**
 * Discover @mah/runtime-* packages in node_modules.
 */
function discoverNodeModulesPackages(rootDir = packageRoot) {
  const nmDir = path.join(rootDir, "node_modules")
  if (!existsSync(nmDir)) return []
  try {
    const scopeDir = path.join(nmDir, "@mah")
    if (!existsSync(scopeDir)) return []
    return readdirSync(scopeDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("runtime-"))
      .map((entry) => ({
        name: `@mah/${entry.name}`,
        path: path.join(scopeDir, entry.name),
        source: "node_modules"
      }))
  } catch {
    return []
  }
}

function isPluginDirectory(candidatePath) {
  if (!candidatePath || !existsSync(candidatePath)) return false
  const pluginJsonPath = path.join(candidatePath, "plugin.json")
  const indexMjsPath = path.join(candidatePath, "index.mjs")
  const pkgJsonPath = path.join(candidatePath, "package.json")
  return (
    (existsSync(pluginJsonPath) && existsSync(indexMjsPath)) ||
    existsSync(pkgJsonPath)
  )
}

/**
 * Normalize a plugin record to a consistent shape.
 * Handles both mah-plugins/ (plugin.json + index.mjs) and node_modules/@mah/runtime-* formats.
 */
async function normalizePlugin(pluginPath, source) {
  // Check for mah-plugins format: plugin.json + index.mjs
  const pluginJsonPath = path.join(pluginPath, "plugin.json")
  const indexMjsPath = path.join(pluginPath, "index.mjs")

  if (existsSync(pluginJsonPath) && existsSync(indexMjsPath)) {
    // mah-plugins format
    try {
      JSON.parse(readFileSync(pluginJsonPath, "utf-8"))
      const mod = await import(pathToFileURL(path.resolve(indexMjsPath)).href)
      if (!mod.runtimePlugin) {
        return { ok: false, error: `no runtimePlugin export in ${pluginPath}/index.mjs` }
      }
      return {
        ok: true,
        plugin: {
          ...mod.runtimePlugin,
          _source: source,
          _path: pluginPath
        }
      }
    } catch (err) {
      return { ok: false, error: `failed to load mah-plugins plugin at ${pluginPath}: ${err.message}` }
    }
  }

  // Check for node_modules/@mah/runtime-* format: package.json + main entry
  const pkgJsonPath = path.join(pluginPath, "package.json")
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"))
      const entry = pkg.exports?.["."]?.import || pkg.exports?.["."] || pkg.main || "index.js"
      const entryPath = path.join(pluginPath, entry)
      const mod = await import(pathToFileURL(path.resolve(entryPath)).href)
      if (!mod.runtimePlugin) {
        return { ok: false, error: `no runtimePlugin export in ${pkg.name}` }
      }
      return {
        ok: true,
        plugin: {
          ...mod.runtimePlugin,
          _source: source,
          _path: pluginPath
        }
      }
    } catch (err) {
      return { ok: false, error: `failed to load ${source} plugin at ${pluginPath}: ${err.message}` }
    }
  }

  return { ok: false, error: `no plugin manifest found in ${pluginPath}` }
}

/**
 * Validate a single plugin for MAH version compatibility and adapter shape.
 */
function validatePluginShape(plugin, mahVersion) {
  const errors = []
  const warnings = []

  // Required top-level fields
  if (!plugin.name || typeof plugin.name !== "string") {
    errors.push("plugin.name is required and must be a string")
  }
  if (!plugin.version || typeof plugin.version !== "string") {
    errors.push("plugin.version is required and must be a string")
  }
  if (!plugin.mahVersion || typeof plugin.mahVersion !== "string") {
    errors.push("plugin.mahVersion is required and must be a string")
  }
  if (!plugin.adapter || typeof plugin.adapter !== "object") {
    errors.push("plugin.adapter is required and must be an object")
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings }
  }

  // Check mahVersion compatibility (simple semver range check via satisfy or comparison)
  if (!semverCompatible(mahVersion, plugin.mahVersion)) {
    errors.push(
      `Plugin ${plugin.name}@${plugin.version} requires MAH ${plugin.mahVersion}, but ${mahVersion} is running`
    )
  }

  // Validate adapter using the runtime-adapter contract
  if (plugin.adapter && errors.length === 0) {
    const adapterValidation = validateRuntimeAdapterContract({ [plugin.name]: plugin.adapter })
    if (!adapterValidation.ok) {
      errors.push(...adapterValidation.errors)
    }
  }

  // Warn if plugin shadows a bundled plugin name.
  if (plugin.name && RUNTIME_ADAPTERS[plugin.name]) {
    warnings.push(`Plugin ${plugin.name} matches a bundled plugin name — bundled plugin takes priority`)
  }

  return { ok: errors.length === 0, errors, warnings }
}

/**
 * Basic semver compatibility check.
 * Supports caret (^x.y.z), tilde (~x.y.z), exact (x.y.z), and comparators (>=x.y.z).
 */
function semverCompatible(current, range) {
  if (!range) return false
  // Strip any leading ^ or ~ or >= etc
  const cleanRange = range.replace(/^[\^~><=]+/, "")
  const [rangeMajor, rangeMinor, rangePatch] = cleanRange.split(".").map(Number)
  const [currMajor, currMinor, currPatch] = current.split(".").map(Number)
  if (currMajor < rangeMajor) return false
  if (currMajor > rangeMajor) return true
  if (currMinor < rangeMinor) return false
  if (currMinor > rangeMinor) return true
  if (rangePatch !== undefined && currPatch < rangePatch) return false
  return true
}

/**
 * Load all plugins from the given search paths.
 * @param {string[]} pluginPaths - Array of base paths to scan for plugins
 * @param {string} mahVersion - Current MAH version for compatibility check
 * @returns {Promise<Array>} - Array of loaded (and valid) plugin records
 */
export async function loadPlugins(pluginPaths = [], mahVersion = "0.0.0") {
  const loaded = []
  const nmPackages = discoverNodeModulesPackages(packageRoot)

  // Collect all candidate plugin directories
  const candidates = []

  // From mah-plugins/ style paths
  for (const basePath of pluginPaths) {
    if (!existsSync(basePath)) continue
    if (isPluginDirectory(basePath)) {
      candidates.push({
        path: basePath,
        source: basePath,
        sourceType: "local"
      })
      continue
    }
    try {
      const entries = readdirSync(basePath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          candidates.push({
            path: path.join(basePath, entry.name),
            source: basePath,
            sourceType: "local"
          })
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  // From node_modules/@mah/runtime-*
  for (const pkg of nmPackages) {
    candidates.push({
      path: pkg.path,
      source: pkg.name,
      sourceType: "npm"
    })
  }

  // Deduplicate by path
  const seen = new Set()
  const unique = candidates.filter((c) => {
    if (seen.has(c.path)) return false
    seen.add(c.path)
    return true
  })

  // Load and validate each candidate
  for (const candidate of unique) {
    const result = await normalizePlugin(candidate.path, candidate.source)
    if (!result.ok) {
      // Log but continue
      console.warn(`[plugin-loader] skipped ${candidate.path}: ${result.error}`)
      continue
    }

    const plugin = result.plugin
    const validation = validatePluginShape(plugin, mahVersion)
    if (!validation.ok) {
      console.warn(
        `[plugin-loader] validation failed for ${plugin.name || candidate.path}: ${validation.errors.join("; ")}`
      )
      continue
    }

    // Bundled plugins take priority — skip registration if an installed plugin claims the same name.
    if (plugin.name && RUNTIME_ADAPTERS[plugin.name]) {
      continue
    }

    // Register the plugin
    if (pluginRegistry.has(plugin.name)) {
      continue
    }
    pluginRegistry.set(plugin.name, {
      ...plugin,
      _loadedAt: Date.now()
    })

    // Call init if present
    if (typeof plugin.init === "function") {
      try {
        await plugin.init({ name: plugin.name, version: plugin.version, mahVersion })
      } catch (err) {
        console.warn(`[plugin-loader] init hook failed for ${plugin.name}: ${err.message}`)
      }
    }

    loaded.push(plugin)
  }

  return loaded
}

/**
 * Get all runtimes — bundled plugins merged with installed plugins.
 * Bundled plugins always take priority over plugins with the same name.
 * Auto-discovers plugins on first call if discovery hasn't run yet.
 * @returns {Object} - Runtime registry { runtimeName: adapter }
 */
export async function getAllRuntimes() {
  // Auto-bootstrap: run discovery once if not yet done
  if (!discoveryRan) {
    discoveryRan = true
    await runPluginDiscovery()
  }

  // Start with bundled plugins
  const registry = { ...RUNTIME_ADAPTERS }

  // Merge loaded plugins (bundled plugins already present, so they take priority)
  for (const [name, plugin] of pluginRegistry.entries()) {
    if (!(name in registry)) {
      registry[name] = plugin.adapter || plugin
    }
  }

  return registry
}

export function listLoadedPlugins() {
  return Array.from(pluginRegistry.values())
    .map((plugin) => ({
      name: plugin.name,
      version: plugin.version,
      source: plugin._source || "unknown",
      path: plugin._path || ""
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Internal: run plugin discovery and populate pluginRegistry.
 * Idempotent — safe to call multiple times.
 */
async function runPluginDiscovery() {
  if (process.env.MAH_PLUGINS_ENABLED === "0") {
    return
  }
  const searchPaths = getMahPluginSearchPaths({ packageRoot, homeRoot: resolveMahHome() })
  await loadPlugins(searchPaths, MAH_VERSION)
}

/**
 * Validate a plugin at the given path without registering it.
 * Uses the real MAH_VERSION for version compatibility checks.
 * @param {string} pluginPath - Path to the plugin directory
 * @returns {Object} - Validation result { ok, name, version, mahVersion, adapter, errors, warnings }
 */
export async function validatePlugin(pluginPath) {
  const errors = []
  const warnings = []

  if (!existsSync(pluginPath)) {
    return { ok: false, errors: [`plugin path does not exist: ${pluginPath}`], warnings: [] }
  }

  const result = await normalizePlugin(pluginPath, pluginPath)
  if (!result.ok) {
    return { ok: false, errors: [result.error], warnings: [] }
  }

  const plugin = result.plugin
  const validation = validatePluginShape(plugin, MAH_VERSION)

  return {
    ok: validation.ok,
    name: plugin.name || null,
    version: plugin.version || null,
    mahVersion: plugin.mahVersion || null,
    adapter: plugin.adapter || null,
    errors: validation.errors,
    warnings: validation.warnings
  }
}

/**
 * Unregister a plugin by name. Calls teardown if present.
 * Bundled plugins cannot be unloaded.
 * @param {string} name - Plugin runtime name
 * @returns {boolean} - True if plugin was unloaded, false if not found or is bundled plugin
 */
export function unloadPlugin(name) {
  if (name && RUNTIME_ADAPTERS[name]) {
    console.warn(`[plugin-loader] cannot unload bundled plugin: ${name}`)
    return false
  }

  const plugin = pluginRegistry.get(name)
  if (!plugin) {
    return false
  }

  // Call teardown if present
  if (typeof plugin.teardown === "function") {
    try {
      plugin.teardown()
    } catch (err) {
      console.warn(`[plugin-loader] teardown hook failed for ${name}: ${err.message}`)
    }
  }

  pluginRegistry.delete(name)
  return true
}
