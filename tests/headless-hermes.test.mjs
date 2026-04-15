import test from "node:test"
import assert from "node:assert/strict"
import { runtimePlugin } from "../plugins/runtime-hermes/index.mjs"

const adapter = runtimePlugin.adapter

test("Hermes adapter has headless capability", () => {
  assert.ok(adapter.capabilities?.headless)
})

test("Hermes headless is supported", () => {
  assert.strictEqual(adapter.capabilities.headless.supported, true)
})

test("Hermes prepareHeadlessRunContext errors without session context", () => {
  const result = adapter.prepareHeadlessRunContext({ repoRoot: "/tmp", task: "test" })
  assert.strictEqual(result.ok, false)
  assert.ok(result.error)
})

test("Hermes prepareHeadlessRunContext returns valid envelope with session", () => {
  const result = adapter.prepareHeadlessRunContext({
    repoRoot: "/tmp",
    task: "test",
    envOverrides: { HERMES_SESSION_ID: "session-123" }
  })
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.exec, "hermes")
})
