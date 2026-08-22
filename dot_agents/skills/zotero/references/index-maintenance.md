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

### Build batch lists from LIVE collection membership — never from a memo
Before launching `create`, enumerate the target collection's keys straight from the local DB and diff against existing sidecars. A stale inventory note WILL miss items (2026-08-21: a memo said Mathematics had 10 items; the collection had 13 — 3 never made the batch). Derive the list at launch time:
```python
# keys = collection_membership(COLL_KEY) − {k for k in sidecar_dir if k.md exists}
with LocalZoteroReader(db_path=db) as r:
    ic = r.get_item_collections()
    keys = sorted(k for k, cols in ic.items() if COLL_KEY in cols)
```

### ALWAYS detach `create` — never run it in a foreground/supervised shell
`zotero-sidecar.sh create` wraps `zotero-sidecar-create.py` in `setsid nohup ... &`, detaching it from the calling shell. **Never call `zotero-sidecar-create.py` directly in a foreground terminal, agent tool call, or any shell whose lifetime is bounded** — if that shell dies or times out, the whole process group (including an in-flight MinerU parse) is reaped with no traceback, leaving a half-written `run.log` and a silent mid-batch stop. If you must launch the python directly (e.g. with extra args), always use `setsid nohup ... >/dev/null 2>&1 </dev/null &` yourself. The pass is idempotent (skips items that already have a sidecar), so a re-launch simply resumes the remainder.

### Large Batch GTT Protection (`zotero-sidecar-watch.sh`)
For long parse batches (e.g. whole subcollections), run `zotero-sidecar-watch.sh` in the background alongside `create`:
```bash
setsid nohup ~/.local/bin/zotero-sidecar-watch.sh > /dev/null 2>&1 < /dev/null &
```
- **Threshold:** `WATCHDOG_GTT_THRESHOLD_MB=105000` (105 GB, 3 samples @ 20 s).
- **Behavior:** SIGKILLs `mineru` children only if memory balloons, allowing `create.py` to log `FAIL <key>` and proceed without hanging the machine.
- **Log:** `~/.cache/zotero-mcp/logs/sidecar-watch.log`.

### Transient DB-lock crash (`sqlite3.DatabaseError: database disk image is malformed`)
`create`'s reader (`LocalZoteroReader`) opens `zotero.sqlite` with `immutable=1`, which skips all locking. If Zotero the app happens to be mid-write (WAL checkpoint / save) at the instant of a read, the immutable reader can see a torn page and raise `sqlite3.DatabaseError: database disk image is malformed`, which kills the whole batch mid-pass (possibly hours in). **The DB is almost certainly fine** — verify with `sqlite3 "file:$HOME/Zotero/zotero.sqlite?immutable=1" "PRAGMA integrity_check;"` → `ok`. The crash is transient; just re-run `create` (idempotent — it resumes missing items), or wrap it in a retry loop with a short backoff:
```bash
for attempt in 1 2 3 4 5; do
  setsid nohup "$UVPY" "$HOME/.local/bin/zotero-sidecar-create.py" $MISSING \
    >> /tmp/create-pass.log 2>&1 < /dev/null &
  wait "$!"   # or poll; recompute $MISSING each pass and break when empty
  sleep 20
 done
```
Note the crash can happen *between* items (next item's attachment lookup), so a failure often shows the last item marked `start` but never `DONE` — that item is fine, just re-parse it.

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

### After ANY `embed`, rebuild BM25 manually — it is NOT auto-synced
`update-db` rebuilds the sparse index at run START, i.e. **before** the new items are chunked/embedded. New items land in Chroma but stay absent from `bm25_index.json` until a manual rebuild (observed twice: batch-1 "Added 33", batch-2 "Added 12" — in both cases the new keys were missing from BM25). The embed summary's "Added: N" is **not** proof of full indexing. After every embed: run the rebuild below, then verify per-item (`sidecar file` + `chroma chunks` + `key ∈ bm25_keys` — all three).

### Rebuild filter: use `is_bibliography_chunk`, NEVER `is_reference_chunk`
The production sparse build (`_build_sparse_index`) excludes chunks via `is_bibliography_chunk` (breadcrumb-only: `references`/`bibliography`/`works cited`/`literature cited`). `is_reference_chunk` additionally ORs an author-year citation-density test that over-drops content — 2026-08-21 it silently evicted 4 Stata "Reference Manual" books from BM25. Manual rebuilds must use the same filter the code uses:

```python
from zotero_mcp.semantic_search import is_bibliography_chunk
# ... then in the build loop:
if t and not is_bibliography_chunk(t):
    docs.append((d, t))
```

### site-packages patch — NOT chezmoi-tracked, lost on reinstall
2026-08-21 fix: `_REFERENCE_BREADCRUMB_RE` dropped the bare singular `reference` from its alternation (it matched "Reference Manual" titles). This patch lives in the installed package (`semantic_search.py` in the uv site-packages) — a `zotero-mcp-server` upgrade/reinstall reverts it. Backup: `semantic_search.py.bak-20260821`. Re-apply from the backup or re-diff after any reinstall.

## 5a. Re-keying a sidecar after an item's key changed (re-import)
When a paper was re-imported (new item key, same PDF), do NOT re-OCR. The sidecar is keyed by item key and byte-identical PDFs produce identical content:
1. **Verify byte-identity first** — md5 of old vs new attachment PDFs must match; if they differ, run `create` fresh instead.
2. `cp <OLD>.md <NEW>.md` in `mineru-sidecars/` (content verified identical after copy).
3. `cc.delete_item_chunks('<OLD>')` to purge stale chroma chunks.
4. `zotero-sidecar.sh embed <COLLECTION>` (new key picks up the copied sidecar; old key gone).
5. Rebuild BM25 (§5 above) and delete the old `<OLD>.md` sidecar.
Done for: Roth (JXKX6EGG→2KDXC6SF), Callaway (6WTDX4R3→F7EGNIBT), did_multiplegt_dyn (9WFK99MT→WBD7ZZ5H), + 6 Programming packages (AANKX54Q→JQY6E4YF, 48XQMXF2→TB9IM8SD, ZD9CCHKJ→64JJ323U, J9AI46VG→7GA3WKM7, K2ZWCBNJ→VL6N89MP, SZQ3HHGT→VS2AB6U2).

## 5b. Sparse (BM25) Index Convergence (rebuild)

`update-db` initializes the BM25 index at run start. If chunks were deleted and re-embedded, synchronize `bm25_index.json` directly from ChromaDB:
```python
from pathlib import Path
from zotero_mcp.chroma_client import create_chroma_client
from zotero_mcp.sparse_index import BM25Index

config_path = str(Path.home() / '.config' / 'zotero-mcp' / 'config.json')
index_path = str(Path.home() / '.config' / 'zotero-mcp' / 'bm25_index.json')

cc = create_chroma_client(config_path)
idx = BM25Index(index_path)
docs = []
for ids, doc_list, _ in cc.iter_documents():
    for d, t in zip(ids, doc_list):
        if t and not is_bibliography_chunk(t):   # same filter _build_sparse_index uses
            docs.append((d, t))
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
