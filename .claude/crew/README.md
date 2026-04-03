# Crew Layout

Create one folder per crew:

```text
.claude/crew/<crew>/
  multi-team.yaml
  agents/
  expertise/
  sessions/
```

Shared skills live at:

```text
.claude/skills/
```

Tool availability is declared per agent in `multi-team.yaml` / agent frontmatter and resolved at runtime (plus MCP tools from `.mcp.json`).

Current crews in this branch:

- `dev`
- `marketing`

## How `multi-team.yaml` Works

Each crew is defined by one topology file:

```text
.claude/crew/<crew>/multi-team.yaml
```

The file has five important areas:

- `name`: display name shown by the harness
- `session_dir`: where run artifacts and session transcripts are stored
- `expertise_dir`: base folder for updatable mental models
- `orchestrator`: root agent that delegates across teams
- `teams`: one or more teams, each with a lead and members

The runtime expects a strict 3-layer topology:

1. `orchestrator`
2. `team leads`
3. `team members`

In strict hierarchy mode, the orchestrator should route to leads, and leads should route to their own members. Write access should usually live on worker-owned domains, not on leads.

## Agent Block Anatomy

Every `orchestrator`, `lead`, and `member` block follows the same shape:

- `name`: stable agent identifier
- `description`: short operational purpose
- `prompt`: path to the agent prompt markdown file
- `expertise`: mental-model file and update policy
  - Claude runtime resolves updates through the local MCP tool `update_mental_model`
  - agents should call it with their own `agent` id, not by editing YAML ad hoc
- `model`: usually `inherit`, unless intentionally pinned
- `tools`: allowed tools for that agent
- `skills`: reusable skill files loaded by the agent
- `domain`: path-level read/write/delete permissions

The most important fields are:

- `prompt`: must point to a real agent file under `.claude/crew/<crew>/agents/`
- `expertise.path`: should point to a real file under `.claude/crew/<crew>/expertise/`
- `tools`: define what the agent can actually do
- `domain`: defines where the agent may read or write

Practical defaults:

- orchestrator and leads: `delegate_agent`, `update_mental_model`, usually read-only domain
- planning/research workers: read-only tools plus MCP when needed
- implementation/content workers: add `write` / `edit`
- execution workers that run commands: add `bash`

## Example Mental Model

The `dev` crew is organized like this:

- `orchestrator`: routes work between Planning, Engineering, and Validation
- `Planning` lead: delegates to `repo-analyst` and `solution-architect`
- `Engineering` lead: delegates to `frontend-dev` and `backend-dev`
- `Validation` lead: delegates to `qa-reviewer` and `security-reviewer`

That pattern is the baseline to follow when creating new crews: one lead per workstream, then workers with narrow tool and domain ownership.

## Bootstrap New Crews

When you want to create a new crew from a minimal specification, use the skill:

```text
.claude/skills/multi-team-bootstrap/SKILL.md
```

Use it when you have goals and workstreams, but do not want to hand-author every agent and expertise file.

Provide at least:

- crew name
- system name
- profile or domain
- goals
- workstreams
- constraints

The skill is expected to generate:

1. `.claude/crew/<crew>/multi-team.yaml`
2. agent prompts under `.claude/crew/<crew>/agents/`
3. expertise files under `.claude/crew/<crew>/expertise/`

Recommended workflow:

1. draft the crew with `multi-team-bootstrap`
2. review `multi-team.yaml` for topology, tools, and domain ownership
3. activate the crew with `ccmh use <crew>`
4. validate by running the crew with `ccmh run --crew <crew>`

Useful commands:

```bash
ccmh list:crews
ccmh use <crew>
ccmh run --crew <crew>
```
