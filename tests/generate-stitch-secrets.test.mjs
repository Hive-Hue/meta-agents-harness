import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

test("generate-stitch-secrets updates only the stitch env keys in place", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "mah-stitch-secrets-"))
  const binDir = path.join(tempDir, "bin")
  mkdirSync(binDir, { recursive: true })

  const fakeGcloud = path.join(binDir, "gcloud")
  writeFileSync(
    fakeGcloud,
    `#!/usr/bin/env node
const args = process.argv.slice(2)
const key = args.join(" ")
if (key === "config get-value account") {
  process.stdout.write("user@example.com\\n")
  process.exit(0)
}
if (key === "auth application-default print-access-token") {
  process.stdout.write("token-abc123\\n")
  process.exit(0)
}
process.exit(0)
`,
    { mode: 0o755 },
  )

  const envPath = path.join(tempDir, ".env")
  writeFileSync(
    envPath,
    `# existing env
FOO=bar
GOOGLE_CLOUD_PROJECT="old-project"
`,
    "utf-8",
  )

  const result = spawnSync(
    process.execPath,
    [
      path.join("/home/alysson/Github/meta-agents-harness", "scripts", "generate-stitch-secrets.mjs"),
      "--project-id",
      "814663988227",
      "--env-file",
      envPath,
    ],
    {
      cwd: tempDir,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
      },
      encoding: "utf-8",
    },
  )

  assert.equal(result.status, 0, result.stderr || result.stdout)

  const updated = readFileSync(envPath, "utf-8")
  assert.match(updated, /FOO=bar/)
  assert.match(updated, /GOOGLE_CLOUD_PROJECT="814663988227"/)
  assert.match(updated, /STITCH_ACCESS_TOKEN="token-abc123"/)
  assert.ok(!updated.includes(".env.stitch"))
})
