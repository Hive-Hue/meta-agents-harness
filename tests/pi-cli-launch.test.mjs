import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { resolvePiCliLaunch } from "../scripts/runtime/pi-cli-launch.mjs"

test("Windows Pi child launch uses pi-launcher.js through Node", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "mah-pi-launch-"))
  try {
    const bin = path.join(home, ".pi", "agent", "bin")
    mkdirSync(bin, { recursive: true })
    const launcher = path.join(bin, "pi-launcher.js")
    writeFileSync(launcher, "", "utf8")
    const plan = resolvePiCliLaunch(["--version"], {
      platform: "win32",
      home,
      env: {},
      execPath: "C:/node/node.exe"
    })

    assert.equal(plan.command, "C:/node/node.exe")
    assert.deepEqual(plan.args, [launcher, "--version"])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("non-Windows Pi child launch keeps the native CLI command", () => {
  const args = ["--version"]
  assert.deepEqual(resolvePiCliLaunch(args, { platform: "linux" }), { command: "pi", args })
})
