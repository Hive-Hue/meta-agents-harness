
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
