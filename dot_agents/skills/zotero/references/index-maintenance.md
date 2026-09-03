# Index Maintenance & Pipeline Recovery

**Load this file when** running the sidecar ingestion pipeline, managing memory watchdogs, recovering from ChromaDB/BM25 desync, or repairing corrupted indexes.

## Dedicated Graph & Reference Maintenance

Do not run the sidecar pipeline on `external_reference` nodes. Use dedicated maintenance tools:

- `zotero_rebuild_citation_graph`: Rebuilds graph nodes and citation edges from SQLite metadata and existing sidecars without touching ChromaDB.
- `zotero_rebuild_reference_index`: Rebuilds the separate per-entry BM25 reference index.
- `zotero_get_reference_index_status`: Reports parsing coverage and initializes the reference index if absent.

**Desktop Closed / WAL Requirement:** Perform graph/reference rebuilds only when Zotero Desktop is fully closed and WAL checkpointing has finished (`immutable=1` ignores active WAL files).

**Graph Node Filtering:** Nodes are parent items filtered by `itemTypes.typeName NOT IN ('attachment','note','annotation')` (not hardcoded IDs, ensuring resilience across Zotero schema versions).

**Metadata-only filter rule:** Do not run `reembed` solely for tag, native `itemType`, `source_group`, or collection changes. Semantic filters use existing parent `item_key` identity plus live local metadata; re-embed only when source text, parsed content, or chunking changes.

## 1. Sidecar Pipeline Execution & Watching

Run the 3-stage pipeline via `zotero-sidecar.sh`:

```bash
# Ingestion Stages
zotero-sidecar.sh create  <COLLECTION_KEY | KEY...>   # Stage 1: MinerU GPU parse -> Markdown sidecar
zotero-sidecar.sh enrich  <COLLECTION_KEY | KEY...>   # Stage 2: Inject [Figure Schema] blocks (requires :8084)
zotero-sidecar.sh embed   <COLLECTION_KEY...>         # Stage 3: Chunk + embed into ChromaDB & BM25

# Maintenance
zotero-sidecar.sh reembed <COLLECTION_KEY...>         # Delete Chroma chunks first, then re-index
```

### Formula handling

Zotero's MinerU sidecar creator uses `-m txt` for native-text PDFs. This skips ordinary prose OCR but still runs enabled formula detection and UniMERNet formula recognition, so detected equations are emitted as LaTeX in the Markdown sidecar. Scanned PDFs use the OCR path; both paths intend the same equation representation. Do not infer missing formula recognition from `-m txt` alone.

### Dynamic Batch Enumeration
Always derive missing items dynamically from live SQLite membership rather than static notes:
```python
# keys = collection_membership(COLL_KEY) − {k for k in sidecar_dir if k.md exists}
with LocalZoteroReader(db_path=db) as r:
    ic = r.get_item_collections()
    keys = sorted(k for k, cols in ic.items() if COLL_KEY in cols)
```

### Detached Execution Rule
Always run `create` detached (`setsid nohup ... &`) to prevent incomplete parses if the calling shell terminates.

### GTT Memory Protection (`zotero-sidecar-watch.sh`)
For large batch runs, launch the memory watchdog in the background:
```bash
setsid nohup ~/.local/bin/zotero-sidecar-watch.sh > /dev/null 2>&1 < /dev/null &
```
- **Threshold:** `WATCHDOG_GTT_THRESHOLD_MB=105000` (105 GB, 3 samples @ 20 s).
- **Action:** Terminates runaway `mineru` processes if memory balloons, allowing `create.py` to log failure and proceed safely.
- **Log Path:** `~/.cache/zotero-mcp/logs/sidecar-watch.log`.

### Handling Transient DB Locks
If an immutable read encounters a mid-checkpoint write, SQLite may report `database disk image is malformed`. This is transient. Verify integrity:
```bash
sqlite3 "file:$HOME/Zotero/zotero.sqlite?immutable=1" "PRAGMA integrity_check;"
```
Rerun the idempotent `create` command or wrap in a retry loop.

## 2. Embedder Responsiveness & Wedge Recovery

Probe `:8082` responsiveness:
```bash
time curl -s http://127.0.0.1:8082/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"input":"probe","model":"embed"}' >/dev/null
```
If deadlocked (0% CPU or slow crawl), restart the container: `podman restart embedder`.

## 3. Pausing & Resuming Batch Jobs

1. **Terminate In-Flight Processes:**
   ```bash
   pkill -f "zotero-backfill-watchdog"
   pkill -f "zotero-sidecar-watch"
   pkill -f "update-db"
   pkill -f "mineru"
   ```
2. **Clean Interrupted Chunks:**
   ```python
   from pathlib import Path
   from zotero_mcp.chroma_client import create_chroma_client
   cc = create_chroma_client(str(Path.home() / '.config' / 'zotero-mcp' / 'config.json'))
   cc.delete_item_chunks('<IN_FLIGHT_KEY>')
   ```
3. **Relaunch:** Re-run pipeline for remaining items.

## 4. Item-Scoped Re-embed (No Full Rebuild)

To update a single item without re-embedding the whole library:
1. Delete item chunks:
   ```python
   from pathlib import Path
   from zotero_mcp.chroma_client import create_chroma_client
   cc = create_chroma_client(str(Path.home() / '.config' / 'zotero-mcp' / 'config.json'))
   cc.delete_item_chunks('<ITEM_KEY>')
   ```
2. Run incremental update:
   ```bash
   zotero-mcp-server update-db --fulltext
   ```
3. Rebuild sparse BM25 index (below) and reload service.

## 5. Sparse (BM25) Index Synchronization

Completed `zotero-sidecar.sh embed` runs converge BM25 automatically. Rebuild manually after interrupted batches, classifier adjustments, or suspected drift:

```python
from pathlib import Path
from zotero_mcp.chroma_client import create_chroma_client
from zotero_mcp.sparse_index import BM25Index
from zotero_mcp.semantic_search import is_bibliography_chunk

config_path = str(Path.home() / '.config' / 'zotero-mcp' / 'config.json')
index_path = str(Path.home() / '.config' / 'zotero-mcp' / 'bm25_index.json')

cc = create_chroma_client(config_path)
idx = BM25Index(index_path)
docs = []
for ids, doc_list, _ in cc.iter_documents():
    for d, t in zip(ids, doc_list):
        if t and not is_bibliography_chunk(t):
            docs.append((d, t))
idx.build(docs)
idx.save()
```
Restart service:
```bash
systemctl --user restart zotero-mcp.service
```

## 6. Re-keying Sidecars after Item Re-import

When an item is re-imported under a new key with an identical PDF:
1. Verify PDF MD5 matches between old and new items.
2. Copy sidecar: `cp ~/.config/zotero-mcp/mineru-sidecars/<OLD>.md ~/.config/zotero-mcp/mineru-sidecars/<NEW>.md`
3. Delete old chunks: `cc.delete_item_chunks('<OLD>')`
4. Embed new item: `zotero-sidecar.sh embed <COLLECTION>`
5. Rebuild BM25 index (§5) and remove the old sidecar file.

## 7. ChromaDB Corruption Recovery

If ChromaDB encounters unrecoverable corruption:
1. Stop service: `systemctl --user stop zotero-mcp.service`
2. Archive damaged database: `mv ~/.config/zotero-mcp/chroma_db ~/.config/zotero-mcp/chroma_db.damaged-$(date +%Y%m%d)`
3. Rebuild from sidecars: `zotero-mcp-server update-db --force-rebuild --allow-mass-deletion`
4. Rebuild BM25 index (§5) and restart `zotero-mcp.service`.

## 8. Figure Schema Maintenance (`zotero-vlm-enrich.py`)

Operational modes (requires `:8084` up):
- **Default (`zotero-vlm-enrich.py`):** Adds `[Figure Schema]` blocks and captions below unenriched images.
- **`--force`:** Re-runs VLM on all figures (use after upgrading the vision model).
- **`--captions-only`:** Local extraction only; stamps captions without querying VLM.
- **`--relocate`:** Moves legacy schemas directly beneath corresponding images.
*Note:* Re-embed affected items via `zotero-sidecar.sh reembed <COLLECTION>`.

## 9. CPU Fallback Runner

For anomalous PDFs failing on GPU:
```bash
~/.local/share/uv/tools/zotero-mcp-server/bin/python ~/.local/bin/zotero-cpu-rescue.py <ITEM_KEY>
```
Rescued files write directly to `~/.config/zotero-mcp/mineru-sidecars/<key>.md`.
