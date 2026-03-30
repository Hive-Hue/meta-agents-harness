# Specification: Alert Engine Extension

## 1. Overview
`alert-engine.ts` is a lightweight monitoring extension that turns Pi into a configurable alerting motor. It watches every `tool_call` event and evaluates a set of user-defined rules sourced from `.pi/alert-rules.yaml`. When a rule matches, the extension raises a notification, refreshes the session status bar with severity counters, and logs the incident so that teams can review what triggered the alert.

The goal is to let developers encode policy guardrails, awareness signals, or operational checks without hard-blocking commands (which is already covered by `damage-control`). The alert engine stays out of the way until one of the rules becomes relevant.

## 2. Configuration
Rules live in `.pi/alert-rules.yaml` (project overrides per-repo, with a fallback to `~/.pi/alert-rules.yaml`). The file must define a root `rules` array containing objects with the following shape:

```yaml
rules:
  - id: "deploy-warning"
    description: "Warn when a deployment command is run from the repo root."
    event: tool_call
    tool: bash
    commandIncludes: ["npm run deploy", "bun run deploy"]
    severity: warning
    message: "Deploy command detected. Confirm your target environment."
    throttleSeconds: 60
  - id: "env-edit"
    description: "Inform about edits to .env"
    event: tool_call
    tool: ["write", "edit"]
    pathIncludes: [".env"]
    severity: critical
    alertOnce: true
```

Key fields:

| Field | Notes |
| --- | --- |
| `id` | Optional friendly name. Defaults to `rule-<index+1>` when missing. Used on the status line and in the log. |
| `event` | Currently only `tool_call` is supported (default). |
| `tool` | String or array of tool names (e.g., `bash`, `write`, `edit`). Case-insensitive. If omitted, the rule evaluates every tool call. |
| `commandIncludes` / `commandRegex` | Text-based filters that inspect every string in the tool input (command, args, globs). Includes are case-insensitive; regexes default to the `i` flag unless you override `commandRegexFlags`. |
| `commandRegexFlags` / `pathRegexFlags` | Optional overrides for regex flags (`i`, `m`, etc.). When absent the engine compiles with `i` for case-insensitive matching. |
| `pathIncludes` / `pathRegex` | Similar filters focused on path-like fields (`path`, `glob`, `directory`, etc.). They also test the resolved path relative to `ctx.cwd`. |
| `severity` | One of `info`, `warning`, or `critical`. Defaults to `warning`. Controls the emoji shown in notifications and the counter buckets. |
| `message` | Custom human-readable message shown in the toast/status line. Falls back to `description` or the rule ID. |
| `notify` | Defaults to `true`. Set to `false` when you only want the status counter to reflect the hit. |
| `throttleSeconds` | Optional quiet window that prevents repeated notifications for the same rule within the provided time span. |
| `alertOnce` | Marks the rule as a one-shot alert that is ignored after first firing. |
| `tags` | Arbitrary strings persisted in the log entry for later filtering. |

## 3. Matching behavior
- All rules compile to lowercase comparison helpers so `commandIncludes`/`pathIncludes` are case insensitive.
- Regex fields (`commandRegex`, `pathRegex`) are compiled with default flags (`i`) unless the rule overrides them with `commandRegexFlags` or `pathRegexFlags`.
- A rule matches when every explicit filter it defines is satisfied (tool name, command clauses, path clauses, regexes). Rules without a path filter still trigger when other criteria match.
- `alert-engine.ts` honors the `throttleSeconds` guard and `alertOnce` semantics to keep the UI quiet during repetitive events.

## 4. Alert presentation
- On match, the extension increments the severity counter (ℹ️/⚠️/🚨) and pushes a toast via `ctx.ui.notify` unless `notify` is set to `false`.
- The footer status is refreshed with a line like `🔔 Alert Engine [ℹ️ 0 ⚠️ 2 🚨 1] • ⚠️ deploy-warning: Deploy command detected.` so you always see the latest signal without reading the history.
- Alerts are deliberately passive—there is no automatic command blockage. If you need hard limits, continue using `damage-control`.

## 5. Logging & observability
Every alert is appended to `alerts-engine-log` via `pi.appendEntry` with the rule ID, severity, user message, tool name, raw input, and the timestamp. This record can be filtered after the fact to understand how often a rule fired or to surface trends shared with teammates.

## 6. Usage
Run the alert engine alongside your favorite UI stack:

```bash
pi -e extensions/alert-engine.ts -e extensions/theme-cycler.ts
```

The repo ships a sample file at `.pi/alert-rules.yaml` with starter rules (see the repo root). Customize it to your team’s guardrails and watch the status bar keep you honest.
