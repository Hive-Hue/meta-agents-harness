#!/usr/bin/env python3
"""Index .mah/context/operational docs into PostgreSQL + pgvector.

Uses all-MiniLM-L6-v2 embeddings (384d), aligned with MAH vector adapter defaults.
"""
from __future__ import annotations

import json
import os
import sys
import re
from pathlib import Path

try:
    import psycopg
    from sentence_transformers import SentenceTransformer
except ImportError:
    print("FATAL: pip install psycopg[binary] sentence-transformers")
    sys.exit(1)

REPO = Path(__file__).resolve().parent.parent.parent
OPERATIONAL = REPO / ".mah" / "context" / "operational"

DSN = os.environ.get("MAH_PGVECTOR_DSN", "postgresql://mah:mah@localhost:5432/mah_context")
TABLE = os.environ.get("MAH_PGVECTOR_TABLE", "context_vectors")
COLLECTION = os.environ.get("MAH_PVECTOR_COLLECTION", "mah-context")
REBUILD = os.environ.get("MAH_PGVECTOR_REBUILD", "1") == "1"

if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", TABLE):
    print(f"FATAL: invalid MAH_PGVECTOR_TABLE '{TABLE}' (use letters/numbers/underscore only)")
    sys.exit(1)


def parse_frontmatter(content: str):
    fm, body = content.split("---", 2)[1:]
    meta = {}
    for line in fm.strip().split("\n"):
        k, _, v = line.partition(":")
        if v.strip():
            try:
                meta[k.strip()] = json.loads(v.strip())
            except Exception:
                meta[k.strip()] = v.strip()
    return meta, body.strip()


def to_pgvector_literal(vector):
    return "[" + ",".join(f"{float(v):.10g}" for v in vector) + "]"


def ensure_schema(conn):
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {TABLE} (
              id text PRIMARY KEY,
              collection text NOT NULL DEFAULT 'mah-context',
              embedding vector(384) NOT NULL,
              payload jsonb NOT NULL DEFAULT '{{}}'::jsonb
            )
            """
        )
        cur.execute(
            f"""
            CREATE INDEX IF NOT EXISTS {TABLE}_embedding_idx
              ON {TABLE}
              USING ivfflat (embedding vector_cosine_ops)
              WITH (lists = 100)
            """
        )
        cur.execute(
            f"""
            CREATE INDEX IF NOT EXISTS {TABLE}_collection_idx
              ON {TABLE} (collection)
            """
        )


def main():
    print("Loading embedding model...")
    model = SentenceTransformer("all-MiniLM-L6-v2")
    print("Model loaded.")

    with psycopg.connect(DSN, autocommit=True) as conn:
        ensure_schema(conn)

        if REBUILD:
            print(f"Deleting existing rows for collection '{COLLECTION}'...")
            with conn.cursor() as cur:
                cur.execute(f"DELETE FROM {TABLE} WHERE collection = %s", (COLLECTION,))

        upserted = 0
        for md in OPERATIONAL.rglob("*.md"):
            content = md.read_text(encoding="utf-8")
            try:
                meta, body = parse_frontmatter(content)
            except Exception:
                meta, body = {}, content
            if len(body) < 20:
                continue

            vector = model.encode(body).tolist()
            vector_literal = to_pgvector_literal(vector)
            doc_id = meta.get("id", md.stem)
            payload = {
                "file": md.name,
                "doc_id": doc_id,
                "kind": meta.get("kind", "document"),
                "crew": meta.get("crew", "unknown"),
                "agent": meta.get("agent", "unknown"),
                "capabilities": meta.get("capabilities", []),
                "stability": meta.get("stability", "unknown"),
                "body_preview": body[:200],
            }

            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    INSERT INTO {TABLE} (id, collection, embedding, payload)
                    VALUES (%s, %s, %s::vector, %s::jsonb)
                    ON CONFLICT (id)
                    DO UPDATE SET
                      collection = EXCLUDED.collection,
                      embedding = EXCLUDED.embedding,
                      payload = EXCLUDED.payload
                    """,
                    (doc_id, COLLECTION, vector_literal, json.dumps(payload)),
                )

            upserted += 1
            print(f"  Upserted: {md.name} -> {doc_id}")

    print(f"\nDone. {upserted} docs indexed into {TABLE} (collection={COLLECTION}).")
    print("Test: node scripts/meta-agents-harness.mjs context find --agent planning-lead --task 'backlog'")


if __name__ == "__main__":
    main()
