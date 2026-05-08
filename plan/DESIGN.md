# MAH WebUI Design

## Stitch Reference

This document is aligned with the existing Stitch project:

- Project: `Meta-Agents Harness Dashboard`
- Stitch project id: `12849774871511595309`
- Design system asset: `assets/08f04d35f3344c2589123f86ce04bfc9`
- Observed screens: `MAH Overview`, `MAH Config Editor`, `MAH Run Console`, `MAH Sessions History`, `MAH Crews Topology`, and an imported `DESIGN.md` reference screen

The dashboard project is the source of truth for the WebUI/operator-console visual language. The separate `MAH Product Landing` Stitch project uses a dark, neon command-center style and should not drive the application console unless a dedicated marketing surface is being designed.

## Purpose

The MAH WebUI is an operator console for configuring, running, and understanding Meta Agents Harness workspaces.

It should make the CLI engine easier to operate without hiding the underlying model. The interface is not a chatbot wrapper and not a marketing dashboard. It is a compact control surface for:

- bootstrapping `meta-agents.yaml`
- editing crews, agents, skills, models, and domain profiles
- routing work by expertise
- retrieving operational context
- running and inspecting sessions
- reviewing lifecycle events, evidence, and governed proposals
- syncing generated runtime artifacts safely

The core UX goal is confidence: the operator should always understand what MAH will do, which agent will act, what context will be loaded, what files can be touched, and what changed afterward.

## Product Principles

- **Config is visible.** The WebUI edits and explains `meta-agents.yaml`; it does not replace it with hidden state.
- **Actions are explainable.** Routing, context retrieval, sync diffs, and validation should always show why a result was selected.
- **Operational density.** Favor scannable tables, split panes, timelines, and inspectors over large hero panels or decorative cards.
- **Safe by default.** Destructive operations, broad domain access, runtime sync, and proposal application require explicit confirmation.
- **CLI parity.** Every major UI action should map to a visible `mah` command or API operation.
- **Progressive depth.** Common tasks should be one or two clicks, with advanced YAML/detail views nearby.
- **Local-first trust.** The UI should make clear which data is workspace-local, which provider/API is used, and what is sent externally.

## Target Users

- **Solo operator:** wants to initialize a repo, choose a runtime/provider, run tasks, and inspect results quickly.
- **Technical lead:** manages crews, domain profiles, skills, routing quality, and context memory.
- **Release/review owner:** checks validation, sync diffs, evidence, lifecycle events, and governance proposals.
- **Runtime integrator:** verifies runtime plugin state, generated artifacts, and headless/session behavior.

## Information Architecture

Primary navigation should be a persistent left rail. Keep it narrow, icon + label, with the active workspace and runtime status pinned at the bottom.

Main sections:

- **Overview:** workspace health, active crew, runtime status, recent sessions, validation state, pending proposals.
- **Bootstrap:** guided setup for new or reset workspaces.
- **Config:** structured editor for `meta-agents.yaml`.
- **Crews:** topology graph, agents, skills, models, domain profiles.
- **Run:** task composer, routing preview, context preview, execution controls.
- **Sessions:** session list, lifecycle timeline, logs, artifacts, resume/export/delete.
- **Expertise:** catalog, recommendations, evidence, sync, proposals, lifecycle.
- **Context:** operational memory search, documents, proposals, validation.
- **Sync:** generated artifact diff, runtime targets, validation results.
- **Settings:** providers, runtime plugins, workspace paths, secrets status, UI preferences.

## Layout Model

Use a three-region operational layout:

- **Left rail:** navigation, active workspace, active crew, detected runtime.
- **Main work area:** tables, editors, graphs, task composer, timelines.
- **Right inspector:** selected item details, explanation, command preview, YAML preview, validation warnings.

The inspector should be collapsible. On mobile, it becomes a bottom sheet.

Avoid nested cards. Use full-width bands and clear section dividers. Cards are reserved for repeated entities such as agents, sessions, proposals, and validation findings.

## Visual Direction

Modern, minimal, technical, and calm.

The Stitch design system describes this as **Operational Density** and **Technical Confidence**: a high-information engineering control deck closer to a refined IDE than a marketing dashboard.

Use these observed tokens as implementation defaults:

- background: `#fdf8f8`
- main surface: `#ffffff`
- low surface: `#f7f3f2`
- panel surface: `#f1edec`
- raised surface: `#ebe7e7`
- primary text: `#1c1b1b`
- secondary text: `#444748`
- primary/action: `#0a0a0a`
- cyan accent: `#00BCD4`
- cyan secondary: `#006876`
- success: `#4CAF50`
- warning: `#FFC107`
- danger: `#F44336`
- border: `#E0E0E0` for component strokes, `#c4c7c7` for stronger outlines
- runtime badge background: `#ECEFF1`
- grid/noise overlay: `rgba(0, 0, 0, 0.03)`

Use radius tokens from Stitch:

- small controls: `0.25rem`
- compact panels and graph nodes: `0.375rem`
- larger cards, drawers, and overlays: `0.5rem`
- avoid oversized, playful radii unless a modal or sheet needs stronger separation

Use spacing tokens from Stitch:

- left rail width: `64px`
- inspector width: `360px`
- default gutter: `16px`
- stack gap: `12px`
- section padding: `24px`

Avoid a dominant purple/blue gradient aesthetic. MAH should feel like an operations tool, not a SaaS landing page. Gradients are acceptable only as subtle focus treatments for active execution states, not as the page identity.

Suggested type:

- UI: `Geist`, matching the Stitch system
- Code/YAML/logs: `IBM Plex Mono`, matching the Stitch system
- H1: `24px / 32px`, weight `600`
- H2: `18px / 24px`, weight `600`
- Body: `14px / 20px`, weight `400`
- Mono UI: `13px / 18px`, weight `400`
- Code block: `13px / 20px`, weight `400`
- Label caps: `11px / 16px`, weight `700`, `0.05em` tracking

### Visual Adjustments To Apply

- Keep the app light by default. A dark mode can exist later, but it should not inherit the landing-page `Obsidian Logic` system directly.
- Use 1px neutral strokes for tables, inspectors, editors, and split panes. This is intentionally different from the landing-page "no-line" rule.
- Use tonal layering first, then borders, then shadows. Shadows should remain rare and only support overlays, command palettes, dropdowns, and focus panels.
- Reserve cyan for active processes, selected routes, running sessions, and positive system affordances. Do not use cyan for every link or decoration.
- Keep runtime colors as compact badges. Runtime identity must not recolor whole pages.
- Preserve high information density, but add quiet breathing room around destructive controls and confirmation states.

## Core Workflows

### 1. First Run Bootstrap

Goal: create a valid, expertise-aware `meta-agents.yaml` with minimal friction.

Flow:

1. Detect workspace state.
2. Ask for mode: logical or AI-assisted.
3. If AI-assisted, show provider picker:
   - Z.ai
   - OpenRouter
   - Codex OAuth
   - MiniMax
4. Ask for key/token and model, with provider defaults.
5. Ask for project name, crew id, mission, and brief.
6. Preview generated topology before write.
7. Write config.
8. Offer next actions: `mah sync`, `mah expertise seed`, `mah validate:all`.

UI requirements:

- Show the exact command equivalent.
- Show where API keys are used and whether they are stored.
- Show fallback behavior before running.
- Show generated diff before writing when overwriting existing config.

### 2. Config Editing

Goal: edit `meta-agents.yaml` without breaking schema or runtime projections.

Views:

- **Structured view:** forms/tables for runtime overrides, catalog models, domain profiles, crews, agents.
- **YAML view:** Monaco-style editor with validation markers.
- **Diff view:** before/after YAML diff.

Controls:

- add/edit/remove crew
- add/edit/remove agent
- assign model ref
- assign skills
- assign domain profiles
- edit domain rules
- validate
- format YAML
- dry-run sync

Important UX detail:

Domain profile editing needs explicit labels:

- `read`: can inspect files
- `edit`: can create/update files in scope
- `bash`: can execute shell commands in scope
- `recursive`: applies below the path
- `approval_required`: requires explicit operator approval

Default profiles should be visible:

```yaml
read_only_cwd:
  - path: .
    read: true

write_cwd:
  - path: .
    read: true
    edit: true
    bash: true
    recursive: true

write_user_home_with_approval:
  - path: <home>
    read: true
    upsert: true
    delete: false
    recursive: true
    approval_required: true
```

### 3. Crew Topology

Goal: make the orchestrator -> leads -> workers structure understandable.

Main view:

- compact topology graph
- lanes by team: orchestration, planning, engineering, validation
- agent cards with role, model, skills, domain profile, expertise state
- warnings for missing references or overly broad domains

Interactions:

- select agent to open inspector
- drag agent between teams only if schema remains valid
- quick filter by role, capability, model, domain profile
- compare two agents' capabilities

### 4. Task Routing

Goal: let the user submit a task and understand who should handle it before execution.

Flow:

1. User enters task.
2. UI calls `mah expertise recommend --task`.
3. Show recommended agent, confidence, capability match, fallback candidates.
4. UI calls context preview for selected agent.
5. User starts run or delegates to selected agent.

Routing preview should show:

- selected agent
- matching capabilities
- confidence
- relevant evidence
- context documents that would be loaded
- domain profile constraints
- command equivalent

### 5. Run Console

Goal: execute work with visible progress and recoverable sessions.

Main elements:

- task composer
- crew/runtime selector
- routing preview
- execution timeline
- lifecycle event stream
- stdout/stderr/log pane
- context loaded panel
- artifacts/results panel

Lifecycle states:

- queued
- routed
- running
- completed
- failed

Failed runs should surface:

- failure reason
- runtime
- command args
- last meaningful log lines
- retry/resume options

### 6. Sessions

Goal: inspect, resume, export, and delete sessions safely.

List columns:

- session id
- runtime
- crew
- active agent
- status
- started/updated time
- last task summary
- lifecycle state

Session detail:

- lifecycle timeline
- run metadata
- task prompt
- selected agent
- context docs
- evidence written
- artifacts
- export/delete controls

Delete requires typed confirmation for non-empty sessions.

### 7. Expertise

Goal: make routing quality inspectable and governed.

Views:

- catalog entries by crew/agent
- capability matrix
- confidence and lifecycle states
- evidence timeline
- sync dry-run
- proposal queue

Core actions:

- seed expertise
- recommend agent for task
- explain recommendation
- sync from evidence
- create proposal
- apply proposal
- change lifecycle
- export with evidence

Governance UX:

- proposals should show a before/after diff
- confidence changes require rationale
- lifecycle changes require reason and actor
- applied proposals should link to evidence

### 8. Context Manager

Goal: manage operational memory used after routing.

Views:

- document list
- search/retrieval preview
- validation status
- proposal queue
- document editor

Document detail:

- id
- crew
- agent
- capabilities
- domains
- tools
- task patterns
- stability
- refs
- body preview

Retrieval preview:

- task input
- selected agent
- matched documents
- scoring/explanation
- excluded documents and why

### 9. Sync And Runtime Artifacts

Goal: make generated runtime artifacts transparent.

Flow:

1. Run validation.
2. Show planned generated paths by runtime.
3. Show diff.
4. Let user apply sync.
5. Show result and next validation.

Runtime targets:

- `.pi/`
- `.claude/`
- `.opencode/`
- `.hermes/`

The UI should distinguish:

- source config: `meta-agents.yaml`
- generated runtime artifacts
- workspace-local MAH state: `.mah/`
- installed/global MAH assets

## Component Inventory

Core components:

- `WorkspaceHeader`
- `RuntimeBadge`
- `CrewSelector`
- `CommandPreview`
- `YamlEditor`
- `ValidationPanel`
- `DiffViewer`
- `TopologyGraph`
- `AgentCard`
- `DomainProfileEditor`
- `TaskComposer`
- `RoutingPreview`
- `ContextPreview`
- `LifecycleTimeline`
- `SessionTable`
- `EvidenceTimeline`
- `ProposalReview`
- `ProviderPicker`
- `SecretInput`
- `ArtifactDiff`
- `ToastLog`

Use icons for repeated actions: validate, sync, run, resume, export, delete, inspect, copy command, open file, approve, reject.

## Stitch Screen Coverage

The current Stitch project covers the main operational spine:

- `MAH Overview`: validates the three-region dashboard shell, workspace health, runtime state, recent sessions, and validation/proposal summaries.
- `MAH Config Editor`: validates structured config editing, YAML inspection, and right-side command/validation context.
- `MAH Run Console`: validates task composition, routing preview, runtime controls, lifecycle timeline, and logs/artifacts.
- `MAH Sessions History`: validates session list density, lifecycle status scanning, and detail inspection.
- `MAH Crews Topology`: validates topology graph concepts, agent cards, role/model/domain metadata, and inspector behavior.

Missing or under-specified screens to add in Stitch before implementation lock:

- `MAH Bootstrap Wizard`: first-run flow, provider picker, key handling, generated topology preview, and overwrite confirmation.
- `MAH Expertise Governance`: catalog, evidence timeline, proposal queue, lifecycle state changes, and confidence rationale.
- `MAH Context Manager`: operational memory documents, retrieval preview, excluded-document explanations, and proposal promotion.
- `MAH Sync Review`: generated artifact paths, runtime target selection, diff preview, validation result, and apply confirmation.
- `MAH Settings`: provider/runtime plugin status, workspace paths, secret status, and UI preferences.
- `Mobile Navigation Variant`: bottom navigation, stacked tables, inspector bottom sheet, and topology list fallback.

Do not treat the current screen set as complete product scope. It is sufficient for validating the shell and primary interaction density, not for the governance and setup workflows.

## Stitch UI/UX Validation

Validation source: generated Stitch screens from project `12849774871511595309`, inspected through their exported HTML for `MAH Overview`, `MAH Config Editor`, `MAH Run Console`, `MAH Sessions History`, and `MAH Crews Topology`.

Overall assessment: directionally aligned, but not implementation-ready without cleanup. The screens validate the intended operator-console model and information density, but they also include generated-code artifacts that should not become product conventions.

What is working:

- The three-region shell is consistently represented: left navigation rail, main work area, and right inspector.
- The screens mostly preserve a light, technical, high-density aesthetic rather than the dark/neon landing-page direction.
- Command previews appear in the core operational screens and reinforce CLI parity.
- The inspector pattern is strong. It gives room for YAML snippets, selected item details, context, and warnings without overwhelming the main pane.
- Tables, timelines, graph nodes, and config panels match the desired operational density better than card-heavy SaaS layouts.
- The Stitch tokens are applied broadly enough to validate the palette, type scale, rail width, inspector width, gutters, and mono/code usage.
- Cyan is generally used for active or system-positive states, not as a full-page brand wash.
- Destructive or risky actions are visually distinct in several screens through red/error treatment.

Required adjustments before implementation:

- Remove generated `dark:*` classes from the light-mode baseline. They introduce an implicit dark mode that has not been designed or validated.
- Replace generic nav labels such as `Registry`, `Analytics`, and `Environment` with the product IA labels in this document: `Config`, `Expertise`, `Context`, `Sync`, and `Settings`.
- Reduce shadows. The generated screens use `shadow-sm` on cards, textareas, command previews, and topology nodes more often than the design direction allows. Keep shadows only for overlays, drawers, dropdowns, and explicit focus panels.
- Standardize the header and rail across screens. Current exports vary between button and anchor nav items, hidden logo behavior, label visibility, active opacity, and header search placement.
- Add accessible names to icon-only buttons. Titles are not enough; implementation needs `aria-label`, visible focus states, and keyboard order validation.
- Add semantic state text beside color indicators. Running, warning, failed, active, and healthy states must not rely on cyan/amber/red dots alone.
- Make the right inspector behavior explicit at responsive breakpoints. Current desktop exports hide it below `lg`, but mobile/tablet replacement behavior is not represented.
- Tighten action hierarchy. Primary actions such as `Approve`, `Save Config`, and `Start Run` are clear, but adjacent secondary/destructive actions need more spacing and confirmation affordance.
- Ensure command previews always include the exact command plus copy affordance and execution context. Some previews are visually present but not yet specific enough to prove CLI parity.
- Replace placeholder/demo domain and model values with realistic MAH concepts before handoff, especially in topology and routing examples.

Screen-specific validation:

- `MAH Overview`: Strong dashboard summary and inspector pattern. Needs IA label cleanup, less reliance on cyan for header/nav identity, and clearer status semantics beyond dots.
- `MAH Config Editor`: Strongest match to the product. It validates structured editing, warning inspection, tabs, YAML-adjacent context, and save/discard controls. Needs explicit domain profile editing states and stronger overwrite confirmation flow.
- `MAH Run Console`: Good task composer and routing-preview foundation. Needs clearer distinction between preview, queued, running, failed, and completed states; destructive/stop controls need confirmation treatment.
- `MAH Sessions History`: Good table density and detail inspector. Needs typed-confirmation delete flow represented, clearer export/resume/delete hierarchy, and better mobile fallback for wide tables.
- `MAH Crews Topology`: Good concept validation for graph nodes and inspector. Needs stronger lane/group labeling, realistic agent hierarchy, accessible non-graph fallback, and less shadow on graph nodes.

Implementation guardrails from this validation:

- Treat Stitch HTML as a visual reference, not production markup.
- Rebuild components with semantic HTML and accessibility first; do not copy generated nav/header/button markup verbatim.
- Keep the visual tokens, layout proportions, and inspector pattern.
- Normalize repeated primitives into shared components before building feature screens.
- Validate every implemented screen against this document with keyboard-only navigation, reduced motion, color contrast, and mobile inspector behavior.

## Interaction Details

### Command Preview

Every state-changing operation should show the equivalent command:

```bash
mah sync
mah validate:all
mah expertise recommend --task "fix auth middleware"
mah context find --agent backend-dev --task "fix auth middleware"
mah sessions resume pi:dev:abc123
```

This keeps CLI and WebUI behavior aligned.

### Safety Confirmations

Require confirmation for:

- overwriting `meta-agents.yaml`
- applying sync with file changes
- deleting sessions
- applying governance proposals
- granting broad domain access
- running bash-capable agents on broad scopes

### Validation Feedback

Validation should be inline and actionable:

- missing references
- unknown domain profiles
- invalid model refs
- agents missing skills
- broad write/bash domains
- runtime plugin missing
- generated artifact drift

## Data And API Boundary

The WebUI should not reimplement MAH logic. It should call a thin backend wrapper around existing commands and shared scripts.

Suggested backend API:

- `GET /api/workspace/status`
- `GET /api/config`
- `POST /api/config/validate`
- `POST /api/config/preview`
- `POST /api/config/write`
- `POST /api/bootstrap/preview`
- `POST /api/bootstrap/apply`
- `GET /api/crews`
- `GET /api/graph`
- `POST /api/run/preview`
- `POST /api/run/start`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `POST /api/sessions/:id/resume`
- `POST /api/sessions/:id/export`
- `DELETE /api/sessions/:id`
- `POST /api/expertise/recommend`
- `POST /api/expertise/sync/preview`
- `POST /api/expertise/sync/apply`
- `GET /api/context/docs`
- `POST /api/context/find`
- `POST /api/sync/preview`
- `POST /api/sync/apply`

Backend implementation should prefer existing MAH modules over shelling out where practical. Shell execution remains acceptable for exact CLI parity and early delivery.

## State Model

Primary workspace state:

- `meta-agents.yaml`
- `.mah/expertise/catalog`
- `.mah/expertise/evidence`
- `.mah/expertise/registry.json`
- `.mah/context/operational`
- `.mah/context/proposals`
- `.mah/sessions/lifecycle-events`
- generated runtime directories

UI state:

- selected workspace
- selected crew
- selected runtime
- active session
- pending config draft
- active inspector item
- provider selection

Do not store secrets in browser local storage. Prefer process memory or OS keychain integration in a later version.

## Empty States

Use empty states as operational launch points:

- no `meta-agents.yaml`: show bootstrap
- no expertise catalog: show `mah expertise seed`
- no context docs: show create/import/validate options
- no sessions: show task composer
- no runtime marker: show runtime selection and init guidance
- validation failed: show prioritized fix list

## Accessibility

- full keyboard navigation for left rail, tables, provider picker, modals, and editors
- visible focus rings
- minimum 4.5:1 text contrast
- no color-only status indicators
- table rows and graph nodes must expose labels to screen readers
- reduced-motion mode for timelines and graph transitions

## Responsive Behavior

Desktop:

- left rail + main + right inspector
- topology and diff views use wide layouts

Tablet:

- collapsible rail
- inspector as side drawer

Mobile:

- bottom nav
- inspector as bottom sheet
- tables become stacked rows
- graph view becomes searchable list plus mini-map

## Implementation Phases

### Phase 1: Read-Only Console

- workspace status
- config viewer
- crew topology
- validation output
- session list/status
- expertise catalog browser
- context document browser

### Phase 2: Guided Operations

- bootstrap wizard
- provider picker
- task routing preview
- context preview
- run start/resume
- sync preview

### Phase 3: Editing And Governance

- structured config editor
- domain profile editor
- proposal review/apply
- expertise sync dry-run/apply
- context proposal promotion

### Phase 4: Runtime Operations

- artifact diff explorer
- runtime plugin manager
- lifecycle event streaming
- session export viewer
- diagnostics center

## Success Criteria

- A new user can create a valid `meta-agents.yaml`, sync, seed expertise, and run a task without reading CLI docs.
- An experienced operator can inspect and edit config faster than manual YAML editing.
- Every run shows selected agent, context loaded, lifecycle state, and result.
- Every generated file change is previewable before sync.
- Broad write/bash access is visible before execution.
- The WebUI preserves CLI parity and never becomes a separate source of truth.
