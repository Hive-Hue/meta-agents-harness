import test from "node:test"
import assert from "node:assert/strict"
import { runtimePlugin } from "../plugins/runtime-codex/index.mjs"

const adapter = runtimePlugin.adapter

test("Codex adapter has headless capability", () => {
  assert.ok(adapter.capabilities?.headless)
})

test("Codex headless is supported", () => {
  assert.strictEqual(adapter.capabilities.headless.supported, true)
})

test("Codex prepareHeadlessRunContext returns executable plan", () => {
  const result = adapter.prepareHeadlessRunContext({ repoRoot: "/tmp/repo", task: "test task" })
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.exec, "codex")
  assert.deepEqual(result.args, ["exec", "--cd", "/tmp/repo", "--full-auto"])
  assert.deepEqual(result.passthrough, ["test task"])
})
