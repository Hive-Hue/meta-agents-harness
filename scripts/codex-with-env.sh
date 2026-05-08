#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${MAH_CODEX_ENV_FILE:-${MAH_ENV_FILE:-/home/alysson/Github/meta-agents-harness/.env.stitch}}"
if [[ ! -f "$ENV_FILE" && -f "/home/alysson/Github/meta-agents-harness/.env" ]]; then
  ENV_FILE="/home/alysson/Github/meta-agents-harness/.env"
fi
CODEX_BIN="${MAH_CODEX_BIN:-codex}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

exec "$CODEX_BIN" "$@"
