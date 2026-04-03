---
name: mental-model
description: Manage structured YAML expertise files as personal mental models. Use when starting tasks (read for context), completing work (capture learnings), or when your understanding of the system needs updating.
---

# Mental Model

## Instructions

You have personal expertise files: structured YAML documents that represent your mental model of the system you work on. These are your files. You own them.

Treat them as durable, high-signal memory, not as a transcript or scratchpad.

## When To Read

- **At the start of every task**: read your expertise file for context before doing anything substantial.
- **When you need recall**: consult it for prior observations, decisions, patterns, or risks.
- **When the task touches known territory**: use it to re-activate lessons you have already learned.

## When To Update

- **After completing meaningful work**: capture what you learned.
- **When you discover something new**: architecture, patterns, risks, ownership boundaries, or operational gotchas.
- **When your understanding changes**: revise stale assumptions rather than only appending.
- **When you observe team dynamics**: note what delegation patterns work, what fails, and where responsibilities are sharpest.

Use `update_mental_model` to persist durable notes during or after the task.

## How To Structure

Write structured YAML. Do not be rigid about categories. Let the structure emerge from the work, but keep it organized enough that you can scan it quickly under pressure.

Example shape:

```yaml
agent:
  name: "extension-engineer"
  role: "worker"
  team: "Engineering"
meta:
  version: 1
  max_lines: 120
  last_updated: "2026-03-30T12:00:00.000Z"
architecture:
  runtime:
    pattern: "Extension runtime favors small helper functions over deep nesting."
    key_files:
      - path: "extensions/multi-team.ts"
        note: "Main orchestration runtime."
decisions:
  - date: "2026-03-30"
    note: "Use rule-based domain permissions instead of flat read/write lists."
observations:
  - date: "2026-03-30"
    note: "Engineering lead performs better when delegations are bounded by ownership."
open_questions:
  - date: "2026-03-30"
    note: "Should bash permission checks become command-class based instead of heuristic?"
```

## Good Content

- architecture and codebase patterns
- recurring risks and failure modes
- tool-specific lessons
- stable workflow guidance
- significant decisions
- useful observations from repeated work
- open questions worth revisiting later

## What Not To Store

- entire file contents; reference paths instead
- raw conversation logs; session logs already exist for that
- transient build output or noisy command results
- speculative guesses with no durable value
- rigid taxonomy overhead that slows down future edits

## Line Limit Enforcement

Your expertise file has a `meta.max_lines` limit. Keep it compact.

After updates:
1. Prefer concise entries over long prose.
2. Remove or condense stale observations first.
3. Trim resolved open questions.
4. Merge redundant notes when the same lesson appears multiple times.

If the file grows too large, preserve the highest-signal entries and compress the rest.

Useful checks:

```bash
wc -l <expertise-file>
```

## YAML Validation

- Keep the file parseable YAML at all times.
- Prefer short strings and small entries.
- Use dates on entries that reflect an observation or learning event.
- Update the structure when needed, but keep it readable.

If you edit the file manually, validate it immediately.

Example check, if `PyYAML` is available:

```bash
python3 -c "import sys, yaml; yaml.safe_load(open(sys.argv[1], 'r', encoding='utf-8'))" <expertise-file>
```

## Operational Rule

Do not finish meaningful work without deciding whether the mental model should be updated. If the task taught you something durable, persist it.
