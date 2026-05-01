# Full Crews Cooperative Routing

## Goal

Add a cooperative execution mode:

```bash
mah --runtime <runtime> run --full-crews
```

The mode should allow the active orchestrator to route across all eligible agents from all accessible crews in the workspace, rather than being bounded to the active crew only.

The system must remain:

- expertise-first
- domain-bounded
- explainable
- opt-in
- compatible with existing single-crew behavior

## Problem

Today, `mah run` is primarily crew-scoped:

- the active crew is the main search boundary
- orchestrator reasoning is constrained to the local crew topology
- expertise routing can only optimize meaningfully inside that crew boundary

This is limiting for work that spans multiple teams, such as:

- security + platform + app coordination
- migration work that crosses legacy and new runtime specialists
- validation tasks that should flow to the strongest expert regardless of crew membership

The current model creates two failure modes:

1. the active crew contains only a mediocre match, but a stronger expert exists elsewhere
2. the operator must manually switch crews, fragmenting orchestration and session continuity

## Non-Goal

This spec does not propose:

- flattening all crews into a permanent single crew
- bypassing `domain_profiles` or approval rules
- removing the active crew abstraction
- changing runtime-native interactive UX semantics
- making every runtime implement cooperative routing locally

## Design

### Principle

The orchestrator sees broader eligibility. MAH still owns routing policy.

The new mode expands the routing candidate set from:

- `active crew agents`

to:

- `all eligible agents across workspace crews`

while preserving:

- runtime compatibility checks
- domain enforcement
- approval flow
- lifecycle and session tracking in the MAH control plane

### New Run Scope

Introduce a routing scope concept:

- `active_crew` — current default behavior
- `full_crews` — cooperative cross-crew behavior

Suggested metadata shape:

```ts
type RoutingScope = "active_crew" | "full_crews"
```

Suggested execution metadata additions:

```ts
type RoutingDecisionMetadata = {
  routing_scope: "active_crew" | "full_crews"
  source_crew: string
  candidate_crews: string[]
  selected_agent?: string
  selected_crew?: string
  expertise_score?: number
  context_score?: number
  domain_fit?: number
  continuity_score?: number
}
```

### CLI Surface

Primary new entrypoint:

```bash
mah --runtime <runtime> run --full-crews
```

Equivalent explain path:

```bash
mah --runtime <runtime> explain run --full-crews --trace
```

Behavior:

- `--full-crews` enables workspace-wide candidate discovery
- the active crew remains the source context, not the hard boundary
- `--trace` should make the wider routing set visible

### Cooperative Routing Flow

#### 1. Workspace Agent Discovery

MAH loads all crews from `meta-agents.yaml` and builds a workspace candidate graph.

The graph includes:

- crew id
- agent id
- role
- team
- model/runtime compatibility
- capabilities
- skills
- domain rules

#### 2. Eligibility Filtering

MAH excludes agents that fail any hard gate:

- incompatible runtime surface
- missing required role/capability
- invalid domain/profile fit
- explicit governance exclusion

This is a hard filter before scoring.

#### 3. Expertise-First Ranking

Candidate ranking should prioritize expertise over crew locality.

Suggested score components:

- `expertise_score`
- `context_score`
- `continuity_score`
- `active_crew_preference`
- `domain_fit`

Suggested behavior:

- expertise remains the primary ranking dimension
- active crew preference is a tie-breaker, not a hard override
- continuity with existing sessions may increase rank, but should not defeat a clearly stronger expertise match

#### 4. Routing Decision

The orchestrator chooses among the ranked candidates.

The output should remain explainable:

- why this agent was selected
- why cross-crew delegation happened
- what higher-ranked local candidates were rejected for

#### 5. Execution

Runtime adapters continue to execute via the MAH control plane.

Adapters should receive:

- selected agent
- selected crew
- routing metadata
- prepared context

Adapters should not own cooperative routing policy.

### Governance

`--full-crews` must not become a boundary bypass.

The following must still apply:

- per-agent domain enforcement
- approval-required domain rules
- fail-closed behavior in headless/non-interactive approval paths
- runtime-specific capability constraints

Future config extension may allow:

```yaml
routing:
  default_scope: active_crew
  cooperative:
    enabled: true
    allow_full_crews: true
    prefer_active_crew: true
    require_expertise_match: true
    allowed_crews:
      - dev
      - security
      - platform
```

This config is explicitly out of scope for the first slice.

### Observability

`mah explain run --full-crews --trace` should expose:

- routing scope
- source crew
- crews considered
- agents considered
- top-ranked candidates
- selected candidate
- concise reasoning

Lifecycle/session metadata should persist:

- `routing_scope=full_crews`
- `source_crew`
- `selected_crew`
- `selected_agent`

### WebUI Implications

This mode should later appear in the WebUI as a cooperative execution toggle.

Likely UX:

- `Routing Scope: Active Crew / Full Crews`
- routing reasoning panel
- visibility into cross-crew selection and expertise basis

WebUI is not required for the first CLI slice.

## Acceptance Criteria

The design is acceptable when:

1. `mah explain run --full-crews` considers agents from multiple crews
2. expertise ranking can select an agent outside the active crew
3. domain enforcement still blocks invalid cross-crew selection
4. active crew preference acts as a tie-breaker, not a hard boundary
5. lifecycle/session metadata records that cooperative routing was used
6. existing `mah run` behavior is unchanged when `--full-crews` is not set

## Risks

- prompt/context growth for orchestrator planning
- more expensive routing due to larger candidate sets
- ambiguous ownership between leads across crews
- explainability degradation if ranking is not transparent

## Recommended Rollout

Roll out in phases:

1. explain-only cooperative scope
2. shared workspace-wide candidate resolver
3. expertise-first ranking implementation
4. real `run --full-crews`
5. lifecycle/session metadata
6. governance/config extensions
7. WebUI cooperative mode

## Rationale

This keeps MAH aligned with its product identity:

- one control plane
- many runtimes
- expertise-aware routing
- bounded governance

`--full-crews` strengthens the orchestrator as the routing intelligence layer without collapsing crew structure or weakening domain boundaries.
