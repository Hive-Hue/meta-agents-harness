# Plugin API for Runtimes — v0.6.0

A formal plugin system for adding new runtimes to MAH without modifying core files. Installed plugins persist across MAH updates, are fully uninstallable, and integrate transparently with all MAH commands.

Plugins can integrate in two ways:
- wrapper-based, where the plugin dispatches through a runtime-specific shim
- core-integrated, where MAH manages crew state and generated artifacts, and the plugin translates that context into the runtime's direct CLI

---

## Overview

Before v0.6.0, adding a new runtime required editing two core files:
- `scripts/runtime-adapters.mjs` — add `createAdapter({...})`
- `scripts/meta-agents-harness.mjs` — add the runtime to `RUNTIME_ORDER`

This meant custom runtimes required permanent forks and merge conflicts on every MAH update.

The Plugin API solves this by having MAH scan designated directories for plugins at startup. No core files are touched.

---

## Architecture

### Discovery locations

Plugins are discovered from two locations on startup:

| Location | Format | Use case |
|---|---|---|
| `mah-plugins/<name>/` | `plugin.json` + `index.mjs` | Local, operator-controlled |
| `node_modules/@mah/runtime-<name>/` | `package.json` + `index.mjs` | npm-installed, team-shared |

### Built-ins vs plugins

The four built-in runtimes (`pi`, `claude`, `opencode`, `hermes`) are always loaded from `RUNTIME_ADAPTERS`. They **always win** over any plugin that claims the same name — this is enforced at the registry level.

### Plugin registry merge order

```
RUNTIME_ADAPTERS (built-ins, loaded first)
    + discovered plugins
    = runtimeProfiles (used by all commands)
```

---

## Plugin contract

Every plugin must export a `runtimePlugin` object. The minimal shape:

```js
// mah-plugins/runtime-kilo/index.mjs
export const runtimePlugin = {
  // --- Identification (all required) ---
  name: "kilo",                      // unique string — used in mah detect, --runtime
  version: "1.0.0",                  // semver
  mahVersion: "^0.6.0",             // semver range of MAH compatibility

  // --- RuntimeAdapter (required) ---
  adapter: {
    name: "kilo",
    markerDir: ".kilo",              // directory checked for auto-detection
    configPattern: ".kilo/crew/<crew>/multi-team.yaml",
    wrapper: null,                   // optional compatibility shim
    directCli: "kilo",               // direct CLI executable name
    capabilities: {
      sessionModeNew: true,
      sessionModeContinue: true,
      sessionModeNone: true,
      sessionIdFlag: "--session-id",
      sessionRootFlag: "--session-root",
      sessionMirrorFlag: false
    },
    supportsSessions: true,
    sessionListCommand: null,
    sessionExportCommand: null,
    sessionDeleteCommand: null,
    supportsSessionNew: true,
    commands: {
      "doctor": [["kilo", ["debug"]]],
      "check:runtime": [["kilo", ["doctor"]]],
      "validate": [["kilo", ["doctor"]]],
      "validate:runtime": [["kilo", ["doctor"]]]
    },
    prepareRunContext({ repoRoot, crew, configPath, argv }) {
      // Helpers omitted for brevity: readYaml(), resolveFromRepo(), and loadPromptBody().
      const multiTeam = readYaml(configPath)
      const orchestrator = multiTeam.orchestrator
      const orchestratorPromptBody = loadPromptBody(resolveFromRepo(repoRoot, orchestrator.prompt))

      return {
        ok: true,
        exec: this.directCli,
        args: argv.length > 0 ? ["run", "--agent", orchestrator.name] : ["--agent", orchestrator.name],
        passthrough: argv,
        envOverrides: {
          KILO_CONFIG_CONTENT: JSON.stringify({
            default_agent: orchestrator.name,
            agent: {
              [orchestrator.name]: {
                description: orchestrator.description,
                model: orchestrator.model,
                mode: "primary",
                prompt: [
                  `Current crew id: ${crew}`,
                  `Crew name: ${multiTeam.name || "n/a"}`,
                  `Current agent: ${orchestrator.name}`,
                  `Current role: orchestrator`,
                  `Mission: ${multiTeam.mission || "n/a"}`,
                  `Prompt source: ${orchestrator.prompt}`,
                  orchestratorPromptBody ? `Agent operating prompt:\n${orchestratorPromptBody}` : ""
                ].filter(Boolean).join("\n\n")
              }
            }
          })
        },
        warnings: []
      }
    }
  },

  // --- Lifecycle hooks (optional) ---
  init(ctx) {
    // called after plugin is loaded and registered
    // ctx contains { name, version, mahVersion }
  },
  teardown() {
    // called before MAH exits or when plugin is unloaded
  }
}
```

For Kilo, `KILO_CONFIG_CONTENT` is the config channel the CLI actually reads; the plugin merges that JSON with any existing Kilo config before spawning `kilo`.
Compose the `prompt` as plain text and strip YAML frontmatter before injecting it, so the agent keeps the crew context in the body that Kilo actually uses.

### Required adapter fields

The adapter must pass the same `validateRuntimeAdapterContract` check that built-in runtimes use. Required fields:

| Field | Description |
|---|---|
| `name` | Must match the plugin's top-level `name` |
| `markerDir` | Directory name that signals this runtime is present |
| `directCli` | Direct CLI executable name |
| `capabilities` | Session and feature support flags |
| `commands` | Object mapping command names to variant arrays |
| `supportsSessions` | Boolean |
| `supportsSessionNew` | Boolean |

`wrapper` is supported but optional. Use it only when the runtime still needs a compatibility shim outside the MAH core.

### Required commands

Every adapter must support these MAH commands:

- `list:crews`
- `use`
- `clear`
- `run`
- `doctor`
- `check:runtime`
- `validate`
- `validate:runtime`

Support can come from either:
- adapter `commands` entries with `[executable, args]` variants tried in order
- MAH core-managed behavior

Core-managed support currently covers:
- `list:crews`, `use`, and `clear` when the runtime follows the generated tree under `markerDir/crew/<crew>/...`
- `run` when the adapter exposes `prepareRunContext()`

In practice, wrapperless plugins still need to declare command-table entries for `doctor`, `check:runtime`, `validate`, and `validate:runtime`.

---

## Plugin manifest (`mah-plugins/` format)

```
mah-plugins/<name>/
  plugin.json       — metadata (name, version, mahVersion, entry)
  index.mjs         — exports runtimePlugin
```

### plugin.json

```json
{
  "name": "kilo",
  "version": "1.0.0",
  "mahVersion": "^0.6.0",
  "entry": "index.mjs"
}
```

The `plugin.json` metadata is informational. Validation is driven entirely by the `runtimePlugin` export in `index.mjs`.

## Headless Capability

Runtimes can declare headless execution support via `capabilities.headless`:

```js
capabilities: {
  headless: {
    supported: boolean,        // true if runtime has non-interactive path
    native: boolean,          // true if headless is native
    requiresSession: boolean, // true if session is required for headless
    promptMode: "argv" | "stdin" | "env" | "unsupported",
    outputMode: "stdout" | "file" | "mixed"
  }
}
```

Implement `prepareHeadlessRunContext(context)` to return:

```js
{
  ok: boolean,
  exec: string,        // command to run
  args: string[],      // arguments
  passthrough: string[],
  envOverrides: object,
  warnings: string[],
  internal?: object,
  error?: string       // only when ok:false
}
```

Runtimes that don't support headless should return `{ ok: false, error: "..." }`.

---

## npm-style plugin (`node_modules/` format)

```
node_modules/@mah/runtime-kilo/
  package.json      — { name: "@mah/runtime-kilo", version: "1.0.0", main: "index.mjs" }
  index.mjs         — exports runtimePlugin
```

The `package.json` `name` field must start with `@mah/runtime-`. The `main` (or `exports`) field points to the entry module.

---

## CLI commands

### `mah plugins list`

Lists all currently loaded, valid plugins.

```
$ mah plugins list
plugin fake version=0.0.1 source=/abs/path/to/mah-plugins
```

With `--json`:
```
$ mah plugins list --json
{"plugins":[{"name":"fake","source":"/abs/path/to/mah-plugins","version":"0.0.1","path":"/abs/path/to/mah-plugins/fake"}]}
```

### `mah plugins validate <path>`

Validates a plugin at the given path without installing it. Returns detailed errors and warnings.

```
$ mah plugins validate ./plugins/runtime-fake
valid plugin=fake version=0.0.1 mahVersion=^0.6.0
```

On error:
```
ERROR: invalid plugin: plugin.adapter is required and must be an object
```

Validation checks:
1. Plugin path exists
2. `runtimePlugin` is exported from the entry module
3. `name`, `version`, `mahVersion`, `adapter` are present
4. `mahVersion` is compatible with running MAH version
5. Adapter passes `validateRuntimeAdapterContract` (same check as built-ins)
6. Adapter declares or core-manages all required commands

### `mah plugins install <path>`

Copies a plugin to `mah-plugins/<name>/` and registers it.

```
$ mah plugins install ./plugins/runtime-fake
installed=fake path=/path/to/mah-plugins/fake
```

Behavior:
1. Runs `validatePlugin` on the source path
2. Copies to `mah-plugins/<name>/`
3. Plugin is immediately available to all subsequent MAH commands

### `mah plugins uninstall <name>`

Removes a plugin from `mah-plugins/` and deregisters it.

```
$ mah plugins uninstall fake
uninstalled=fake
```

Does not delete plugin source files outside `mah-plugins/`. Safe to re-run — idempotent.

---

## Plugin discovery at startup

On every MAH command invocation, `getAllRuntimes()` is called at module load time (top-level `await`). This:

1. Scans `mah-plugins/` subdirectories
2. Scans `node_modules/@mah/runtime-*` packages
3. Validates each candidate against the plugin contract
4. Rejects plugins with incompatible `mahVersion`
5. Registers valid plugins in the in-memory registry

Plugin discovery is resolved from the MAH package root, not the caller's current working directory. A plugin installed under `mah-plugins/` remains available when `mah` is executed from subdirectories inside the same repo.

To disable plugin discovery:
```bash
MAH_PLUGINS_ENABLED=0 mah detect
```

---

## Runtime detection with plugins

`mah detect` iterates all registered runtimes (built-ins + plugins) and checks:

1. **Marker directory** — does `<cwd>/.<name>` exist?
2. **CLI availability** — is `directCli` or optional `wrapper` executable?
3. **Priority** — when multiple markers exist, `RUNTIME_ORDER` tiebreaks; plugin runtimes are sorted alphabetically after built-ins

A plugin runtime is selected by `mah detect` if its marker directory is present and no higher-priority runtime's marker exists.

---

## Module API

### `scripts/plugin-loader.mjs`

```js
import {
  MAH_VERSION,          // "0.6.0" — current MAH version
  getAllRuntimes,       // async () => { [name]: adapter }
  validatePlugin,       // async (path) => ValidationResult
  unloadPlugin          // (name) => boolean
} from './plugin-loader.mjs'
```

#### `getAllRuntimes()`

Returns the merged runtime registry. Auto-discovers plugins on first call.

```js
const runtimes = await getAllRuntimes()
// { pi: {...}, claude: {...}, opencode: {...}, hermes: {...}, fake: {...} }
```

#### `validatePlugin(pluginPath)`

Validates without registering:

```js
const result = await validatePlugin('./mah-plugins/runtime-kilo')
// { ok: true, name: "kilo", version: "1.0.0", mahVersion: "^0.6.0",
//   adapter: {...}, errors: [], warnings: [] }
```

#### `unloadPlugin(name)`

Removes a plugin from the in-memory registry and calls `teardown()`:

```js
unloadPlugin('kilo')  // true if unloaded, false if not found or built-in
```

Built-in runtimes (`pi`, `claude`, `opencode`, `hermes`) cannot be unloaded.

---

## Validation contract

Plugins must satisfy the same `validateRuntimeAdapterContract` that built-in runtimes use. This is enforced at registration time — a plugin with a malformed adapter is rejected with a clear error message listing the missing fields or commands.

To validate manually:
```bash
mah plugins validate ./path/to/plugin
```

---

## v0.6.0 scope

**In scope:**
- Plugin discovery from `mah-plugins/` and `node_modules/@mah/runtime-*`
- `mah plugins list|install|uninstall|validate` commands
- Plugin adapter validation via existing runtime contract
- Retrocompatible with all existing commands
- Lifecycle hooks (`init`, `teardown`)

**Out of scope for v0.6.0:**
- Remote/plugin loading from URLs
- Plugins that modify MAH core behavior (plugins are runtime-only)
- Plugin marketplace or registry
- Policy engine
- Federation / interconnect
- Multiple plugin directories
- Plugin hooking into MAH internal events

---

## Files

| File | Role |
|---|---|
| `scripts/plugin-loader.mjs` | Core plugin system — discovery, validation, registry |
| `scripts/runtime-adapter-contract.mjs` | Adapter shape validation (shared with built-ins) |
| `scripts/runtime-adapters.mjs` | Built-in runtime definitions |
| `scripts/meta-agents-harness.mjs` | CLI entry — imports `getAllRuntimes()` at startup |
| `mah-plugins/` | Operator plugin directory (created on first use) |
| `tests/plugin-loader.test.mjs` | Unit tests for plugin-loader |
| `tests/plugins-e2e.test.mjs` | End-to-end tests for install/uninstall/detect |
| `mah-plugins/runtime-fake/` | Test fixture plugin |
