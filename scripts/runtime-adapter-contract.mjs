export const REQUIRED_RUNTIME_ADAPTER_FIELDS = [
  "name",
  "markerDir",
  "wrapper",
  "directCli",
  "capabilities",
  "commands",
  "detect",
  "supports",
  "resolveCommandPlan",
  "validateRuntime"
]

export const REQUIRED_RUNTIME_COMMANDS = [
  "list:crews",
  "use",
  "clear",
  "run",
  "doctor",
  "check:runtime",
  "validate",
  "validate:runtime"
]

export function validateRuntimeAdapterContract(adapters) {
  const errors = []
  for (const [runtimeName, adapter] of Object.entries(adapters || {})) {
    for (const field of REQUIRED_RUNTIME_ADAPTER_FIELDS) {
      if (!(field in adapter)) {
        errors.push(`${runtimeName}: missing field '${field}'`)
      }
    }
    for (const method of ["detect", "supports", "resolveCommandPlan", "validateRuntime"]) {
      if (typeof adapter?.[method] !== "function") {
        errors.push(`${runtimeName}: method '${method}' must be a function`)
      }
    }
    for (const command of REQUIRED_RUNTIME_COMMANDS) {
      if (!adapter?.commands?.[command]) {
        errors.push(`${runtimeName}: missing command '${command}'`)
      }
    }
    if (adapter?.name && adapter.name !== runtimeName) {
      errors.push(`${runtimeName}: adapter.name must match runtime key`)
    }
  }
  return { ok: errors.length === 0, errors }
}
