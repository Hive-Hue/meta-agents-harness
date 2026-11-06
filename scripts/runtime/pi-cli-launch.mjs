import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export function resolvePiCliLaunch(args = [], options = {}) {
  const platform = options.platform || process.platform
  if (platform !== "win32") return { command: "pi", args }

  const env = options.env || process.env
  const home = options.home || os.homedir()
  const directories = [
    env.PI_CODING_AGENT_DIR ? path.join(env.PI_CODING_AGENT_DIR, "bin") : "",
    path.join(home, ".pi", "agent", "bin"),
    ...(env.PATH || "").split(path.delimiter)
  ].filter(Boolean)
  const launcher = [...new Set(directories)]
    .map((directory) => path.join(directory, "pi-launcher.js"))
    .find((candidate) => (options.exists || existsSync)(candidate))

  if (!launcher) return { command: "pi", args }
  return {
    command: options.execPath || process.execPath,
    args: [launcher, ...args]
  }
}
