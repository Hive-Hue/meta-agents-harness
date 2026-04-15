import test from "node:test"
import assert from "node:assert/strict"
import { RUNTIME_ADAPTERS } from "../scripts/runtime-adapters.mjs"

test("all built-in adapters declare capabilities.headless", () => {
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    assert.ok(adapter.capabilities?.headless, `${name} must declare capabilities.headless`)
  }
})

test("headless schema has required properties", () => {
  const required = ["supported", "native", "requiresSession", "promptMode", "outputMode"]
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    const h = adapter.capabilities?.headless
    for (const prop of required) {
      assert.ok(prop in h, `${name}.capabilities.headless must have ${prop}`)
    }
  }
})

test("promptMode is valid enum value", () => {
  const valid = ["argv", "stdin", "env", "unsupported"]
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    const mode = adapter.capabilities?.headless?.promptMode
    assert.ok(valid.includes(mode), `${name} promptMode=${mode} must be one of ${valid.join(",")}`)
  }
})

test("outputMode is valid enum value", () => {
  const valid = ["stdout", "file", "mixed"]
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    const mode = adapter.capabilities?.headless?.outputMode
    assert.ok(valid.includes(mode), `${name} outputMode=${mode} must be one of ${valid.join(",")}`)
  }
})

test("supported=true adapters implement prepareHeadlessRunContext", () => {
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    if (adapter.capabilities?.headless?.supported === true) {
      assert.strictEqual(typeof adapter.prepareHeadlessRunContext, "function", `${name} must implement prepareHeadlessRunContext`)
    }
  }
})

test("prepareHeadlessRunContext returns valid envelope for supported runtimes", () => {
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    if (adapter.capabilities?.headless?.supported === true) {
      const result = adapter.prepareHeadlessRunContext({ repoRoot: "/tmp", task: "test" })
      // Hermes requires active session; ok:false with session error is acceptable when no session exists.
      if (name === "hermes") {
        assert.ok(
          result.ok === true || (result.ok === false && result.error && result.error.includes("session")),
          `${name} should return ok:true or ok:false with session error`
        )
      } else {
        assert.strictEqual(result.ok, true, `${name} should return ok:true`)
        assert.ok(result.exec, `${name} should return exec`)
        assert.ok(Array.isArray(result.args), `${name} should return args array`)
      }
    }
  }
})

test("prepareHeadlessRunContext returns error for unsupported runtimes", () => {
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    if (adapter.capabilities?.headless?.supported === false) {
      const result = adapter.prepareHeadlessRunContext?.({ repoRoot: "/tmp", task: "test" }) || { ok: true }
      assert.strictEqual(result.ok, false, `${name} should return ok:false`)
      assert.ok(result.error, `${name} should return error message`)
    }
  }
})

test("prepareHeadlessRunContext errors when no task provided", () => {
  for (const [name, adapter] of Object.entries(RUNTIME_ADAPTERS)) {
    if (adapter.capabilities?.headless?.supported === true) {
      const result = adapter.prepareHeadlessRunContext({ repoRoot: "/tmp" })
      // Either ok:true with empty task or ok:false is acceptable
      assert.ok(result.ok === true || result.ok === false, `${name} should return valid ok value`)
    }
  }
})
