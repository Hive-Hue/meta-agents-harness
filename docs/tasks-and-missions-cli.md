# Tasks and Missions CLI

The `mah task` and `mah mission` command groups provide the operator-facing workflow behind the WebUI `Tasks` page.

They persist workspace planning state under `.mah/tasks/` and expose stable `--json` output for WebUI and other integrations.

## Task Commands

```bash
mah task list [--mission <id>] [--state <state>] [--owner <owner>] [--runtime <runtime>] [--json]
mah task show <id> [--json]
mah task create --payload '<json>' [--json]
mah task update <id> --payload '<json>' [--json]
mah task run --id <id> [--json]
```

## Mission Commands

```bash
mah mission list [--status <status>] [--json]
mah mission show <id> [--json]
mah mission create --payload '<json>' [--json]
mah mission update <id> --payload '<json>' [--json]
mah mission commit-scope --id <id> [--json]
mah mission replan --id <id> [--json]
```

## What They Manage

- `mah task`: executable work items inside a mission, including owner, runtime, dependencies, session link, and current state.
- Task mission linkage is optional (`missionId` may be empty) for unscoped/backlog work.
- `mah mission`: planning containers for objective, delivery window, risk, capacity, and success criteria.
- `mah mission replan`: applies the current replan heuristic to both mission state and related tasks.
- `mah task run`: launches a real MAH run for the task and links the task to the most recent matching session when available.

## Examples

```bash
mah mission list
mah mission create --payload '{"name":"Q4 Audit Hardening","objective":"Ship auth middleware hardening"}' --json
mah mission commit-scope --id q4-audit --json
mah mission replan --id q4-audit --json

mah task list --mission q4-audit --json
mah task create --payload '{"title":"Verify auth middleware","missionId":"q4-audit","crewId":"dev","runtime":"pi"}' --json
mah task create --payload '{"title":"Investigate flaky sync artifact","crewId":"dev","runtime":"openclaude"}' --json
mah task update TASK-142 --payload '{"state":"ready","owner":"eng-lead"}' --json
mah task run --id TASK-142 --json
```

## Storage

- Tasks are stored in `.mah/tasks/tasks.yaml`.
- Missions are stored in `.mah/tasks/missions.yaml`.
- Store files are bootstrapped empty when missing; no default demo missions/tasks are seeded.

## Integration Notes

- The WebUI `Tasks` page now consumes these CLIs through `/api/mah/tasks` and `/api/mah/missions`.
- Prefer `--json` for automations, scripts, and UI adapters.
- Payload fields are intentionally shallow and map directly to stored task/mission records.
