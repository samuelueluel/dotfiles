# Index Maintenance & Recovery

**Load this file when** an index update fails, wedges, or silently misses content, when configuring watchdog runners, pausing or resuming long jobs, recovering from store corruption, converging the sparse BM25 index, or running item-scoped re-embeds.

## 1. Sidecar Pipeline Execution & Watching

Run the 3-stage pipeline via `zotero-sidecar.sh`:
```bash
# Ingestion Stages
zotero-sidecar.sh create  <COLLECTION_KEY | KEY...>   # Stage 1: MinerU parse -> Markdown sidecar (GPU)
zotero-sidecar.sh enrich  <COLLECTION_KEY | KEY...>   # Stage 2: Inject [Figure Schema] blocks (needs :8084)
zotero-sidecar.sh embed   <COLLECTION_KEY...>         # Stage 3: Chunk + embed + index into ChromaDB & BM25

# Maintenance
zotero-sidecar.sh reembed <COLLECTION_KEY...>         # Delete Chroma chunks first, then re-index
```

### Large Batch GTT Protection (`zotero-sidecar-watch.sh`)
For long parse batches (e.g. whole subcollections), run `zotero-sidecar-watch.sh` in the background alongside `create`:
```bash
setsid nohup ~/.local/bin/zotero-sidecar-watch.sh > /dev/null 2>&1 < /dev/null &
```
- **Threshold:** `WATCHDOG_GTT_THRESHOLD_MB=105000` (105 GB, 3 samples @ 20 s).
- **Behavior:** SIGKILLs `mineru` children only if memory balloons, allowing `create.py` to log `FAIL <key>` and proceed without hanging the machine.
- **Log:** `~/.cache/zotero-mcp/logs/sidecar-watch.log`.

## 2. Embedder Probe & Wedge Recovery

The `:8082` embedder can occasionally deadlock on startup (0% CPU). Probe responsiveness with:
```bash
time curl -s http://127.0.0.1:8082/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"input":"probe","model":"embed"}' >/dev/null
```
- **Recovery:** If unresponsive, restart the container: `podman restart embedder`.

## 3. Pausing and Resuming Batches

### Step 1: Terminate In-Flight Processes
```bash
pkill -f "zotero-backfill-watchdog"
pkill -f "zotero-sidecar-watch"
pkill -f "update-db"
pkill -f "mineru"
```

### Step 2: Clean In-Flight Chunks
ChromaDB commits in batches. If an item was interrupted mid-flush, delete its partial chunks:
```python
from pathlib import Path
from zotero_mcp.chroma_client import create_chroma_client
cc = create_chroma_client(str(Path.home()/'.config'/'zotero-mcp'/'config.json'))
cc.delete_item_chunks('<IN_FLIGHT_KEY>')
```

### Step 3: Relaunch
Relaunch the pipeline or watchdog for the remaining items.

## 4. Item-Scoped Re-embed (No Full Rebuild)

To re-index a single modified item without running a full library update:
1. Delete the item's chunks in ChromaDB:
   ```python
   from pathlib import Path
   from zotero_mcp.chroma_client import create_chroma_client
   cc = create_chroma_client(str(Path.home()/'.config'/'zotero-mcp'/'config.json'))
   cc.delete_item_chunks('<ITEM_KEY>')
   ```
2. Run incremental update:
   ```bash
   zotero-mcp-server update-db --fulltext
   ```
3. Converge the sparse index and restart the service (see below).

## 5. Sparse (BM25) Index Convergence

`update-db` initializes the BM25 index at run start. If chunks were deleted and re-embedded, synchronize `bm25_index.json` directly from ChromaDB:
```python
from pathlib import Path
from zotero_mcp.chroma_client import create_chroma_client
from zotero_mcp.sparse_index import BM25Index

config_path = str(Path.home() / '.config' / 'zotero-mcp' / 'config.json')
index_path = str(Path.home() / '.config' / 'zotero-mcp' / 'bm25_index.json')

cc = create_chroma_client(config_path)
idx = BM25Index(index_path)
docs = [(d, t) for ids, docs, _ in cc.iter_documents() for d, t in zip(ids, docs) if t]
idx.build(docs)
idx.save()
```
Reload the service cache:
```bash
systemctl --user restart zotero-mcp.service
```

## 6. Store Corruption Recovery

If ChromaDB encounters unrecoverable corruption or segfaults:
1. Stop running watchdogs and services:
   ```bash
   systemctl --user stop zotero-mcp.service
   ```
2. Archive the damaged directory:
   ```bash
   mv ~/.config/zotero-mcp/chroma_db ~/.config/zotero-mcp/chroma_db.damaged-$(date +%Y%m%d)
   ```
3. Rebuild from sidecars:
   ```bash
   zotero-mcp-server update-db --force-rebuild --allow-mass-deletion
   ```
4. Rebuild the BM25 index (Step 5 above) and restart `zotero-mcp.service`.

## 7. Figure Schema Maintenance (`zotero-vlm-enrich.py`)

The VLM enrichment script (`~/.local/bin/zotero-vlm-enrich.py`) provides four operational modes (requires `:8084` up):
- **Default (`zotero-vlm-enrich.py`):** Enriches figures lacking schemas by placing `[Figure Schema]` blocks and local captions directly below images.
- **`--force`:** Re-runs VLM on all figures and restamps schemas (use after upgrading the VLM model).
- **`--captions-only`:** Local extraction only; stamps missing captions onto existing schemas without querying the VLM.
- **`--relocate`:** Relocates legacy schemas to sit directly beneath their respective images.

*Note:* After modifying sidecars, re-embed the affected items with `zotero-sidecar.sh reembed <COLLECTION>`.

## 8. CPU Fallback Runner

For anomalous PDFs that fail under GPU parsing:
```bash
~/.local/share/uv/tools/zotero-mcp-server/bin/python ~/.local/bin/zotero-cpu-rescue.py <ITEM_KEY>
```
Existing sidecars are preserved, and rescued files write directly to `~/.config/zotero-mcp/mineru-sidecars/<key>.md`.
