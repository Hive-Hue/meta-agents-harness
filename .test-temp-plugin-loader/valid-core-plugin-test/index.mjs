
export const runtimePlugin = {
  name: "validcoretest",
  version: "0.1.0",
  mahVersion: ">=0.0.0",
  adapter: {
    name: "validcoretest",
    markerDir: ".validcoretest",
    wrapper: null,
    directCli: "validcoretest",
    capabilities: {
      sessionModeNew: true,
      sessionModeContinue: true,
      sessionModeNone: true,
      sessionIdViaEnv: "VALIDCORETEST_SESSION_ID",
      sessionRootFlag: "--session-root",
      sessionMirrorFlag: false
    },
    supportsSessions: true,
    sessionListCommand: null,
    sessionExportCommand: null,
    sessionDeleteCommand: null,
    supportsSessionNew: true,
    commands: {
      doctor: [["validcoretest", ["doctor"]]],
      "check:runtime": [["validcoretest", ["doctor"]]],
      validate: [["validcoretest", ["doctor"]]],
      "validate:runtime": [["validcoretest", ["doctor"]]]
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
