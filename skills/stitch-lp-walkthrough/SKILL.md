---
name: stitch-lp-walkthrough
description: Use Google Stitch MCP to generate and refine the MAH landing page design system, tokens, and screens, then hand off manually through Figma and Zeplin for the walkthrough-lp-e2e flow.
compatibility: [generic]
---

# Stitch LP Walkthrough

Use this skill when the task is about the `walkthrough-lp-e2e-v0.9.0` design phase or any landing-page design work that should flow through Google Stitch.

## Scope

- Design-system generation for the MAH landing page
- Screen generation and iteration in Stitch
- Token extraction and normalization for implementation
- Manual handoff path through Figma and Zeplin

## Preconditions

1. Confirm Stitch MCP is available and configured as HTTP.
2. Confirm `STITCH_ACCESS_TOKEN` and `GOOGLE_CLOUD_PROJECT` are present in the active shell.
3. For the walkthrough, prefer the `MAH Product Landing` project unless the user specifies another project.

## Workflow

1. Start with discovery
- Call `stitch.list_projects`.
- If the project is not obvious, call `stitch.get_project` on the closest match.

2. Build the design system
- Use `stitch.create_design_system` when the task needs a reusable system rather than a single screen.
- Keep the prompt grounded in the MAH LP brief:
  - dark, high-contrast, technical aesthetic
  - cyan/neon accent direction
  - landing-page sections: hero, features, architecture, CTA, footer

3. Generate or edit screens
- Use `stitch.generate_screen_from_text` for first-pass composition.
- Use `stitch.edit_screens` for iterative refinements.
- Use `stitch.generate_variants` only when state or layout variants matter.

4. Extract reusable outputs
- Prefer design tokens over ad hoc colors.
- Normalize flat hex tokens into semantic Tailwind-friendly names:
  - `primary`, `secondary`, `accent`, `surface`, `surface-muted`, `text`, `text-muted`, `border`
- Keep the mapping explicit when you hand off to implementation.

5. Handoff
- Treat Zeplin as a downstream validation and handoff surface, not a Stitch target.
- Move assets manually through the current chain:
  - Stitch export
  - Figma import or reconstruction
  - Zeplin import or export from Figma
- Use the Zeplin MCP only after the content is already in Zeplin.
- Export tokens before components when both are needed.

## Reliability Rules

- Do not invent project IDs, screen IDs, or tokens.
- If Stitch returns multiple plausible projects, state the match you used and why.
- If the requested project is missing, stop and report the gap instead of guessing.
- Separate observed Stitch output from implementation inferences.

## Output Contract

1. Project selected
2. Stitch tools used
3. Design tokens and semantic mapping
4. Screens/components generated
5. Handoff or implementation next steps
