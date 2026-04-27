---
name: stitch-react-handoff
description: Use Stitch MCP to inspect design systems and screens, update or create design systems, generate/refine variants with the correct schemas, and capture faithful component/layout guidance for React implementation. Use when working with Google Stitch projects, MCP design tools, UI refinement, design-to-code handoff, or extracting screen/component details for React.
---

# Stitch React Handoff

## Purpose

Operate Stitch as a design-source system, not just a screenshot generator. Use MCP reads to ground decisions, MCP writes to refine screens/design systems, and exported HTML/screens to capture implementation-ready React structure.

## Workflow

1. Discover project context.
- Call `mcp__stitch__.list_projects`.
- Select the project by title and task fit; do not invent IDs.
- Call `list_design_systems` and `list_screens` for the selected project.
- Use `get_screen` for each target screen before editing or coding.

2. Validate current design.
- Compare screens against the user's product goals, design system, IA labels, layout model, accessibility expectations, and implementation constraints.
- Separate observed Stitch output from recommendations.
- Treat generated HTML as reference material, not production markup.

3. Update design system when global rules changed.
- Use structured object payloads, not markdown strings. See [mcp-schemas.md](references/mcp-schemas.md).
- Keep `displayName` stable unless the user asks for a renamed system.
- Put normative design guidance in `theme.designMd`.
- Verify with `list_design_systems`.

4. Generate variants for screen-level refinement.
- Use `generate_variants` with `variantOptions` as an object, not a string.
- Prefer one screen per call when traceability matters; Stitch may only return one generated screen from multi-select requests.
- Use low-variance prompts when preserving product direction.
- Verify generated screen IDs with `list_screens`.

5. Capture React handoff.
- Download exported HTML when available, or inspect via `get_screen` metadata and screenshots.
- Extract component inventory, layout regions, tokens, semantic states, copy, interactions, responsive behavior, and accessibility requirements.
- Rebuild in React with semantic components and the repo's design system; do not copy generated HTML wholesale.
- See [react-capture.md](references/react-capture.md).

## Tool Rules

- Prefer MCP reads over memory when checking Stitch state.
- Browse official Stitch docs when schemas fail or tool metadata conflicts with runtime behavior.
- If tool schema says `variantOptions: string` but the official Stitch reference says object, use the official object schema.
- Use `GEMINI_3_1_PRO` for high-fidelity refinement unless speed matters more than quality.
- Record generated screen IDs in the final response.
- Do not claim an update landed until the MCP write call returns success and a readback confirms it where possible.

## Prompt Pattern For Refinement

Use concrete, enforceable prompts:

```text
Refine [screen title] for [product/UI goal].
Preserve [layout/system constraints].
Apply global rules: [mode, nav labels, shadows, color usage, status semantics].
Screen-specific changes: [workflow/component/state fixes].
Do not reinvent the visual direction.
```

Avoid vague prompts such as "make it better" or "modernize this".

## React Handoff Output

When asked to prepare implementation guidance, return:

- Stitch project and screen IDs used.
- Design system version or observed tokens.
- Component tree mapped to React components.
- Layout and responsive behavior.
- State model and required interactions.
- Accessibility requirements.
- Assets/icons/fonts to source.
- Risks where Stitch output is ambiguous or generated-code-specific.

## Common Failure Modes

- Passing `designSystem` as a plain string to `update_design_system`; use an object.
- Passing `variantOptions` as a string; use an object.
- Using source screen IDs where a tool expects screen instance IDs, or vice versa.
- Copying generated Tailwind/HTML directly into React without semantic cleanup.
- Letting dark-mode classes leak into a light-only baseline.
- Treating color-only dots as sufficient status indicators.
