# React Capture From Stitch

Use this reference to convert Stitch screens into faithful React implementation guidance.

## Capture Checklist

For each screen, capture:

- Layout regions: header, rail, main, inspector, drawers, modals, bottom sheets.
- Component inventory: reusable components, screen-only components, repeated primitives.
- Tokens: colors, typography, radius, spacing, borders, elevation, icon style.
- Content model: labels, headings, table columns, badges, empty states, help text.
- State model: loading, preview, queued, running, completed, failed, warning, destructive confirmation.
- Interaction model: command copy, save, discard, run, stop, resume, export, delete, apply, approve, reject.
- Data binding: fields that map to API/config/runtime state.
- Accessibility: labels, focus order, keyboard behavior, status semantics, table/graph alternatives.
- Responsive behavior: desktop shell, tablet drawer, mobile bottom sheet, stacked tables, graph fallback.

## React Mapping Pattern

Map visual regions to semantic components:

```text
AppShell
  TopBar
  LeftRail
  MainPane
    ScreenHeader
    CommandPreview
    FeatureSpecificContent
  InspectorPanel
```

For MAH-style operator screens, common components include:

- `AppShell`
- `TopBar`
- `LeftRail`
- `WorkspaceStatus`
- `RuntimeBadge`
- `CommandPreview`
- `InspectorPanel`
- `ValidationPanel`
- `StatusBadge`
- `ConfirmAction`
- `DiffViewer`
- `YamlSnippet`
- `LifecycleTimeline`
- `SessionTable`
- `TopologyGraph`
- `TopologyListFallback`
- `DomainProfileEditor`
- `RoutingPreview`
- `ContextPreview`

## Implementation Rules

- Recreate components in React; do not paste Stitch generated HTML unchanged.
- Normalize Tailwind classes or CSS variables into project tokens.
- Remove generated artifacts such as stray `dark:*`, inconsistent active states, and decorative shadows that violate the system.
- Replace icon-only generated controls with labelled accessible buttons.
- Preserve visual density, spacing, and interaction hierarchy from approved variants.
- Keep exact command strings in data or props, not hard-coded fragments scattered through JSX.

## Component Spec Format

Use this format when handing off a component:

```markdown
### ComponentName

- Purpose:
- Props/data:
- Layout:
- States:
- Interactions:
- Accessibility:
- Styling tokens:
- Source Stitch screen:
- Implementation notes:
```

## Fidelity Risks

- Stitch generated HTML may include non-semantic divs and inconsistent anchors/buttons.
- Screens may include demo data; replace with product-realistic domain values before implementation.
- Screenshots validate visual direction but not runtime behavior.
- MCP-generated variants can diverge in typography or font availability; verify tokens before coding.
- A graph screen needs a list/tree fallback for keyboard and screen reader users.
