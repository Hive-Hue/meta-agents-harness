#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import process from "node:process"

function printUsage() {
  console.log(`Usage:
  node scripts/security/generate-stitch-secrets.mjs --project-id <PROJECT_ID> [--env-file .env]

Writes GOOGLE_CLOUD_PROJECT and STITCH_ACCESS_TOKEN into the target env file without replacing the rest of the file.
`)
}

function parseArgs(argv) {
  const args = {
    projectId: (process.env.PROJECT_ID || "").trim(),
    envFile: ".env",
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      return { help: true }
    }
    if (arg === "--project-id" || arg === "--project") {
      args.projectId = `${argv[i + 1] || ""}`.trim()
      i += 1
      continue
    }
    if (arg.startsWith("--project-id=")) {
      args.projectId = arg.slice("--project-id=".length).trim()
      continue
    }
    if (arg.startsWith("--project=")) {
      args.projectId = arg.slice("--project=".length).trim()
      continue
    }
    if (arg === "--env-file") {
      args.envFile = `${argv[i + 1] || ""}`.trim() || ".env"
      i += 1
      continue
    }
    if (arg.startsWith("--env-file=")) {
      args.envFile = arg.slice("--env-file=".length).trim() || ".env"
    }
  }

  return args
}

function fail(message) {
  console.error(`generate-stitch-secrets: ${message}`)
  process.exit(1)
}

function runGcloud(args, { capture = false } = {}) {
  const result = spawnSync("gcloud", args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf-8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  })

  if (result.error) {
    fail(`failed to run gcloud ${args.join(" ")}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    process.exit(typeof result.status === "number" ? result.status : 1)
  }

  return capture ? `${result.stdout || ""}`.trim() : ""
}

function serializeEnvValue(value) {
  return JSON.stringify(`${value}`)
}

function updateEnvFile(envPath, updates) {
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf-8") : ""
  const lines = existing ? existing.split(/\r?\n/) : []
  const seen = new Set()
  const nextLines = lines.map((line) => {
    const match = line.match(/^(?<prefix>\s*(?:export\s+)?)?(?<key>[A-Za-z_][A-Za-z0-9_]*)=(?<value>.*)$/)
    if (!match?.groups?.key) return line
    const key = match.groups.key
    if (!(key in updates)) return line
    seen.add(key)
    const prefix = match.groups.prefix || ""
    return `${prefix}${key}=${serializeEnvValue(updates[key])}`
  })

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${serializeEnvValue(value)}`)
    }
  }

  const normalized = nextLines.join("\n").replace(/\n*$/, "\n")
  writeFileSync(envPath, normalized, "utf-8")
}

function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.help) {
    printUsage()
    return
  }

  const projectId = `${parsed.projectId || ""}`.trim()
  if (!projectId) {
    printUsage()
    fail("missing --project-id <PROJECT_ID>")
  }

  const envPath = path.resolve(process.cwd(), parsed.envFile)

  runGcloud(["auth", "login"])
  runGcloud(["auth", "application-default", "login"])
  runGcloud(["config", "set", "project", projectId])
  runGcloud(["beta", "services", "mcp", "enable", "stitch.googleapis.com", `--project=${projectId}`])

  const userEmail = runGcloud(["config", "get-value", "account"], { capture: true })
  if (!userEmail) {
    fail("gcloud config get-value account returned an empty account name")
  }

  runGcloud([
    "projects",
    "add-iam-policy-binding",
    projectId,
    `--member=user:${userEmail}`,
    "--role=roles/serviceusage.serviceUsageConsumer",
    "--condition=None",
  ])

  const token = runGcloud(["auth", "application-default", "print-access-token"], { capture: true })
  if (!token) {
    fail("gcloud auth application-default print-access-token returned an empty token")
  }

  updateEnvFile(envPath, {
    GOOGLE_CLOUD_PROJECT: projectId,
    STITCH_ACCESS_TOKEN: token,
  })

  console.log(`generate-stitch-secrets: updated ${path.relative(process.cwd(), envPath) || envPath}`)
  console.log("generate-stitch-secrets: wrote GOOGLE_CLOUD_PROJECT and STITCH_ACCESS_TOKEN")
}

main()
