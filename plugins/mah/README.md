# MAH Codex Plugin

Native Codex plugin that exposes bounded Meta Agents Harness operations as MCP tools.

## Installation

No global Codex installation is required for MAH-managed Codex sessions.

When you run:

```bash
mah --runtime codex run
```

the Codex runtime now injects the local `mah` MCP server automatically via `codex -c mcp_servers.mah=...`, using:

- the current Node executable
- the repo-local server at `plugins/mah/mcp/server.mjs`
- the MAH repo root as `cwd`

Optional standalone installation remains available if you want the same server outside MAH-managed sessions:

```bash
codex mcp add mah -- /home/alysson/.nvm/versions/node/v22.19.0/bin/node /home/alysson/Github/meta-agents-harness/plugins/mah/mcp/server.mjs
```

If your Stitch or other MCP credentials live in a shared `.env`, start Codex through the wrapper so those variables are loaded before the session begins:

```bash
MAH_CODEX_ENV_FILE=/home/alysson/Github/meta-agents-harness/.env \
  /home/alysson/Github/meta-agents-harness/scripts/codex-with-env.sh
```

## Usage

Select the crew and open the Codex runtime:

```bash
cd /home/alysson/Github/meta-agents-harness
mah --runtime codex use --crew dev
mah --runtime codex run
```

Inside the Codex session, use:

- `mah_get_active_context`
- `mah_list_agents`
- `mah_delegate_agent`

Typical flow:

1. Call `mah_get_active_context` to confirm active crew and current agent.
2. Call `mah_list_agents` to inspect valid routes from the current agent.
3. Call `mah_delegate_agent` with a bounded task and a valid target.

## Runtime Integration

For MAH-managed Codex sessions, the runtime injects the `mah` MCP server directly into the Codex launch arguments. This keeps the integration scoped to:

- the active MAH session
- the current workspace
- the current active crew and agent context

It also means:

- no manual edit of `~/.codex/config.toml` is required for `mah --runtime codex run`
- the plugin does not depend on global Codex state to be available
- standalone Codex sessions outside MAH can still use manual `codex mcp add` if desired

## Scope

This plugin keeps the existing `codex` runtime responsible for:

- selecting the active crew
- selecting the active agent
- projecting prompt and runtime context
- opening the Codex session

This plugin is responsible for:

- reporting active MAH runtime context
- listing the valid delegation topology for the current agent
- dispatching logical delegation requests through the MAH CLI delegation pipeline

## Tools

### `mah_get_active_context`

Returns:

- active crew
- current agent
- current role
- current team
- sprint metadata
- active config path
- context sources used to resolve state

### `mah_list_agents`

Returns:

- orchestrator
- leads
- workers
- allowed targets from the current agent
- reroute information for worker targets when the current agent is an orchestrator

### `mah_delegate_agent`

Receives:

- `target`
- `task`
- optional `target_runtime`
- optional `include_full_output`

Behavior:

- validates the target against the active crew graph
- reroutes orchestrator-to-worker requests through the owning lead
- executes `node scripts/meta-agents-harness.mjs delegate --target <effective-target> [--runtime <target_runtime>] --task <task> --execute`
- lets MAH select native same-runtime or cross-runtime sidecar adapter
- returns target resolution, status, elapsed time, summary, and optional full output

## Notes

- The plugin is intentionally bounded to the active Codex crew state.
- It does not replace the `codex` runtime adapter.
- It does not implement remote execution, federation, or cross-crew routing.
