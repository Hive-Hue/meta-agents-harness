import test from "node:test"
import assert from "node:assert/strict"
import { runtimePlugin } from "../plugins/runtime-opencode/index.mjs"

const adapter = runtimePlugin.adapter

test("OpenCode adapter has headless capability", () => {
  assert.ok(adapter.capabilities?.headless)
})

test("OpenCode headless is supported", () => {
  assert.strictEqual(adapter.capabilities.headless.supported, true)
})

test("OpenCode prepareHeadlessRunContext returns valid envelope", () => {
  const result = adapter.prepareHeadlessRunContext({ repoRoot: "/tmp", task: "test" })
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.exec, "opencode")
  assert.deepStrictEqual(result.args, ["run"])
  assert.deepStrictEqual(result.passthrough, ["test"])
})

test("OpenCode headless errors without task", () => {
  const result = adapter.prepareHeadlessRunContext({ repoRoot: "/tmp" })
  assert.strictEqual(result.ok, false)
})
