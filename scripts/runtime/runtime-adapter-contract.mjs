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

export const HEADLESS_CAPABILITY_PROPERTIES = [
  "supported",
  "native",
  "requiresSession",
  "promptMode",
  "outputMode"
]

export const VALID_PROMPT_MODES = ["argv", "stdin", "env", "unsupported"]
export const VALID_OUTPUT_MODES = ["stdout", "file", "mixed"]

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
    for (const optionalMethod of ["activateCrew", "clearCrewState", "executePreparedRun", "prepareHeadlessRunContext"]) {
      if (optionalMethod in (adapter || {}) && typeof adapter?.[optionalMethod] !== "function") {
        errors.push(`${runtimeName}: method '${optionalMethod}' must be a function when provided`)
      }
    }

    // Validate headless capability schema if declared
    if (adapter?.capabilities?.headless) {
      const headless = adapter.capabilities.headless
      for (const prop of HEADLESS_CAPABILITY_PROPERTIES) {
        if (!(prop in headless)) {
          errors.push(`${runtimeName}: capabilities.headless missing '${prop}'`)
        }
      }
      if (headless.promptMode && !VALID_PROMPT_MODES.includes(headless.promptMode)) {
        errors.push(`${runtimeName}: capabilities.headless.promptMode must be one of: ${VALID_PROMPT_MODES.join(", ")}`)
      }
      if (headless.outputMode && !VALID_OUTPUT_MODES.includes(headless.outputMode)) {
        errors.push(`${runtimeName}: capabilities.headless.outputMode must be one of: ${VALID_OUTPUT_MODES.join(", ")}`)
      }
      // If headless is supported, prepareHeadlessRunContext should be declared
      if (headless.supported === true && typeof adapter?.prepareHeadlessRunContext !== "function") {
        errors.push(`${runtimeName}: capabilities.headless.supported=true requires prepareHeadlessRunContext method`)
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
