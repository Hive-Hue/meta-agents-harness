# Skills CLI

The `mah skills` command group manages skill discovery, inspection, and assignment in `meta-agents.yaml`.

## Subcommands

```bash
mah skills list [--crew <crew>] [--agent <agent>] [--json]
mah skills inspect <skill> [--json]
mah skills explain <skill> [--json]
mah skills add <skill> --agent <agent> [--crew <crew>] [--dry-run] [--json]
mah skills remove <skill> --agent <agent> [--crew <crew>] [--dry-run] [--json]
```

## What Each Command Does

- `list`: lists installed skills (workspace and `~/.mah/skills`) and current assignments.
- `inspect`: shows SKILL.md metadata (title, summary, sections, file path).
- `explain`: concise operational explanation of the skill and where it is used.
- `add`: writes skill assignment to the target agent in `meta-agents.yaml`.
- `remove`: removes the skill assignment from the target agent in `meta-agents.yaml`.

## Examples

```bash
mah skills list
mah skills list --agent frontend-dev
mah skills inspect stitch-react-handoff
mah skills explain delegate-bounded
mah skills add stitch-react-handoff --agent frontend-dev
mah skills remove stitch-react-handoff --agent frontend-dev --dry-run
```

## Notes

- `add` and `remove` modify `meta-agents.yaml` unless `--dry-run` is used.
- If an agent id exists in multiple crews, pass `--crew` to disambiguate.
- JSON mode is stable for UI/API integrations: use `--json`.
