---
name: multi-team-bootstrap
description: Build a new Claude multi-team crew from a minimal specification across domains (coding, productivity, teaching, marketing, ads). Infer teams, members, tools, MCP access, and initial domain rules.
---

# Multi-Team Bootstrap

Use this skill when the user provides goals and desired scopes and wants a ready-to-run Claude multi-team setup with:

- topology YAML
- agent prompts
- initial expertise files
- sensible tool/domain defaults

This skill is portable in spirit (Markdown + plain files), but this version is optimized for Claude Code TUI + CCR conventions.

## Minimal Input Spec

Expect (or infer) this structure:

```yaml
crew: "<crew-name>"                    # e.g. dev, marketing, growthlab, academy
system_name: "<display-name>"          # e.g. GrowthLabMultiTeam
profile: "coding"                      # coding | productivity | teaching | marketing | ads | custom
repo_root: "."                         # optional, default "."
enable_mcp: true                       # optional, default false
goals:
  - "<goal 1>"
  - "<goal 2>"
workstreams:
  - name: "planning"
    objective: "Understand current state and define approach"
    outputs: ["plan", "spec"]
    read: ["."]
    write: ["specs/"]                  # optional
  - name: "execution"
    objective: "Produce deliverables"
    outputs: ["implementation"]        # code, docs, campaigns, lesson plans, etc.
    read: ["."]
    write: ["deliverables/"]
  - name: "validation"
    objective: "Review quality, risk, and coverage"
    outputs: ["review_report"]
    read: ["."]
    write: []
constraints:
  - "<constraint 1>"
  - "<constraint 2>"
```

If required pieces are missing, infer conservative defaults and state assumptions explicitly.

## Output Contract

Always generate:

1. `.claude/crew/<crew>/multi-team.yaml`
2. `.claude/crew/<crew>/agents/orchestrator.md`
3. one lead prompt per team/workstream
4. one or more worker prompts per team/workstream
5. `.claude/crew/<crew>/expertise/*-mental-model.yaml` for every generated agent

## Team Topology Rules

Always produce 3 layers:

- `orchestrator`
- `team leads`
- `workers`

Default stream mapping:

- `planning` -> team `Planning`, lead `planning-lead`
- `execution` -> team `Execution` (or `Engineering` for coding), lead `execution-lead` / `engineering-lead`
- `validation` -> team `Validation`, lead `validation-lead`

Profile worker defaults:

- `coding`
  - Planning: `repo-analyst`, `solution-architect`
  - Engineering: `frontend-dev`, `backend-dev` (or `feature-dev` if split unknown)
  - Validation: `qa-reviewer`, `security-reviewer`
- `productivity`
  - Planning: `process-analyst`, `solution-architect`
  - Execution: `automation-specialist`, `operations-specialist`
  - Validation: `qa-reviewer`, `risk-reviewer`
- `teaching`
  - Planning: `curriculum-analyst`, `learning-architect`
  - Execution: `lesson-designer`, `content-producer`
  - Validation: `assessment-reviewer`, `quality-reviewer`
- `marketing` / `ads`
  - Planning: `market-researcher`, `campaign-strategist`
  - Execution: `copywriter`, `creative-strategist`, `media-operator`
  - Validation: `performance-analyst`, `brand-safety-reviewer`
- `custom`
  - infer names from goals, using `<capability>-lead` plus 1-3 workers per stream

## Tool Inference Rules (Claude)

Use Claude harness tool names and runtime semantics:

- Orchestrator: `delegate_agent`, `update_mental_model`
- Leads: `delegate_agent`, `update_mental_model`
- Research/review workers: `read`, `grep`, `find`, `ls`, `update_mental_model`
- Document/spec/content workers: add `write`, `edit`
- Code/script execution workers: add `bash`

In Claude runtime, `update_mental_model` is a local MCP-backed tool. Agents should call it with their own `agent` id instead of editing expertise YAML manually.

Avoid OpenCode-only names (`task`, `update-mental-model`, `glob`, `list`) in Claude output.

## MCP Inference Rules (Claude)

If `enable_mcp: true`:

- add Claude MCP bridge tools to all leads: `mcp_servers`, `mcp_tools`, `mcp_call`
- add Claude MCP bridge tools to planning/research workers and any worker requiring external systems
- infer MCP server usage from goals (examples: `clickup`, `github`, `context7`, `brave-search`, `firecrawl`, `zeplin`)

## Domain Inference Rules

For each agent, build ownership paths with Claude domain flags:

- global read-only baseline:
  - `path: .`
  - `read: true`
  - `upsert: false`
  - `delete: false`

- add write-enabled rules only for owned paths:
  - `upsert: true` only where stream owns output
  - `delete: true` only when deletion is explicitly part of ownership

Guidelines:

- leads are read-only by default
- workers write only to stream-owned paths
- validation workers stay read-only unless corrective edits are explicitly requested

## Prompt and Frontmatter Rules (Claude)

Each agent `.md` must follow the Claude harness conventions:

- frontmatter:
  - `name`
  - `model`
  - `role` (`orchestrator`, `lead`, `worker`)
  - `team`
  - `expertise` (`path`, `use-when`, `updatable`, `max-lines`)
  - `tools`
  - `skills` (`path`, `use-when`)
  - `domain` (`path`, `read`, `upsert`, `delete`)
- body sections (recommended):
  - Role, Team, Model
  - Expertise path/use-when
  - Skills with path/use-when
  - Tools
  - MCP Access (if enabled by tools)
  - Domain
  - Delegation
  - Response Contract

Default skill paths:

- `.claude/skills/delegate-bounded/SKILL.md`
- `.claude/skills/mental-model/SKILL.md`
- `.claude/skills/zero-micromanagement/SKILL.md`

Mission text must reflect domain language (coding, marketing, teaching, etc.), not coding-only assumptions.

## Expertise File Rules

Create one expertise file per agent:

- `.claude/crew/<crew>/expertise/<agent-name>-mental-model.yaml`

Initial structure:

```yaml
agent:
  name: "<agent-name>"
  role: "<ceo|lead|worker>"
  team: "<team-name-or-global>"
meta:
  version: 1
  max_lines: 10000
  last_updated: "<ISO8601>"
observations: []
open_questions: []
```

## Build Procedure

1. Parse and normalize `profile`, workstreams, constraints.
2. Build team/member matrix from workstreams + profile defaults.
3. Infer tools (including `mcp_servers`, `mcp_tools`, `mcp_call` when needed) by role and objective.
4. Infer domain rules from stream ownership (`read`/`write` paths).
5. Generate `.claude/crew/<crew>/multi-team.yaml`.
6. Generate all prompts under `.claude/crew/<crew>/agents/`.
7. Generate expertise files under `.claude/crew/<crew>/expertise/`.
8. Validate references:
   - every prompt path exists
   - every expertise path exists
   - every skill path exists
9. Return:
   - files created
   - assumptions made
   - unresolved mapping gaps

## Quality Bar

Output is acceptable only if:

- it can be selected with `ccmh use <crew>` and launched with `ccmh run --crew <crew>`
- no worker has `edit/bash` outside owned scope
- leads do not get direct `edit/bash` by default
- prompts clearly match selected profile and goals
- non-coding profiles work without code-specific assumptions
