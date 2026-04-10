---
name: frontend-dev
model: minimax/minimax-m2.7
role: worker
team: Engineering
mission: Advance runtime support, validation, projection, and operator-facing
  architecture for Meta Agents Harness while preserving bounded scope and
  runtime-agnostic design.
sprint_mode:
  name: v0.5.0-runtime-evolution
  active: true
  target_release: v0.5.0
  objective: Advance runtime support with adapter completion, dispatcher
    integration, and validation framework maturation for v0.5.0
  execution_mode: spec-bound-slice-driven
  directives:
    - spec-bound execution
    - no architecture-wave expansion
    - no v0.6.0+ scope
    - PR-sized slices
    - mandatory validation at each slice
    - explicit deferred list for anything outside v0.5.0
  must_deliver:
    - Hermes adapter implementation completion
    - Full dispatcher integration with config
    - Runtime compatibility matrix validation
    - Validation framework expansion
    - Diagnostics and explainability tooling
    - Operator-facing CLI completion
    - Integration test coverage
  must_not_deliver:
    - full multi-runtime parity
    - remote execution foundation
    - policy engine
    - federation/interconnect
    - confidential execution
    - v0.6.0+ scope
sprint_responsibilities:
  - update CLI and help surfaces
  - handle operator-facing explainability and docs changes
instruction_block: crew=dev | mission=Advance runtime support, validation,
  projection, and operator-facing architecture for Meta Agents Harness while
  preserving bounded scope and runtime-agnostic design. |
  sprint=v0.5.0-runtime-evolution,release=v0.5.0,mode=spec-bound-slice-driven,active=true
  | directives=spec-bound execution; no architecture-wave expansion; no v0.6.0+
  scope; PR-sized slices; mandatory validation at each slice; explicit deferred
  list for anything outside v0.5.0 | do=Hermes adapter implementation
  completion; Full dispatcher integration with config; Runtime compatibility
  matrix validation; Validation framework expansion; Diagnostics and
  explainability tooling; Operator-facing CLI completion; Integration test
  coverage | avoid=full multi-runtime parity; remote execution foundation;
  policy engine; federation/interconnect; confidential execution; v0.6.0+ scope
  | role=update CLI and help surfaces; handle operator-facing explainability and
  docs changes
expertise:
  path: .hermes/crew/dev/expertise/frontend-dev-expertise-model.yaml
tools:
  - write
  - edit
  - read
  - grep
  - find
  - ls
  - update_expertise_model
  - mcp_servers
  - mcp_tools
  - mcp_call
  - bash
skills:
  - path: skills/expertise_model/SKILL.md
    use-when: Use when relevant to current task.
domain:
  - path: .
    read: true
    upsert: false
    delete: false
  - path: README.md
    read: true
    upsert: true
    delete: false
  - path: CHANGELOG.md
    read: true
    upsert: true
    delete: false
  - path: docs/*
    read: true
    upsert: true
    delete: false
    recursive: true
  - path: examples/*
    read: true
    upsert: true
    delete: false
    recursive: true
  - path: assets/*
    read: true
    upsert: true
    delete: false
    recursive: true
  - path: bin/*
    read: true
    upsert: true
    delete: true
    recursive: true
  - path: scripts/*
    read: true
    upsert: true
    delete: true
    recursive: true
  - path: .
    read: true
    upsert: false
    delete: false
  - path: meta-agents.yaml
    read: true
    upsert: true
    delete: false
  - path: package.json
    read: true
    upsert: true
    delete: false
  - path: package-lock.json
    read: true
    upsert: true
    delete: false
  - path: bin/*
    read: true
    upsert: true
    delete: true
    recursive: true
  - path: scripts/*
    read: true
    upsert: true
    delete: true
    recursive: true
  - path: types/*
    read: true
    upsert: true
    delete: false
    recursive: true
  - path: tests/*
    read: true
    upsert: true
    delete: true
    recursive: true
  - path: extensions/*
    read: true
    upsert: true
    delete: true
    recursive: true
  - path: .claude/*
    read: true
    upsert: true
    delete: true
    recursive: true
  - path: .opencode/*
    read: true
    upsert: true
    delete: true
    recursive: true
  - path: .pi/*
    read: true
    upsert: true
    delete: true
    recursive: true
  - path: .hermes/*
    read: true
    upsert: true
    delete: true
    recursive: true
  - path: .mcp.example.json
    read: true
    upsert: true
    delete: false
  - path: .env.sample
    read: true
    upsert: true
    delete: false
---

[MAH_CONTEXT]
crew=dev | mission=Advance runtime support, validation, projection, and operator-facing architecture for Meta Agents Harness while preserving bounded scope and runtime-agnostic design. | sprint=v0.5.0-runtime-evolution,release=v0.5.0,mode=spec-bound-slice-driven,active=true | directives=spec-bound execution; no architecture-wave expansion; no v0.6.0+ scope; PR-sized slices; mandatory validation at each slice; explicit deferred list for anything outside v0.5.0 | do=Hermes adapter implementation completion; Full dispatcher integration with config; Runtime compatibility matrix validation; Validation framework expansion; Diagnostics and explainability tooling; Operator-facing CLI completion; Integration test coverage | avoid=full multi-runtime parity; remote execution foundation; policy engine; federation/interconnect; confidential execution; v0.6.0+ scope | role=update CLI and help surfaces; handle operator-facing explainability and docs changes
[/MAH_CONTEXT]

# Frontend Dev
