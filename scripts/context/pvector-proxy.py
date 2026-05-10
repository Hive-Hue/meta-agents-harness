#!/usr/bin/env python3
"""pvector REST → Qdrant proxy.
 Bridges MAH's pvector contract to Qdrant's vector search.
 
 /health  → {"status": "ok"}
 /query   → POST {query: str, top_n: int, vector: list[float]|null} → {results: [...]}
 
 Query embedding: caller (MAH) sends pre-computed vector OR raw query string
 (if sentence-transformers available, embeds automatically; otherwise requires vector field)
"""
from __future__ import print_function
import os
import sys

print("pvector-proxy loading...", file=sys.stderr, flush=True)

try:
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel
    import httpx
    print("  fastapi/httpx imported OK", file=sys.stderr, flush=True)
except ImportError as e:
    print("FATAL: missing dependencies: pip install fastapi httpx", file=sys.stderr)
    print(f"  ImportError: {e}", file=sys.stderr)
    sys.exit(1)

# Optional sentence-transformers for auto-embedding
_model = None
try:
    from sentence_transformers import SentenceTransformer
    print("  sentence-transformers available — auto-embed enabled", file=sys.stderr, flush=True)
    _model = SentenceTransformer('all-MiniLM-L6-v2')
except ImportError:
    print("  sentence-transformers not installed — pass vector directly", file=sys.stderr, flush=True)

app = FastAPI(title="pvector-proxy → Qdrant")

COLLECTION = os.environ.get("MAH_PVECTOR_COLLECTION", "mah-context")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
PORT = int(os.environ.get("PORT", 8080))

print(f"  Collection: {COLLECTION}", file=sys.stderr, flush=True)
print(f"  Qdrant URL: {QDRANT_URL}", file=sys.stderr, flush=True)
print(f"  Port: {PORT}", file=sys.stderr, flush=True)

@app.get("/health")
def health():
    return {"status": "ok"}

class QueryRequest(BaseModel):
    query: str | None = None
    vector: list[float] | None = None
    top_n: int = 5
    collection: str | None = None

@app.post("/query")
async def query(req: QueryRequest):
    collection = req.collection or COLLECTION

    # Build vector: use provided vector, or embed query string, or error
    if req.vector is not None:
        vector = req.vector
    elif req.query is not None:
        if _model is None:
            raise HTTPException(503, "sentence-transformers not installed — pass vector directly in request body")
        vector = _model.encode(req.query).tolist()
    else:
        raise HTTPException(400, "must provide query string or vector")

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{QDRANT_URL}/collections/{collection}/points/search",
            json={"vector": vector, "limit": req.top_n, "with_payload": True}
        )
        resp.raise_for_status()
        data = resp.json()

    return {
        "results": [
            {"id": str(p.get("id", "")), "score": p.get("score", 0.0), "metadata": p.get("payload", {})}
            for p in data.get("result", [])
        ]
    }

if __name__ == "__main__":
    import uvicorn
    print(f"Starting uvicorn on 0.0.0.0:{PORT}...", file=sys.stderr, flush=True)
    uvicorn.run(app, host="0.0.0.0", port=PORT)
