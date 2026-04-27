# Stitch MCP Schemas

Use this reference when Stitch MCP mutation tools reject arguments.

## `generate_variants`

Use source screen IDs without the `projects/.../screens/` prefix.

```json
{
  "projectId": "12849774871511595309",
  "selectedScreenIds": ["c4e46dd60bf0404bab0c46713ed2e09b"],
  "deviceType": "DESKTOP",
  "modelId": "GEMINI_3_1_PRO",
  "prompt": "Refine the screen...",
  "variantOptions": {
    "variantCount": 1,
    "creativeRange": "REFINE",
    "aspects": ["LAYOUT", "TEXT_CONTENT"]
  }
}
```

Notes:

- `variantOptions` is an object. Do not pass a string.
- Use `creativeRange: "REFINE"` for low-variance cleanup.
- Use `aspects: ["LAYOUT", "TEXT_CONTENT"]` for UI/UX and copy refinement.
- Prefer individual calls per screen for reliable traceability.
- `GEMINI_3_PRO` may be obsolete; prefer `GEMINI_3_1_PRO`.

## `update_design_system`

Use an object with `displayName` and `theme`. Do not pass raw markdown as `designSystem`.

```json
{
  "projectId": "12849774871511595309",
  "name": "assets/08f04d35f3344c2589123f86ce04bfc9",
  "designSystem": {
    "displayName": "MAH WebUI Design System",
    "theme": {
      "colorMode": "LIGHT",
      "colorVariant": "FIDELITY",
      "customColor": "#212121",
      "headlineFont": "GEIST",
      "bodyFont": "GEIST",
      "labelFont": "GEIST",
      "roundness": "ROUND_FOUR",
      "overridePrimaryColor": "#212121",
      "overrideSecondaryColor": "#00BCD4",
      "overrideTertiaryColor": "#222120",
      "overrideNeutralColor": "#5f5e5e",
      "designMd": "Normative system rules..."
    }
  }
}
```

Read back with `list_design_systems` and check the returned `version`.

## `apply_design_system`

Use asset id without `assets/`. Use screen instance IDs, not source screen IDs.

```json
{
  "projectId": "12849774871511595309",
  "assetId": "08f04d35f3344c2589123f86ce04bfc9",
  "selectedScreenInstances": ["8363a78b70d145129154ef6ab2cfd22e"]
}
```

If rejected, call `get_project` and inspect `screenInstances[].id` and `screenInstances[].sourceScreen`.

## ID Guide

- Project ID: numeric string from `projects/{id}`.
- Asset ID: id from `assets/{id}`; omit `assets/` only where the tool explicitly asks for asset id.
- Source screen ID: id from `projects/{project}/screens/{screen}`; use for `selectedScreenIds`.
- Screen instance ID: `screenInstances[].id` from `get_project`; use for `selectedScreenInstances`.

## Debugging Invalid Arguments

1. Check whether a field expected by docs is an object but local tool metadata says string.
2. Remove optional fields and retry the minimal valid payload.
3. Confirm ID type: source screen vs screen instance.
4. Use official docs over generated tool descriptions when they conflict.
5. Read back project/design system state before assuming failure or success.
