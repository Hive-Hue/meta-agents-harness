---
id: dev/planning-lead/backlog-planning/clickup-backlog-triage
kind: operational-memory
crew: dev
agent: planning-lead
capabilities:
  - backlog-planning
  - scope-triage
domains:
  - planning
  - project-management
systems:
  - clickup
skills:
  - agentic_pert
tools:
  - mcp_call
task_patterns:
  - "transform spec into backlog"
  - "create milestones and tasks"
  - "derive acceptance criteria"
  - "triage incoming feature requests"
priority: high
stability: curated
source_type: human-authored
last_reviewed_at: "2026-04-17"
refs:
  - docs/expertise-catalog-governance.md
  - dev/planning-lead/backlog-planning/milestone-splitting
---

# ClickUp Backlog Triage

## Pre-conditions

- ClickUp MCP server is connected and responsive
- The spec or feature request document is available in the workspace

## Step-by-step Process

1. **Read the source spec** — Use `read` tool to consume the full specification
2. **Identify milestones** — Decompose into logical delivery milestones using PERT heuristics
3. **Create ClickUp milestones** — Use `mcp_call` to `clickup.create_folder` for each milestone
4. **Derive tasks** — Under each milestone, create tasks with acceptance criteria
5. **Set priorities** — Apply MoSCoW prioritization based on spec requirements

## Common Pitfalls

- Don't create tasks without acceptance criteria
- Don't skip milestone decomposition — flat task lists lose ordering information
- Verify ClickUp workspace ID before creating folders

## Fallback

If ClickUp MCP is unavailable:
1. Write the backlog decomposition to `plan/progress/` as a markdown file
2. Tag the file for later ClickUp import
3. Notify the operator about the manual sync requirement
