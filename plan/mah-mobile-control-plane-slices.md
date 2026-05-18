# MAH Mobile Control Plane - Implementation Slices

**Status:** proposed
**Date:** 2026-05-17
**Target:** post-v0.10 evolution
**RFC:** `docs/mobile/mah-mobile-control-plane-rfc.md`

## Summary

This plan decomposes MAH Mobile into implementable slices for a **team-ready, host-mediated, React Native / Expo-first** mobile control plane powered by **Hermes Gateway**.

Locked defaults:

- product shape: `Full Remote Dev`
- connectivity model: `host-mediated`
- audience: `team-ready from day 1`
- client stack: `React Native / Expo first`
- orchestration engine: `Hermes Gateway`
- MAH role: control plane over local and remote runtimes, sessions, approvals, artifacts, and policies

## Cross-Slice Rules

- The phone is never a runtime host.
- Remote execution is always mediated by a trusted MAH host.
- Mobile APIs must reuse or wrap existing MAH control-plane logic where possible.
- RBAC and audit are required from v1, not deferred.
- SSE is the minimum streaming contract; WebSocket is optional if it does not split the event schema.
- Direct SSH from the phone is out of scope even though remote targets are in scope.

## Slice 1 - Control Plane Contract

### Scope

- define the shared mobile API map
- define the mobile event taxonomy
- decide which existing WebUI and Hermes Gateway endpoints are promoted vs wrapped

### Deliverables

- mobile API namespace design for:
  - auth
  - devices
  - sessions
  - runs
  - approvals
  - artifacts
  - files
  - terminal
  - remote targets
  - voice
- canonical `RunStreamEvent` categories shared across Hermes chat, MAH run lifecycle, and terminal streams
- mapping table showing reuse of:
  - `/api/mah/hermes-gateway/*`
  - run/session lifecycle endpoints
  - artifact/context/file utilities already present in the WebUI backend

### Acceptance

- decision-complete API map exists for chat, sessions, runs, approvals, artifacts, files, terminal, and remote targets
- event taxonomy is transport-agnostic and does not depend on client-specific parsing

## Slice 2 - Host Identity and Security

### Scope

- pairing flow for mobile devices
- token issuance, rotation, and revocation
- RBAC policy model
- mobile audit event persistence

### Deliverables

- `MobileHost` and `MobileDeviceSession` persistence model
- pairing bootstrap flow for first-time device registration
- role model with `viewer`, `operator`, `admin`
- audit schema for mobile-originated actions
- protected-endpoint middleware strategy for mobile APIs

### Acceptance

- every mobile request can be attributed to device, user, host, and role
- protected operations require role and policy checks
- device access can be revoked without rotating runtime or SSH secrets

## Slice 3 - Session and Run Mobility

### Scope

- session listing, resume, and new-session flows
- run lifecycle streaming
- artifact loading and association
- reconnect-safe mobile behavior

### Deliverables

- mobile session list and filtering contract by workspace, runtime, crew, owner, and status
- resume behavior for Hermes-native sessions and MAH-linked non-Hermes sessions
- run detail stream model covering lifecycle, logs, tool activity, and artifacts
- background-friendly stream reconnect policy with replay-safe semantics

### Acceptance

- session continuity remains stable under intermittent mobile connectivity
- operators can observe run progress and artifacts without desktop access
- reconnect does not silently lose critical run state

## Slice 4 - Approvals Queue

### Scope

- approval object model
- pending approvals queue
- approval resolution flows
- integration with sensitive execution paths

### Deliverables

- `ApprovalRequest` schema with actor, role, command summary, scope, target, reason, and expiry
- queue endpoints for list, inspect, approve, deny, and expire
- integration points for:
  - destructive terminal actions
  - protected file patch apply actions
  - protected remote target commands
  - policy-driven runtime/headless execution boundaries

### Acceptance

- a mobile operator can approve or reject pending actions and see the resulting run state change
- expired approvals fail closed with clear operator feedback

## Slice 5 - Remote Dev Surface

### Scope

- file tree and file read access
- diff and patch-request workflow
- terminal execution model
- policy-aware edit boundaries

### Deliverables

- file browsing contract scoped to workspace roots
- read-only inspection APIs for files and diffs
- `FilePatchRequest` lifecycle:
  - inspect
  - propose patch
  - review
  - apply through MAH
- terminal stream model aligned with the shared event taxonomy

### Safety Rules

- the app does not mutate files directly
- file changes are applied by the host through MAH-governed actions
- protected apply actions can feed the approvals queue

### Acceptance

- the mobile app can inspect files and submit controlled edits without bypassing MAH policy
- terminal output is streamed and attributable to actor, device, host, and target

## Slice 6 - Remote Targets and SSH

### Scope

- remote target registry on host
- target selection from mobile
- SSH-backed execution through host mediation
- target health and binding model

### Deliverables

- `RemoteTarget` schema with identity, transport type, workspace binding, environment class, and health state
- host-managed SSH profile storage and validation strategy
- target selection UX contract for runs, sessions, and terminal actions
- error model for unreachable or degraded targets

### Acceptance

- a mobile-triggered run can execute against a registered remote target through the host
- remote connectivity failures degrade with actionable error states
- SSH material remains server-side

## Slice 7 - Voice and Mobile UX

### Scope

- client-side voice capture and playback
- voice-to-chat orchestration flow
- mobile-first IA for core surfaces

### Deliverables

- voice input boundary for transcript-to-Hermes submission
- optional playback/TTS boundary for assistant responses
- mobile navigation model:
  - Runs
  - Sessions
  - Approvals
  - Workspace
  - Chat
- interaction model for notifications, deep links, and action shortcuts

### Acceptance

- voice input works as an alternate entry path into the same Hermes orchestration flow
- mobile IA stays focused on operational control rather than desktop-density editing

## Slice 8 - Rollout

### Scope

- phased delivery and validation path
- operational hardening milestones

### Deliverables

- alpha:
  - one MAH host
  - one workspace
  - one operator
- beta:
  - multi-user RBAC
  - approval queue
  - remote targets
- production hardening:
  - stream reconnect behavior
  - audit visibility
  - push notifications
  - host exposure guidance

### Acceptance

- rollout path exists without requiring a big-bang release
- security and observability hardening are explicit preconditions for broader adoption

## Test Plan

### Session Continuity

- resume existing Hermes session
- resume non-Hermes MAH-linked session through host bridge
- recover after network interruption without losing authoritative state

### Run Visibility

- streaming lifecycle, logs, and artifacts appear on mobile in near real time
- failed run surfaces reason and terminal context
- retry preserves audit trace and run lineage

### Approval Safety

- destructive action creates approval request
- wrong-role user cannot approve
- expired approval is rejected cleanly

### Remote Dev

- file browse and read works on bound workspace
- patch request is policy-checked before apply
- terminal output is streamed and attributed

### Remote Targets

- registered SSH target can execute a host-mediated run
- unreachable target degrades with actionable error state
- host credential ownership remains server-side

### Team-Ready Behavior

- session visibility respects RBAC
- audit trail records actor, device, host, target, and operation
- cross-user access is denied by default unless granted

## Assumptions

- new docs live under `docs/mobile/` and `plan/`
- the RFC is product and architecture oriented, not a low-level OpenAPI spec
- this plan is slice-oriented and meant to feed later implementation tasks and missions
- existing Hermes Gateway and WebUI code are reusable foundations, not throwaway prototypes
- direct SSH from the phone is out of scope for v1 even though remote targets are in scope
