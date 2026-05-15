#!/bin/bash
set -euo pipefail

CONTAINER_NAME="${MAH_PGVECTOR_CONTAINER:-mah-pgvector}"
PG_USER="${POSTGRES_USER:-mah}"
PG_PASSWORD="${POSTGRES_PASSWORD:-mah}"
PG_DB="${POSTGRES_DB:-mah_context}"
PG_PORT="${POSTGRES_PORT:-5432}"

echo "=== Installing pgvector proxy dependencies with uv ==="
uv sync --project scripts/context/pvector-pgvector-proxy/pyproject.toml

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "=== Postgres container '${CONTAINER_NAME}' already running ==="
elif docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "=== Starting existing Postgres container '${CONTAINER_NAME}' ==="
  docker start "${CONTAINER_NAME}" >/dev/null
else
  echo "=== Starting new pgvector container '${CONTAINER_NAME}' ==="
  docker run -d \
    --name "${CONTAINER_NAME}" \
    -e POSTGRES_USER="${PG_USER}" \
    -e POSTGRES_PASSWORD="${PG_PASSWORD}" \
    -e POSTGRES_DB="${PG_DB}" \
    -p "${PG_PORT}:5432" \
    -v "$(pwd)/.mah/pgvector-data:/var/lib/postgresql/data" \
    pgvector/pgvector:pg16 >/dev/null
fi

echo "=== Initializing pgvector schema ==="
docker exec -i "${CONTAINER_NAME}" psql -U "${PG_USER}" -d "${PG_DB}" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS context_vectors (
  id text PRIMARY KEY,
  collection text NOT NULL DEFAULT 'mah-context',
  embedding vector(384) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS context_vectors_embedding_idx
  ON context_vectors
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS context_vectors_collection_idx
  ON context_vectors (collection);
SQL

echo ""
echo "=== To start pgvector pvector-proxy ==="
echo "  uv run --project scripts/context/pvector-pgvector-proxy/pyproject.toml \\"
echo "    python scripts/context/pvector-pgvector-proxy.py"
echo ""
echo "=== Then set env ==="
echo "  export MAH_VECTOR_RETRIEVAL=1"
echo "  export MAH_PVECTOR_URL=http://localhost:8080"
echo "  export MAH_PVECTOR_COLLECTION=mah-context"
echo "  export MAH_PGVECTOR_DSN=postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}"
echo "  export MAH_PGVECTOR_TABLE=context_vectors"
echo "  export MAH_PGVECTOR_COLLECTION_MODE=column"
