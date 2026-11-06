import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { runtimeCommandExists, spawnRuntimeSync } from "../scripts/runtime/process-launcher.mjs"

test("Windows runtime launcher resolves and starts a PATH .cmd shim", { skip: process.platform !== "win32" }, () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-runtime-shim-"))
  try {
    const shimPath = path.join(tempDir, "mah-test-runtime.cmd")
    writeFileSync(shimPath, "@echo off\r\necho runtime-shim-ok\r\n", "utf8")
    const env = {
      ...process.env,
      PATH: `${tempDir}${path.delimiter}${process.env.PATH || ""}`
    }

    assert.equal(runtimeCommandExists("mah-test-runtime", { cwd: tempDir, env }), true)
    const child = spawnRuntimeSync("mah-test-runtime", [], {
      cwd: tempDir,
      env,
      encoding: "utf8",
      windowsHide: true
    })
    assert.equal(child.error, null)
    assert.equal(child.status, 0, child.stderr)
    assert.match(child.stdout, /runtime-shim-ok/)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
