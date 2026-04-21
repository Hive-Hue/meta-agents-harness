import test from "node:test"
import assert from "node:assert/strict"
import { runtimePlugin } from "../plugins/runtime-kilo/index.mjs"

const adapter = runtimePlugin.adapter

test("Kilo adapter has headless capability", () => {
  assert.ok(adapter.capabilities?.headless)
})

test("Kilo headless is supported", () => {
  assert.strictEqual(adapter.capabilities.headless.supported, true)
})

test("Kilo prepareHeadlessRunContext returns valid envelope", () => {
  const result = adapter.prepareHeadlessRunContext({ repoRoot: "/tmp", task: "test" })
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.exec, "kilo")
  assert.deepEqual(result.args, ["run"])
  assert.deepEqual(result.passthrough, ["test"])
  assert.strictEqual(result.envOverrides.KILO_HEADLESS, "1")
})

test("Kilo headless errors without task", () => {
  const result = adapter.prepareHeadlessRunContext({ repoRoot: "/tmp" })
  assert.strictEqual(result.ok, false)
  assert.ok(result.error)
})
