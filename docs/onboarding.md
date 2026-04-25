# Onboarding Guide

This guide covers the bootstrap and initial setup process for Meta Agents Harness.

## Overview

MAH provides two ways to create your initial `meta-agents.yaml` configuration:

1. **Automatic bootstrap** (recommended) - Runs during `npm run setup`
2. **Manual bootstrap** - Use `mah init` for full control

## Automatic Bootstrap

The first time you run `npm run setup`, MAH automatically creates `meta-agents.yaml` if it doesn't exist

### Interactive Mode

When running in an interactive terminal (TTY), MAH prompts for:

```
Bootstrap mode [1=logical, 2=ai-assisted] (default 1): 1
Project name (default: meta-agents-harness): My Project
Project description (default: ...): My project description
Primary crew id (default: dev): my-team
Primary crew mission (default: ...): My crew mission
```

**Mode Options:**
- `1` - **Logical mode**: Uses sensible defaults, minimal prompts
- `2` - **AI-assisted mode**: Provides a project brief, generates enhanced mission statement

### Non-Interactive Mode

In CI/CD environments or MAH automatically uses logical defaults

```bash
npm run setup  # Auto-detects TTY, uses defaults if unavailable
```

## Manual Bootstrap

Use `mah init` for full control over the bootstrap process

### Basic Usage

```bash
# Non-interactive with defaults
mah init --yes

# Force overwrite existing config
mah init --yes --force

# Specify crew
mah init --yes --crew my-team

# Full specification
mah init --yes \
  --crew my-team \
  --name "My Project" \
  --description "A custom project for multi-agent orchestration"
```

### Interactive Mode

```bash
# Prompts for input
mah init

# With crew hint
mah init --crew my-team
```

### Environment Variables

Override defaults without modifying command arguments

```bash
MAH_INIT_NAME="my-project" mah init --yes
MAH_INIT_DESCRIPTION="Custom description" mah init --yes
MAH_INIT_CREW="custom-crew" mah init --yes
```

## Generated Configuration

The bootstrap creates a minimally valid `meta-agents.yaml` with

### Required Fields

- `version: 1`
- `name` - Project name
- `description` - Project description
- `runtime_detection` - Internal default; omit from YAML unless overriding
- `runtimes` - Runtime-specific settings
- `catalog` - Model catalog and fallbacks
- `agents[].skills` - Skill refs enabled for each agent, resolved by convention from `skills/<skill-slug>/SKILL.md`
- `crews` - At least one crew definition

### Minimal Crew Structure

Each generated crew includes

- **Orchestrator** - Coordinates team leads
- **Lead** - Team lead (e.g., planning-lead)
- **Workers** - Team workers (e.g., repo-analyst)

Example generated crew

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
        model_ref: orchestrator_default
        skills:
          - delegate_bounded
          - zero_micromanagement
          - expertise_model
      - id: planning-lead
        role: lead
        team: planning
        model_ref: lead_default
        skills:
          - delegate_bounded
          - zero_micromanagement
          - expertise_model
      - id: repo-analyst
        role: worker
        team: planning
        model_ref: worker_default
        skills:
          - expertise_model
```

## Post-Bootstrap Steps

After running the bootstrap

### 1. Sync Configuration

Generate runtime-specific artifacts

```bash
npm run sync:meta
```

### 2. Select a Crew

Activate a crew for your runtime

```bash
mah use dev
```

### 3. Validate Configuration

Ensure everything is properly configured

```bash
mah validate:config
```

### 4. Run Diagnostics

Check runtime health

```bash
mah doctor
```

## Customizing Bootstrap

### Adding Custom Crew

Edit `meta-agents.yaml` to add new crew under the `crews` section

```yaml
crews:
  - id: my-custom-crew
    display_name: My Custom Crew
    mission: Custom mission for this crew
    topology:
      orchestrator: orchestrator
      leads:
        engineering: engineering-lead
      workers:
        engineering:
          - backend-dev
          - frontend-dev
    agents:
      - id: orchestrator
        role: orchestrator
        # ... existing orchestrator config
      - id: engineering-lead
        role: lead
        team: engineering
        # ... existing lead config
      - id: backend-dev
        role: worker
        team: engineering
        # ... worker configs
```

### Adding Custom Agents

Add agents to existing crews

```yaml
crews:
  - id: dev
    agents:
      # ... existing agents
      - id: custom-worker
        role: worker
        team: custom-team
        model_ref: worker_default
        skills:
          - expertise_model
        domain_profile: read_only_cwd
```

To stack multiple domain profiles (merge their rules):

```yaml
      - id: custom-worker
        role: worker
        team: custom-team
        model_ref: worker_default
        skills:
          - expertise_model
        domain_profile:
          - read_only_cwd
          - shared_output

## AI-Assisted Mode

When selecting mode `2` during interactive bootstrap, MAH prompts for a provider preset and credentials.

```
Select AI provider (↑/↓, Enter):
> Z.ai  glm-5.1
  OpenRouter  z-ai/glm-5.1
  Codex (OAuth)  gpt-5.4
  MiniMax  MiniMax-M2.5
OpenRouter API key (paste and press Enter, leave empty for env/runtime fallback): sk-or-...
AI model (default: z-ai/glm-5.1):
Project brief (describe your project goals and context): My project is a multi-agent orchestration platform for automating development workflows and handling complex multi-step tasks across distributed agent teams.
```

MAH uses this brief to generate

- Enhanced project description
- Contextual mission statement aligned with project goals

### Example

```bash
mah init
# Select option 2
# Pick provider and paste API key/token
Bootstrap mode [1=logical, 2=ai-assisted] (default 1): 2
Select AI provider (↑/↓, Enter):
Project brief: My project is a multi-agent orchestration platform...
```

Result

```yaml
name: my-project
description: My project is a multi-agent orchestration platform...
crews:
  - id: dev
    mission: Deliver project outcomes aligned to: My project is a multi-agent orchestration platform...
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Bootstrap MAH Config
on: push
  branches: [main]
jobs:
  bootstrap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Bootstrap
        run: |
          npm run setup
          npm run sync:meta
          mah validate:config
          mah validate:sync
```

### Docker Example

```dockerfile
FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install

# Bootstrap in non-interactive mode
RUN npm run setup

# Validate
RUN npm run validate:config
```

## Troubleshooting

### Bootstrap Skips When Config Exists

If `meta-agents.yaml` already exists, bootstrap is skipped

```bash
bootstrap: skipped (meta-agents.yaml already exists)
```

**Solution:** Use `--force` to overwrite

```bash
mah init --yes --force
```

### Invalid Configuration

If bootstrap fails, run validation to see errors

```bash
mah validate:config
```

### Missing Runtime Artifacts

If sync fails, regenerate runtime artifacts

```bash
npm run sync:meta
```

## Best Practices

1. **Always validate after bootstrap**

   ```bash
   mah validate:config
   ```

2. **Use environment variables in CI**

   ```bash
   MAH_INIT_NAME="${{ github.event.repository.name }}" mah init --yes
   ```

3. **Commit `meta-agents.yaml`** - Its configuration is the source of truth

4. **Never commit .mcp.json** - Contains secrets

5. **Run sync after changes**

   ```bash
   npm run sync:meta
   ```

## Next Steps

After bootstrap:

- Select a crew with `mah use <crew>`
- Run the demo with `mah demo <crew>`
- Configure Codex MCP usage in [`plugins/mah/README.md`](../plugins/mah/README.md)
- Explore the command surface in [`README.md`](../README.md) and [`docs/README.md`](./README.md)
