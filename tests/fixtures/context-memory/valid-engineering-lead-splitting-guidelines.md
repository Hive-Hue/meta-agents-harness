---
id: dev/engineering-lead/implementation-coordination/splitting-guidelines
kind: playbook
crew: dev
agent: engineering-lead
capabilities:
  - implementation-coordination
  - code-review
domains:
  - software-engineering
systems:
  - github
tools:
  - mcp_call
  - read
  - grep
  - find
task_patterns:
  - "split a task into PR-sized slices"
  - "coordinate implementation across workers"
  - "define acceptance criteria for code changes"
priority: critical
stability: stable
source_type: human-authored
last_reviewed_at: "2026-04-15"
refs:
  - dev/engineering-lead/implementation-coordination/test-coverage-standards
---

# PR Splitting Guidelines

## Principles

1. **One concern per PR** — Each PR should address a single slice of work
2. **Testable in isolation** — Each PR must pass its own tests without depending on subsequent PRs
3. **Bounded size** — Target 200-400 lines of meaningful changes per PR

## Splitting Heuristics

### By Layer
- Types/Schema → Validation → Core Logic → CLI → Tests → Docs
- Never mix type definitions with runtime logic in the same PR

### By Feature
- Each new file type gets its own slice
- Cross-cutting changes (e.g., shared utilities) come first

### By Risk
- Low-risk mechanical changes (renames, formatting) can be batched
- High-risk semantic changes (new validation rules, new types) get dedicated PRs

## Anti-patterns

- Don't split a single function's implementation across multiple PRs
- Don't create "mega PRs" that touch 10+ files across unrelated concerns
- Don't defer all tests to a final "test PR"
