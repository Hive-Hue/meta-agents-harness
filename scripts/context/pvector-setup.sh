#!/bin/bash
set -e

echo "=== Installing pvector proxy with uv ==="
uv sync --project scripts/context/pvector-proxy/pyproject.toml

echo "=== Creating Qdrant collection 'mah-context' (384d cosine) ==="
curl -s -X PUT "http://localhost:6333/collections/mah-context" \
  -H "Content-Type: application/json" \
  -d '{"vectors": {"size": 384, "distance": "Cosine"}}' || true

echo ""
echo "=== To start pvector proxy ==="
echo "  uv run --project scripts/context/pvector-proxy/pyproject.toml python scripts/context/pvector-proxy.py"
echo "  # Or activate env and run directly:"
echo "  source scripts/context/pvector-proxy/.venv/bin/activate"
echo "  python scripts/context/pvector-proxy.py"
echo ""
echo "  Then set env:"
echo "    export MAH_PVECTOR_URL=http://localhost:8080"
echo "    export MAH_PVECTOR_COLLECTION=mah-context"
