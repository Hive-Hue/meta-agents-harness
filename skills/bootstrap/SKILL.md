---
name: bootstrap
description: Bootstrap a multi-team crew from a minimal specification. Infers teams, members, tools, domain rules, and generates topology YAML, agent prompts, and expertise files. Works across PI, Claude, OpenCode, and Hermes runtimes.
compatibility: [generic]
---

# Bootstrap

Use this skill when the user provides goals and desired scopes and wants a ready-to-run multi-team setup with topology YAML, agent prompts, and initial expertise files.

## When to Use

Use this skill when:
- A new crew needs to be created from scratch
- An existing crew needs to be reconfigured or extended
- A new team member needs their agent prompt and expertise file generated

Do NOT use this skill when:
- An existing crew is already running and just needs to continue
- The task is about execution, not crew bootstrapping

## Table of Contents

1. Minimal Input Spec
2. Profile to Teams Mapping
3. Output Contract
4. Tool Inference by Runtime
5. Domain Rules
6. Quality Gates
7. Build Procedure
8. Runtime Adapters
9. File Paths by Runtime
10. Quality Bar

---

## 1. Minimal Input Spec

The bootstrapper accepts a YAML manifest with this structure:

```yaml
crew: string
system_name: string
profile: coding | productivity | teaching | marketing | ads | custom
repo_root: string
enable_mcp: boolean
goals:
  - goal_id: string
    description: string
    priority: high | medium | low
workstreams:
  - name: string
    objective: string
    outputs: [string]
    read: [path_globs]
    write: [path_globs]
constraints:
  - name: string
    description: string
```

If required pieces are missing, infer conservative defaults and state assumptions explicitly.

### Optional: sprint_mode (PI, Hermes, OpenCode)

For PI-family runtimes, optionally include:

```yaml
sprint_mode:
  name: string
  active: boolean
  target_release: string
  objective: string
  execution_mode: spec-bound-slice-driven | milestone-based | continuous | pr-sized-slices
  directives:
    - string
  must_deliver:
    - string
  must_not_deliver:
    - string
```

### sprint_mode Key Principles

1. **Objective is one sentence** — not a paragraph, not a backlog. The sprint exists to deliver this one thing.
2. **do/avoid lists are explicit** — vague missions produce vague outputs. If it is not in must_deliver, it is implicitly deferred.
3. **Directives constrain execution, not scope** — directives tell how to build, not what to build.
4. **Deferred items are first-class** — anything not in must_deliver goes to an explicit deferred list.

### Instruction Block Pattern

Build the instruction_block by piping mission + sprint_mode fields together:

```
crew=<crew_id> | mission=<one_line_mission> | sprint=<sprint_name>,release=<target_release>,mode=<execution_mode>,active=<true|false> | directives=<semicolon_separated> | do=<semicolon_separated_do_list> | avoid=<semicolon_separated_avoid_list>
```

This instruction block is placed in the frontmatter of every agent prompt.

---

## 2. Profile to Teams Mapping

Every crew has 3 layers: orchestrator, leads, workers.

### Team Topology Layers

```
Layer 1: Orchestrator  (mission-level coordination, never touches files directly)
Layer 2: Leads         (team coordination, validation, deferred list maintenance)
Layer 3: Workers       (execution, constrained to owned paths)
```

### Default Team Mapping by Profile

| Profile | Planning | Execution/Engineering | Validation |
|---------|----------|----------------------|------------|
| coding | Planning | Engineering | Validation |
| productivity | Planning | Execution | Validation |
| teaching | Planning | Execution | Validation |
| marketing | Planning | Execution | Validation |
| ads | Planning | Execution | Validation |
| custom | Planning | (as specified) | Validation |

### Worker Defaults by Profile

**coding**
- Planning: repo-analyst, solution-architect
- Engineering: frontend-dev, backend-dev
- Validation: qa-reviewer, security-reviewer

**productivity**
- Planning: process-analyst, solution-architect
- Execution: automation-specialist, operations-specialist
- Validation: qa-reviewer, risk-reviewer

**teaching**
- Planning: curriculum-analyst, learning-architect
- Execution: lesson-designer, content-producer
- Validation: assessment-reviewer, quality-reviewer

**marketing / ads**
- Planning: market-researcher, campaign-strategist
- Execution: copywriter, creative-strategist, media-operator
- Validation: performance-analyst, brand-safety-reviewer

**custom**
- Infer names from goals using capability-lead plus 1-3 workers per stream

### Crew Topology Roles

- **Orchestrator**: Owns the mission, delegates to leads, never touches files directly
- **Leads**: Coordinate workers, validate outputs, maintain deferred list, do NOT get edit/bash by default
- **Workers**: Execute slices, write only to stream-owned paths, ping leads for scope decisions

---

## 3. Output Contract

Always generate these artifacts:

### 3.1 multi-team.yaml

Topology with version, crew, teams, ownership. Example:

```yaml
version: "1"
crew: <crew_id>
teams:
  - name: Planning
    leads: [planning-lead]
    workers: [repo-analyst, solution-architect]
    ownership:
      read: [repo_root]
      upsert: [specs/, plans/]
      delete: []
  - name: Engineering
    leads: [engineering-lead]
    workers: [frontend-dev, backend-dev]
    ownership:
      read: [repo_root]
      upsert: [<stream-owned-paths>]
      delete: [<stream-owned-paths>]
  - name: Validation
    leads: [validation-lead]
    workers: [qa-reviewer, security-reviewer]
    ownership:
      read: [repo_root]
      upsert: []
      delete: []
```

### 3.2 Agent Prompts

One .md file per agent under `<runtime>/crew/<crew>/agents/`. Each includes:
- **Frontmatter**: name, role, team, sprint_mode, tools, skills, domain
- **Body**: responsibilities, boundaries, quality gates, output expectations

#### Example Frontmatter

```yaml
---
name: engineering-lead
role: lead
team: Engineering
sprint_mode:
  name: v0.6.0-headless-and-sessions
  active: true
  target_release: v0.6.0
  objective: Deliver bounded v0.6.0 runtime evolution
  execution_mode: spec-bound-slice-driven
  directives:
    - spec-bound execution
    - no architecture-wave expansion
    - PR-sized slices
    - mandatory validation at each slice
  do:
    - Headless support matrix across runtimes
    - Explicit headless capability and adapter contract
  avoid:
    - full transcript replay portability
    - full multi-runtime parity
tools: [delegate_agent, delegate_agents_parallel, read, grep, find, ls, update_expertise_model]
domain:
  - path: .
    read: true
    upsert: false
    delete: false
---
```

### 3.3 Expertise Files

One YAML file per agent:

```yaml
agent:
  name: "<agent-name>"
  role: "<lead|worker>"
  team: "<team-name>"
meta:
  version: "1"
  max_lines: "120"
  last_updated: "<ISO-8601>"
patterns: []
risks: []
tools: []
workflows: []
decisions: []
lessons: []
observations: []
open_questions: []
```

---

## 4. Tool Inference by Runtime

### Generic Tools (All Runtimes)

| Tool | Purpose |
|------|---------|
| read | Read file contents |
| grep | Search file contents |
| find | Search for files by glob |
| ls | List directory contents |
| write | Write entire file |
| edit | Edit specific lines |
| bash | Execute shell commands |
| delegate_agent | Delegate to single child |
| delegate_agents_parallel | Delegate to multiple children |
| update_expertise_model | Append to expertise file |

### MCP Tools (when enable_mcp: true)

| Tool | Purpose |
|------|---------|
| mcp_servers | List configured MCP servers |
| mcp_tools | List tools exposed by an MCP server |
| mcp_call | Call a specific MCP tool |

### Tool Assignment by Role

**Orchestrator**: delegate_agent, update_expertise_model

**Lead**: delegate_agent, update_expertise_model, read, grep, find, ls

**Worker (research/review)**: read, grep, find, ls, update_expertise_model

**Worker (document/spec/content)**: add write, edit

**Worker (code/script)**: add bash

### Runtime Tool Conventions

**PI, Hermes, OpenCode**: Use generic tool names. update_expertise_model is a native tool.

**Claude**: update_expertise_model is MCP-backed. Agents call it with their own agent id, NOT by editing expertise YAML manually.

**Avoid in Claude output**: task, update-expertise-model, glob, list (OpenCode-only names).

### MCP Inference

If enable_mcp: true:
- Add MCP tools to all leads
- Add MCP tools to planning/research workers and any worker requiring external systems
- Infer MCP server usage from goals (e.g., clickup, github, context7, brave-search, firecrawl, zeplin)

---

## 5. Domain Rules

Ownership paths define what each agent can read/write/delete. Paths are relative to repo_root.

### Path Flags

```yaml
read:   # Files/dirs this agent can read
upsert: # Files/dirs this agent can create or modify
delete: # Files/dirs this agent can delete
```

### Default Ownership by Role

| Role | read | upsert | delete |
|------|------|--------|--------|
| Orchestrator | [.] | [] | [] |
| Lead | [.] | [] | [] |
| Worker (stream) | [stream-paths] | [stream-paths] | [stream-paths] |
| Validation | [.] | [] | [] |

### Guidelines

- **Leads are read-only by default** — coordination, not execution
- **Workers write only to stream-owned paths** — no side effects outside owned scope
- **Validation workers stay read-only** unless corrective edits are explicitly part of ownership
- **Delete only when explicitly part of ownership** — use sparingly

### Example Domain Rules (Coding Profile)

```yaml
# Orchestrator (read-only, delegates only)
orchestrator:
  read: [.]
  upsert: []
  delete: []

# Engineering lead (read-only by default)
engineering-lead:
  read: [.]
  upsert: []
  delete: []

# Frontend-dev (owns frontend streams)
frontend-dev:
  read: [., plugins/frontend/**, extensions/frontend/**]
  upsert: [plugins/frontend/**, extensions/frontend/**, assets/**]
  delete: [plugins/frontend/**, extensions/frontend/**]

# Backend-dev (owns backend streams)
backend-dev:
  read: [., plugins/backend/**, extensions/backend/**, scripts/**]
  upsert: [plugins/backend/**, extensions/backend/**, scripts/**, bin/**]
  delete: [plugins/backend/**, extensions/backend/**, scripts/**]

# QA-reviewer (read-only)
qa-reviewer:
  read: [.]
  upsert: []
  delete: []
```

---

## 6. Quality Gates

For PI-family runtimes with sprint_mode, every slice must pass these four gates:

### Gate 1: Spec Adherence Check

- Verify the change matches the spec/sprint_mode objective
- Document which spec item is satisfied
- **Fail**: If change does not match objective or drifts from bounded scope

### Gate 2: No Scope Escape Check

- Verify no must_not_deliver items are included
- Verify no expanded scope crept in
- **Fail**: If any exclusion item is touched or expanded scope detected

### Gate 3: Validation Runs Clean

- Run all relevant tests (unit, integration, contract)
- Verify no regressions
- **Fail**: If any test fails or validation cannot complete

### Gate 4: Explicit Deferred List Updated

- If any needed work was deferred, it must appear in the deferred list
- Deferred list is maintained by the lead
- **Fail**: If work was quietly dropped instead of explicitly deferred

### Deferred List Format

```yaml
# <runtime>/teams/<crew>/deferred.yaml
deferred:
  - item: string
    reason: string
    target_sprint: string
    blocked_by: [string]
```

### Gate Enforcement

- **Workers** run Gate 1 and Gate 3 self-checks before reporting completion
- **Leads** verify all 4 gates before accepting a slice as done
- **Orchestrator** trusts lead sign-off but may re-verify Gate 2 on risky slices

---

## 7. Build Procedure

Follow these 9 steps to bootstrap a multi-team crew:

### Step 1: Parse Minimal Input Spec

- Read the YAML manifest
- Extract crew, system_name, profile, repo_root, goals, workstreams, constraints
- Extract sprint_mode block if present (name, active, target_release, objective, execution_mode, directives, must_deliver, must_not_deliver)
- **Validate**: All required fields present, sprint_mode is complete if provided
- **If missing**: Infer conservative defaults and state assumptions explicitly

### Step 2: Build Team Matrix

- Map profile to default team layout (Planning / Engineering / Execution / Validation)
- Determine worker roster from profile defaults (see Section 2)
- Assign each worker to a workstream
- **Validate**: Each workstream has a lead, workers are assigned

### Step 3: Infer Tool Availability

- Based on runtime (PI, Claude, OpenCode, Hermes), confirm available tools
- If enable_mcp: true, add MCP tools to appropriate roles
- Infer MCP server usage from goals
- **Validate**: No tool dependencies unresolvable by runtime

### Step 4: Define Domain Rules

- For each agent, build ownership paths based on role and stream assignment
- Leads: read-only by default
- Workers: read/write on stream-owned paths
- **Validate**: No agent has edit/bash outside owned scope

### Step 5: Generate multi-team.yaml

- Compile topology YAML with version, teams, ownership
- Include orchestrator layer if present
- **Validate**: Schema valid, all agents have entries, paths are repo-relative

### Step 6: Generate Agent Prompts

- For each lead and worker, create agent prompt with runtime-specific frontmatter
- Include sprint_mode in frontmatter (if present)
- Include do/avoid lists from sprint_mode
- Include quality gate checklist
- **Validate**: Every prompt has required frontmatter fields

### Step 7: Generate Expertise Files

- For each agent, create expertise YAML
- Initialize with agent name, role, team, meta (version, max_lines, last_updated)
- Leave observations, decisions, risks, open_questions empty
- **Validate**: YAML valid, all required fields present

### Step 8: Validate

- Run quality gate checks (self-validation)
- Check: mission is specific and bounded
- Check: sprint_mode complete with do/avoid lists (if provided)
- Check: no worker has edit/bash outside owned scope
- Check: leads do not get direct edit/bash by default
- Check: prompts include required context
- Check: every prompt path, expertise path, and skill path exists
- **Validate**: All checks pass, or return errors for correction

### Step 9: Return Artifacts

- Report list of files created/modified
- Report assumptions made during bootstrap
- Report any gaps or open questions
- Forward artifact references verbatim if delegation produced them

---

## 8. Runtime Adapters

Each runtime has its own directory conventions, frontmatter format, and tool mapping. The bootstrapper must adapt output to the target runtime.

### Runtime: PI

```yaml
output_root: .pi
topology_path: .pi/teams/<crew>/multi-team.yaml
agent_prompts: .pi/crew/<crew>/agents/<name>.md
expertise_path: .pi/crew/<crew>/agents/<name>/expertise.yaml
deferred_path: .pi/teams/<crew>/deferred.yaml
skills_path: .pi/skills/<skill-name>/SKILL.md
```

**Frontmatter**: YAML between `---` markers with fields: name, role, team, sprint_mode, tools, skills, domain.

**Tools**: All generic tools. update_expertise_model is a direct tool invocation.

**Default skills**: None required.

### Runtime: Hermes

```yaml
output_root: .hermes
topology_path: .hermes/teams/<crew>/multi-team.yaml
agent_prompts: .hermes/crew/<crew>/agents/<name>.md
expertise_path: .hermes/crew/<crew>/agents/<name>/expertise.yaml
deferred_path: .hermes/teams/<crew>/deferred.yaml
skills_path: .hermes/skills/<skill-name>/SKILL.md
```

**Frontmatter**: YAML between `---` markers. Standard MAH format applies.

**Tools**: All generic tools. Standard tool names apply.

### Runtime: OpenCode

```yaml
output_root: .opencode
topology_path: .opencode/teams/<crew>/multi-team.yaml
agent_prompts: .opencode/crew/<crew>/agents/<name>.md
expertise_path: .opencode/crew/<crew>/agents/<name>/expertise.yaml
deferred_path: .opencode/teams/<crew>/deferred.yaml
skills_path: .opencode/skills/<skill-name>/SKILL.md
```

**Frontmatter**: YAML between `---` markers. OpenCode may map find to glob internally.

**Tools**: All generic tools available.

### Runtime: Claude

```yaml
output_root: .claude
topology_path: .claude/crew/<crew>/multi-team.yaml
agent_prompts: .claude/crew/<crew>/agents/<name>.md
expertise_path: .claude/crew/<crew>/expertise/<name>-expertise-model.yaml
deferred_path: .claude/crew/<crew>/deferred.yaml
skills_path: .claude/skills/<skill-name>/SKILL.md
```

**Frontmatter**: YAML between `---` markers with fields: name, model, role, team, expertise (path, use-when, updatable, max-lines), tools, skills (path, use-when), domain (path, read, upsert, delete).

**Tools**: All generic tools + mcp_servers, mcp_tools, mcp_call (if enable_mcp). update_expertise_model is MCP-backed.

**Default skills**:
- .claude/skills/delegate-bounded/SKILL.md
- .claude/skills/expertise-model/SKILL.md
- .claude/skills/zero-micromanagement/SKILL.md

**Note**: Mission text must reflect domain language (coding, marketing, teaching, etc.), not coding-only assumptions. Avoid OpenCode-only names.

---

## 9. File Paths by Runtime

| Artifact | PI | Hermes | OpenCode | Claude |
|----------|-----|--------|----------|--------|
| Crew root | .pi/crew/<crew>/ | .hermes/crew/<crew>/ | .opencode/crew/<crew>/ | .claude/crew/<crew>/ |
| Teams root | .pi/teams/<crew>/ | .hermes/teams/<crew>/ | .opencode/teams/<crew>/ | N/A |
| Topology | .pi/teams/<crew>/multi-team.yaml | .hermes/teams/<crew>/multi-team.yaml | .opencode/teams/<crew>/multi-team.yaml | .claude/crew/<crew>/multi-team.yaml |
| Agent prompts | .pi/crew/<crew>/agents/<name>.md | .hermes/crew/<crew>/agents/<name>.md | .opencode/crew/<crew>/agents/<name>.md | .claude/crew/<crew>/agents/<name>.md |
| Expertise | .pi/crew/<crew>/agents/<name>/expertise.yaml | .hermes/crew/<crew>/agents/<name>/expertise.yaml | .opencode/crew/<crew>/agents/<name>/expertise.yaml | .claude/crew/<crew>/expertise/<name>-expertise-model.yaml |
| Deferred | .pi/teams/<crew>/deferred.yaml | .hermes/teams/<crew>/deferred.yaml | .opencode/teams/<crew>/deferred.yaml | .claude/crew/<crew>/deferred.yaml |
| Skills | .pi/skills/<name>/SKILL.md | .hermes/skills/<name>/SKILL.md | .opencode/skills/<name>/SKILL.md | .claude/skills/<name>/SKILL.md |

### File Tree Example (PI Runtime)

```
.pi/
  teams/
    dev/
      multi-team.yaml
      deferred.yaml
  crew/
    dev/
      agents/
        orchestrator.md
        planning-lead.md
        repo-analyst.md
        solution-architect.md
        engineering-lead.md
        frontend-dev.md
        backend-dev.md
        validation-lead.md
        qa-reviewer.md
        security-reviewer.md
  skills/
    bootstrap/
      SKILL.md
    mission-bootstrap/
      SKILL.md
```

---

## 10. Quality Bar

Output is **acceptable only if** all of the following are true:

1. **Mission is specific and bounded** — one sentence objective, explicit deliverables
2. **All required output files generated** — with correct paths for the target runtime
3. **No worker has edit/bash outside owned scope** — stream ownership enforced
4. **Leads do not get direct edit/bash by default** — coordination, not execution
5. **Prompts include runtime-specific frontmatter** — all required fields present
6. **Quality gates defined and actionable** — each slice must pass all 4 gates (PI-family with sprint_mode)
7. **Deferred list is first-class** — anything not delivered goes there, not to the void
8. **Profile matched correctly** — prompts reflect profile domain language

### Additional Acceptance Criteria

- The output can be selected with `mah use <crew>` and launched with `mah run --crew <crew>` (or runtime-equivalent)
- Prompts clearly match selected profile and goals
- Non-coding profiles work without code-specific assumptions
- Every prompt path, expertise path, and skill path exists

### Failure Protocol

If any criterion is unmet:
1. Return errors with specific details
2. Do **not** proceed to delegation
3. Do **not** silently skip missing fields
4. State what was expected vs. what was found
