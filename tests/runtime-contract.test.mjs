import test from "node:test"
import assert from "node:assert/strict"
import { RUNTIME_ADAPTERS } from "../scripts/runtime-adapters.mjs"
import { validateRuntimeAdapterContract } from "../scripts/runtime-adapter-contract.mjs"

test("runtime adapters satisfy minimal contract", () => {
  const result = validateRuntimeAdapterContract(RUNTIME_ADAPTERS)
  assert.equal(result.ok, true, result.errors.join("\n"))
})
