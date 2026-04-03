# OpenCode Multi-Team Harness

This directory contains an OpenCode-native scaffold for a three-layer multi-team workflow.

## Structure

- `multi-team.yaml`: high-level canonical topology/config spec
- `opencode.json`: OpenCode config (permissions + MCP servers)
- `agents/`: active runtime agent links/materialization for the selected crew
- `skills/`: reusable behavior skills in `SKILL.md` format
- `tools/`: custom tools callable by the model (`update-mental-model`)
- `expertise/`: persistent YAML mental-model files per agent
- `scripts/validate-multi-team.mjs`: validates topology + file references

ClickUp MCP is configured via local `mcp-remote` (`https://mcp.clickup.com/mcp`, callback port `19876`).
First successful run performs OAuth and persists token in `~/.mcp-auth`.

## Install

```bash
git clone https://github.com/AlyssonM/multi-agents.git
cd multi-agents
npm --prefix .opencode install
```

Optional environment setup:

```bash
cp .env.sample .env
# then fill required values in .env (e.g. CONTEXT7_API_KEY, GITHUB_PAT)
```

Verify OpenCode CLI is available:

```bash
if command -v opencode >/dev/null 2>&1; then
  opencode --version
else
  echo "OpenCode CLI not found. Install it first: https://opencode.ai/"
fi
```

## Get Started

Sync crew configs from repository canonical source:

```bash
# from repo root
npm run sync:meta
# or from .opencode
npm run sync:meta
```

This generates:

- `.pi/crew/<crew>/multi-team.yaml`
- `.claude/crew/<crew>/multi-team.yaml`
- `.opencode/crew/<crew>/multi-team.yaml`
- `.opencode/crew/<crew>/agents/*` and `.opencode/crew/<crew>/expertise/*`

Generate/update all agent prompts from the canonical YAML:

```bash
npm --prefix .opencode run sync:multi-team
```

Validate the high-level spec:

```bash
npm --prefix .opencode run validate:multi-team
```

Check drift (CI-friendly, no file writes):

```bash
npm --prefix .opencode run check:multi-team-sync
```

Select crew and start OpenCode:

```bash
ocmh list:crews
ocmh use dev
ocmh use dev --hierarchy
ocmh use dev --no-hierarchy
ocmh run
ocmh run --crew dev --no-hierarchy
ocmh clear
```

`ocmh use <crew>` creates runtime symlinks:

- `.opencode/multi-team.yaml -> .opencode/crew/<crew>/multi-team.yaml`
- `.opencode/agents/*.md -> .opencode/crew/<crew>/agents/*.md`

Optional hierarchy override:

- `--hierarchy` keeps strict topology (`orchestrator -> leads -> workers`)
- `--no-hierarchy` expands orchestrator `permission.task` to all agents for the active runtime materialization
- works with both `ocmh use` and `ocmh run`

Expertise behavior:

- expertise remains per crew in `.opencode/crew/<crew>/expertise`
- `update-mental-model` resolves path by active crew metadata first, then active agent prompt metadata
- fallback legacy path `.opencode/expertise/<agent>-mental-model.yaml` remains only for compatibility

`ocmh clear` removes these symlinks.

If ClickUp OAuth session is broken, clear auth cache and retry:

```bash
rm -rf ~/.mcp-auth
opencode
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
  - update `meta-agents.yaml` first (single source-of-truth)
  - run `npm run sync:meta`
  - run `npm run check:meta-sync` in CI
  - use `ocmh use <crew>` to switch OpenCode active crew
- It does not yet replicate the full Pi widget/session runtime parity.
