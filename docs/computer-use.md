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
  "args": [],
  "expected_version": "1.2.0",
  "apps": ["Your test application"],
  "allow_all_apps": false,
  "tools": ["desktop_status", "desktop_version", "desktop_skills_get", "desktop_snapshot"],
  "allow_actions": false,
  "timeout_ms": 15000,
  "launch_timeout_ms": 60000,
  "max_actions": 50
}
```

`platform` uses Node OS identifiers (`win32`, `linux`, `darwin`). `timeout_ms` bounds ordinary tool calls; `launch_timeout_ms` gives permitted application startup a separate 60-second default (maximum 120 seconds). Policy belongs to the operator; do not delegate modification of this file to agents being restricted by it. `principal_id` is an audit label configured by the operator, not independently authenticated identity.

By default, `apps` is an exact-name allowlist. `allow_all_apps: true` explicitly bypasses that app-name allowlist for snapshot, launch, and enabled actions; do not use it for untrusted agents. Tool-level limits and action budgets still apply.

```sh
mah computer doctor
mah computer mcp
```

Doctor only requests the tool catalog and platform status, and does not inspect app contents. It skips driver requests during takeover. A version mismatch is reported as a failed check. MCP exposes only the permitted subset and validates each invocation. The `desktop_snapshot` and `desktop_launch` schemas list the exact configured app names; pass those names verbatim, including the executable suffix when present. Read upstream skills `desktop` and `platform` before using GUI tools.

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

Actions are disabled by default. An operator may set `allow_actions: true` and add individual tools. `desktop_focus_window` is app-scoped: it requires a window ID from the latest `desktop_list_windows` result for that exact app. Focusing a window counts as an action and invalidates observed refs and window IDs; list windows again before the next snapshot or focus. Ref-based UI tools are `desktop_click`, `desktop_type`, `desktop_set_value`, `desktop_check`, `desktop_uncheck`, and `desktop_select`. `desktop_drag` is a headed physical action: it requires `--headed` in driver `args`, a `canvas_ref` selected from `data.mah_canvases` in a fresh snapshot with `include_bounds: true`, and endpoints inside that element's captured bounds. The broker only issues canvas refs for accessibility elements whose names identify a canvas or drawing surface, and the refs expire after any mutation. Drag length and duration are limited. `desktop_list_windows` lists visible windows for one allowed app; if a snapshot is ambiguous, pass an ID from that result as `window_id` on `desktop_snapshot`. Those IDs expire after any mutation. `desktop_launch` accepts only an app identifier allowed by the policy plus optional `activate`; it rejects process arguments, environment variables, working-directory overrides, and other launch options. Launch and drag count against `max_actions` and revoke prior refs. This grants tool-level capability, not proof that every possible click is safe. Restrict the test app/environment accordingly.

On Windows strict-headless runs, `desktop_type` may be refused because it synthesizes physical keystrokes. Prefer `desktop_set_value` for accessible text fields; this broker does not expose headed input flags.

- Every ref-based action requires a ref from the last successful snapshot of an allowed app in that broker connection. Ref-based actions consume the refs; launch also clears prior refs, so observe again before acting.
- The broker advertises only argument shapes it supports. Snapshot supports `app`, the observed `window_id`, `interactive_only`, `compact`, `skeleton`, `max_depth`, and `include_bounds`. It refuses arbitrary surfaces and accepts a window ID only after `desktop_list_windows` observed that ID for the same app. Clipboard, raw keyboard/mouse, force and headed flags are not exposed as tools.
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

## Validation status — 2026-11-05

- Automated fixtures cover allowlists, argument refusal, consumed refs, app/tool revocation, shared lease, takeover, timeout, failed shutdown, version/platform checks and CLI bootstrap.
- Real Windows x64 `agent-desktop v1.2.0` was downloaded to a temporary directory; SHA-256 matched upstream checksums (`a4199f741a441cedd349bf56c5eba01783b1261258b498efeb7ec9945220c3e8`). MCP initialization, tool catalog and `desktop_status` succeeded and reported accessibility granted. This exposed the actual `max_depth` argument, which is now used by the broker.
- No personal app was edited. Snapshot/action end-to-end on a disposable GUI, Linux/macOS graphical compatibility, multi-runtime integration, remote isolation and unattended operation remain separate acceptance gates.

Sources: [upstream MCP guide](https://github.com/vercel-labs/agent-desktop/blob/main/apps/docs/content/docs/guides/mcp.mdx), [platform requirements](https://github.com/vercel-labs/agent-desktop/blob/main/README.md).
