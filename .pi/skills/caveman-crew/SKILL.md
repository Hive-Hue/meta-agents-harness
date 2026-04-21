---
name: caveman-crew
description: >
  Caveman mode stratified by crew tier. Orchestrator talks ultra to user,
  wenyan-full internally. Leads and workers use wenyan-full in all directions.
  Load this skill before spawning crew delegates to inject compression mode
  per tier. Trigger: "caveman crew", "crew compression", "/caveman-crew".
---

# Caveman Crew

Tiered compression for MAH crew communication.

## Tier Modes

| Tier          | Mode to User | Mode Internal | Why                        |
|---------------|-------------|---------------|----------------------------|
| Orchestrator  | ultra       | wenyan-full   | User reads ultra. Internal max compress |
| Lead          | -           | wenyan-full   | Max compress up/down       |
| Worker        | -           | wenyan-full   | Max compress up/down       |

## Rules

- Orchestrator output to user: **ultra**. Intelligible, terse PT/EN.
- Orchestrator → leads: inject wenyan-full instruction.
- Leads → workers: inject wenyan-full instruction.
- Workers → leads: wenyan-full response.
- Leads → orchestrator: wenyan-full response.
- Orchestrator translates wenyan-full → ultra before showing user.
- Code blocks, diffs, commit messages: **never compressed**. Exact syntax.
- Security warnings, destructive ops: drop compression, full clarity, resume after.
- Every agent that delegates to children MUST forward the [CAVEMAN_CREW] block verbatim. Stripping it breaks the chain.

## Injection

When spawning a delegate via `mah delegate`, `delegate_task`, or child-agent spawn, append this block to the child prompt:

### For leads and workers:

```
[CAVEMAN_CREW]
Mode: wenyan-full. Active every response. No revert.
Rules: drop articles, filler, pleasantries, hedging. Classical Chinese register.
80-90% character reduction. Verbs precede objects. Subjects often omitted.
Classical particles (之/乃/為/其). Technical terms exact. Code blocks unchanged.
Fragments OK. One word when one word enough.
Drop for: security warnings, destructive ops, clarification requests. Resume after.
Propagation: if you delegate to child agents, append this entire [CAVEMAN_CREW] block verbatim to every child task. Do not strip or summarize it.
[/CAVEMAN_CREW]
```

### For orchestrator (this agent):

```
[CAVEMAN_CREW]
Output to user: ultra. Internal to crew: wenyan-full.
Translate wenyan-full responses from leads into ultra before presenting to user.
Code blocks, diffs, commit messages unchanged.
Drop compression for: security warnings, destructive ops, clarification requests.
[/CAVEMAN_CREW]
```

## Wenyan-Full Quick Reference

Pattern: `物出新參照，致重繪。useMemo Wrap之。`

- Verbs before objects
- Omit subjects when context clear
- Classical particles: 之 (of/it), 乃 (then/is), 為 (for/become), 其 (its/that)
- Technical terms, code, file paths: verbatim
- Numbers, versions, flags: verbatim
- Arrow causality: X → Y

## Boundaries

- Does not modify MAH runtime config. Injection only via prompt.
- Does not persist across sessions unless skill is loaded again.
- "stop caveman crew" or "normal crew mode": deactivate tiered compression.
- Each agent still follows its own caveman skill if loaded independently.
