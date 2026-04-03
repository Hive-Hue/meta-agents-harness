---
name: zeplin-mcp-ops
description: Optimize Zeplin MCP usage for fast, traceable design extraction (screens, components, tokens, assets) with minimal redundant calls.
---

# Zeplin MCP Ops

Use this skill when a task depends on design data from Zeplin.

## Scope

- Read-only workflow over Zeplin MCP
- Supported tools: `zeplin.get_screen`, `zeplin.get_component`, `zeplin.get_design_tokens`, `zeplin.download_layer_asset`
- Non-goal: creating or editing designs in Zeplin (not supported by current MCP)

## Preflight

1. Confirm Zeplin MCP is connected in the current session.
2. Route by input type:
- screen URL -> `zeplin.get_screen`
- component URL -> `zeplin.get_component`
- project/styleguide id -> `zeplin.get_design_tokens`

## Call Plan (Token-Aware)

1. First pass
- Call `zeplin.get_screen` with `includeVariants=false`.
- If user asks for one element, try `targetLayerName` first.

2. Expand only when necessary
- Retry without `targetLayerName` only if focused call returns insufficient data.
- Use `includeVariants=true` only when state/variant differences are required.

3. Design tokens
- Call `zeplin.get_design_tokens` once per project/styleguide.
- Reuse this result across the whole task instead of re-querying.

4. Assets
- Call `zeplin.download_layer_asset` only for assets missing in codebase.
- Prefer `svg` for icons/logos; use `png` for raster assets.

5. Components
- Use `zeplin.get_component` for reusable component details or when screen payload is noisy.

## Extraction Rules

- Return concrete fields whenever available: layer `name`, `sourceId`, `content`, `x`, `y`, `width`, `height`.
- Keep hierarchy focused on layers relevant to the user goal.
- Separate facts (from tool output) from inference.
- If target layer is not found, show closest layer names and retry once with best match.

## Output Contract

1. What was queried (URL/id + tool sequence)
2. Structured findings
3. Relevant design tokens
4. Errors/gaps + next best action

## Reliability Checklist

- Never invent layer names, dimensions, or tokens.
- If a call fails, include the raw MCP error in the response.
- Avoid repeated full-screen pulls when a targeted call is enough.
- Explicitly state when data may be incomplete because variants were skipped.
