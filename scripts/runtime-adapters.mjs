import { existsSync } from "node:fs"
import path from "node:path"
import {
  activateClaudeCrewState,
  activateHermesCrewState,
  activateOpencodeCrewState,
  activatePiCrewState,
  clearClaudeCrewState,
  clearHermesCrewState,
  clearOpencodeCrewState,
  clearPiCrewState,
  executeClaudePreparedRun,
  executeHermesPreparedRun,
  executeOpencodePreparedRun,
  prepareClaudeHeadlessRunContext,
  prepareClaudeRunContext,
  prepareHermesHeadlessRunContext,
  prepareHermesRunContext,
  prepareOpencodeHeadlessRunContext,
  prepareOpencodeRunContext,
  preparePiHeadlessRunContext,
  preparePiRunContext
} from "./runtime-core-integrations.mjs"

export const RUNTIME_ORDER = ["pi", "claude", "opencode", "hermes"]

function variantPathExists(candidatePath) {
  if (!candidatePath || typeof candidatePath !== "string") return false
  const absolutePath = path.isAbsolute(candidatePath)
    ? candidatePath
    : path.resolve(process.cwd(), candidatePath)
  return existsSync(absolutePath)
}

function variantExecutableAvailable(exec, args, commandExistsFn) {
  if (!commandExistsFn(exec)) return false
  if (exec === "node") {
    return variantPathExists(args?.[0])
  }
  if (exec === "npm") {
    const prefixIndex = Array.isArray(args) ? args.indexOf("--prefix") : -1
    if (prefixIndex === -1 || !args?.[prefixIndex + 1]) return true
    const prefixDir = args[prefixIndex + 1]
    return variantPathExists(prefixDir) && variantPathExists(path.join(prefixDir, "package.json"))
  }
  return true
}

export function createAdapter(definition) {
  return {
    ...definition,
    detect(cwd, existsFn) {
      return existsFn(`${cwd}/${this.markerDir}`)
    },
    supports(command) {
      if (command === "run" && typeof this.prepareRunContext === "function") return true
      if (["list:crews", "use", "clear"].includes(command) && !this.commands?.[command]) return true
      return Array.isArray(this.commands?.[command]) && this.commands[command].length > 0
    },
    resolveCommandPlan(command, commandExistsFn) {
      const variants = this.commands?.[command] || []
      if (variants.length === 0) return { ok: false, error: `command not supported: ${command}`, variants: [] }
      const candidates = variants.map(([exec, args]) => ({
        exec,
        args,
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
      const ok = checks.every((item) =>
        item.ok ||
        item.name === "wrapper_declared" ||
        item.name.endsWith("_available")
      )
      return { ok, checks }
    }
  }
}

export const RUNTIME_ADAPTERS = {
  pi: createAdapter({
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
    activateCrew(context) {
      return activatePiCrewState(context)
    },
    clearCrewState(context) {
      return clearPiCrewState(context)
    },
    prepareRunContext(context) {
      return preparePiRunContext(context)
    },
    prepareHeadlessRunContext(context) {
      return preparePiHeadlessRunContext(context)
    }
  }),
  claude: createAdapter({
    name: "claude",
    markerDir: ".claude",
    configPattern: ".claude/crew/<crew>/multi-team.yaml",
    wrapper: null,
    directCli: "claude",
    capabilities: {
      sessionModeNew: false,
      sessionModeContinue: true,
      sessionModeNone: true,
      sessionIdFlag: "--session-id",
      sessionRootFlag: false,
      sessionMirrorFlag: true,
      sessionContinueArgs: ["--continue"],
      sessionNoneArgs: ["--print", "--no-session-persistence"],
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
    commands: {
      doctor: [["claude", ["--help"]]],
      "check:runtime": [["claude", ["--help"]]],
      validate: [["claude", ["--help"]]],
      "validate:runtime": [["claude", ["--help"]]]
    },
    activateCrew(context) {
      return activateClaudeCrewState(context)
    },
    clearCrewState(context) {
      return clearClaudeCrewState(context)
    },
    prepareRunContext(context) {
      return prepareClaudeRunContext(context)
    },
    executePreparedRun(context) {
      return executeClaudePreparedRun(context)
    },
    prepareHeadlessRunContext(context) {
      return prepareClaudeHeadlessRunContext(context)
    }
  }),
  opencode: createAdapter({
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
    activateCrew(context) {
      return activateOpencodeCrewState(context)
    },
    clearCrewState(context) {
      return clearOpencodeCrewState(context)
    },
    prepareRunContext(context) {
      return prepareOpencodeRunContext(context)
    },
    executePreparedRun(context) {
      return executeOpencodePreparedRun(context)
    },
    prepareHeadlessRunContext(context) {
      return prepareOpencodeHeadlessRunContext(context)
    }
  }),
  hermes: createAdapter({
    name: "hermes",
    markerDir: ".hermes",
    configPattern: ".hermes/crew/<crew>/config.yaml",
    wrapper: null,
    directCli: "hermes",
    capabilities: {
      sessionModeNew: true,
      sessionModeContinue: true,
      sessionModeNone: false,
      sessionIdViaEnv: "HERMES_SESSION_ID",
      sessionRootFlag: "--session-root",
      sessionMirrorFlag: false,
      sessionNewArgs: ["--new-session"],
      sessionContinueArgs: ["-c"],
      persistentMemory: true,
      supportsBackgroundOperation: true,
      supportsMultiBackendExecution: true,
      gatewayAware: true,
      headless: {
        supported: true,
        native: true,
        requiresSession: true,
        promptMode: "argv",
        outputMode: "mixed"
      }
    },
    supportsSessions: true,
    sessionListCommand: null,
    sessionExportCommand: null,
    sessionDeleteCommand: null,
    supportsSessionNew: true,
    commands: {
      doctor: [["hermes", ["doctor"]]],
      "check:runtime": [["hermes", ["doctor"]]],
      validate: [["hermes", ["doctor"]]],
      "validate:runtime": [["hermes", ["doctor"]]]
    },
    activateCrew(context) {
      return activateHermesCrewState(context)
    },
    clearCrewState(context) {
      return clearHermesCrewState(context)
    },
    prepareRunContext(context) {
      return prepareHermesRunContext(context)
    },
    executePreparedRun(context) {
      return executeHermesPreparedRun(context)
    },
    prepareHeadlessRunContext(context) {
      return prepareHermesHeadlessRunContext(context)
    }
  })
}
