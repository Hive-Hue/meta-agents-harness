# RFC - MAH Mobile Control Plane via Hermes Gateway

## Status

- status: proposed
- date: 2026-05-17
- owner: core MAH
- target: post-v0.10 evolution
- thesis:
  - deliver a mobile operator surface for MAH crews using Hermes Gateway as the central session and orchestration transport

## 1. Problem

Current MAH operator surfaces are desktop-first:

- CLI for direct execution, inspection, and recovery
- WebUI for run/session/task observability and settings
- local runtime adapters and workspace artifacts on trusted hosts

That leaves a mobility gap.

Today, an operator cannot reliably do the following from a phone or tablet:

- continue an existing MAH/Hermes session
- monitor a long-running run with streaming status and artifacts
- review and approve sensitive actions in real time
- inspect file outputs, diffs, and command results away from the workstation
- trigger controlled execution against local or remote environments through the same MAH policy surface

The core issue is not missing primitives.
The repo already has strong building blocks:

- Hermes Gateway chat transport and streaming
- `mah sessions` and session interop
- `mah run --headless` and runtime adapter abstraction
- lifecycle events, artifacts, and task/mission console flows
- context memory and persistent memory APIs

The problem is that these capabilities are not yet shaped into a mobile-grade control plane.

## 2. Proposed Decision

Approve a new MAH product surface: **MAH Mobile**.

This product should:

- use **Hermes Gateway** as the canonical mobile orchestration endpoint
- keep runtime execution on trusted MAH hosts
- treat the phone as a control plane, not as a runtime host
- support team-ready operation from v1 through RBAC, audit, and session visibility rules
- target **React Native / Expo** as the primary client stack

This product should not:

- make the phone the primary holder of runtime credentials
- make SSH/device credentials primarily live on the phone
- bypass MAH policy, approval, or audit surfaces
- rebrand MAH Mobile as a Codex-compatible shell

## 3. Product Boundaries

### What It Is

- a mobile control plane for sessions, runs, approvals, artifacts, terminal/file operations, and orchestration chat
- a host-mediated execution model over trusted MAH/Hermes hosts
- a team-ready operator surface with RBAC and audit from v1
- a mobile-first extension of the MAH control plane, not a separate orchestration product

### What It Is Not

- a direct replacement for desktop IDE workflows
- a phone-local runtime execution platform
- a peer-to-peer SSH toolbox that bypasses MAH policy and control
- a Codex clone
- a direct mobile shell for every runtime CLI

## 4. Existing MAH Foundations to Reuse

MAH Mobile should be built on top of existing MAH subsystems rather than inventing a parallel stack.

Primary foundations:

- Hermes Gateway WebUI and `/api/mah/hermes-gateway/*`
- `mah sessions` and session interop envelopes
- `mah run --headless`, runtime adapters, and lifecycle events
- task/mission console and run artifact collection
- context memory and persistent memory APIs
- workspace `.env` plus Settings-driven configuration patterns

Implementation bias:

- prefer promoting or wrapping existing MAH APIs over creating mobile-only logic
- keep MAH as the system of record for policy, runtime selection, and persistence
- keep Hermes Gateway as the preferred orchestration transport for mobile chat and command continuity

## 5. Architecture

Canonical v1 architecture:

- `Mobile App (React Native / Expo)`
- `MAH Mobile API on trusted host`
- `Hermes Gateway`
- `MAH CLI / runtime adapters`
- `Remote execution connectors (SSH profiles managed by host)`

Key rule:

- phone talks to MAH host
- MAH host talks to Hermes Gateway, runtimes, SSH targets, filesystems, and policies

### Logical Flow

1. The mobile app authenticates to a trusted MAH host using device pairing and revocable tokens.
2. The MAH host exposes a mobile-safe API surface for sessions, runs, approvals, files, artifacts, terminal streams, and remote targets.
3. Hermes Gateway provides the central orchestration/chat surface and can route into MAH crews and runtime-backed execution.
4. Runtime execution stays on the host or on host-managed remote targets, never on the phone.
5. Mobile-originated actions are audited and policy-checked before execution.

### Host-Mediated Execution Model

The host owns:

- runtime credentials
- SSH profiles and target bindings
- workspace access
- approval enforcement
- artifact and session persistence

The mobile client owns:

- interaction state
- device identity
- streaming presentation
- voice capture and local mobile UX

## 6. Core User Journeys

These flows are first-class for v1:

### Resume Existing Session

- operator opens the app
- sees available sessions by workspace, crew, runtime, and owner
- resumes an existing Hermes or MAH-linked session
- continues orchestration without returning to desktop

### Start New Orchestration Thread

- operator selects workspace, crew, runtime, and remote target if needed
- opens a new Hermes orchestration thread
- sends an execution or planning request

### Monitor Long-Running Run

- operator opens run details from mobile
- sees streaming lifecycle, logs, tool activity, and artifacts
- can stop, retry, or open the associated session

### Receive and Act on Approval Requests

- operator receives a pending approval notification
- reviews command, target, scope, and reason
- approves or rejects with audit attribution

### Inspect Artifacts and Command Results

- operator opens generated files, diffs, command output, and run artifacts
- artifacts are tied to a run/session and remain host-resident

### Browse and Edit Files Through MAH

- operator browses the workspace tree
- inspects files and diffs
- submits a patch request through MAH-controlled execution rather than direct mobile file mutation

### Trigger Remote Execution Through Host-Mediated Routing

- operator selects a registered remote target
- MAH host performs SSH-backed execution or forwarding
- results stream back to the mobile app under the same audit and policy surface

### Voice Interaction

- operator speaks to the orchestrator using device-native voice capture
- transcribed text is sent through Hermes Gateway
- voice is a UI modality, not a separate orchestration path

## 7. Public API and Interface Additions

The mobile product should define a new logical API namespace:

- `/api/mah/mobile/auth/*`
- `/api/mah/mobile/devices/*`
- `/api/mah/mobile/sessions/*`
- `/api/mah/mobile/runs/*`
- `/api/mah/mobile/approvals/*`
- `/api/mah/mobile/artifacts/*`
- `/api/mah/mobile/files/*`
- `/api/mah/mobile/terminal/*`
- `/api/mah/mobile/targets/*`
- `/api/mah/mobile/voice/*`

These APIs are logical groups.
They may promote, wrap, or internally call existing MAH surfaces such as:

- `/api/mah/hermes-gateway/chat`
- `/api/mah/hermes-gateway/health`
- run/session lifecycle endpoints
- artifact collection and workspace access routines

### Shared Concepts

The RFC locks the following shared concepts into the design:

- `MobileHost`
  - a trusted MAH host registered to serve mobile requests for one or more workspaces
- `MobileDeviceSession`
  - the authenticated relationship between a paired device, a user, and a host
- `ApprovalRequest`
  - a persisted request to authorize a protected action before execution
- `RemoteTarget`
  - a host-managed execution target backed by SSH or local host context
- `FilePatchRequest`
  - a structured request to inspect, propose, review, and apply a workspace change through MAH policy
- `RunStreamEvent`
  - the canonical mobile event envelope for lifecycle, logs, activity, artifacts, approval needs, and terminal chunks
- `MobileAuditEvent`
  - an auditable record linking device, actor, host, workspace, target, and action

### Event Taxonomy

The mobile stream model should converge on a single event family regardless of whether the source is Hermes chat, MAH run lifecycle, or terminal output.

Required event categories:

- `session.meta`
- `session.state`
- `run.lifecycle`
- `run.log`
- `run.activity`
- `run.artifact`
- `approval.pending`
- `approval.resolved`
- `terminal.chunk`
- `file.diff`
- `host.warning`
- `error`

Transport rule:

- SSE is the minimum required transport
- WebSocket may be added for richer duplex streams, but the event schema must remain shared

## 8. Security Model

The v1 security model is mandatory, not aspirational.

### Identity and Pairing

- each device must pair with a trusted MAH host
- pairing produces revocable device tokens
- device sessions are attributable to a user, device, host, and role

### RBAC

v1 roles:

- `viewer`
  - can observe sessions, runs, artifacts, and approvals
  - cannot execute protected actions
- `operator`
  - can start and monitor runs, resume sessions, submit patch requests, and approve actions allowed by policy
- `admin`
  - can manage devices, hosts, roles, remote targets, and approval policies

### Approval Gates

Protected actions must require explicit approval when policy demands it, including:

- destructive terminal commands
- wide-scope file edits
- remote target operations in protected environments
- commands crossing sensitive domain/profile boundaries

### Secret Ownership

- runtime and target secrets remain host-scoped
- the phone may hold revocable access tokens, not long-lived infrastructure credentials
- the app must not become the primary trust root for SSH material

### Session Visibility

Team mode requires:

- session ownership metadata
- role-based visibility filters
- explicit rules for shared or delegated sessions

### Transport and Exposure

- TLS or private tunnel is required for host exposure
- hosts must be deployable behind private networking, reverse proxies, or zero-trust tunnels

### Audit

Every mobile-originated action must be auditable with:

- actor
- device
- host
- workspace
- crew
- runtime
- target
- action
- outcome
- timestamp

## 9. Non-Goals

The following are out of scope for v1:

- fully offline execution
- direct runtime hosting on device
- unrestricted direct SSH from the app
- collaborative live-editing similar to VS Code Live Share
- a mobile-specific plugin ecosystem
- replacing the desktop WebUI for dense config editing or large refactors

## 10. Acceptance Criteria

The RFC is acceptable when the resulting design enables the following:

1. An operator can resume a MAH-linked session from a phone without desktop access.
2. Run lifecycle, logs, and artifacts are visible in near real time on mobile.
3. Approval-gated actions can be reviewed and actioned safely from mobile.
4. File and terminal actions route through MAH host policy rather than bypassing it.
5. Team-role separation exists from v1 through RBAC and audit.
6. Remote target execution can be initiated from mobile through host-mediated routing.
7. Hermes Gateway remains the canonical mobile orchestration surface rather than a Codex-specific engine.

## 11. Implementation Direction

This RFC intentionally leaves OpenAPI-level details to implementation work, but it is decision-complete on product shape and architecture:

- mobile is a first-class MAH control plane
- Hermes Gateway is the orchestrator entrypoint
- the host is the trust boundary
- team-ready security is required in v1
- remote dev actions remain mediated and auditable

The execution roadmap for this RFC is tracked in:

- `plan/mah-mobile-control-plane-slices.md`
