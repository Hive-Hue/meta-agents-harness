# Platform Capabilities Status

## Status

- `sessions`: experimental
- `graph`: experimental
- `demo`: experimental
- `provenance`: experimental

These capabilities are available and supported for evaluation, but are not yet declared as stable long-term interfaces.

## Provenance Retention Policy

When provenance logging is enabled (`MAH_AUDIT=1` or `MAH_PROVENANCE=1`), events are written to `.mah/provenance.jsonl`.

Retention controls:

- `MAH_PROVENANCE_MAX_LINES` (default `5000`)
- `MAH_PROVENANCE_MAX_DAYS` (default `30`)

Compaction keeps only valid recent entries within both limits.
