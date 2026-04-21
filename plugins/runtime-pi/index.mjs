/**
 * runtime-pi — PI runtime plugin.
 *
 * Integrates the pi CLI with the MAH core.
 * MAH core manages crew state and session resolution; this plugin provides
 * the runtime-specific prepareRunContext that injects crew config and
 * session context into the pi invocation.
 *
 * Plugin source: plugins/runtime-pi/
 * Install target: mah-plugins/pi/  (via mah plugins install)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

function variantPathExists(candidatePath) {
  if (!candidatePath || typeof candidatePath !== "string") return false
  const absolutePath = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(process.cwd(), candidatePath)
  return existsSync(absolutePath)
}

function variantExecutableAvailable(exec, args, commandExistsFn) {
  if (!commandExistsFn(exec)) return false
  if (exec === "node") return variantPathExists(args?.[0])
  if (exec === "npm") {
    const prefixIndex = Array.isArray(args) ? args.indexOf("--prefix") : -1
    if (prefixIndex === -1 || !args?.[prefixIndex + 1]) return true
    return variantPathExists(args[prefixIndex + 1]) && variantPathExists(path.join(args[prefixIndex + 1], "package.json"))
  }
  return true
}

// --- PI-specific helpers (inlined from runtime-core-integrations.mjs) ---

function toPosix(t) { return `${t || ""}`.replaceAll(path.sep, "/") }
function rel(repoRoot, targetPath) { return toPosix(path.relative(repoRoot, targetPath)) }

function resolveFromRepo(repoRoot, targetPath) {
  if (!targetPath) return ""
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(repoRoot, targetPath)
}

function parseInlineFlag(argv, flagName) {
  const collected = []
  const remaining = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === flagName && argv[i + 1]) { collected.push(argv[i + 1]); i += 1; continue }
    if (token.startsWith(`${flagName}=`)) { collected.push(token.slice(flagName.length + 1)); continue }
    remaining.push(token)
  }
  return { values: collected.filter(Boolean), remaining }
}

function stripFlags(argv, flags) {
  const flagSet = new Set(flags)
  return argv.filter((token) => !flagSet.has(token))
}

function hasContinueFlag(argv = []) {
  return argv.includes("-c") || argv.includes("--continue") || argv.includes("--resume") || argv.includes("-r")
}

function newSessionId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const rand = Math.random().toString(36).slice(2, 8)
  return `${stamp}-${rand}`
}

function latestSessionRoot(sessionBaseRoot) {
  if (!existsSync(sessionBaseRoot)) return ""
  const { statSync } = require("node:fs")
  const candidates = readdirSync(sessionBaseRoot)
    .map((entry) => path.join(sessionBaseRoot, entry))
    .filter((entryPath) => { try { return statSync(entryPath).isDirectory() } catch { return false } })
    .sort((left, right) => { try { return statSync(right).mtimeMs - statSync(left).mtimeMs } catch { return 0 } })
  return candidates[0] || ""
}

function removeIfExists(targetPath) {
  if (!existsSync(targetPath)) return
  const { lstatSync, rmSync: rm } = require("node:fs")
  const stat = lstatSync(targetPath)
  if (stat.isDirectory() && !stat.isSymbolicLink()) { rm(targetPath, { recursive: true, force: true }); return }
  rm(targetPath, { force: true })
}

function writeJson(targetPath, payload) {
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
}

function loadPiDefaultExtensions(repoRoot) {
  const fallbackExtensions = [
    "extensions/multi-team.ts",
    "extensions/agent-session-navigator.ts",
    "extensions/mcp-bridge.ts",
    "extensions/theme-cycler.ts"
  ]
  const metaPath = path.join(repoRoot, "meta-agents.yaml")
  if (!existsSync(metaPath)) return fallbackExtensions
  try {
    const YAML = require("yaml")
    const meta = YAML.parse(readFileSync(metaPath, "utf8")) || {}
    const configured = meta?.runtimes?.pi?.default_extensions
    if (!Array.isArray(configured) || configured.length === 0) return fallbackExtensions
    return configured.map((item) => `${item || ""}`.trim()).filter(Boolean)
  } catch { return fallbackExtensions }
}

function parsePiExtensionArgs(repoRoot, argv = []) {
  const collected = []
  const remaining = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === "--extension" && argv[i + 1]) { collected.push(argv[i + 1]); i += 1; continue }
    if (token.startsWith("--extension=")) { collected.push(token.slice("--extension=".length)); continue }
    remaining.push(token)
  }
  const values = collected
    .flatMap((item) => `${item || ""}`.split(","))
    .map((item) => item.trim()).filter(Boolean)
    .map((item) => resolveFromRepo(repoRoot, item))
  return { extensionPaths: [...new Set(values)], remaining }
}

function resolvePiSessionLayout(repoRoot, crew, argv = [], baseEnvOverrides = {}) {
  const sessionRootParse = parseInlineFlag(argv, "--session-root")
  const explicitRoots = sessionRootParse.values.map((item) => resolveFromRepo(repoRoot, item))
  let remaining = sessionRootParse.remaining

  const newSessionRequested = remaining.includes("--new-session")
  remaining = stripFlags(remaining, ["--new-session"])

  const envSessionRoot = `${baseEnvOverrides.PI_MULTI_SESSION_ROOT || process.env.PI_MULTI_SESSION_ROOT || ""}`.trim()
  const envSessionId = `${baseEnvOverrides.PI_MULTI_SESSION_ID || process.env.PI_MULTI_SESSION_ID || ""}`.trim()

  const explicitRoot = explicitRoots[explicitRoots.length - 1] || (envSessionRoot ? resolveFromRepo(repoRoot, envSessionRoot) : "")
  const sessionBaseRoot = explicitRoot || path.join(repoRoot, ".pi", "crew", crew, "sessions")
  const continueRequested = hasContinueFlag(remaining)

  if (explicitRoot && path.basename(explicitRoot) !== "sessions") {
    return { passthrough: remaining, sessionBaseRoot: path.dirname(explicitRoot), sessionRoot: explicitRoot, sessionId: envSessionId || path.basename(explicitRoot), sessionMode: "explicit-root" }
  }

  if (!newSessionRequested && continueRequested) {
    const latest = latestSessionRoot(sessionBaseRoot)
    if (latest) return { passthrough: remaining, sessionBaseRoot, sessionRoot: latest, sessionId: envSessionId || path.basename(latest), sessionMode: "continue-latest" }
  }

  const sessionId = envSessionId || newSessionId()
  return { passthrough: remaining, sessionBaseRoot, sessionRoot: path.join(sessionBaseRoot, sessionId), sessionId, sessionMode: "new" }
}

export const runtimePlugin = {
  name: "pi",
  version: "1.0.0",
  mahVersion: "^0.8.0",

  adapter: {
    name: "pi",
    markerDir: ".pi",
    configPattern: ".pi/crew/<crew>/multi-team.yaml",
    wrapper: null,
    directCli: "pi",

    capabilities: {
      sessionModeNew: true,
      sessionModeContinue: true,
      sessionModeNone: true,
      sessionIdViaEnv: "PI_MULTI_SESSION_ID",
      sessionRootFlag: "--session-root",
      sessionMirrorFlag: false,
      sessionNewArgs: ["--new-session"],
      sessionContinueArgs: ["-c"],
      sessionNoneArgs: ["--no-session"],
      headless: {
        supported: true,
        native: true,
        requiresSession: false,
        promptMode: "argv",
        outputMode: "stdout"
      }
    },

    supportsSessions: true,
    sessionListCommand: null,
    sessionExportCommand: null,
    sessionDeleteCommand: null,
    supportsSessionNew: true,

    commands: {
      doctor: [["pi", ["--help"]]],
      "check:runtime": [["pi", ["--help"]]],
      validate: [["pi", ["--help"]]],
      "validate:runtime": [["pi", ["--help"]]]
    },

    detect(cwd, existsFn) {
      return existsFn(`${cwd}/${this.markerDir}`)
    },

    supports(command) {
      if (command === "run" && typeof this.prepareRunContext === "function") return true
      if (["list:crews", "use", "clear"].includes(command)) return true
      return Array.isArray(this.commands?.[command]) && this.commands[command].length > 0
    },

    prepareRunContext({ repoRoot, crew, configPath, argv = [], envOverrides = {} }) {
      if (!crew || !configPath) {
        return { ok: false, error: "no PI crew selected. Run 'mah use <crew>' or pass '--crew <crew>'." }
      }

      const extensionParse = parsePiExtensionArgs(repoRoot, argv)
      const session = resolvePiSessionLayout(repoRoot, crew, extensionParse.remaining, envOverrides)
      const extensionPaths = extensionParse.extensionPaths.length > 0
        ? extensionParse.extensionPaths
        : loadPiDefaultExtensions(repoRoot).map((item) => resolveFromRepo(repoRoot, item))

      const missingExtension = extensionPaths.find((item) => !existsSync(item))
      if (missingExtension) {
        return { ok: false, error: `PI extension not found: ${rel(repoRoot, missingExtension)}` }
      }

      return {
        ok: true,
        exec: this.directCli,
        args: extensionPaths.flatMap((item) => ["-e", item]),
        passthrough: session.passthrough,
        envOverrides: {
          ...envOverrides,
          PI_MULTI_CONFIG: configPath,
          PI_MULTI_SESSION_ROOT: session.sessionRoot,
          PI_MULTI_SESSION_ID: session.sessionId
        },
        warnings: [],
        internal: {
          crew, configPath,
          sessionRoot: session.sessionRoot,
          sessionBaseRoot: session.sessionBaseRoot,
          sessionId: session.sessionId,
          sessionMode: session.sessionMode
        }
      }
    },

    prepareHeadlessRunContext({ repoRoot, task = "", argv = [], envOverrides = {} }) {
      if (!task && (!argv || argv.length === 0)) {
        return {
          ok: false,
          error: "PI headless requires a task prompt"
        }
      }

      const extensionParse = parsePiExtensionArgs(repoRoot, argv)
      const extensionPaths = extensionParse.extensionPaths.length > 0
        ? extensionParse.extensionPaths
        : loadPiDefaultExtensions(repoRoot).map((item) => resolveFromRepo(repoRoot, item))

      const missingExtension = extensionPaths.find((item) => !existsSync(item))
      if (missingExtension) {
        return { ok: false, error: `PI extension not found: ${rel(repoRoot, missingExtension)}` }
      }

      return {
        ok: true,
        exec: "pi",
        args: [...extensionPaths.flatMap((item) => ["-e", item]), "-p"],
        passthrough: task ? [task] : extensionParse.remaining,
        envOverrides: {
          ...envOverrides,
          PI_MULTI_HEADLESS: "1"
        },
        warnings: [],
        internal: {
          mode: "headless",
          promptMode: "argv",
          runtime: "pi"
        }
      }
    },

    activateCrew({ repoRoot, crewId }) {
      const runtimeRoot = path.join(repoRoot, ".pi")
      const configPath = path.join(runtimeRoot, "crew", crewId, "multi-team.yaml")
      const sessionRoot = path.join(runtimeRoot, "crew", crewId, "sessions")
      mkdirSync(sessionRoot, { recursive: true })
      const payload = {
        crew: crewId,
        source_config: rel(repoRoot, configPath),
        session_root: rel(repoRoot, sessionRoot),
        activated_at: new Date().toISOString(),
        note: "Used by MAH core to bootstrap PI with selected crew."
      }
      writeJson(path.join(runtimeRoot, ".active-crew.json"), payload)
      return payload
    },

    clearCrewState({ repoRoot }) {
      removeIfExists(path.join(repoRoot, ".pi", ".active-crew.json"))
      return true
    },

    resolveCommandPlan(command, commandExistsFn, passthroughArgs = []) {
      const variants = this.commands?.[command] || []
      if (variants.length === 0) return { ok: false, error: `command not supported: ${command}`, variants: [] }
      const candidates = variants.map(([exec, args]) => ({
        exec, args,
        exists: commandExistsFn(exec),
        usable: variantExecutableAvailable(exec, args, commandExistsFn)
      }))
      const selected = candidates.find((item) => item.usable)
      if (!selected) return { ok: false, error: `no executable available for ${command}`, variants: candidates }
      return { ok: true, exec: selected.exec, args: selected.args, variants: candidates }
    },

    validateRuntime(commandExistsFn) {
      const hasRuntimeEntrypoint = Boolean(this.wrapper) || Boolean(this.directCli)
      const checks = [
        { name: "marker_dir", ok: Boolean(this.markerDir) },
        { name: "wrapper_declared", ok: Boolean(this.wrapper) },
        { name: "direct_cli_declared", ok: Boolean(this.directCli) },
        { name: "runtime_entrypoint_declared", ok: hasRuntimeEntrypoint },
        { name: "wrapper_available", ok: Boolean(this.wrapper) ? commandExistsFn(this.wrapper) : false },
        { name: "direct_cli_available", ok: Boolean(this.directCli) ? commandExistsFn(this.directCli) : false }
      ]
      const hasCommandTable = Object.keys(this.commands || {}).length > 0
      checks.push({ name: "commands_declared", ok: hasCommandTable })
      const ok = checks.every((item) => item.ok || item.name === "wrapper_declared" || item.name.endsWith("_available"))
      return { ok, checks }
    }
  },

  init(ctx) {
    if (process.env.MAH_DEBUG_PLUGINS === "1") console.log(`[pi] plugin loaded (MAH ${ctx.mahVersion})`)
  },
  teardown() {
    if (process.env.MAH_DEBUG_PLUGINS === "1") console.log("[pi] plugin unloaded")
  }
}