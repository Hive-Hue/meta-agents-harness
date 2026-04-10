#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <figma_url> [objetivo] [output_file]" >&2
  exit 1
fi

FIGMA_URL="$1"
OBJECTIVE="${2:-Extrair contexto util para implementacao}"
OUTPUT_FILE="${3:-$(mktemp "${TMPDIR:-/tmp}/figma-codex-XXXXXX.md")}"
WORKDIR="${WORKDIR:-$PWD}"

if ! command -v codex >/dev/null 2>&1; then
  echo "Erro: codex nao encontrado no PATH." >&2
  exit 1
fi

if ! codex mcp list | grep -Eq '^figma[[:space:]]'; then
  echo "Erro: MCP 'figma' nao aparece em 'codex mcp list'." >&2
  echo "Sugestao: rode 'codex mcp login figma' no ambiente do Codex CLI." >&2
  exit 1
fi

read -r -d '' PROMPT <<EOF || true
Use as tools MCP do Figma disponiveis neste ambiente Codex para inspecionar esta URL:

${FIGMA_URL}

Objetivo:
${OBJECTIVE}

Instrucoes:
- Use as tools do Figma MCP, nao apenas suposicoes.
- Extraia o maximo util do node referenciado na URL.
- Se fizer sentido, use metadata, design context, variable defs e screenshot.
- No final, entregue um resumo estruturado em Markdown com estas secoes:
  1. Identificacao do arquivo e node
  2. Layout e hierarquia visual
  3. Componentes e estados
  4. Copy e textos relevantes
  5. Cores, tipografia e tokens
  6. Observacoes para implementacao em codigo
- Seja conciso, mas concreto.
EOF

codex exec \
  --skip-git-repo-check \
  -C "$WORKDIR" \
  -o "$OUTPUT_FILE" \
  "$PROMPT"

echo "$OUTPUT_FILE"
