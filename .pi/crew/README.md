# PI Crew Layout

Create one folder per crew:

```text
.pi/crew/<crew>/
  multi-team.yaml
  agents/
  expertise/
  sessions/
```

Shared skills live at:

```text
.pi/skills/
```

Tool availability is declared per agent in `multi-team.yaml` / agent frontmatter and resolved at runtime (plus MCP tools from `.pi/mcp-servers.json`).

Current crews in this branch:

- `dev`
- `marketing`

## How `multi-team.yaml` Works

Each crew is defined by one topology file:

```text
.pi/crew/<crew>/multi-team.yaml
```

The file has five important areas:

- `name`: display name shown by the harness
- `session_dir`: where run artifacts and session transcripts are stored
- `expertise_dir`: base folder for updatable expertise models
- `orchestrator`: root agent that delegates across teams
- `teams`: one or more teams, each with a lead and members

The runtime expects a strict 3-layer topology:

1. `orchestrator`
2. `team leads`
3. `team members`

In practice, the orchestrator should route to leads, and each lead should route to their own members. Domain write access should usually stay with worker-owned scopes.

## Agent Block Anatomy

Every `orchestrator`, `lead`, and `member` block follows the same shape:

- `name`: stable agent identifier
- `description`: short operational purpose
- `prompt`: path to the agent prompt markdown file
- `expertise`: expertise-model file and update policy (`path`, `use-when`, `updatable`, `max-lines`)
- `model`: usually `inherit`, unless intentionally pinned
- `tools`: allowed tools for that agent
- `skills`: reusable skill files loaded by the agent
- `domain`: path-level `read` / `upsert` / `delete` permissions

The most important fields are:

- `prompt`: should point to an existing file under `.pi/crew/<crew>/agents/`
- `expertise.path`: should point to an existing file under `.pi/crew/<crew>/expertise/`
- `tools`: define what the agent can actually do
- `domain`: defines where the agent may read or write

Practical defaults:

- orchestrator and leads: `delegate_agent`, `update_expertise_model`, usually read-only domain
- planning/research workers: read-only tools plus MCP tools as needed
- implementation workers: add `write` / `edit` and scoped `upsert` permissions
- validation workers: add `bash` for checks, usually keep write disabled

Expertise update policy:

- prefer `lessons`, `decisions`, `risks`, and `workflows` for durable learning
- use `observations` only for short-lived facts, measurements, or state changes
- keep each note short enough to be useful on re-read; move long narratives to session artifacts
- prune weak `observations` first when the expertise file grows

## Example Mental Model

The `dev` crew follows this baseline:

- `orchestrator`: routes work between Planning, Engineering, and Validation
- Planning lead: delegates to `repo-analyst` and `solution-architect`
- Engineering lead: delegates to `frontend-dev` and `backend-dev`
- Validation lead: delegates to `qa-reviewer` and `security-reviewer`

Use this as the default blueprint for new crews: one lead per workstream, then workers with narrow tool and domain ownership.

## Bootstrap New Crews

When you want to create a new crew from a minimal specification, use:

```text
.pi/skills/multi-team-bootstrap/SKILL.md
```

Provide at least:

- crew name
- profile or domain
- goals
- workstreams
- constraints

Expected output:

1. `.pi/crew/<crew>/multi-team.yaml`
2. prompts under `.pi/crew/<crew>/agents/`
3. expertise files under `.pi/crew/<crew>/expertise/`

Recommended workflow:

1. Draft crew topology
2. Review tools and domain ownership boundaries
3. Activate with `pimh use <crew>`
4. Run with `pimh run --crew <crew>`
5. Validate with `pimh check:runtime` and `pimh doctor --ci`

## Useful Commands

```bash
pimh list:crews
pimh use <crew>
pimh clear
pimh run --crew <crew>
pimh check:runtime
pimh doctor --ci
pimh test:smoke
```
