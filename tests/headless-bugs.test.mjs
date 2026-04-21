import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"
import { runtimePlugin } from "../plugins/runtime-pi/index.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const harnessPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")

test("stripHeadlessArgs removes '--' passthrough separator", () => {
  const src = readFileSync(harnessPath, "utf-8")
  const fnStart = src.indexOf("function stripHeadlessArgs(argv)")
  assert.ok(fnStart >= 0, "stripHeadlessArgs must exist")
  const fnSlice = src.slice(fnStart, fnStart + 260)
  assert.match(fnSlice, /item !== "--"/, "stripHeadlessArgs must remove '--'")
})

test("dispatchHeadless forwards task to adapter.prepareHeadlessRunContext", () => {
  const src = readFileSync(harnessPath, "utf-8")
  const dispatchStart = src.indexOf("function dispatchHeadless(runtime, command, passthrough, outputMode = \"text\")")
  assert.ok(dispatchStart >= 0, "dispatchHeadless must exist")
  const dispatchSlice = src.slice(dispatchStart, dispatchStart + 1200)
  assert.match(dispatchSlice, /task:\s*normalized\.args\.join\(" "\)/, "dispatchHeadless must pass task")
})

test("PI headless includes default extensions", () => {
  const adapter = runtimePlugin.adapter
  const result = adapter.prepareHeadlessRunContext({
    repoRoot,
    task: "just echo: ok!"
  })

  assert.strictEqual(result.ok, true)
  const extensionFlags = result.args.filter((token) => token === "-e")
  assert.ok(extensionFlags.length > 0, "headless args must include PI extensions")
  assert.deepStrictEqual(result.args.slice(-1), ["-p"])
})

test("headless run path exits via process.exit", () => {
  const src = readFileSync(harnessPath, "utf-8")
  const marker = "if (command === \"run\" && hasHeadlessFlag(argv)) {"
  const start = src.indexOf(marker)
  assert.ok(start >= 0, "headless run block must exist")
  const block = src.slice(start, start + 500)
  assert.match(block, /process\.exit\(exitCode\)/, "headless run must call process.exit")
  assert.doesNotMatch(block, /process\.exitCode\s*=\s*typeof result\.status/, "headless run must not only set process.exitCode")
})
