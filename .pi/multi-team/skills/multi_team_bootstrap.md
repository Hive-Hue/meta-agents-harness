---
name: multi-team-bootstrap
description: Build a new multi-team pack from a minimal specification across domains (coding, productivity, teaching, marketing, ads). Infer teams, members, tools, and initial domain rules.
---

# Multi-Team Bootstrap

Use this skill when the user provides goals and desired scopes and wants a ready-to-run multi-team setup with:

- config YAML
- agent prompts
- initial expertise files
- sensible tool/domain defaults

This skill is designed to be portable across Codex, Pi, and Claude because it only depends on Markdown instructions and plain file outputs.

## Minimal Input Spec

Expect (or ask for) this minimum structure:

```yaml
pack: "<pack-name>"                    # e.g. hivehue, growthlab, academy
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
    outputs: ["implementation"]        # can be code, docs, campaigns, lesson plans, etc.
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

If any required piece is missing, infer with conservative defaults and state assumptions explicitly in the generated config comments or final notes.

## Output Contract

Always generate:

1. `multi-team.<pack>.yaml`
2. `.pi/agents/<pack>/orchestrator.md`
3. one lead prompt per team/workstream
4. one or more worker prompts per team/workstream
5. `.pi/expertise/<pack>/*-mental-model.yaml` for every generated agent

## Team Topology Rules

Always produce a 3-layer topology:

- `orchestrator`
- `team leads`
- `workers`

Default team naming:

- workstream `planning` -> team `Planning`, lead `planning-lead`
- workstream `execution` -> team `Execution` (or `Engineering` for coding profile), lead `execution-lead`/`engineering-lead`
- workstream `validation` -> team `Validation`, lead `validation-lead`

Profile-driven default workers:

- `coding`
  - Planning: `repo-analyst`, `solution-architect`
  - Engineering: `frontend-dev`, `backend-dev` (or `feature-dev` when split is unknown)
  - Validation: `qa-reviewer`, `security-reviewer`
- `productivity`
  - Planning: `process-analyst`, `solution-architect`
  - Execution: `automation-specialist`, `operations-specialist`
  - Validation: `qa-reviewer`, `risk-reviewer`
- `teaching`
  - Planning: `curriculum-analyst`, `learning-architect`
  - Execution: `lesson-designer`, `content-producer`
  - Validation: `assessment-reviewer`, `quality-reviewer`
- `marketing` or `ads`
  - Planning: `market-researcher`, `campaign-strategist`
  - Execution: `copywriter`, `creative-strategist`, `media-operator`
  - Validation: `performance-analyst`, `brand-safety-reviewer`
- `custom`
  - infer names from goals, keep pattern `<capability>-lead` plus 1-3 workers per stream

## Tool Inference Rules

Apply these defaults unless the spec explicitly restricts them:

- Orchestrator: `delegate_agent`, `update_mental_model`
- Leads: `delegate_agent`, `update_mental_model`
- Research/review workers: `read`, `grep`, `find`, `ls`, `update_mental_model`
- Document/spec/content workers: `read`, `write`, `edit`, `grep`, `find`, `ls`, `update_mental_model`
- Code or script execution workers: add `bash`

If `enable_mcp: true`, add MCP tools to:

- all leads
- workers that need external systems (at minimum Planning/research workers)

MCP set:

- `mcp_servers`
- `mcp_tools`
- `mcp_call`

## Domain Inference Rules

For each agent, build rule-based ownership:

- Always include a global read-only rule:
  - `path: .`
  - `read: true`
  - `upsert: false`
  - `delete: false`

- Add write-enabled rules only for owned paths from the relevant scope.

Guideline:

- Leads remain read-only by default.
- Workers only write to paths declared in their workstream.
- Validation workers stay read-only unless the spec explicitly asks for corrective edits.
- If no `write` paths are provided for a stream, keep that stream read-only.

## Prompt/Frontmatter Rules

Each agent `.md` must include frontmatter with:

- `name`
- `model`
- `role`
- `team`
- `expertise.path`
- `expertise.use-when`
- `expertise.updatable`
- `expertise.max-lines`
- `tools`
- `skills` with `path` and `use-when`
- `domain` as path rules

Skills to include by default:

- leads: `delegate`, `active_listener`, `mental_model`, `zero_micromanagement`
- workers: `active_listener`, `mental_model`

Skill paths should default to:

- `.pi/multi-team/skills/delegate.md`
- `.pi/multi-team/skills/active_listener.md`
- `.pi/multi-team/skills/mental_model.md`
- `.pi/multi-team/skills/zero_micromanagement.md`

Prompt body requirements:

- describe mission and ownership in domain language (not necessarily coding)
- define expected artifacts (`plan`, `campaign`, `lesson`, `report`, `implementation`, etc.)
- enforce no cross-domain delegation or writes
- require concise handoff format: outcome, files/artifacts, risks, follow-up

## Expertise File Rules

Create one expertise file per agent:

- `.pi/expertise/<pack>/<agent-name>-mental-model.yaml`

Use a compact initial structure:

```yaml
agent:
  name: "<agent-name>"
  role: "<orchestrator|lead|worker>"
  team: "<team-name-or-global>"
meta:
  version: 1
  max_lines: 10000
  last_updated: "<ISO8601>"
observations: []
open_questions: []
```

## Build Procedure

1. Parse the spec and normalize `profile`, workstream names, and constraints.
2. Build team/member matrix from workstreams + profile templates.
3. Infer tools from role and task type (research, content, execution, review) plus `enable_mcp`.
4. Infer domain rules from workstream ownership (`read`/`write` paths).
5. Generate `multi-team.<pack>.yaml`.
6. Generate all agent prompt files with profile-specific mission text.
7. Generate all expertise files.
8. Validate references:
   - every prompt path exists
   - every expertise path exists
   - every skill path exists
9. Return:
   - files created
   - assumptions made
   - unresolved mapping gaps

## Quality Bar

Generated setup is acceptable only if:

- it can run with `PI_MULTI_CONFIG=multi-team.<pack>.yaml pi -e extensions/multi-team.ts`
- no worker has write access outside owned scope
- no lead has direct write/edit/bash tools by default
- generated prompts clearly match the selected profile and goals
- the setup works even when no coding scope exists (docs/content/review-only flows)
