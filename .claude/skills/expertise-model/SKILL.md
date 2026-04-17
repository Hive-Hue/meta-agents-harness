---
name: expertise-model
description: Manage structured YAML expertise files as personal expertise models. Use when starting tasks (read for context), completing work (capture learnings), or when your understanding of the system needs updating.
compatibility: [generic]
---

# Expertise Model

You have a personal expertise file: a compact YAML document that acts as your **durable working memory** across sessions. It persists what you've learned so you don't repeat mistakes or re-derive the same insights.

Think of it as the page of notes you'd keep in your pocket between shifts.

## When To Read

- At the start of every task, before doing anything substantial.
- When you're about to make a decision that prior experience should inform.
- When the task touches a component or pattern you've worked with before.

## When To Update

- After completing meaningful work that produced a durable insight.
- After discovering a gotcha, risk, or non-obvious behavior.
- After a delegation succeeds or fails in a revealing way.
- After making an architectural or strategic decision with lasting impact.

Use `update_expertise_model` to persist notes. Do not finish meaningful work without deciding whether something durable was learned.

## Write Policy

Use the most specific category that matches the signal. Do not default everything to `observations`.

### Category Selection

- `patterns`: repeatable approaches that are likely to be useful again.
- `workflows`: step sequences that consistently work end to end.
- `risks`: failure modes, regressions, and boundary conditions that can break work.
- `tools`: tool quirks, limits, or runtime-specific behavior.
- `decisions`: explicit choices with rationale and tradeoffs.
- `lessons`: durable insights, gotchas, and reusable constraints.
- `observations`: narrow factual state only, with no narrative padding.
- `open_questions`: unresolved items worth revisiting later.

### Observation Policy

- Keep `observations` short and specific.
- Use them for current state, measurements, or concrete facts that may expire.
- Do not store session logs, task summaries, or copied output.
- Do not let `observations` become the default bucket for durable learnings.
- If a note is reusable next week, move it to `lessons`, `patterns`, `decisions`, `risks`, or `workflows` instead.

### Retention Policy

- Prefer rewriting an existing note over appending a vague duplicate.
- If a note exceeds roughly 120 characters, compress it and reference the artifact path instead.
- If a file starts filling with `observations`, prune the oldest weak notes first and promote durable content into other categories.

Call shape:

```json
{
  "agent": "<your-agent-id>",
  "category": "lessons",
  "note": "Durable lesson or decision worth preserving."
}
```

Rules for calling the tool:
- Always pass your own agent id in `agent`.
- Prefer `category` values already used by the file: `patterns`, `workflows`, `risks`, `tools`, `decisions`, `lessons`, `open_questions`.
- Use `expertise_path` only for manual recovery or ambiguity handling. Do not use it as the default path selector.
- If the tool reports ambiguity across crews, either activate the correct crew first or retry with the specific `expertise_path`.

## How To Write High-Signal Notes

A good expertise note is **dense, specific, and actionable on re-read**. It should tell future-you exactly what to do differently.

### Pattern

```
<concrete subject> — <specific behavior or constraint>
```

### Good Notes

- `domain guardrails block bash upsert for paths outside declared domain — delegate to worker with matching domain instead`
- `glm-4.7 context: ~125k tokens. Keep total prompt under 110k to leave room for tool results.`
- `worker delegation fails silently when session file is locked — wait 500ms between sequential delegates to same worker`
- `smoke.mjs uses node:test not Jest — all new tests must follow node:test patterns`

### Bad Notes (don't write these)

- `Worked on the bootstrap CLI today. Made some changes.` — no actionable signal
- `The delegation chain doesn't seem to propagate content back.` — vague, no root cause
- `TODO: investigate the test failure` — transient task, not durable learning
- `README.md contents: # Project\nThis is a project...` — raw file content, reference paths instead

### Signals Worth Capturing

- **Gotchas**: non-obvious constraints that cause failures
- **Patterns**: repeatable approaches that work reliably
- **Risks**: conditions that cause cascading failures
- **Decisions**: choices made with rationale (so you don't reverse them)
- **Boundary conditions**: what works, what doesn't, and at what limits
- **Delegation dynamics**: which delegation patterns actually produce results

### Signals Not Worth Capturing

- What you did today (session logs exist for that)
- File contents or command output (reference paths instead)
- Speculation without evidence
- Things that are obvious from reading the code
- Transient states that won't recur

## Category Guide

| Category | Use For |
|---|---|
| `patterns` | Repeatable approaches, architectural conventions, code idioms |
| `risks` | Failure modes, gotchas, conditions that cause breakage |
| `tools` | Tool-specific lessons (pi, git, npm, model quirks) |
| `workflows` | Multi-step processes, delegation patterns, session rituals |
| `decisions` | Choices made with rationale, tradeoffs accepted |
| `lessons` | Hard-won insights from failure or unexpected behavior |
| `observations` | Factual notes about system state or agent behavior |
| `open_questions` | Unresolved questions worth investigating in future sessions |

You may create custom categories if the standard ones don't fit, but prefer the standard ones. The default bias should be toward `lessons`, `decisions`, `risks`, and `workflows`, not `observations`.

## Compactness Rules

Your expertise file has a hard budget. Every byte counts because it's injected into your system prompt every turn.

1. **One insight per note.** Don't combine multiple learnings into one entry.
2. **Lead with the subject.** Future-you scans by keyword, not by prose.
3. **Prefer ~40-120 chars per note.** Longer is acceptable only when the detail is essential.
4. **Don't repeat yourself.** If two notes say the same thing, merge or keep the better one.
5. **Evict stale entries first** when space is tight. Prefer recent and proven over old and speculative.
6. **Keep `observations` as the smallest bucket.** If a note is durable, move it out of observations immediately.

## Revise, Don't Just Append

Before adding a new note, check if an existing note covers the same territory:

- **Contradicted?** Update the old note with the new finding, don't append a contradictory one.
- **Refined?** Replace the vague old note with the sharper new version.
- **Confirmed?** Don't add "confirmed X" — the existing note is already there.
- **Related but distinct?** Append, but reference the related note if it helps.

Use the `update_expertise_model` tool to add notes. To revise existing ones, read the file, reason about what to change, then write the updated version.

## Format

```yaml
agent:
  name: "worker-name"
  role: "worker"
  team: "TeamName"
meta:
  version: 1
  max_lines: 120
  last_updated: "2026-04-07T12:00:00.000Z"
patterns: []
risks:
  - date: "2026-04-07"
    note: "expertise files over 24KB cause context overflow on glm-4.7 — enforce byte budget at write time"
tools:
  - date: "2026-04-07"
    note: "pi --session resumes from existing session file — don't reuse session IDs within same session"
workflows: []
decisions: []
lessons: []
observations: []
open_questions: []
```
