---
name: delegate-bounded
description: Delegate one bounded outcome per subagent with clear ownership, expected artifact, and verification criteria.
compatibility: [generic]
---

# Delegate Bounded

Use this skill whenever you delegate via Task.

Rules:

- assign one bounded objective per subagent call
- specify why that subagent owns the objective
- require expected artifact type (analysis, implementation, review, plan)
- require changed files/artifacts and residual risks in every response
- **never delegate more than one active task to the same agent at the same time**
  - wait for the current task to complete before delegating the next one to the same agent
  - if multiple tasks are needed for the same agent, sequence them: one completes, then the next

Avoid:

- vague delegation
- mixed ownership in one task
- delegating and implementing in the same step
- parallel delegations to the same agent (leads have one-at-a-time capacity)
