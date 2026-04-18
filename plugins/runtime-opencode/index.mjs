/**
 * runtime-opencode — OpenCode runtime plugin.
 *
 * Integrates the OpenCode CLI with the MAH core.
 * MAH core manages crew state and generated artifact lookup; this plugin
 * handles agent materialization and symlinking for the opencode runtime.
 *
 * Plugin source: plugins/runtime-opencode/
 * Install target: mah-plugins/opencode/  (via mah plugins install)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import path from "node:path"

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

// --- OpenCode-specific helpers (inlined from runtime-core-integrations.mjs) ---

function toPosix(t) { return `${t || ""}`.replaceAll(path.sep, "/") }
function rel(repoRoot, targetPath) { return toPosix(path.relative(repoRoot, targetPath)) }

function readYaml(targetPath) {
  const YAML = require("yaml")
  return YAML.parse(readFileSync(targetPath, "utf8"))
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
  writeFileSync(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

function stripFlags(argv, flags) {
  const flagSet = new Set(flags)
  return argv.filter((token) => !flagSet.has(token))
}

function parseOpencodeRunArgs(argv = []) {
  const hierarchy = argv.includes("--hierarchy") ? true : argv.includes("--no-hierarchy") ? false : null
  const passthrough = stripFlags(argv, ["--hierarchy", "--no-hierarchy"])
  return { hierarchy, passthrough }
}

function shouldUseOpencodeRunSubcommand(argv = []) {
  if (!Array.isArray(argv) || argv.length === 0) return false
  return argv.some((token) => {
    const value = `${token || ""}`.trim()
    if (!value) return false
    return !value.startsWith("-")
  })
}

function getAllowDelegateForCrew(repoRoot, crew) {
  const metaPath = path.join(repoRoot, "meta-agents.yaml")
  if (!existsSync(metaPath)) return null
  try {
    const meta = readYaml(metaPath)
    const crewConfig = meta?.crews?.find((item) => item.id === crew)
    return crewConfig?.runtime_overrides?.opencode?.permission?.task?.allow_delegate || null
  } catch { return null }
}

function patchOpencodeOrchestratorPrompt(repoRoot, crew, promptContent) {
  const match = `${promptContent || ""}`.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return promptContent
  let frontmatter = {}
  try {
    frontmatter = readYaml(match[1]) || {}
  } catch { return promptContent }

  const allowDelegate = getAllowDelegateForCrew(repoRoot, crew)
  const taskPermission = { "*": "deny" }
  if (allowDelegate && typeof allowDelegate === "object") {
    for (const [agent, allowedTargets] of Object.entries(allowDelegate)) {
      if (agent !== "orchestrator" || !Array.isArray(allowedTargets)) continue
      for (const target of allowedTargets) taskPermission[target] = "allow"
    }
  } else {
    taskPermission["planning-lead"] = "allow"
    taskPermission["engineering-lead"] = "allow"
    taskPermission["validation-lead"] = "allow"
  }

  frontmatter.permission = frontmatter.permission || {}
  frontmatter.permission.task = taskPermission
  const YAML = require("yaml")
  const updatedFrontmatter = YAML.stringify(frontmatter).trimEnd()
  return `---\n${updatedFrontmatter}\n---\n${match[2]}`
}

function materializeOpencodeAgents(repoRoot, crew, hierarchy) {
  const runtimeRoot = path.join(repoRoot, ".opencode")
  const sourceAgents = path.join(runtimeRoot, "crew", crew, "agents")
  const activeAgentsPath = path.join(runtimeRoot, "agents")
  removeIfExists(activeAgentsPath)
  mkdirSync(activeAgentsPath, { recursive: true })
  writeFileSync(path.join(activeAgentsPath, ".gitkeep"), "", "utf8")

  if (!existsSync(sourceAgents)) return
  const files = readdirSync(sourceAgents).filter((entry) => entry.endsWith(".md")).sort((a, b) => a.localeCompare(b))
  for (const file of files) {
    const sourcePath = path.join(sourceAgents, file)
    const targetPath = path.join(activeAgentsPath, file)
    if (hierarchy && file === "orchestrator.md") {
      writeFileSync(targetPath, patchOpencodeOrchestratorPrompt(repoRoot, crew, readFileSync(sourcePath, "utf8")), "utf8")
    } else {
      const relativeTarget = path.relative(path.dirname(targetPath), sourcePath)
      symlinkSync(relativeTarget, targetPath)
    }
  }
}

export const runtimePlugin = {
  name: "opencode",
  version: "1.0.0",
  mahVersion: "^0.5.0",

  adapter: {
    name: "opencode",
    markerDir: ".opencode",
    configPattern: ".opencode/crew/<crew>/multi-team.yaml",
    wrapper: null,
    directCli: "opencode",

    capabilities: {
      sessionModeNew: false,
      sessionModeContinue: true,
      sessionModeNone: false,
      sessionIdFlag: "--session-id",
      sessionRootFlag: false,
      sessionMirrorFlag: false,
      sessionContinueArgs: ["-c"],
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
    supportsSessionNew: false,
    sessionGlobalRoot: ".opencode/sessions",

    commands: {
      doctor: [["opencode", ["--help"]]],
      "check:runtime": [["opencode", ["--help"]]],
      validate: [["opencode", ["--help"]]],
      "validate:runtime": [["opencode", ["--help"]]]
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
        return { ok: false, error: "no OpenCode crew selected. Run 'mah use <crew>' or pass '--crew <crew>'." }
      }
      const parsed = parseOpencodeRunArgs(argv)
      const commandArgs = shouldUseOpencodeRunSubcommand(parsed.passthrough) ? ["run"] : []
      return {
        ok: true,
        exec: this.directCli,
        args: commandArgs,
        passthrough: parsed.passthrough,
        envOverrides: {
          ...envOverrides,
          MAH_RUNTIME: "opencode",
          MAH_ACTIVE_CREW: crew
        },
        warnings: [],
        internal: { crew, configPath, hierarchy: parsed.hierarchy }
      }
    },

    prepareHeadlessRunContext({ repoRoot, task = "", argv = [], envOverrides = {} }) {
      if (!task && (!argv || argv.length === 0)) {
        return {
          ok: false,
          error: "OpenCode headless requires a task prompt"
        }
      }
      return {
        ok: true,
        exec: "opencode",
        args: ["run"],
        passthrough: task ? [task] : argv,
        envOverrides: {
          ...envOverrides,
          OPENCODE_HEADLESS: "1"
        },
        warnings: [],
        internal: {
          mode: "headless",
          promptMode: "argv",
          runtime: "opencode"
        }
      }
    },

    activateCrew({ repoRoot, crewId, argv = [] }) {
      const runtimeRoot = path.join(repoRoot, ".opencode")
      const parse = parseOpencodeRunArgs(argv)
      const hierarchy = parse.hierarchy === true
      const sourceConfig = path.join(runtimeRoot, "crew", crewId, "multi-team.yaml")
      const sourceAgents = path.join(runtimeRoot, "crew", crewId, "agents")
      const sourceExpertise = path.join(runtimeRoot, "crew", crewId, "expertise")
      if (!existsSync(sourceConfig) || !existsSync(sourceAgents) || !existsSync(sourceExpertise)) {
        throw new Error(`OpenCode crew assets are incomplete for '${crewId}'`)
      }

      // Symlink the config
      const targetConfig = path.join(runtimeRoot, "multi-team.yaml")
      removeIfExists(targetConfig)
      symlinkSync(sourceConfig, targetConfig)

      // Materialize agents (symlinks or patched files)
      materializeOpencodeAgents(repoRoot, crewId, hierarchy)

      // Symlink expertise
      const targetExpertise = path.join(runtimeRoot, "expertise")
      removeIfExists(targetExpertise)
      symlinkSync(sourceExpertise, targetExpertise)

      const payload = {
        crew: crewId,
        source_config: rel(repoRoot, sourceConfig),
        source_agents: rel(repoRoot, sourceAgents),
        source_expertise: rel(repoRoot, sourceExpertise),
        hierarchy,
        selected_at: new Date().toISOString()
      }
      writeJson(path.join(runtimeRoot, ".active-crew.json"), payload)
      return payload
    },

    clearCrewState({ repoRoot }) {
      const runtimeRoot = path.join(repoRoot, ".opencode")
      removeIfExists(path.join(runtimeRoot, "multi-team.yaml"))
      removeIfExists(path.join(runtimeRoot, "agents"))
      removeIfExists(path.join(runtimeRoot, ".active-crew.json"))
      removeIfExists(path.join(runtimeRoot, "expertise"))
      return true
    },

    executePreparedRun({ repoRoot, plan, runCommand }) {
      const internal = plan.internal || {}
      if (internal.crew) {
        this.activateCrew({
          repoRoot,
          crewId: internal.crew,
          argv: internal.hierarchy === true ? ["--hierarchy"] : internal.hierarchy === false ? ["--no-hierarchy"] : []
        })
      }
      return runCommand(plan.exec, plan.args || [], plan.passthrough || [], plan.envOverrides || {})
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
    if (process.env.MAH_DEBUG_PLUGINS === "1") console.log(`[opencode] plugin loaded (MAH ${ctx.mahVersion})`)
  },
  teardown() {
    if (process.env.MAH_DEBUG_PLUGINS === "1") console.log("[opencode] plugin unloaded")
  }
}
