export const REQUIRED_RUNTIME_ADAPTER_FIELDS = [
  "name",
  "markerDir",
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

function hasCoreManagedCommandSupport(adapter, command) {
  if (!adapter || typeof adapter !== "object") return false
  if (command === "run") return typeof adapter.prepareRunContext === "function"
  return ["list:crews", "use", "clear"].includes(command)
}

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
    if ("prepareRunContext" in (adapter || {}) && typeof adapter?.prepareRunContext !== "function") {
      errors.push(`${runtimeName}: method 'prepareRunContext' must be a function when provided`)
    }
    for (const optionalMethod of ["activateCrew", "clearCrewState", "executePreparedRun"]) {
      if (optionalMethod in (adapter || {}) && typeof adapter?.[optionalMethod] !== "function") {
        errors.push(`${runtimeName}: method '${optionalMethod}' must be a function when provided`)
      }
    }
    for (const command of REQUIRED_RUNTIME_COMMANDS) {
      if (!adapter?.commands?.[command] && !hasCoreManagedCommandSupport(adapter, command)) {
        errors.push(`${runtimeName}: missing command '${command}'`)
      }
    }
    if (adapter?.name && adapter.name !== runtimeName) {
      errors.push(`${runtimeName}: adapter.name must match runtime key`)
    }
  }
  return { ok: errors.length === 0, errors }
}
