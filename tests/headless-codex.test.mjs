import test from "node:test"
import assert from "node:assert/strict"
import { runtimePlugin } from "../plugins/codex/index.mjs"

const adapter = runtimePlugin.adapter

test("Codex adapter has headless capability", () => {
  assert.ok(adapter.capabilities?.headless)
})

test("Codex headless is not supported", () => {
  assert.strictEqual(adapter.capabilities.headless.supported, false)
})

test("Codex prepareHeadlessRunContext returns unsupported error", () => {
  const result = adapter.prepareHeadlessRunContext({ repoRoot: "/tmp", task: "test" })
  assert.strictEqual(result.ok, false)
  assert.ok(result.error)
})
