import { spawnSync } from "node:child_process"

const steps = [
  { name: "root dependencies", command: "npm", args: ["install"] },
  { name: "OpenCode dependencies", command: "npm", args: ["--prefix", ".opencode", "install"] },
  { name: "Claude dependencies", command: "npm", args: ["--prefix", ".claude", "install"] },
  { name: "PI dependencies", command: "npm", args: ["--prefix", ".pi", "install"] }
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

console.log("setup: done")
