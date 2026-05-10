#!/usr/bin/env python3
"""Index .mah/context/operational/ docs into Qdrant.
 Uses all-MiniLM-L6-v2 for embeddings (384d).
"""
import os, sys, json
from pathlib import Path

try:
    import httpx
    from sentence_transformers import SentenceTransformer
except ImportError:
    print("FATAL: pip install httpx sentence-transformers")
    sys.exit(1)

REPO = Path(__file__).resolve().parent.parent.parent
OPERATIONAL = REPO / ".mah" / "context" / "operational"
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
COLLECTION = os.environ.get("MAH_PVECTOR_COLLECTION", "mah-context")
BATCH = 20

def parse_frontmatter(content):
    fm, body = content.split("---", 2)[1:]
    meta = {}
    for line in fm.strip().split("\n"):
        k, _, v = line.partition(":")
        if v.strip():
            try: meta[k.strip()] = json.loads(v.strip())
            except: meta[k.strip()] = v.strip()
    return meta, body.strip()

print(f"Loading embedding model...")
model = SentenceTransformer("all-MiniLM-L6-v2")
print(f"Model loaded.")

print(f"Creating/updating collection '{COLLECTION}' with low indexing threshold...")
try:
    # Delete if exists (Qdrant requires this to change vector config)
    httpx.delete(f"{QDRANT_URL}/collections/{COLLECTION}", timeout=10)
except:
    pass
resp = httpx.put(
    f"{QDRANT_URL}/collections/{COLLECTION}",
    json={"vectors": {"size": 384, "distance": "Cosine"}, "optimizer_config": {"indexing_threshold": 1}},
    timeout=30
)
resp.raise_for_status()
print(f"Collection ready.")

points = []
for md in OPERATIONAL.rglob("*.md"):
    content = md.read_text(encoding="utf-8")
    try:
        meta, body = parse_frontmatter(content)
    except:
        meta, body = {}, content
    if len(body) < 20: continue

    vector = model.encode(body).tolist()
    doc_id = meta.get("id", md.stem)

    points.append({
        "id": abs(hash(doc_id)) % (2**63),
        "vector": vector,
        "payload": {
            "file": md.name,
            "doc_id": doc_id,
            "kind": meta.get("kind", "document"),
            "crew": meta.get("crew", "unknown"),
            "agent": meta.get("agent", "unknown"),
            "capabilities": meta.get("capabilities", []),
            "stability": meta.get("stability", "unknown"),
            "body_preview": body[:200],
        },
    })
    print(f"  Prepared: {md.name} → {doc_id}")

print(f"\nUpserting {len(points)} points to Qdrant...")
resp = httpx.put(
    f"{QDRANT_URL}/collections/{COLLECTION}/points?wait=true",
    json={"points": points},
    timeout=120
)
resp.raise_for_status()
print(f"Done. {len(points)} docs indexed into '{COLLECTION}'.\n")
print(f"Test: node scripts/meta-agents-harness.mjs context find --agent planning-lead --task 'backlog'")
