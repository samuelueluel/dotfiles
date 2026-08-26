# Index Maintenance & Recovery

**Load this file when** an index update fails, wedges, or silently misses content, when configuring watchdog runners, pausing or resuming long jobs, recovering from store corruption, converging the sparse BM25 index, or running item-scoped re-embeds.

## Metadata-only external references (default)

Do not run `zotero-sidecar.sh create`, `enrich`, `embed`, or `reembed` for `external_reference` nodes. The status means the graph resolver did not map that citation identity to a Zotero item; it is not proof that no equivalent version exists locally. Search library metadata first, but never merge versions or trigger PDF acquisition/full-text indexing automatically.

Use the dedicated maintenance routes instead:

- `zotero_zotero_rebuild_citation_graph` rebuilds the graph from Zotero metadata and existing sidecars without touching ChromaDB.
- `zotero_zotero_rebuild_reference_index` rebuilds the separate BM25 index over individual bibliography entries without embedding.
- `zotero_zotero_audit_references` reports parsed-entry coverage and resolution status. If the reference index is absent, the audit initializes it and therefore writes local index files.

After Zotero synchronization, perform graph/reference rebuilds only after Desktop has fully closed and its WAL is checkpointed. An `immutable=1` SQLite connection ignores a live WAL and can show an old snapshot. These rebuilds do not require external-paper downloads or dense re-embedding.

## What counts as a graph node

Graph nodes are **Zotero parent items** (papers, books, reports, preprints, documents) — child **attachments, notes, and annotations are excluded**. The build filters by `itemTypes.typeName` (`NOT IN ('attachment','note','annotation')`), **not by hardcoded `itemTypeID` numbers**: Zotero renumbers those across versions (Zotero 10 did), and a hardcoded filter leaks attachment “PDF” junk into the node set and can drop real document items. If hub/audit counts look wrong after a Zotero upgrade, rebuild the graph (Desktop closed) before suspecting data loss — and note that a Zotero **Desktop** upgrade alone does not re-trigger the justfile patch re-application (that only runs on uv server upgrades), so after any Desktop upgrade, close Zotero and rebuild the graph.

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

### Build batch lists from LIVE collection membership — never from static notes
Before launching `create`, enumerate the target collection's keys straight from the local DB and diff against existing sidecars. Static inventory notes drift as items are added or moved. Derive the missing list dynamically at launch time:
```python
# keys = collection_membership(COLL_KEY) − {k for k in sidecar_dir if k.md exists}
with LocalZoteroReader(db_path=db) as r:
    ic = r.get_item_collections()
    keys = sorted(k for k, cols in ic.items() if COLL_KEY in cols)
```

### ALWAYS detach `create` — never run it in a foreground/supervised shell
`zotero-sidecar.sh create` wraps `zotero-sidecar-create.py` in `setsid nohup ... &`, detaching it from the calling shell. **Never call `zotero-sidecar-create.py` directly in a foreground terminal or agent tool call** — if that shell dies or times out, the whole process group (including in-flight MinerU parses) is reaped silently, leaving a half-written log and a silent stop. If launching Python directly, always use `setsid nohup ... >/dev/null 2>&1 </dev/null &`. The pass is idempotent and skips items with existing sidecars.

### Large Batch GTT Protection (`zotero-sidecar-watch.sh`)
For long parse batches (e.g. whole subcollections), run `zotero-sidecar-watch.sh` in the background alongside `create`:
```bash
setsid nohup ~/.local/bin/zotero-sidecar-watch.sh > /dev/null 2>&1 < /dev/null &
```
- **Threshold:** `WATCHDOG_GTT_THRESHOLD_MB=105000` (105 GB, 3 samples @ 20 s).
- **Behavior:** SIGKILLs `mineru` children only if memory balloons, allowing `create.py` to log `FAIL <key>` and proceed without hanging the machine.
- **Log:** `~/.cache/zotero-mcp/logs/sidecar-watch.log`.

### Transient DB-lock Handling (`sqlite3.DatabaseError: database disk image is malformed`)
`create`'s reader (`LocalZoteroReader`) opens `zotero.sqlite` with `immutable=1`, which skips all locking. If Zotero the app happens to be mid-write (WAL checkpoint or save) at the instant of a read, the immutable reader can see a torn page and raise `sqlite3.DatabaseError: database disk image is malformed`. **The DB is not corrupt** — verify with:
```bash
sqlite3 "file:$HOME/Zotero/zotero.sqlite?immutable=1" "PRAGMA integrity_check;"
```
The error is transient. Rerun `create` (idempotent), or wrap in a retry loop:
```bash
for attempt in 1 2 3 4 5; do
  setsid nohup "$UVPY" "$HOME/.local/bin/zotero-sidecar-create.py" $MISSING \
    >> /tmp/create-pass.log 2>&1 < /dev/null &
  wait "$!"
  sleep 20
done
```

## 2. Embedder Probe & Wedge Recovery

The `:8082` embedder can occasionally deadlock on startup (0% CPU) or slow-crawl (~20+ s per embedding). Probe responsiveness with:
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
3. Rebuild the sparse BM25 index and restart the service (see §5 below).

## 5. Sparse (BM25) Index Synchronization

### When a manual content-BM25 rebuild is required
The patched realtime `update-db` path rebuilds content BM25 after successful chunk indexing, so a normal completed `zotero-sidecar.sh embed` / update run converges ChromaDB and `bm25_index.json` automatically. Rebuild manually after an interrupted or legacy batch path, after changing bibliography-classifier logic, or whenever verification shows Chroma/BM25 drift. Verify affected items (`sidecar file` + `Chroma chunks` + key in content BM25). Bibliography metadata uses the separate `zotero_zotero_rebuild_reference_index`; it never re-embeds full text.

### Complete BM25 Rebuild Script
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
        # Use is_bibliography_chunk (never is_reference_chunk, which over-drops reference manuals)
        if t and not is_bibliography_chunk(t):
            docs.append((d, t))
idx.build(docs)
idx.save()
```
Reload the service:
```bash
systemctl --user restart zotero-mcp.service
```

### Site-packages Patch Note
The production sparse build excludes bibliography sections via `is_bibliography_chunk` (checking `references`, `bibliography`, `works cited`, `literature cited`). The regex `_REFERENCE_BREADCRUMB_RE` in site-packages (`semantic_search.py`) excludes the bare singular word `reference` to prevent evicting "Reference Manual" books. Re-verify this patch after any `zotero-mcp-server` package upgrade.

## 6. Re-keying a Sidecar after Re-import

When a paper is re-imported under a new item key but has the same PDF, do not re-OCR:
1. **Verify byte-identity first:** MD5 checksum of old vs new attachment PDF must match. If they differ, run `create` fresh.
2. Copy sidecar: `cp ~/.config/zotero-mcp/mineru-sidecars/<OLD>.md ~/.config/zotero-mcp/mineru-sidecars/<NEW>.md`
3. Delete stale chunks: `cc.delete_item_chunks('<OLD>')`
4. Re-embed new item: `zotero-sidecar.sh embed <COLLECTION>`
5. Rebuild BM25 index (§5) and remove the old `<OLD>.md` sidecar.

## 7. ChromaDB Store Corruption Recovery

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
4. Rebuild the BM25 index (§5 above) and restart `zotero-mcp.service`.

## 8. Figure Schema Maintenance (`zotero-vlm-enrich.py`)

The VLM enrichment script (`~/.local/bin/zotero-vlm-enrich.py`) provides four operational modes (requires `:8084` up):
- **Default (`zotero-vlm-enrich.py`):** Enriches figures lacking schemas by placing `[Figure Schema]` blocks and local captions directly below images.
- **`--force`:** Re-runs VLM on all figures and restamps schemas (use after upgrading the VLM model).
- **`--captions-only`:** Local extraction only; stamps missing captions onto existing schemas without querying the VLM.
- **`--relocate`:** Relocates legacy schemas to sit directly beneath their respective images.

*Note:* After modifying sidecars, re-embed the affected items with `zotero-sidecar.sh reembed <COLLECTION>`.

## 9. CPU Fallback Runner

For anomalous PDFs that fail under GPU parsing:
```bash
~/.local/share/uv/tools/zotero-mcp-server/bin/python ~/.local/bin/zotero-cpu-rescue.py <ITEM_KEY>
```
Existing sidecars are preserved, and rescued files write directly to `~/.config/zotero-mcp/mineru-sidecars/<key>.md`.
