// Fake runtime plugin for testing plugin loading system

function createFakeAdapter(definition) {
  return {
    ...definition,
    detect(cwd, existsFn) {
      return existsFn(`${cwd}/${this.markerDir}`)
    },
    supports(command) {
      return Array.isArray(this.commands?.[command]) && this.commands[command].length > 0
    },
    resolveCommandPlan(command, commandExistsFn) {
      const variants = this.commands?.[command] || []
      if (variants.length === 0) return { ok: false, error: `command not supported: ${command}`, variants: [] }
      const candidates = variants.map(([exec, args]) => ({
        exec,
        args,
        exists: commandExistsFn(exec),
        usable: true
      }))
      const selected = candidates.find((item) => item.usable)
      if (!selected) return { ok: false, error: `no executable available for ${command}`, variants: candidates }
      return { ok: true, exec: selected.exec, args: selected.args, variants: candidates }
    },
    validateRuntime(commandExistsFn) {
      const checks = [
        { name: "marker_dir", ok: Boolean(this.markerDir) },
        { name: "wrapper_declared", ok: Boolean(this.wrapper) },
        { name: "direct_cli_declared", ok: Boolean(this.directCli) },
        { name: "wrapper_available", ok: Boolean(this.wrapper) ? commandExistsFn(this.wrapper) : false },
        { name: "direct_cli_available", ok: Boolean(this.directCli) ? commandExistsFn(this.directCli) : false }
      ]
      const hasCommandTable = Object.keys(this.commands || {}).length > 0
      checks.push({ name: "commands_declared", ok: hasCommandTable })
      const ok = checks.every((item) => item.ok || item.name.endsWith("_available"))
      return { ok, checks }
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
    sessionModeNone: true,
    sessionIdViaEnv: "FAKE_SESSION_ID",
    sessionRootFlag: "--session-root",
    sessionMirrorFlag: false
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
  mahVersion: "^0.8.0",
  adapter,
  init(ctx) {
    // called after loading successful
  },
  teardown() {
    // called before MAH exits
  }
}
