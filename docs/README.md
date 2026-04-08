# Meta Agents Harness Documentation

## Overview

Meta Agents Harness (MAH) is a runtime-agnostic orchestration layer for multi-agent AI systems. It provides a unified configuration model (`meta-agents.yaml`) that works across multiple coding agent runtimes.

## Quick Start

- [Getting Started](./getting-started.md) — Installation, bootstrap, and first run
- [Onboarding](./onboarding.md) — Step-by-step guide to using MAH with your project

## Core Concepts

- [Expertise Model Foundation](./expertise-model-foundation.md) — Durable knowledge capture for agents
- [Platform Capabilities](./platform-capabilities.md) — Feature overview across runtimes
- [Runtime Boundary](./runtime-boundary.md) — What MAH owns vs. what runtime handles
- [Validate Semantics](./validate-semantics.md) — Configuration validation rules

## Runtimes

### Hermes
- [Quickstart](./hermes/quickstart.md) — Get started with Hermes runtime
- [Runtime Support](./hermes/runtime-support.md) — Hermes-specific configuration
- [Session Management](./hermes/session-management.md) — Session lifecycle
- [Artifact Structure](./hermes/artifact-structure.md) — How Hermes persists artifacts

## Development

- [Bootstrap CLI UX Research](./bootstrap-cli-ux-research.md) — Design notes for the bootstrap flow

## Project Structure

```
docs/
├── README.md                    # This file
├── getting-started.md           # Installation and first run
├── onboarding.md                # Step-by-step onboarding guide
├── expertise-model-foundation.md # Durable knowledge for agents
├── platform-capabilities.md     # Feature matrix
├── runtime-boundary.md          # MAH vs. runtime responsibilities
├── validate-semantics.md        # Config validation
├── bootstrap-cli-ux-research.md # Bootstrap design notes
└── hermes/                     # Hermes-specific docs
    ├── quickstart.md
    ├── runtime-support.md
    ├── session-management.md
    └── artifact-structure.md
```

## External Resources

- [Repository](https://github.com/Hive-Hue/meta-agents-harness)
- [CHANGELOG](../CHANGELOG.md) — Release history
- [Specification](../specs/) — Formal specs and test plans
