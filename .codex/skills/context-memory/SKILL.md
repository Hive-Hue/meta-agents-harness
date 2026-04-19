---
name: context-memory
description: Retrieve and curate operational context memory for MAH tasks after expertise routing has selected the agent.
compatibility: [generic]
---

# Context Memory

Use this skill when a task needs bounded operational memory from `.mah/context`, or when you are validating or proposing context memory content.

## When To Use

- Before a task that depends on prior playbooks, gotchas, or task-specific memory
- When validating or indexing `.mah/context/operational`
- When proposing memory from sessions
- When explaining why a document matched a task

## Core Rule

Expertise chooses the agent. Context Memory only helps the chosen agent execute the task well.

## Workflow

1. Confirm expertise routing already selected the agent.
2. Run `mah context find --agent <agent> --task "<task>" [--capability <cap>]`.
3. If the result looks surprising, run `mah context explain`.
4. Keep retrieval bounded. Prefer the top matches with the most specific capability signal.
5. If you changed the corpus, run `mah context validate --strict` and `mah context index`.
6. If the source is a session, run `mah context propose --from-session <runtime:crew:session>`, review manually, then move approved content into `operational/`.
7. For `planning-lead` backlog-planning tasks, prefer docs that mention ClickUp MCP explicitly and use the ClickUp MCP tools directly when the task requires backlog grooming or task creation.

## Rules

- Do not use Context Memory to choose the agent.
- Treat `tests/fixtures/context-memory/` as validation data, not production memory.
- Prefer human-authored or curated docs over draft entries unless there is no better match.
- If there is no strong match, fall back to the task spec or expertise.

## Retrieval Hints

- Use the exact agent name.
- Add the most specific capability hint available.
- Include relevant tools or MCP systems when known.
- Keep the task text close to the operational question, not the mission statement.
- For ClickUp-backed backlog planning, mention the ClickUp MCP and the concrete planning goal instead of asking for a generic project-management memory.

## Bootstrap Note

- `mah run --with-context-memory` is for bootstrap injection, not for routing.
- Rebuild the index after moving documents between proposal and operational folders.
