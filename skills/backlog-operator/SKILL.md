---
name: backlog-operator
description: Operate MAH mission/task backlog inside an active session: inspect queue, execute ready tasks, and keep task states synchronized.
compatibility: [generic]
---

# Backlog Operator

Use this skill when the user asks to run backlog work through `mah mission` / `mah task`, update task status, or keep execution progress synchronized during the current session.

## When To Use

- Execute ready tasks from the MAH backlog
- Reconcile task status after real execution
- Review mission scope/progress before acting
- Continue backlog execution loop until stop condition

## Core Rule

Backlog operations must reflect real execution. Never mark a task as done without running work and validating outcomes.

## Workflow

1. Inspect planning containers:
   - `mah mission list --json`
   - `mah task list --json`
2. Select a task that is actionable (`ready` or explicitly requested), respecting:
   - `missionId`
   - `dependencies`
   - `runtime` and `crewId`
3. Mark execution start:
   - `mah task update <id> --payload '{"state":"in_progress","lastUpdate":"<iso8601>"}' --json`
4. Execute task:
   - `mah task run --id <id> --json`
5. Reconcile final state:
   - success: `state=done`
   - blocked: `state=blocked` + `blockedReason`
   - retryable failure: keep `in_progress` only if immediate retry is planned; otherwise set `blocked`
6. Report concise outcome with:
   - task id/title
   - command/result summary
   - state transition performed
   - next recommended task

## State Policy

- Allowed normal flow: `backlog -> ready -> in_progress -> done`
- If dependencies are unresolved, do not start execution; keep task as `backlog` or `blocked` with reason
- Do not reopen `done` tasks unless the user explicitly requests rework

## Guardrails

- Prefer `--json` for all CLI interactions in automation loops
- Do not execute tasks outside the requested mission/backlog scope
- If runtime/tooling fails, persist the failure reason in task state
- Avoid speculative updates; status must mirror command outcomes

