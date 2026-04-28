import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync } from "node:fs"
import path from "node:path"

const steps = [
  { name: "root dependencies", command: "npm", args: ["install"] },
  { name: "OpenCode dependencies", command: "npm", args: ["--prefix", ".opencode", "install"] },
  { name: "Claude dependencies", command: "npm", args: ["--prefix", ".claude", "install"] },
  { name: "PI dependencies", command: "npm", args: ["--prefix", ".pi", "install"] },
  { name: "Hermes dependencies", command: "npm", args: ["--prefix", ".hermes", "install"] }
]

for (const step of steps) {
  console.log(`setup: ${step.name}`)
  const child = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  })
  if (child.status !== 0) {
    process.exitCode = typeof child.status === "number" ? child.status : 1
    process.exit(process.exitCode)
  }
}

const mcpExamplePath = path.resolve(process.cwd(), ".mcp.example.json")
const mcpLocalPath = path.resolve(process.cwd(), ".mcp.json")
if (existsSync(mcpExamplePath) && !existsSync(mcpLocalPath)) {
  copyFileSync(mcpExamplePath, mcpLocalPath)
  console.log("setup: created .mcp.json from .mcp.example.json")
}

const bootstrapPath = path.resolve(process.cwd(), "scripts", "./bootstrap-meta-agents.mjs")
if (existsSync(bootstrapPath)) {
  console.log("setup: bootstrap meta-agents.yaml")
  const bootstrap = spawnSync("node", [bootstrapPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  })
  if (bootstrap.status !== 0) {
    process.exitCode = typeof bootstrap.status === "number" ? bootstrap.status : 1
    process.exit(process.exitCode)
  }
}

console.log("setup: done")
