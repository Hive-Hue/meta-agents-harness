---
name: expertise-model
description: Keep a durable YAML expertise model per agent and update it with stable learnings after meaningful work.
---

# Mental Model

Each agent owns one expertise file in `.opencode/expertise/`.

Use this skill to:

- read prior context before important work
- preserve durable insights after meaningful progress
- avoid repeated mistakes across sessions

What to store:

- architecture or workflow patterns
- recurring risks
- decisions and tradeoffs
- open questions worth revisiting

What not to store:

- raw chat transcript
- noisy command output
- whole file copies

When there is a durable new lesson, call `update-expertise-model` with a concise `note`.
