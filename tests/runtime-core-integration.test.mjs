import test from "node:test"
import assert from "node:assert/strict"
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")
const cliPath = path.join(repoRoot, "scripts", "meta-agents-harness.mjs")
const kiloActiveCrewFile = path.join(repoRoot, ".kilo", ".active-crew.json")

function removePath(targetPath) {
  try {
    rmSync(targetPath, { recursive: true, force: true })
  } catch (error) {
    if (error?.code !== "EROFS" && error?.code !== "EPERM") throw error
  }
}

function snapshotPath(targetPath) {
  const existed = existsSync(targetPath)
  const snapshotRoot = mkdtempSync(path.join(os.tmpdir(), "mah-runtime-state-"))
  const backupPath = path.join(snapshotRoot, "backup")
  let type = "missing"
  let symlinkTarget = ""

  if (existed) {
    const stat = lstatSync(targetPath)
    if (stat.isSymbolicLink()) {
      type = "symlink"
      symlinkTarget = readlinkSync(targetPath)
    } else if (stat.isDirectory()) {
      type = "dir"
      cpSync(targetPath, backupPath, { recursive: true })
    } else {
      type = "file"
      mkdirSync(path.dirname(backupPath), { recursive: true })
      cpSync(targetPath, backupPath)
    }
  }

  return () => {
    removePath(targetPath)
    if (!existed) {
      removePath(snapshotRoot)
      return
    }
    mkdirSync(path.dirname(targetPath), { recursive: true })
    if (type === "symlink") {
      symlinkSync(symlinkTarget, targetPath)
    } else if (type === "dir") {
      cpSync(backupPath, targetPath, { recursive: true })
    } else if (type === "file") {
      cpSync(backupPath, targetPath)
    }
    removePath(snapshotRoot)
  }
}

function snapshotPaths(paths) {
  const restores = paths.map(snapshotPath)
  return () => {
    for (const restore of restores.reverse()) restore()
  }
}

function run(args, options = {}) {
  const env = { ...process.env, ...(options.env || {}) }
  delete env.NODE_OPTIONS
  delete env.NODE_TEST_CONTEXT
  delete env.NODE_V8_COVERAGE
  const outputDir = mkdtempSync(path.join(os.tmpdir(), "mah-core-run-"))
  const stdoutPath = path.join(outputDir, "stdout.txt")
  const stderrPath = path.join(outputDir, "stderr.txt")
  const stdoutFd = openSync(stdoutPath, "w")
  const stderrFd = openSync(stderrPath, "w")
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", stdoutFd, stderrFd]
  })
  closeSync(stdoutFd)
  closeSync(stderrFd)
  return {
    status: result.status,
    stdout: existsSync(stdoutPath) ? readFileSync(stdoutPath, "utf-8") : "",
    stderr: existsSync(stderrPath) ? readFileSync(stderrPath, "utf-8") : ""
  }
}

for (const runtime of ["pi", "claude", "opencode", "hermes", "kilo", "codex"]) {
  test(`${runtime} list:crews is handled by MAH core without wrapper`, () => {
    const result = run(["--runtime", runtime, "list:crews"])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /crew=dev/)
    assert.match(result.stdout, /crew=marketing/)
  })
}

test("kilo use persists active crew via MAH core state", () => {
  const previous = existsSync(kiloActiveCrewFile) ? readFileSync(kiloActiveCrewFile, "utf-8") : null
  const restoreAgents = snapshotPath(path.join(repoRoot, ".kilo", "agents"))
  try {
    const result = run(["--runtime", "kilo", "use", "dev"])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /active_crew=dev/)
    const next = JSON.parse(readFileSync(kiloActiveCrewFile, "utf-8"))
    assert.equal(next.crew, "dev")
    assert.equal(next.source_config, ".kilo/crew/dev/multi-team.yaml")
    assert.equal(existsSync(path.join(repoRoot, ".kilo", "agents")), true)
  } finally {
    restoreAgents()
    if (previous === null) rmSync(kiloActiveCrewFile, { force: true })
    else writeFileSync(kiloActiveCrewFile, previous, "utf-8")
  }
})

test("codex use persists active crew and runtime artifacts via MAH core state", () => {
  const restore = () => {}
  try {
    const result = run(["--runtime", "codex", "use", "dev"])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /active_crew=dev/)
    assert.match(result.stdout, /source_config=\.codex\/crew\/dev\/multi-team\.yaml/)
    if (existsSync(path.join(repoRoot, ".codex", ".active-crew.json"))) {
      const next = JSON.parse(readFileSync(path.join(repoRoot, ".codex", ".active-crew.json"), "utf-8"))
      assert.equal(next.crew, "dev")
      assert.equal(next.source_config, ".codex/crew/dev/multi-team.yaml")
    }
  } finally {
    restore()
  }
})

test("pi use persists active crew and session root via MAH core state", () => {
  const restore = snapshotPaths([
    path.join(repoRoot, ".pi", ".active-crew.json"),
    path.join(repoRoot, ".pi", "crew", "dev", "sessions")
  ])
  try {
    const result = run(["--runtime", "pi", "use", "dev"])
    assert.equal(result.status, 0, result.stderr)
    const next = JSON.parse(readFileSync(path.join(repoRoot, ".pi", ".active-crew.json"), "utf-8"))
    assert.equal(next.crew, "dev")
    assert.equal(next.source_config, ".pi/crew/dev/multi-team.yaml")
    assert.equal(existsSync(path.join(repoRoot, ".pi", "crew", "dev", "sessions")), true)
  } finally {
    restore()
  }
})

test("claude use persists active crew via MAH core state", () => {
  const restore = snapshotPaths([
    path.join(repoRoot, ".claude", ".active-crew.json"),
    path.join(repoRoot, ".claude", "crew", "dev", "sessions")
  ])
  try {
    const result = run(["--runtime", "claude", "use", "dev"])
    assert.equal(result.status, 0, result.stderr)
    const next = JSON.parse(readFileSync(path.join(repoRoot, ".claude", ".active-crew.json"), "utf-8"))
    assert.equal(next.crew, "dev")
    assert.equal(next.source_config, ".claude/crew/dev/multi-team.yaml")
  } finally {
    restore()
  }
})

test("opencode use materializes active runtime tree via MAH core state", () => {
  const restore = snapshotPaths([
    path.join(repoRoot, ".opencode", ".active-crew.json"),
    path.join(repoRoot, ".opencode", "multi-team.yaml"),
    path.join(repoRoot, ".opencode", "agents"),
    path.join(repoRoot, ".opencode", "expertise")
  ])
  try {
    const result = run(["--runtime", "opencode", "use", "dev", "--hierarchy"])
    assert.equal(result.status, 0, result.stderr)
    const next = JSON.parse(readFileSync(path.join(repoRoot, ".opencode", ".active-crew.json"), "utf-8"))
    assert.equal(next.crew, "dev")
    assert.equal(next.source_config, ".opencode/crew/dev/multi-team.yaml")
    assert.equal(next.hierarchy, true)
    assert.equal(existsSync(path.join(repoRoot, ".opencode", "multi-team.yaml")), true)
    assert.equal(existsSync(path.join(repoRoot, ".opencode", "agents")), true)
  } finally {
    restore()
  }
})

test("hermes use persists active crew via MAH core state", () => {
  const restore = snapshotPaths([
    path.join(repoRoot, ".hermes", ".active-crew.json")
  ])
  try {
    const result = run(["--runtime", "hermes", "use", "dev"])
    assert.equal(result.status, 0, result.stderr)
    const next = JSON.parse(readFileSync(path.join(repoRoot, ".hermes", ".active-crew.json"), "utf-8"))
    assert.equal(next.crew, "dev")
    assert.equal(next.source_config, ".hermes/crew/dev/config.yaml")
  } finally {
    restore()
  }
})

test("kilo explain run resolves to direct cli with injected crew context", () => {
  const result = run(["--runtime", "kilo", "explain", "run", "--trace", "--crew", "dev"])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.runtime, "kilo")
  assert.equal(payload.command, "run")
  assert.equal(payload.exec, "kilo")
  assert.deepEqual(payload.execArgs, ["--agent", "orchestrator"])
  assert.ok(payload.env?.KILO_CONFIG_CONTENT, "expected KILO_CONFIG_CONTENT in env overrides")

  const kiloConfig = JSON.parse(payload.env.KILO_CONFIG_CONTENT)
  assert.equal(kiloConfig.default_agent, "orchestrator")
  assert.ok(kiloConfig.agent?.orchestrator, "expected orchestrator agent in Kilo config")
  assert.match(kiloConfig.agent.orchestrator.prompt, /Current crew id: dev/)
  assert.match(kiloConfig.agent.orchestrator.prompt, /Crew name: DevMultiTeam/)
  assert.match(kiloConfig.agent.orchestrator.prompt, /Current role: orchestrator/)
  assert.match(kiloConfig.agent.orchestrator.prompt, /Mission: Deliver bounded v0\.8\.0 Context Memory evolution/)
  assert.match(kiloConfig.agent.orchestrator.prompt, /Sprint: v0\.8\.0-context-memory/)
  assert.match(kiloConfig.agent.orchestrator.prompt, /Target release: v0\.8\.0/)
  assert.match(kiloConfig.agent.orchestrator.prompt, /Prompt source: \.kilo\/crew\/dev\/agents\/orchestrator\.md/)
  assert.match(kiloConfig.agent.orchestrator.prompt, /\[MAH_CONTEXT\]/)
  assert.match(kiloConfig.agent.orchestrator.prompt, /# Orchestrator/)
  assert.equal(kiloConfig.agent.orchestrator.prompt.startsWith("---"), false)
  assert.ok(kiloConfig.agent["backend-dev"], "expected crew worker agents in Kilo config")
  assert.equal(kiloConfig.agent["backend-dev"].mode, "subagent")
})

test("codex explain run resolves to interactive codex session with injected crew context", () => {
  const result = run(["--runtime", "codex", "explain", "run", "--trace", "--crew", "dev", "--agent", "planning-lead"])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.runtime, "codex")
  assert.equal(payload.command, "run")
  assert.equal(payload.exec, "codex")
  assert.equal(payload.env?.MAH_ACTIVE_CREW, "dev")
  assert.equal(payload.env?.MAH_AGENT, "planning-lead")
  assert.ok(Array.isArray(payload.execArgs))
  assert.equal(payload.execArgs[0], "-c")
  assert.match(payload.execArgs[1], /mcp_servers\.mah=\{/)
  assert.match(payload.execArgs[1], /plugins\/mah\/mcp\/server\.mjs/)
  assert.match(payload.execArgs[1], /startup_timeout_sec=120/)
  assert.equal(payload.execArgs.some((arg) => arg === "exec"), false)
  assert.equal(payload.execArgs.some((arg) => arg === "--full-auto"), false)
  assert.match(payload.execArgs.join(" "), /initial_messages=\[\{ role = "system"/)
  assert.match(payload.execArgs.join(" "), /Current agent: planning-lead/)
  assert.match(payload.execArgs.join(" "), /Current crew id: dev/)
  assert.match(payload.execArgs.join(" "), /Prompt source: \.codex\/crew\/dev\/agents\/planning_lead\.md/)
})

test("codex explain run switches to full-auto only in autonomous subagent mode", () => {
  const result = run([
    "--runtime",
    "codex",
    "explain",
    "run",
    "--trace",
    "--crew",
    "dev",
    "--agent",
    "planning-lead",
    "refactor",
    "the",
    "planner"
  ], {
    env: { MAH_CODEX_AUTONOMOUS: "1" }
  })
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.runtime, "codex")
  assert.equal(payload.command, "run")
  assert.equal(payload.exec, "codex")
  assert.equal(payload.env?.MAH_CODEX_AUTONOMOUS, "1")
  assert.equal(payload.env?.MAH_AGENT, "planning-lead")
  assert.ok(Array.isArray(payload.execArgs))
  assert.equal(payload.execArgs[0], "-c")
  assert.match(payload.execArgs[1], /mcp_servers\.mah=\{/)
  assert.match(payload.execArgs[1], /plugins\/mah\/mcp\/server\.mjs/)
  assert.match(payload.execArgs.join(" "), /exec/)
  assert.match(payload.execArgs.join(" "), /--full-auto/)
  assert.match(payload.execArgs.join(" "), /refactor the planner/)
  assert.match(payload.execArgs.join(" "), /initial_messages=\[\{ role = "system"/)
})

test("pi explain run resolves to direct cli with MAH session env", () => {
  const result = run(["--runtime", "pi", "explain", "run", "--trace", "--crew", "dev"])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.runtime, "pi")
  assert.equal(payload.exec, "pi")
  assert.ok(payload.env?.PI_MULTI_CONFIG)
  assert.ok(payload.env?.PI_MULTI_SESSION_ROOT)
  assert.ok(payload.env?.PI_MULTI_SESSION_ID)
})

test("claude explain run resolves to direct cli with generated agent context", () => {
  const result = run(["--runtime", "claude", "explain", "run", "--trace", "--crew", "dev", "--dry-run"])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.runtime, "claude")
  assert.equal(payload.exec, "claude")
  assert.equal(payload.execArgs[0], "--append-system-prompt")
  assert.ok(payload.execArgs.includes("--agents"))
})

test("opencode explain run resolves to direct cli without wrapper plan", () => {
  const result = run(["--runtime", "opencode", "explain", "run", "--trace", "--crew", "dev", "--hierarchy"])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.runtime, "opencode")
  assert.equal(payload.exec, "opencode")
  assert.deepEqual(payload.execArgs, ["-m", "minimax-coding-plan/MiniMax-M2.7"])
})

test("opencode explain run uses run subcommand when task prompt is provided", () => {
  const result = run(["--runtime", "opencode", "explain", "run", "--trace", "--crew", "dev", "--agent", "planning-lead", "test task"])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.runtime, "opencode")
  assert.equal(payload.exec, "opencode")
  assert.deepEqual(payload.execArgs, ["run", "-m", "zai-coding-plan/glm-5"])
  assert.deepEqual(payload.passthrough, ["test task", "--agent", "planning-lead"])
})

test("hermes explain run resolves to hermes chat with MAH bootstrap env", () => {
  const result = run(["--runtime", "hermes", "explain", "run", "--trace", "--crew", "dev"])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.runtime, "hermes")
  assert.equal(payload.exec, "hermes")
  assert.deepEqual(payload.execArgs, ["chat", "--provider", "minimax", "-m", "MiniMax-M2.7"])
  assert.equal(payload.env?.MAH_ACTIVE_CREW, "dev")
  assert.ok(payload.env?.MAH_HERMES_CONFIG)
  assert.ok(payload.env?.MAH_HERMES_MULTI_TEAM)
})
