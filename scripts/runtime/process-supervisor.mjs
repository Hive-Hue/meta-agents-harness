import { spawn } from "node:child_process"

export function runBoundedProcess(command, args, options = {}) {
  if (options.signal?.aborted) return Promise.resolve({ status: 1, stdout: "", stderr: "", reason: "cancelled", truncated: false })
  const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(Number(value), max)) : fallback
  const timeoutMs = bounded(options.timeoutMs, 600_000, 1, 3_600_000)
  const maxOutputBytes = bounded(options.maxOutputBytes, 1_048_576, 1024, 8_388_608)
  const graceMs = bounded(options.graceMs, 2_000, 1, 10_000)
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, { cwd: options.cwd, env: options.env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] })
    } catch (error) {
      resolve({ status: 1, stdout: "", stderr: error.message, error })
      return
    }
    let stdout = ""
    let stderr = ""
    let bytes = 0
    let truncated = false
    let reason = ""
    let closed = false
    const append = (kind, chunk) => {
      const remaining = maxOutputBytes - bytes
      if (remaining > 0) {
        const part = chunk.subarray(0, remaining)
        if (kind === "stdout") stdout += part.toString("utf8")
        else stderr += part.toString("utf8")
        bytes += part.length
      }
      if (chunk.length > remaining) truncated = true
    }
    child.stdout.on("data", (chunk) => append("stdout", chunk))
    child.stderr.on("data", (chunk) => append("stderr", chunk))
    const killTree = (force = false) => {
      if (closed || !child.pid) return
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])], { stdio: "ignore", windowsHide: true })
        killer.on("error", () => { try { child.kill(force ? "SIGKILL" : "SIGTERM") } catch {} })
      } else {
        try { process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM") } catch { try { child.kill(force ? "SIGKILL" : "SIGTERM") } catch {} }
      }
    }
    const stop = (why) => {
      if (reason || closed) return
      reason = why
      killTree()
      escalation = setTimeout(() => killTree(true), graceMs)
      escalation.unref?.()
    }
    let escalation
    const deadline = setTimeout(() => stop("deadline exceeded"), timeoutMs)
    deadline.unref?.()
    const onAbort = () => stop("cancelled")
    options.signal?.addEventListener("abort", onAbort, { once: true })
    if (options.signal?.aborted) onAbort()
    child.on("error", (error) => { if (!reason) reason = error.message })
    child.on("close", (code, signal) => {
      closed = true
      clearTimeout(deadline)
      clearTimeout(escalation)
      options.signal?.removeEventListener("abort", onAbort)
      resolve({ status: reason ? 1 : code ?? 1, stdout, stderr, signal, reason, truncated })
    })
  })
}
