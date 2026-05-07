#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const cwd = process.cwd()
const canonicalPath = path.join(cwd, ".mah", "mcp", "servers.json")
const mcpJsonPath = path.join(cwd, ".mcp.json")
const piMcpPath = path.join(cwd, ".pi", "mcp-servers.json")
const claudeSettingsPath = path.join(cwd, ".claude", "settings.local.json")
const opencodeSettingsPath = path.join(cwd, ".opencode", "opencode.json")

function printHelp() {
  console.log("mah mcp — MCP registry and runtime sync")
  console.log("")
  console.log("Usage:")
  console.log("  mah mcp list [--json]")
  console.log("  mah mcp add <name> --type <stdio|http> [--command <cmd>] [--arg <value> ...] [--url <url>] [--env KEY=VALUE ...] [--header KEY=VALUE ...] [--timeout-ms <n>] [--runtime <name> ...]")
  console.log("  mah mcp update <name> [--type <stdio|http>] [--command <cmd>] [--arg <value> ...] [--url <url>] [--env KEY=VALUE ...] [--header KEY=VALUE ...] [--timeout-ms <n>]")
  console.log("  mah mcp remove <name>")
  console.log("  mah mcp sync [--json]")
  console.log("")
  console.log("Canonical file:")
  console.log("  .mah/mcp/servers.json")
}

function parseFlags(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith("--")) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith("--")) {
      out[key] = true
      continue
    }
    if (out[key] === undefined) out[key] = next
    else if (Array.isArray(out[key])) out[key].push(next)
    else out[key] = [out[key], next]
    i += 1
  }
  return out
}

function listify(v) {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

function safeReadJson(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback
    return JSON.parse(readFileSync(filePath, "utf-8"))
  } catch {
    return fallback
  }
}

function writeJson(filePath, value) {
  const dir = path.dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

function normalizeServer(def) {
  const inferredType =
    def.type === "http" ||
    def.type === "remote" ||
    def.transport === "http" ||
    (typeof def.url === "string" && def.url.trim().length > 0)
      ? "http"
      : "stdio"
  const type = inferredType
  const base = {
    type,
    timeout_ms: Number.isFinite(Number(def.timeout_ms)) ? Number(def.timeout_ms) : 60000,
  }
  if (type === "http") {
    return {
      ...base,
      url: `${def.url || ""}`.trim(),
      headers: def.headers && typeof def.headers === "object" ? def.headers : undefined,
    }
  }
  return {
    ...base,
    command: `${def.command || ""}`.trim(),
    args: Array.isArray(def.args) ? def.args.map((x) => `${x}`) : [],
    env: def.env && typeof def.env === "object" ? def.env : undefined,
    cwd: def.cwd ? `${def.cwd}` : undefined,
  }
}

function normalizeRegistry(raw) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  const serversIn = input.servers && typeof input.servers === "object" ? input.servers : {}
  const runtimeBindingsIn = input.runtime_bindings && typeof input.runtime_bindings === "object" ? input.runtime_bindings : {}
  const servers = {}
  for (const [name, def] of Object.entries(serversIn)) {
    if (!name || typeof name !== "string") continue
    servers[name] = normalizeServer(def || {})
  }
  const runtimeBindings = {}
  for (const [runtime, names] of Object.entries(runtimeBindingsIn)) {
    if (!runtime || typeof runtime !== "string") continue
    runtimeBindings[runtime] = Array.from(new Set(listify(names).map((x) => `${x}`.trim()).filter(Boolean))).sort()
  }
  return {
    schema: "mah.mcp.registry.v1",
    servers,
    runtime_bindings: runtimeBindings,
  }
}

function mergeRuntimeHints(registry) {
  const next = normalizeRegistry(registry)
  const builtins = {
    stitch: normalizeServer({
      type: "http",
      url: "https://stitch.googleapis.com/mcp",
      timeout_ms: 300000,
      headers: {
        Accept: "application/json",
        Authorization: "Bearer ${STITCH_ACCESS_TOKEN}",
        "X-Goog-User-Project": "${GOOGLE_CLOUD_PROJECT}",
      },
    }),
  }

  const pi = safeReadJson(piMcpPath, {})
  const piServers = pi && typeof pi === "object" && pi.servers && typeof pi.servers === "object" ? pi.servers : {}
  for (const [name, def] of Object.entries(piServers)) {
    if (!name) continue
    const incoming = normalizeServer(def || {})
    const current = next.servers[name]
    if (!current) {
      next.servers[name] = incoming
      continue
    }
    if (current.type === "stdio" && !current.command && incoming.command) {
      next.servers[name] = incoming
    }
    if (current.type === "stdio" && !current.command && incoming.type === "http" && incoming.url) {
      next.servers[name] = incoming
    }
  }

  const opencode = safeReadJson(opencodeSettingsPath, {})
  const opencodeMcp = opencode && typeof opencode === "object" && opencode.mcp && typeof opencode.mcp === "object" ? opencode.mcp : {}
  for (const [name, def] of Object.entries(opencodeMcp)) {
    if (!name || !def || typeof def !== "object") continue
    const incoming = def.type === "remote"
      ? normalizeServer({
          type: "http",
          url: def.url,
          headers: def.headers,
          timeout_ms: def.timeout || def.timeout_ms,
        })
      : normalizeServer({
          type: "stdio",
          command: Array.isArray(def.command) ? def.command[0] : def.command,
          args: Array.isArray(def.command) ? def.command.slice(1) : [],
          env: def.environment,
          timeout_ms: def.timeout || def.timeout_ms,
        })
    const current = next.servers[name]
    if (!current) {
      next.servers[name] = incoming
      continue
    }
    if (current.type === "stdio" && !current.command && incoming.command) {
      next.servers[name] = incoming
    }
    if (current.type === "stdio" && !current.command && incoming.type === "http" && incoming.url) {
      next.servers[name] = incoming
    }
  }

  for (const [name, builtin] of Object.entries(builtins)) {
    const current = next.servers[name]
    if (!current) {
      next.servers[name] = builtin
      continue
    }
    if (current.type === "stdio" && !current.command) {
      next.servers[name] = builtin
    }
  }

  return next
}

function loadRegistry() {
  const fromCanonical = safeReadJson(canonicalPath, null)
  if (fromCanonical) return mergeRuntimeHints(fromCanonical)

  const legacy = safeReadJson(mcpJsonPath, { mcpServers: {} })
  const servers = {}
  for (const [name, def] of Object.entries(legacy.mcpServers || {})) {
    if (!name) continue
    const entry = {
      type: (def.transport || def.type || "stdio"),
      command: def.command,
      args: Array.isArray(def.args) ? def.args : [],
      env: def.env && typeof def.env === "object" ? def.env : undefined,
      cwd: def.cwd,
      timeout_ms: def.timeout_ms,
      url: def.url,
      headers: def.headers,
    }
    servers[name] = normalizeServer(entry)
  }
  return mergeRuntimeHints({ servers })
}

function saveRegistry(registry) {
  writeJson(canonicalPath, normalizeRegistry(registry))
}

function parseAssignments(values) {
  const out = {}
  for (const item of values) {
    const text = `${item || ""}`
    const idx = text.indexOf("=")
    if (idx <= 0) continue
    const key = text.slice(0, idx).trim()
    const val = text.slice(idx + 1).trim()
    if (!key) continue
    out[key] = val
  }
  return out
}

function toMcpJsonServer(def) {
  if (def.type === "http") {
    const out = {
      transport: "http",
      url: def.url,
    }
    if (def.headers && Object.keys(def.headers).length > 0) out.headers = def.headers
    if (def.timeout_ms) out.timeout_ms = def.timeout_ms
    return out
  }
  const out = {
    transport: "stdio",
    command: def.command,
    args: Array.isArray(def.args) ? def.args : [],
  }
  if (def.env && Object.keys(def.env).length > 0) out.env = def.env
  if (def.cwd) out.cwd = def.cwd
  if (def.timeout_ms) out.timeout_ms = def.timeout_ms
  return out
}

function toOpenCodeServer(def) {
  if (def.type === "http") {
    return {
      type: "remote",
      url: def.url,
      headers: def.headers && typeof def.headers === "object" ? def.headers : undefined,
      enabled: true,
      timeout: def.timeout_ms || 60000,
    }
  }
  return {
    type: "local",
    command: [def.command, ...(Array.isArray(def.args) ? def.args : [])],
    environment: def.env && typeof def.env === "object" ? def.env : undefined,
    enabled: true,
    timeout: def.timeout_ms || 60000,
  }
}

function resolveEnabledServers(registry, runtime) {
  const declared = listify(registry.runtime_bindings?.[runtime])
  if (declared.length > 0) return declared.filter((name) => registry.servers[name])
  return Object.keys(registry.servers).sort()
}

function syncToRuntimeFiles(registry) {
  const mcpServers = {}
  for (const [name, def] of Object.entries(registry.servers)) {
    mcpServers[name] = toMcpJsonServer(def)
  }
  writeJson(mcpJsonPath, { mcpServers })

  const piServers = {}
  for (const [name, def] of Object.entries(registry.servers)) {
    piServers[name] = toMcpJsonServer(def)
  }
  writeJson(piMcpPath, { servers: piServers })

  const claudeSettings = safeReadJson(claudeSettingsPath, {})
  claudeSettings.enabledMcpjsonServers = resolveEnabledServers(registry, "claude")
  writeJson(claudeSettingsPath, claudeSettings)

  const openCodeSettings = safeReadJson(opencodeSettingsPath, { "$schema": "https://opencode.ai/config.json" })
  const existingMcp = openCodeSettings.mcp && typeof openCodeSettings.mcp === "object" ? openCodeSettings.mcp : {}
  const enabledOpenCode = new Set(resolveEnabledServers(registry, "opencode"))
  const nextMcp = {}
  for (const [name, value] of Object.entries(existingMcp)) {
    if (!enabledOpenCode.has(name)) continue
    nextMcp[name] = value
  }
  for (const name of enabledOpenCode) {
    const def = registry.servers[name]
    if (!def) continue
    nextMcp[name] = toOpenCodeServer(def)
  }
  openCodeSettings.mcp = nextMcp
  writeJson(opencodeSettingsPath, openCodeSettings)

  return {
    canonical: path.relative(cwd, canonicalPath),
    files: [
      path.relative(cwd, mcpJsonPath),
      path.relative(cwd, piMcpPath),
      path.relative(cwd, claudeSettingsPath),
      path.relative(cwd, opencodeSettingsPath),
    ],
  }
}

function printJson(v) {
  console.log(JSON.stringify(v, null, 2))
}

async function main() {
  const argv = process.argv.slice(2)
  const sub = argv[0]
  const jsonMode = argv.includes("--json")

  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    printHelp()
    return
  }

  const registry = loadRegistry()

  if (sub === "list") {
    const rows = Object.entries(registry.servers)
      .map(([name, def]) => ({
        name,
        type: def.type,
        command: def.type === "stdio" ? `${def.command || ""} ${(def.args || []).join(" ")}`.trim() : def.url,
        command_bin: def.command || "",
        args: Array.isArray(def.args) ? def.args : [],
        url: def.url || "",
        env: def.env && typeof def.env === "object" ? def.env : {},
        headers: def.headers && typeof def.headers === "object" ? def.headers : {},
        timeout_ms: def.timeout_ms || 0,
        enabled_in: Object.entries(registry.runtime_bindings || {})
          .filter(([, names]) => listify(names).includes(name))
          .map(([runtime]) => runtime),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const payload = {
      ok: true,
      canonical_path: path.relative(cwd, canonicalPath),
      servers: rows,
      total: rows.length,
    }
    if (jsonMode) printJson(payload)
    else {
      console.log(`canonical=${payload.canonical_path}`)
      console.log(`total=${payload.total}`)
      for (const row of rows) {
        const enabled = row.enabled_in.length > 0 ? row.enabled_in.join(",") : "all(default)"
        console.log(`- ${row.name} [${row.type}] ${row.command} | enabled=${enabled}`)
      }
    }
    return
  }

  if (sub === "add") {
    const name = `${argv[1] || ""}`.trim()
    if (!name) {
      console.error("ERROR: missing server name")
      process.exitCode = 1
      return
    }
    const flags = parseFlags(argv.slice(2))
    const type = flags.type === "http" ? "http" : "stdio"

    const entry = {
      type,
      timeout_ms: Number.isFinite(Number(flags["timeout-ms"])) ? Number(flags["timeout-ms"]) : 60000,
    }

    if (type === "http") {
      const url = `${flags.url || ""}`.trim()
      if (!url) {
        console.error("ERROR: --url is required for --type http")
        process.exitCode = 1
        return
      }
      entry.url = url
      const headers = parseAssignments(listify(flags.header))
      if (Object.keys(headers).length > 0) entry.headers = headers
    } else {
      const command = `${flags.command || ""}`.trim()
      if (!command) {
        console.error("ERROR: --command is required for --type stdio")
        process.exitCode = 1
        return
      }
      entry.command = command
      entry.args = listify(flags.arg).map((x) => `${x}`)
      const env = parseAssignments(listify(flags.env))
      if (Object.keys(env).length > 0) entry.env = env
    }

    registry.servers[name] = normalizeServer(entry)
    const runtimes = listify(flags.runtime).map((x) => `${x}`.trim()).filter(Boolean)
    if (runtimes.length > 0) {
      for (const runtime of runtimes) {
        const current = new Set(listify(registry.runtime_bindings[runtime]))
        current.add(name)
        registry.runtime_bindings[runtime] = Array.from(current).sort()
      }
    }

    saveRegistry(registry)
    const sync = syncToRuntimeFiles(registry)
    if (jsonMode) printJson({ ok: true, added: name, synced: sync.files, canonical_path: sync.canonical })
    else {
      console.log(`added=${name}`)
      console.log(`canonical=${sync.canonical}`)
      console.log(`synced=${sync.files.join(",")}`)
    }
    return
  }

  if (sub === "update") {
    const name = `${argv[1] || ""}`.trim()
    if (!name) {
      console.error("ERROR: missing server name")
      process.exitCode = 1
      return
    }
    const existing = registry.servers[name]
    if (!existing) {
      console.error(`ERROR: server '${name}' not found`)
      process.exitCode = 1
      return
    }
    const flags = parseFlags(argv.slice(2))
    const type = flags.type === "http" ? "http" : flags.type === "stdio" ? "stdio" : existing.type
    const timeout = Number.isFinite(Number(flags["timeout-ms"])) ? Number(flags["timeout-ms"]) : existing.timeout_ms

    const entry = {
      type,
      timeout_ms: timeout,
    }

    if (type === "http") {
      const url = flags.url !== undefined ? `${flags.url || ""}`.trim() : `${existing.url || ""}`.trim()
      if (!url) {
        console.error("ERROR: --url is required for http MCP")
        process.exitCode = 1
        return
      }
      entry.url = url
      if (flags.header !== undefined) {
        entry.headers = parseAssignments(listify(flags.header))
      } else {
        entry.headers = existing.headers && typeof existing.headers === "object" ? existing.headers : undefined
      }
    } else {
      const command = flags.command !== undefined ? `${flags.command || ""}`.trim() : `${existing.command || ""}`.trim()
      if (!command) {
        console.error("ERROR: --command is required for stdio MCP")
        process.exitCode = 1
        return
      }
      entry.command = command
      if (flags.arg !== undefined) entry.args = listify(flags.arg).map((x) => `${x}`)
      else entry.args = Array.isArray(existing.args) ? existing.args : []
      if (flags.env !== undefined) entry.env = parseAssignments(listify(flags.env))
      else entry.env = existing.env && typeof existing.env === "object" ? existing.env : undefined
    }

    registry.servers[name] = normalizeServer(entry)
    saveRegistry(registry)
    const sync = syncToRuntimeFiles(registry)
    if (jsonMode) printJson({ ok: true, updated: name, synced: sync.files, canonical_path: sync.canonical })
    else {
      console.log(`updated=${name}`)
      console.log(`canonical=${sync.canonical}`)
      console.log(`synced=${sync.files.join(",")}`)
    }
    return
  }

  if (sub === "remove") {
    const name = `${argv[1] || ""}`.trim()
    if (!name) {
      console.error("ERROR: missing server name")
      process.exitCode = 1
      return
    }
    if (!registry.servers[name]) {
      console.error(`ERROR: server '${name}' not found`)
      process.exitCode = 1
      return
    }
    delete registry.servers[name]
    for (const runtime of Object.keys(registry.runtime_bindings || {})) {
      registry.runtime_bindings[runtime] = listify(registry.runtime_bindings[runtime]).filter((item) => item !== name)
      if (registry.runtime_bindings[runtime].length === 0) delete registry.runtime_bindings[runtime]
    }
    saveRegistry(registry)
    const sync = syncToRuntimeFiles(registry)
    if (jsonMode) printJson({ ok: true, removed: name, synced: sync.files, canonical_path: sync.canonical })
    else {
      console.log(`removed=${name}`)
      console.log(`canonical=${sync.canonical}`)
      console.log(`synced=${sync.files.join(",")}`)
    }
    return
  }

  if (sub === "sync") {
    saveRegistry(registry)
    const sync = syncToRuntimeFiles(registry)
    if (jsonMode) printJson({ ok: true, synced: sync.files, canonical_path: sync.canonical, servers: Object.keys(registry.servers).length })
    else {
      console.log(`canonical=${sync.canonical}`)
      console.log(`servers=${Object.keys(registry.servers).length}`)
      console.log(`synced=${sync.files.join(",")}`)
    }
    return
  }

  console.error(`ERROR: unknown subcommand '${sub}'`)
  printHelp()
  process.exitCode = 1
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
