# Quasi Root Domain Approval

## Goal

Allow a worker to request temporary access outside its normal bounded domain without converting that access into a permanent bypass.

The mechanism must remain:

- explicit
- session-scoped
- operation-scoped
- fail-closed outside interactive TUI mode

## Problem

Current `domain_profile` enforcement in `extensions/multi-team.ts` is binary:

- path is allowed
- or path is blocked

There is no middle state for:

- "this path is normally restricted"
- "but the operator may approve a one-off access in the TUI"

## Design

### Domain Rule Extensions

`DomainRule` may include:

- `approval_required?: boolean`
- `approval_mode?: "explicit_tui"`
- `grant_scope?: "single_path" | "subtree" | "single_op"`

Example:

```yaml
domain_profiles:
  quasi_root:
    - path: .
      read: true
      upsert: true
      delete: true
      recursive: true
      approval_required: true
      approval_mode: explicit_tui
      grant_scope: subtree
```

### Approval Flow

When a worker attempts a path operation:

1. If the rule allows it directly, proceed.
2. If the matching rule requires approval:
   - create a pending approval request
   - notify the operator in the TUI
   - block the tool call
3. Operator approves with:
   - `/approve-domain <id>`
4. Operator can deny with:
   - `/deny-domain <id>`
5. Operator can inspect state with:
   - `/domain-approvals`

### Grant Semantics

Approved access is stored as a temporary in-memory grant:

- bound to `agentName`
- bound to `operation`
- bound to `path`
- optionally widened by `grant_scope`

Grant scopes:

- `single_op`: consumed on the next matching operation
- `single_path`: reusable for the exact path only during the session
- `subtree`: reusable for descendants of the approved path during the session

## Safety

### Fail-Closed

Approval is denied if:

- `PI_MULTI_HEADLESS=1`
- `stdin` is not a TTY
- `stdout` is not a TTY

This prevents silent escalation in:

- headless runs
- delegated background execution
- non-interactive pipelines

### Audit

The runtime must emit events for:

- `domain_approval_requested`
- `domain_approval_granted`
- `domain_approval_denied`

## Current Implementation Scope

This implementation provides:

- explicit approval through slash commands in the active TUI
- temporary in-memory grants
- worker path enforcement integration
- headless fail-closed behavior

It does not yet provide:

- modal confirmation UI
- cross-process approval propagation
- persistent grants
- approval storage in session files

## Rationale

This preserves MAH's bounded-domain identity.

The operator may grant exceptions, but only through explicit action and only for the current interactive session.
