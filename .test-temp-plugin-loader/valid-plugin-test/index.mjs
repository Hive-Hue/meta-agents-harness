
export const runtimePlugin = {
  name: "validtest",
  version: "0.1.0",
  mahVersion: ">=0.0.0",
  adapter: {
    name: "validtest",
    markerDir: ".validtest",
    wrapper: "validtestmh",
    directCli: "validtest",
    capabilities: {
      sessionModeNew: true,
      sessionModeContinue: true,
      sessionModeNone: true,
      sessionIdViaEnv: "VALIDTEST_SESSION_ID",
      sessionRootFlag: "--session-root",
      sessionMirrorFlag: false
    },
    supportsSessions: true,
    sessionListCommand: null,
    sessionExportCommand: null,
    sessionDeleteCommand: null,
    supportsSessionNew: true,
    commands: {
      "list:crews": [["validtestmh", ["list:crews"]]],
      use: [["validtestmh", ["use"]]],
      clear: [["validtestmh", ["clear"]]],
      run: [["validtestmh", ["run"]]],
      doctor: [["validtestmh", ["doctor"]]],
      "check:runtime": [["validtestmh", ["check:runtime"]]],
      validate: [["validtestmh", ["validate"]]],
      "validate:runtime": [["validtestmh", ["validate:runtime"]]]
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
