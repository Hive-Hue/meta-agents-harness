import test from "node:test"
import assert from "node:assert/strict"
import { runtimePlugin } from "../plugins/runtime-claude/index.mjs"

const adapter = runtimePlugin.adapter

test("Claude adapter has headless capability", () => {
  assert.ok(adapter.capabilities?.headless)
})

test("Claude headless is supported", () => {
  assert.strictEqual(adapter.capabilities.headless.supported, true)
})

test("Claude prepareHeadlessRunContext returns valid envelope", () => {
  const result = adapter.prepareHeadlessRunContext({ repoRoot: "/tmp", task: "test" })
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.exec, "claude")
})

test("Claude headless errors without task", () => {
  const result = adapter.prepareHeadlessRunContext({ repoRoot: "/tmp" })
  assert.strictEqual(result.ok, false)
})
