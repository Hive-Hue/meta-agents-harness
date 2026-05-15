#!/usr/bin/env python3
"""pvector REST -> pgvector proxy.

Bridges MAH's pvector contract to PostgreSQL + pgvector.

Endpoints:
  GET /health
  POST /query
    body: { query?: str, vector?: number[], top_n?: int, top_k?: int, collection?: str, filters?: {...} }
"""
from __future__ import annotations

import os
import sys
from typing import Any

print("pvector-pgvector-proxy loading...", file=sys.stderr, flush=True)

try:
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel
    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row
    print("  fastapi/psycopg imported OK", file=sys.stderr, flush=True)
except ImportError as exc:
    print("FATAL: missing dependencies: pip install fastapi psycopg[binary] uvicorn pydantic", file=sys.stderr)
    print(f"  ImportError: {exc}", file=sys.stderr)
    sys.exit(1)

_model = None
try:
    from sentence_transformers import SentenceTransformer
    print("  sentence-transformers available — auto-embed enabled", file=sys.stderr, flush=True)
    _model = SentenceTransformer("all-MiniLM-L6-v2")
except ImportError:
    print("  sentence-transformers not installed — pass vector directly", file=sys.stderr, flush=True)

DSN = os.environ.get("MAH_PGVECTOR_DSN", "postgresql://mah:mah@localhost:5432/mah_context")
TABLE = os.environ.get("MAH_PGVECTOR_TABLE", "context_vectors")
COLLECTION = os.environ.get("MAH_PVECTOR_COLLECTION", "mah-context")
COLLECTION_MODE = os.environ.get("MAH_PGVECTOR_COLLECTION_MODE", "none").lower()
PORT = int(os.environ.get("PORT", 8080))

print(f"  DSN: {DSN}", file=sys.stderr, flush=True)
print(f"  Table: {TABLE}", file=sys.stderr, flush=True)
print(f"  Collection default: {COLLECTION}", file=sys.stderr, flush=True)
print(f"  Collection mode: {COLLECTION_MODE}", file=sys.stderr, flush=True)
print(f"  Port: {PORT}", file=sys.stderr, flush=True)

app = FastAPI(title="pvector-proxy -> pgvector")


class QueryRequest(BaseModel):
    query: str | None = None
    vector: list[float] | None = None
    top_n: int = 5
    top_k: int | None = None
    collection: str | None = None
    filters: dict[str, Any] | None = None


def _vector_to_pg_literal(vector: list[float]) -> str:
    values = ",".join(f"{float(v):.10g}" for v in vector)
    return f"[{values}]"


def _coerce_limit(req: QueryRequest) -> int:
    raw = req.top_n if req.top_n is not None else req.top_k
    if req.top_k is not None and req.top_n == 5:
        raw = req.top_k
    try:
        parsed = int(raw)
    except Exception:
        parsed = 5
    return max(1, min(parsed, 100))


def _resolve_vector(req: QueryRequest) -> list[float]:
    if req.vector is not None:
        return req.vector
    if req.query is None:
        raise HTTPException(400, "must provide query string or vector")
    if _model is None:
        raise HTTPException(503, "sentence-transformers not installed — pass vector directly in request body")
    return _model.encode(req.query).tolist()


def _build_filters(req: QueryRequest):
    filters = req.filters or {}
    collection = req.collection or COLLECTION

    clauses = []
    params: list[Any] = []

    if COLLECTION_MODE == "column":
        clauses.append(sql.SQL("collection = %s"))
        params.append(collection)
    elif COLLECTION_MODE == "payload":
        clauses.append(sql.SQL("payload->>'collection' = %s"))
        params.append(collection)

    agent = filters.get("agent")
    crew = filters.get("crew")
    if agent:
        clauses.append(sql.SQL("payload->>'agent' = %s"))
        params.append(str(agent))
    if crew:
        clauses.append(sql.SQL("payload->>'crew' = %s"))
        params.append(str(crew))

    if not clauses:
        return sql.SQL(""), params
    return sql.SQL("WHERE ") + sql.SQL(" AND ").join(clauses), params


@app.get("/health")
def health():
    try:
        with psycopg.connect(DSN, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
    except Exception as exc:
        raise HTTPException(503, f"database unavailable: {exc}") from exc
    return {"status": "ok", "backend": "pgvector", "table": TABLE}


@app.post("/query")
def query(req: QueryRequest):
    vector = _resolve_vector(req)
    vector_param = _vector_to_pg_literal(vector)
    limit = _coerce_limit(req)
    where_sql, where_params = _build_filters(req)

    query_sql = sql.SQL(
        """
        SELECT
          id::text AS id,
          1 - (embedding <=> %s::vector) AS score,
          payload
        FROM {table}
        {where_clause}
        ORDER BY embedding <=> %s::vector
        LIMIT %s
        """
    ).format(
        table=sql.Identifier(TABLE),
        where_clause=where_sql,
    )

    params: list[Any] = [vector_param, *where_params, vector_param, limit]

    try:
        with psycopg.connect(DSN, autocommit=True, row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(query_sql, params)
                rows = cur.fetchall()
    except Exception as exc:
        raise HTTPException(500, f"pgvector query failed: {exc}") from exc

    return {
        "results": [
            {
                "id": str(row.get("id", "")),
                "score": float(row.get("score", 0.0)),
                "metadata": row.get("payload") or {},
            }
            for row in rows
        ]
    }


if __name__ == "__main__":
    import uvicorn

    print(f"Starting uvicorn on 0.0.0.0:{PORT}...", file=sys.stderr, flush=True)
    uvicorn.run(app, host="0.0.0.0", port=PORT)
