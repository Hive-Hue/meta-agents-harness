# Computer use — local agent-desktop broker

MAH exposes `mah computer init|doctor|mcp|pause|resume`. This is a **trusted single-user local integration**, not a sandbox, remote desktop service, credential vault, or semantic approval engine. Shell access as the same OS user can bypass these controls. Keep untrusted agents in a separately isolated environment.

## Install and configure

Install a pinned native [agent-desktop release](https://github.com/vercel-labs/agent-desktop/releases) on the OS whose apps you want to operate. Verify its release checksum. Keep the executable in a persistent location such as `%USERPROFILE%\.mah\agent-desktop\<version>` and set `command` to that path; a temporary folder can be cleaned and leave the broker unable to start. The broker never installs or updates a driver automatically. Windows apps require the Windows driver and broker; a Linux process in WSL uses Linux accessibility, not Windows UI Automation.

```sh
mah computer init
```

Edit `.mah/computer.json`. Set `command` to the native executable path, `expected_version` to the verified **MCP server version**, and `apps` to the explicit app names. The generated version placeholder deliberately refuses a connection; it is not automatic discovery or permission to install a binary. A validated release example is MCP `1.2.0`; its JSON envelope version `2.6` is a different field.

```json
{
  "schema": "mah.computer.v1",
  "environment_id": "local-desktop",
  "principal_id": "local-operator",
  "platform": "win32",
  "command": "C:/Tools/agent-desktop/agent-desktop.exe",
  "args": ["--headed"],
  "expected_version": "1.2.0",
  "apps": ["Your test application"],
  "allow_all_apps": false,
  "tools": ["*"],
  "allow_actions": false,
  "timeout_ms": 15000,
  "launch_timeout_ms": 60000,
  "max_actions": 50,
  "max_output_bytes": 20971520
}
```

`platform` uses Node OS identifiers (`win32`, `linux`, `darwin`). `timeout_ms` bounds ordinary tool calls; `launch_timeout_ms` gives permitted application startup a separate 60-second default (maximum 120 seconds). Policy belongs to the operator; do not delegate modification of this file to agents being restricted by it. `principal_id` is an audit label configured by the operator, not independently authenticated identity.

By default, `apps` is an exact-name allowlist. `allow_all_apps: true` explicitly bypasses that app-name allowlist for snapshot, launch, and enabled actions; do not use it for untrusted agents. Tool-level limits and action budgets still apply.

```sh
mah computer doctor
mah computer mcp
```

Doctor only requests the tool catalog and platform status, and does not inspect app contents. It skips driver requests during takeover. A version mismatch is reported as a failed check. MCP mirrors the tool names and argument schemas exposed by the pinned agent-desktop version, subject to MAH policy. Set `tools: ["*"]` to allow every command in that catalog, or list exact `desktop_*` tool names. Mutating tools are hidden until `allow_actions: true`; physical input tools also require `--headed` in `args`. App values are constrained to the configured allowlist unless `allow_all_apps: true`. Global system surfaces and screen-wide screenshots require `allow_all_apps: true`; app snapshots, search, screenshots and notifications require an allowed app when running with an allowlist. Read upstream skills `desktop` and the target platform before using GUI tools.

## Register with a runtime

Point a runtime's MCP configuration at **the MAH broker**, not directly at the unrestricted upstream MCP server. For a native Windows worker:

```json
{
  "mcpServers": {
    "mah-computer": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "D:/WSL/Github/meta-agents-harness/scripts/computer/computer-cli.mjs",
        "mcp",
        "--config",
        "D:/YourWorkspace/.mah/computer.json"
      ]
    }
  }
}
```

These are example paths, not auto-created installations. On Linux use Linux paths and `platform: linux`; provide a real graphical session with AT-SPI/D-Bus. The driver forwards selected display/session environment variables without forwarding provider API keys. `AGENT_DESKTOP_HOME` may point to a private driver state directory.

The canonical MAH registry is `.mah/mcp/servers.json`. Its server shape uses `type: "stdio"`, `command`, and `args`. Set explicit `runtime_bindings` for each runtime; an empty binding now means no tools for that runtime. Existing registry projections cover PI, Claude and OpenCode. Codex/Hermes or remote WSL→Windows deployments require their own verified runtime configuration; automatic parity is not claimed.

## Actions, pause and recovery

Actions are disabled by default. Enable the full action surface by setting `allow_actions: true` with `tools: ["*"]`, or enable exact commands individually. The broker forwards the pinned driver's schemas, including accessibility actions, screenshots, search, clipboard, waits, notifications, sessions, traces, app/window management, keyboard, mouse, cursor overlays, permissions and batch. Headed physical input commands require `--headed` and an observed app/window ID; pointer coordinates are confined to that window's most recently observed bounds. `desktop_press` also requires an observed app and window. `desktop_drag` requires an observed app/window and accepts accessibility refs or coordinates bounded to the window; `canvas_ref` adds a stricter canvas-bound path. `desktop_list_windows` returns IDs that MAH validates for app-scoped window tools; IDs and refs expire after mutations. `desktop_batch` only runs child commands enabled by MAH policy, applies the same app/window checks, and requires action permission. `max_actions` counts mutations and internally focused pointer operations, `max_output_bytes` bounds returned tool data, and a per-call timeout can extend the broker deadline up to 120 seconds. Clipboard reads/writes, screenshot file output, permission requests, session cleanup and trace export can expose or change local state; enable only the tools the runtime needs.

On Windows strict-headless runs, `desktop_type` may be refused because it synthesizes physical keystrokes. Prefer `desktop_set_value` for accessible text fields. Enable `--headed` when the requested use case needs physical typing, clicks or pointer movement.

- Every ref-based action requires a ref from the last successful snapshot of an allowed app in that broker connection. Ref-based actions consume the refs; launch also clears prior refs, so observe again before acting.
- The broker advertises the argument shapes returned by the pinned driver and adds app/window scope to physical input tools. It accepts a window ID only after `desktop_list_windows` observed it for the same app. `force` remains available only on upstream tools that define it and only when that tool is enabled by policy.
- Make one desktop tool call at a time and wait for its result. `DESKTOP_BUSY` means another operation is active; do not issue parallel calls or remove its lease. After a successful launch, take a new snapshot before acting.
- Snapshot the allowlisted app first when possible. If the app is already open, keep using that instance; launch only when it is absent and the user requested opening it.
- One operation owns the user's local desktop lease at a time, across broker processes and environment labels. Different environment IDs do not imply isolation.
- Policy changes are reloaded. App/tool revocation and takeover abort in-flight requests; successful driver shutdown precedes releasing the lease. A driver shutdown failure leaves the lease in place.
- Timeouts after a mutating call have unknown outcome. There is no automatic retry. Reconcile externally and restart the broker before further actions.
- `max_actions` is per broker connection. It is not an account spending budget or a cross-restart quota.

```sh
mah computer pause
# Human takes control; the broker stops new calls and aborts an in-flight call.
mah computer resume
# Observe again; old references have been revoked.
```

State lives under `~/.mah/computer/local-desktop`. The audit stores tool name, action ID, principal label, timestamps and outcome, not snapshot text, typed content or clipboard. Driver/transport results may still contain private UI data in the runtime conversation, so protect session storage. No persistent screenshot viewer is implemented.

A crash can leave `lease/owner.json`. Inspect the owning process and reconcile desktop state before removing a stale lease; age alone does not make it safe. No automatic deletion of uncertain leases is performed.

## Validation status — 2026-11-08

- Automated fixtures cover allowlists, argument refusal, consumed refs, app/tool revocation, shared lease, takeover, timeout, failed shutdown, version/platform checks and CLI bootstrap.
- Real Windows x64 `agent-desktop v1.2.0` is persisted under `%USERPROFILE%\\.mah\\agent-desktop\\v1.2.0`. With the local wildcard policy, MAH advertised all 67 tools and schemas; `desktop_version` and a batch containing only the read-only `version` command succeeded through the broker. `mah computer doctor` reported accessibility granted. No GUI app was operated during this catalog check.
- No personal app was edited. Snapshot/action end-to-end on a disposable GUI, Linux/macOS graphical compatibility, multi-runtime integration, remote isolation and unattended operation remain separate acceptance gates.

Sources: [upstream MCP guide](https://github.com/vercel-labs/agent-desktop/blob/main/apps/docs/content/docs/guides/mcp.mdx), [platform requirements](https://github.com/vercel-labs/agent-desktop/blob/main/README.md).
