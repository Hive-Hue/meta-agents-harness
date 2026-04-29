
export const runtimePlugin = {
  name: "plugin2",
  version: "0.1.0",
  mahVersion: ">=0.8.0",
  adapter: {
    name: "plugin2",
    markerDir: ".plugin2",
    wrapper: "plugin2mh",
    directCli: "plugin2",
    capabilities: {
      sessionModeNew: true,
      sessionModeContinue: true,
      sessionModeNone: true,
      sessionIdViaEnv: "PLUGIN2_SESSION_ID",
      sessionRootFlag: "--session-root",
      sessionMirrorFlag: false
    },
    supportsSessions: true,
    sessionListCommand: null,
    sessionExportCommand: null,
    sessionDeleteCommand: null,
    supportsSessionNew: true,
    commands: {
      "list:crews": [["plugin2mh", ["list:crews"]]],
      use: [["plugin2mh", ["use"]]],
      clear: [["plugin2mh", ["clear"]]],
      run: [["plugin2mh", ["run"]]],
      doctor: [["plugin2mh", ["doctor"]]],
      "check:runtime": [["plugin2mh", ["check:runtime"]]],
      validate: [["plugin2mh", ["validate"]]],
      "validate:runtime": [["plugin2mh", ["validate:runtime"]]]
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
