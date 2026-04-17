---
name: expertise-model
description: Keep a durable YAML expertise model per agent and update it with stable learnings after meaningful work.
---

# Expertise Model

You have a personal expertise file: a compact YAML document in `.opencode/expertise/` that acts as your **durable working memory** across sessions. It persists what you've learned so you don't repeat mistakes or re-derive the same insights.

Think of it as the page of notes you'd keep in your pocket between shifts.

## When To Read

- At the start of every task, before doing anything substantial.
- When you're about to make a decision that prior experience should inform.
- When the task touches a component or pattern you've worked with before.

## When To Update

- After completing meaningful work that produced a durable insight.
- After discovering a gotcha, risk, or non-obvious behavior.
- After making an architectural or strategic decision with lasting impact.

When there is a durable new lesson, call `update-expertise-model` with a concise `note` and optional `category`.

Do not finish meaningful work without deciding whether something durable was learned.

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

## How To Write High-Signal Notes

A good expertise note is **dense, specific, and actionable on re-read**. It should tell future-you exactly what to do differently.

### Pattern

```
<concrete subject> — <specific behavior or constraint>
```

### Good Notes

- `domain guardrails block bash upsert for paths outside declared domain — delegate to worker with matching domain instead`
- `node:test assert.strictEqual throws on type mismatch but not on deep equality — use assert.deepStrictEqual for objects`
- `npm ci fails when package-lock.json is stale — always run npm install after manual dependency edits`
- `TypeScript 5.4 supports const type parameters — use for narrower inferred types in generics`

### Bad Notes (don't write these)

- `Worked on the auth module today. Made some changes.` — no actionable signal
- `The tests seem to be failing for some reason.` — vague, no root cause
- `TODO: investigate the build error` — transient task, not durable learning
- `README.md contents: # Project\nThis is a project...` — raw file content, reference paths instead

### Signals Worth Capturing

- **Gotchas**: non-obvious constraints that cause failures
- **Patterns**: repeatable approaches that work reliably
- **Risks**: conditions that cause cascading failures
- **Decisions**: choices made with rationale (so you don't reverse them)
- **Boundary conditions**: what works, what doesn't, and at what limits

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
| `tools` | Tool-specific lessons (opencode, git, npm, model quirks) |
| `workflows` | Multi-step processes, build/deploy rituals |
| `decisions` | Choices made with rationale, tradeoffs accepted |
| `lessons` | Hard-won insights from failure or unexpected behavior |
| `observations` | Factual notes about system state or behavior |
| `open_questions` | Unresolved questions worth investigating in future sessions |

The default bias should be toward `lessons`, `decisions`, `risks`, and `workflows`, not `observations`.

## Compactness Rules

Your expertise file has a hard budget (120 lines, 32KB). Every byte counts because it's loaded into your context on every turn.

1. **One insight per note.** Don't combine multiple learnings into one entry.
2. **Lead with the subject.** Future-you scans by keyword, not by prose.
3. **Prefer ~40-120 chars per note.** Longer is acceptable only when the detail is essential.
4. **Don't repeat yourself.** Similar notes are automatically merged — but write distinct insights from the start.
5. **Open questions auto-expire** after 14 days. Don't re-add resolved questions.
6. **Keep `observations` as the smallest bucket.** If a note is durable, move it out of observations immediately.

## Revise, Don't Just Append

Before adding a new note, check if an existing note covers the same territory:

- **Contradicted?** Update the old note with the new finding.
- **Refined?** Replace the vague old note with the sharper new version.
- **Confirmed?** Don't add "confirmed X" — the existing note is already there.
- **Related but distinct?** Append, but keep it tight.

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
    note: "npm ci fails when package-lock.json is stale — always run npm install after manual dependency edits"
tools:
  - date: "2026-04-07"
    note: "opencode --resume picks up from last session — don't start fresh when context is still valid"
workflows: []
decisions: []
lessons: []
observations: []
open_questions: []
```
