# OpenCode Multi-Team Harness

This branch contains an OpenCode-native multi-team scaffold focused on hierarchical delegation:

- `orchestrator`
- `team leads`
- `workers`

The objective is to run a controlled multi-agent workflow in OpenCode with explicit task boundaries, durable expertise, and optional MCP integration.

## Repository Layout

- [`.opencode/multi-team.yaml`](./.opencode/multi-team.yaml)  
  High-level canonical multi-team topology (models, skills, tools, domains, routing).
- [`.opencode/opencode.json`](./.opencode/opencode.json)  
  OpenCode config (permissions, MCP servers).
- [`.opencode/agents/`](./.opencode/agents)  
  Orchestrator, leads, and worker prompts.
- [`.opencode/skills/`](./.opencode/skills)  
  Reusable skills (`SKILL.md`) for delegation and mental model discipline.
- [`.opencode/tools/`](./.opencode/tools)  
  Custom tools callable by the model (currently `update-mental-model`).
- [`.opencode/expertise/`](./.opencode/expertise)  
  Per-agent YAML mental-model files.
- [`.opencode/scripts/validate-multi-team.mjs`](./.opencode/scripts/validate-multi-team.mjs)  
  Topology/reference validator for `.opencode/multi-team.yaml`.
- [specs/opencode-multi-team-plan.md](./specs/opencode-multi-team-plan.md)  
  Implementation plan and rollout phases.

## Agent Topology

Primary:

- `orchestrator`

Leads:

- `planning-lead`
- `engineering-lead`
- `validation-lead`

Workers:

- Planning: `repo-analyst`, `solution-architect`
- Engineering: `frontend-dev`, `backend-dev`
- Validation: `qa-reviewer`, `security-reviewer`

Task delegation is constrained through per-agent `permission.task` rules in each agent frontmatter.

## Custom Tool

Current custom tool:

- [update-mental-model.ts](./.opencode/tools/update-mental-model.ts)

It appends durable notes to `.opencode/expertise/<agent>-mental-model.yaml` with category support and line-limit trimming.

## MCP

Configured in [`.opencode/opencode.json`](./.opencode/opencode.json):

- `context7`
- `clickup`
- `github`

If OAuth is required for a remote MCP server, use OpenCode MCP auth flow in CLI.

## Run

```bash
opencode
```

Validate high-level config consistency:

```bash
npm --prefix .opencode run validate:multi-team
```

Generate/update all `.opencode/agents/*.md` from canonical YAML:

```bash
npm --prefix .opencode run sync:multi-team
```

Check if generated agents are in sync (no writes):

```bash
npm --prefix .opencode run check:multi-team-sync
```

Suggested workflow:

1. Switch to `@orchestrator`.
2. Request a task that needs Planning -> Engineering -> Validation.
3. Confirm delegation path respects `permission.task`.
4. Ask an agent to persist a durable insight through `update-mental-model`.

## Notes

- This branch intentionally removes legacy Pi runtime assets.
- The focus here is OpenCode-native primitives, not Pi extension compatibility.
- Authoring strategy:
  - treat `.opencode/multi-team.yaml` as source-of-truth
  - run `npm --prefix .opencode run sync:multi-team` after topology changes
  - run `npm --prefix .opencode run check:multi-team-sync` in CI/pre-commit to prevent drift
  - validate with `npm --prefix .opencode run validate:multi-team`
  - keep `.opencode/opencode.json` aligned with runtime needs
