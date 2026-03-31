# OpenCode Multi-Team Harness

This directory contains an OpenCode-native scaffold for a three-layer multi-team workflow.

## Structure

- `multi-team.yaml`: high-level canonical topology/config spec
- `opencode.json`: OpenCode config (permissions + MCP servers)
- `agents/`: orchestrator, leads, and workers
- `skills/`: reusable behavior skills in `SKILL.md` format
- `tools/`: custom tools callable by the model (`update-mental-model`)
- `expertise/`: persistent YAML mental-model files per agent
- `sessions/`: reserved for future session artifacts
- `scripts/validate-multi-team.mjs`: validates topology + file references

## Run

```bash
opencode
```

Validate the high-level spec:

```bash
npm --prefix .opencode run validate:multi-team
```

Generate/update all agent prompts from the canonical YAML:

```bash
npm --prefix .opencode run sync:multi-team
```

Check drift (CI-friendly, no file writes):

```bash
npm --prefix .opencode run check:multi-team-sync
```

Recommended start:

1. switch to `@orchestrator`
2. request a task requiring Planning -> Engineering -> Validation
3. verify delegation respects task permissions

## Notes

- This scaffold is focused on OpenCode primitives:
  - Task tool permissions (`permission.task`)
  - custom tools under `.opencode/tools`
  - skills under `.opencode/skills/*/SKILL.md`
  - MCP under `mcp` in `opencode.json`
- Canonical authoring model:
  - update `.opencode/multi-team.yaml` first (high level)
  - run `npm --prefix .opencode run sync:multi-team`
  - optionally run `npm --prefix .opencode run check:multi-team-sync` in CI
  - run `npm --prefix .opencode run validate:multi-team`
  - keep `opencode.json` aligned as runtime artifact
- It does not yet replicate the full Pi widget/session runtime parity.
