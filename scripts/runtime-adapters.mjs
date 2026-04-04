export const RUNTIME_ORDER = ["pi", "claude", "opencode"]

function createAdapter(definition) {
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
      const candidates = variants.map(([exec, args]) => ({ exec, args, exists: commandExistsFn(exec) }))
      const selected = candidates.find((item) => item.exists)
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

export const RUNTIME_ADAPTERS = {
  pi: createAdapter({
    name: "pi",
    markerDir: ".pi",
    wrapper: "pimh",
    directCli: "pi",
    capabilities: {
      sessionModeNew: true,
      sessionModeContinue: true,
      sessionIdViaEnv: "PI_MULTI_SESSION_ID",
      sessionRootFlag: "--session-root",
      sessionMirrorFlag: false
    },
    commands: {
      "list:crews": [["node", [".pi/bin/pimh", "list:crews"]], ["pimh", ["list:crews"]], ["npm", ["--prefix", ".pi", "run", "list:crews"]]],
      use: [["node", [".pi/bin/pimh", "use"]], ["pimh", ["use"]], ["npm", ["--prefix", ".pi", "run", "use:crew", "--"]]],
      clear: [["node", [".pi/bin/pimh", "clear"]], ["pimh", ["clear"]], ["npm", ["--prefix", ".pi", "run", "clear:crew"]]],
      run: [["node", [".pi/bin/pimh", "run"]], ["pimh", ["run"]], ["npm", ["--prefix", ".pi", "run", "run:crew", "--"]]],
      doctor: [["node", [".pi/bin/pimh", "doctor"]], ["pimh", ["doctor"]], ["npm", ["--prefix", ".pi", "run", "doctor", "--"]]],
      "check:runtime": [["node", [".pi/bin/pimh", "check:runtime"]], ["pimh", ["check:runtime"]], ["npm", ["--prefix", ".pi", "run", "check:runtime"]]],
      validate: [["node", [".pi/bin/pimh", "check:runtime"]], ["pimh", ["check:runtime"]], ["npm", ["--prefix", ".pi", "run", "check:runtime"]]],
      "validate:runtime": [["node", [".pi/bin/pimh", "check:runtime"]], ["pimh", ["check:runtime"]], ["npm", ["--prefix", ".pi", "run", "check:runtime"]]]
    }
  }),
  claude: createAdapter({
    name: "claude",
    markerDir: ".claude",
    wrapper: "ccmh",
    directCli: "claude",
    capabilities: {
      sessionModeNew: false,
      sessionModeContinue: true,
      sessionIdFlag: "--session-id",
      sessionRootFlag: false,
      sessionMirrorFlag: true
    },
    commands: {
      "list:crews": [["node", [".claude/bin/ccmh", "list:crews"]], ["ccmh", ["list:crews"]], ["npm", ["--prefix", ".claude", "run", "list:crews"]]],
      use: [["node", [".claude/bin/ccmh", "use"]], ["ccmh", ["use"]], ["npm", ["--prefix", ".claude", "run", "use:crew", "--"]]],
      clear: [["node", [".claude/bin/ccmh", "clear"]], ["ccmh", ["clear"]], ["npm", ["--prefix", ".claude", "run", "clear:crew"]]],
      run: [["node", [".claude/bin/ccmh", "run"]], ["ccmh", ["run"]], ["npm", ["--prefix", ".claude", "run", "run:crew", "--"]]],
      doctor: [["node", [".claude/bin/ccmh", "doctor"]], ["ccmh", ["doctor"]], ["npm", ["--prefix", ".claude", "run", "doctor", "--"]]],
      "check:runtime": [["node", [".claude/bin/ccmh", "check:runtime"]], ["ccmh", ["check:runtime"]], ["npm", ["--prefix", ".claude", "run", "check:runtime"]]],
      validate: [["node", [".claude/bin/ccmh", "check:runtime"]], ["ccmh", ["check:runtime"]], ["npm", ["--prefix", ".claude", "run", "check:runtime"]]],
      "validate:runtime": [["node", [".claude/bin/ccmh", "check:runtime"]], ["ccmh", ["check:runtime"]], ["npm", ["--prefix", ".claude", "run", "check:runtime"]]]
    }
  }),
  opencode: createAdapter({
    name: "opencode",
    markerDir: ".opencode",
    wrapper: "ocmh",
    directCli: "opencode",
    capabilities: {
      sessionModeNew: false,
      sessionModeContinue: true,
      sessionIdFlag: "--session-id",
      sessionRootFlag: false,
      sessionMirrorFlag: false
    },
    commands: {
      "list:crews": [["node", [".opencode/bin/ocmh", "list:crews"]], ["ocmh", ["list:crews"]], ["npm", ["--prefix", ".opencode", "run", "list:crews"]]],
      use: [["node", [".opencode/bin/ocmh", "use"]], ["ocmh", ["use"]], ["npm", ["--prefix", ".opencode", "run", "use:crew", "--"]]],
      clear: [["node", [".opencode/bin/ocmh", "clear"]], ["ocmh", ["clear"]], ["npm", ["--prefix", ".opencode", "run", "clear:crew"]]],
      run: [["node", [".opencode/bin/ocmh", "run"]], ["ocmh", ["run"]], ["npm", ["--prefix", ".opencode", "run", "run:crew", "--"]]],
      doctor: [["node", [".opencode/bin/ocmh", "doctor"]], ["ocmh", ["doctor"]], ["npm", ["--prefix", ".opencode", "run", "doctor", "--"]]],
      "check:runtime": [["node", [".opencode/bin/ocmh", "check:runtime"]], ["ocmh", ["check:runtime"]], ["npm", ["--prefix", ".opencode", "run", "check:runtime"]]],
      validate: [["node", [".opencode/bin/ocmh", "check:runtime"]], ["ocmh", ["check:runtime"]], ["npm", ["--prefix", ".opencode", "run", "check:runtime"]]],
      "validate:runtime": [["node", [".opencode/bin/ocmh", "check:runtime"]], ["ocmh", ["check:runtime"]], ["npm", ["--prefix", ".opencode", "run", "check:runtime"]]]
    }
  })
}
