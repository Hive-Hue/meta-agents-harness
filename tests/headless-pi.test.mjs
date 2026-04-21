import test from "node:test"
import assert from "node:assert/strict"
import { runtimePlugin } from "../plugins/runtime-pi/index.mjs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const adapter = runtimePlugin.adapter
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

test("PI adapter has headless capability", () => {
  assert.ok(adapter.capabilities?.headless)
})

test("PI headless is supported", () => {
  assert.strictEqual(adapter.capabilities.headless.supported, true)
})

test("PI prepareHeadlessRunContext returns valid envelope", () => {
  const result = adapter.prepareHeadlessRunContext({ repoRoot, task: "test" })
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.exec, "pi")
})

test("PI headless errors without task", () => {
  const result = adapter.prepareHeadlessRunContext({ repoRoot: "/tmp" })
  assert.strictEqual(result.ok, false)
})
