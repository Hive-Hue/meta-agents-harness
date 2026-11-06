import { spawnSync as nodeSpawnSync } from "node:child_process"
import crossSpawn from "cross-spawn"

export function spawnRuntimeSync(command, args = [], options = {}) {
  const spawnSync = process.platform === "win32" ? crossSpawn.sync : nodeSpawnSync
  return spawnSync(command, args, options)
}

export function runtimeCommandExists(command, { cwd = process.cwd(), env = process.env } = {}) {
  const probe = process.platform === "win32"
    ? nodeSpawnSync("where.exe", [command], { cwd, env, stdio: "ignore" })
    : nodeSpawnSync("bash", ["-lc", `command -v ${command} >/dev/null 2>&1`], { cwd, env })
  return probe.status === 0
}
