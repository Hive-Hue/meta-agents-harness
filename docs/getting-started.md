# Getting Started with Meta Agents Harness

This guide will help you bootstrap your first `meta-agents.yaml` configuration and get started with multi-agent orchestration.

---

## Quick Start

### 1. Install and Bootstrap

```bash
# Clone the repository
git clone https://github.com/Hive-Hue/meta-agents-harness.git
cd meta-agents-harness

# Run setup (automatically creates meta-agents.yaml if missing)
npm run setup
```

If you want a global install from the repository checkout, use:

```bash
npm run install:global
```

That exposes both `mah` and `meta-agents-harness` on your PATH.
It also lets `mah run` fall back to the bundled MAH runtime assets when a new repo does not have its own local `extensions/` tree yet.

### 2. Verify Installation

```bash
# Check runtime detection
mah detect

# Validate configuration
mah validate:config

# Run diagnostics
mah doctor
```

### 3. Start Using MAH

```bash
# Select a crew
mah use dev

# Run interactive session
mah run
```

---

## Bootstrap CLI Overview

The Bootstrap CLI creates a minimally valid `meta-agents.yaml` configuration file. It supports two modes:

| Mode | Description | When to Use |
|------|-------------|-------------|
| **Logical** | Uses sensible defaults, minimal prompts | CI/CD, quick setup, first-time users |
| **AI-Assisted** | Generates enhanced config using AI | Complex projects, custom topologies |

---

## Bootstrap Commands

### Interactive Mode (Default)

When running in an interactive terminal (TTY), MAH prompts for configuration:

```bash
npm run setup
# or
mah init
```

**Prompts:**
1. Bootstrap mode: `1` (logical) or `2` (AI-assisted)
2. Project name
3. Project description
4. Primary crew ID
5. Crew mission

### Non-Interactive Mode

For CI/CD or automated environments:

```bash
# Create with all defaults
mah init --yes

# Force overwrite existing config
mah init --yes --force

# Specify project details
mah init --yes \
  --crew my-team \
  --name "My Project" \
  --description "A custom project for multi-agent orchestration"
```

### Direct Bootstrap Script

```bash
# Run bootstrap directly
npm run bootstrap:meta

# With flags
node scripts/bootstrap-meta-agents.mjs --yes --crew dev
```

---

## Command Flags Reference

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--yes` | | Non-interactive mode, use defaults | `false` |
| `--force` | | Overwrite existing `meta-agents.yaml` | `false` |
| `--crew <id>` | | Primary crew identifier | `dev` |
| `--name <name>` | | Project name | Directory name |
| `--description <desc>` | | Project description | Generated default |
| `--ai` | `--ai-assisted` | Use AI-assisted generation mode | `false` |
| `--brief <text>` | | Project brief for AI-assisted mode | (none) |
| `--help` | `-h` | Show help message | |

---

## Environment Variables

Override defaults without modifying command arguments:

```bash
# Set project name
MAH_INIT_NAME="my-project" mah init --yes

# Set description
MAH_INIT_DESCRIPTION="Custom description" mah init --yes

# Set crew ID
MAH_INIT_CREW="custom-crew" mah init --yes

# Combine multiple overrides
MAH_INIT_NAME="my-project" \
MAH_INIT_DESCRIPTION="Custom description" \
MAH_INIT_CREW="custom-crew" \
mah init --yes
```

---

## AI-Assisted Bootstrap

AI-assisted mode generates enhanced configurations based on your project context.

### Requirements

- **Runtime CLI**: `pi` or `opencode` installed and available in PATH
- **API Key**: Configured in the runtime CLI (not passed to MAH directly)
- **Skill File**: `bootstrap` skill available

### Usage

```bash
# Interactive AI-assisted mode
mah init
# Select option 2 when prompted

# Non-interactive AI-assisted mode
mah init --yes --ai --brief "E-commerce platform with microservices"

# With project details
mah init --yes --ai \
  --name "my-project" \
  --description "AI-powered code review tool" \
  --brief "Automated code review with multi-agent analysis"
```

### What AI-Assisted Mode Does

1. **Analyzes repository context** - Reads README, detects runtime markers
2. **Generates tailored configuration** - Creates topology matching project needs
3. **Infers sensible defaults** - Chooses appropriate crews, agents, and profiles
4. **Falls back gracefully** - If AI fails, uses logical mode automatically

### Fallback Behavior

If AI-assisted mode fails (no runtime, missing skill, API error), MAH automatically falls back to logical mode:

```
bootstrap: bootstrap skill not found, falling back to logical mode
bootstrap: created meta-agents.yaml
```

---

## Generated Configuration

### Required Fields

The bootstrap generates a valid `meta-agents.yaml` with:

```yaml
version: 1                          # Config schema version
name: "my-project"                  # Project name
description: "Project description"  # Project description
runtime_detection:                  # How MAH detects runtimes
  order: ["forced", "marker", "cli"]
  marker:
    pi: ".pi"
    claude: ".claude"
    opencode: ".opencode"
    hermes: ".hermes"
runtimes:                           # Runtime configurations
  pi: { ... }
  claude: { ... }
  opencode: { ... }
  hermes: { ... }
catalog:                            # Shared resources
  models: { ... }
  skills: { ... }
  domain_profiles: { ... }
crews:                              # Team definitions
  - id: "dev"
    topology: { ... }
    agents: [ ... ]
```

### Minimal Crew Structure

Each generated crew includes:

```yaml
crews:
  - id: dev
    display_name: Dev Crew
    mission: Execute bounded delivery for this repository.
    topology:
      orchestrator: orchestrator
      leads:
        planning: planning-lead
      workers:
        planning:
          - repo-analyst
    agents:
      - id: orchestrator
        role: orchestrator
        team: orchestration
        model_ref: orchestrator_default
        skills:
          - delegate_bounded
          - zero_micromanagement
          - expertise_model
        domain_profile: read_only_repo
      - id: planning-lead
        role: lead
        team: planning
        model_ref: lead_default
        skills:
          - delegate_bounded
          - zero_micromanagement
          - expertise_model
        # Stack multiple profiles to merge domain rules
        domain_profile:
          - read_only_repo
          - planning_delivery
      - id: repo-analyst
        role: worker
        team: planning
        model_ref: worker_default
        skills:
          - expertise_model
        domain_profile: read_only_repo
```

---

## Post-Bootstrap Steps

### 1. Validate Configuration

```bash
# Validate config structure
mah validate:config

# Validate all (config + runtime + sync)
mah validate:all
```

### 2. Sync Runtime Artifacts

Generate runtime-specific configuration files:

```bash
# Generate the runtime tree from meta-agents.yaml
mah generate

# npm shortcut
npm run generate:meta

# legacy direct sync script
npm run sync:meta

# Check for drift without writing
npm run check:meta-sync
```

### 3. Select a Crew

```bash
# List available crews
mah list:crews

# Activate a crew
mah use dev
```

### 4. Run Diagnostics

```bash
# Check runtime health
mah doctor

# Check runtime status
mah check:runtime
```

### 5. Start an Interactive Session

```bash
# Run with selected crew
mah run

# Run with specific runtime
mah --runtime opencode run
```

---

## Common Workflows

### CI/CD Integration

```yaml
# .github/workflows/bootstrap.yml
name: Bootstrap MAH Config
on: push

jobs:
  bootstrap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install and Bootstrap
        run: |
          npm run setup
          npm run sync:meta
          mah validate:config
```

### Docker Integration

```dockerfile
FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install

# Bootstrap in non-interactive mode
RUN npm run setup

# Validate
RUN mah validate:config

CMD ["mah", "run"]
```

### Development Setup Script

```bash
#!/bin/bash
# setup-dev.sh

set -e

echo "Installing dependencies..."
npm run setup

echo "Validating configuration..."
mah validate:config

echo "Syncing runtime artifacts..."
npm run sync:meta

echo "Selecting dev crew..."
mah use dev

echo "Running diagnostics..."
mah doctor

echo "Setup complete! Run 'mah run' to start."
```

---

## Troubleshooting

### Bootstrap Skips When Config Exists

**Problem:** Running bootstrap but file already exists.

**Solution:** Use `--force` flag to overwrite:

```bash
mah init --yes --force
```

### AI-Assisted Mode Falls Back to Logical

**Problem:** AI mode always falls back to logical mode.

**Possible causes:**
1. No `pi` or `opencode` CLI installed
2. Skill file `bootstrap/SKILL.md` missing
3. API key not configured in runtime CLI

**Solution:** Check runtime availability:

```bash
# Check if runtime is available
which pi
which opencode

# Check skill file exists
ls .opencode/skills/bootstrap/SKILL.md
```

### Invalid Configuration After Bootstrap

**Problem:** Generated config fails validation.

**Solution:** Run validation to see errors:

```bash
mah validate:config
```

### Runtime Not Detected

**Problem:** `mah detect` shows no runtime.

**Solutions:**

```bash
# Force a specific runtime
mah --runtime opencode detect

# Check for runtime markers
ls -la .pi .claude .opencode .hermes

# Install a runtime CLI
npm install -g @anthropic-ai/claude-code
```

---

## Next Steps

After bootstrap:

1. **Customize Configuration** - Edit `meta-agents.yaml` to match your project
2. **Add Custom Crews** - Define teams for your specific workflows
3. **Configure Skills** - Add or modify skills in the catalog
4. **Set Up Domain Profiles** - Define access control for agents
5. **Explore Commands** - See [README.md](../README.md) for full command reference

---

## Related Documentation

- [Onboarding Guide](./onboarding.md) - Detailed onboarding documentation
- [Validation Semantics](./validate-semantics.md) - Validation command ownership
- [Runtime Boundary](./runtime-boundary.md) - Architecture boundaries
- [Hermes Runtime Support](./hermes/runtime-support.md) - Hermes integration

---

## Examples

### Minimal Bootstrap

```bash
# Quick start with all defaults
mah init --yes
```

### Custom Project

```bash
# With custom details
mah init --yes \
  --crew engineering \
  --name "my-saas-app" \
  --description "SaaS application with multi-tenant architecture"
```

### AI-Enhanced Bootstrap

```bash
# Let AI design the topology
mah init --yes --ai \
  --brief "Microservices e-commerce platform with event-driven architecture"
```

### CI/CD Bootstrap

```bash
# Environment-driven configuration
MAH_INIT_NAME="${GITHUB_REPOSITORY#*/}" \
MAH_INIT_CREW="ci" \
mah init --yes
```

---

**Need help?** Check the [Troubleshooting](#troubleshooting) section or run `mah doctor` for diagnostics.
