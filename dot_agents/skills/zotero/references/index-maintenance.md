# Index Maintenance & Failure Modes

**Load this file when** an index update fails, wedges, or silently misses content, when configuring watchdog runners, pausing or resuming long jobs, recovering from store corruption, tuning the reranker, or adjusting retrieval hygiene filters.

## Index updates and MinerU

- `zotero_zotero_update_search_database()` — incremental; low cost when metadata is unchanged.
- MinerU auto-parse: during update, every item being (re)embedded with a PDF and no cached sidecar is parsed by MinerU (magic-pdf on ROCm GPU) before embedding — equations become LaTeX, tables HTML, scans OCR'd.
  - Sidecars cache at `~/.config/zotero-mcp/mineru-sidecars/<item_key>.md`.
  - Per-item parse logs cache at `~/.cache/zotero-mcp/mineru-work/<item_key>/run.log`.
- Previously-failed items (where text extraction failed) are auto-retried by MinerU on subsequent update runs.
- Execution speed: text-layer papers typically take ~1–2 min; scanned books take ~25–30 min.
- Backfill toggle: `semantic_search.mineru.backfill` in `~/.config/zotero-mcp/config.json` gates re-parsing of already-indexed items. Keep set to `false` for incremental operations; set to `true` only for full re-parsing.
- Verification: magic-pdf can exit 0 even on extraction failure; hooks verify that output `.md` files exist on disk.

## Update run anatomy

- **Batch Dispatch:** Per-item progress lines (`[ 11%] 1/9 — Title`) print at dispatch before `_process_item_batch` runs. A run displaying `[100%]` may still have in-flight embedding.
- **Bulk Flushes:** ChromaDB doc counts remain flat during embedding and commit via `upsert_documents` at the conclusion of each item batch (batch size 25), followed by BM25 sparse index rebuilding (~1 s).
- **Progress Tracking:** Run logs stay quiet during embedding. Track live progress via the llama-server task counter:
  ```bash
  podman logs --tail 1 embedder
  ```
  An advancing `task N` counter indicates active embedding. Check for zero upsert error lines in the run log.

## Verifying MinerU treatment

1. Check that the sidecar file exists at `~/.config/zotero-mcp/mineru-sidecars/<item_key>.md`.
2. Verify retrieved passages contain real LaTeX (`$$\frac{...}$$`) rather than garbled Unicode fragments.

## Failure modes & watchdog

### Embedder wedge recovery

The :8082 embedder can wedge on start in deadlock (0% CPU) or slow-crawl (>20s per request). Probe with:
```bash
time curl -s http://127.0.0.1:8082/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"input":"probe","model":"embed"}' >/dev/null
```
Fix: `podman restart embedder`. Always re-probe before launching large jobs.

### Upsert write wedge (batch-size/scale)

Signature: CLI force-rebuild embeds steadily (task counter climbing) but never commits: store count frozen (0 or exactly 5,461), dispatch stalled at batch 1, no errors in the log, GPU still drawing power. Root causes and fixes are in Zotero-MCP.md §11.7; the short version:

- Embedding requests are now batched at 16 with a 120 s timeout (a wedged request used to block the whole batch forever with no error).
- `upsert_documents` writes are capped at 512 chunks per sub-batch — ChromaDB's native ~5,461 sub-batch wedged mid-write at scale.
- update-db item batch is 2 (was 25) so progress is durable in small increments.
- Run CLI rebuilds with `PYTHONUNBUFFERED=1` (block-buffered stdout hid the real exception for hours) and stop `zotero-mcp.service` during force-rebuilds (documented recovery pattern; the service holds its own ChromaDB connection + BM25 cache).
- Verify writes are landing, not just the task counter: `zotero_mcp.chroma_client.create_chroma_client(...).get_all_ids()` should grow every few minutes.

Speed caveat: batch=16 showed ~2.7× in isolation but the end-to-end pipeline rate was unchanged (batching fixed reliability, not throughput) — the iGPU appears memory-bandwidth-bound for Qwen3-8B Q5_K_M. To check current throughput, sample the embedder task counter over a minute before planning a large run.

### Index gate: text-based duplication check

The gate (`~/.local/bin/zotero-index-gate.py`) flags chunk duplication by shared TEXT, not span overlap: span overlap alone is not corruption (the chunker's oversized-block split can leave a pending heading whose later flush has a span wrapping an already-emitted region — text stays correct). A >1,000-char shared-text run between two chunks of an item = FAIL; span overlap without shared text = WARN. The >4,000-char failsafe remains a FAIL (a packed atomic+prose chunk can breach it when a <`min_chunk_size` prose block rides onto a near-`max_atomic_size` atomic block; fixed in the chunker, so future rebuilds are clean).

### Watchdog (self-healing runner)

`~/.local/bin/zotero-backfill-watchdog.sh` manages long `update-db` runs and guards against:
1. **GTT Ballooning:** SIGKILLs magic-pdf when amdgpu GTT >50 GB (pipeline falls back to text-layer).
2. **Embedder Deadlock:** Restarts embedder and update-db when task counter hangs and CPU <5% across consecutive intervals.
3. **Embedder Slow-Crawl:** Restarts embedder when accumulating upsert errors occur.

Launch watchdog in background:
```bash
setsid nohup ~/.local/bin/zotero-backfill-watchdog.sh > /dev/null 2>&1 < /dev/null &
```
Logs:
- `~/.cache/zotero-mcp/logs/backfill-run.log` (progress)
- `~/.cache/zotero-mcp/logs/backfill-watchdog.log` (heartbeat: `task=<N> task_delta=<k>`)

### Live status monitoring

`~/.local/bin/zotero-run-status.sh <ITEMKEY...>` polls per-item ChromaDB counts and writes `~/.cache/zotero-mcp/logs/run-status.txt` (`committed=X/N in-flight=<keys> task=<counter> gpu=<busy%>`). It exits automatically when the watchdog and update-db terminate.

### Pausing and resuming batches

1. **Stop Order:** Stop the watchdog AND update-db together to prevent the watchdog from relaunching update-db:
   ```bash
   pkill -f "zotero-backfill-watchdog"
   pkill -f "update-db"
   pkill -f "magic-pdf"
   ```
2. **In-Flight Items:** Chroma upserts commit in multi-item flushes. A key with a partial chunk count indicates an in-flight flush.
3. **Resume Procedure:**
   - Delete in-flight item chunks from ChromaDB to prevent partial-commit gaps:
     ```python
     from pathlib import Path
     from zotero_mcp.chroma_client import create_chroma_client
     cc = create_chroma_client(str(Path.home()/'.config'/'zotero-mcp'/'config.json'))
     cc.delete_item_chunks('<IN_FLIGHT_KEY>')
     ```
   - Relaunch the watchdog with the target scoped config.

### Item-scoped re-embed (no full rebuild)

To re-chunk + re-embed ONE item with the current chunker (e.g. after a chunker fix, without a 4 h force-rebuild): delete its chunks, then run an incremental `update-db`. The item then looks new to the local-mode indexer. Note the local-mode per-item decision is Chroma-state based (existing chunks + `has_fulltext` + `attachment_keys` + priority tag + MinerU backfill target) — a Zotero metadata `version` bump alone does NOT trigger a re-embed (the version watermark only drives web/API-mode sync). Procedure:

```bash
PYTHONUNBUFFERED=1 zotero-mcp-server update-db --fulltext --config-path <scoped-config>  # after deleting the item's chunks
```

A 1,200-chunk book takes ~18 min; verified 2026-08-18 clearing the grandfathered 4,255-char QWSXSH6I chunk (gate PASS afterwards).

| Step | Atomic Unit | In-Flight Loss on Kill | Resume Action |
|---|---|---|---|
| **VLM Enrich** (`zotero-vlm-enrich.py`) | Per figure (immediate YAML append) | 1 figure (~40 s) | Re-run command; finished figures skip automatically |
| **Embed** (`update-db`) | Per batch (bulk upsert to Chroma) | In-flight item batch | Delete partial item chunks, relaunch watchdog |
| **MinerU Parse** | Per item (sidecar `.md` written on completion) | In-flight item parse | Re-run command; existing sidecars are preserved |

### Store corruption recovery

If ChromaDB encounters segfaults on access:
1. Terminate running watchdogs and update-db processes.
2. Stop the service: `systemctl --user stop zotero-mcp.service`.
3. Archive damaged store: `mv ~/.config/zotero-mcp/chroma_db ~/.config/zotero-mcp/chroma_db.damaged-$(date +%Y%m%d)`.
4. Rebuild from sidecars using temporary collection scoping:
   - Create temporary collection `rebuild-pool`.
   - Add all item keys with existing sidecars to the collection.
   - Run scoped force rebuild:
     ```bash
     zotero-mcp-server update-db --force-rebuild --allow-mass-deletion --config-path /tmp/scoped.json
     ```
   - Rebuild BM25 index and restart service.
   - Remove temporary collection.
5. Backups are created via `~/.local/bin/zotero-backup.sh` (stores sidecars in Dropbox and tarballs of image crops locally).

### Re-embedding changed sidecars

Incremental runs check Zotero metadata rather than sidecar modification dates. When sidecars are enriched or edited manually:
1. Delete target item chunks in ChromaDB:
   ```python
   from pathlib import Path
   from zotero_mcp.chroma_client import create_chroma_client
   cc = create_chroma_client(str(Path.home()/'.config'/'zotero-mcp'/'config.json'))
   for k in ('KEY1', 'KEY2'):
       cc.delete_item_chunks(k)
   ```
2. Run incremental update: `zotero-mcp-server update-db --fulltext`.
3. Restart `zotero-mcp.service` to reload the sparse index cache.

### Scoping update-db runs to a collection

To prevent unscoped scans across non-target items, create a scoped config:
```bash
~/.local/share/uv/tools/zotero-mcp-server/bin/python - ~/.config/zotero-mcp/config.json /tmp/scoped.json <COLLECTION_KEY> <<'EOF'
import json, sys
cfg = json.load(open(sys.argv[1]))
cfg.setdefault("semantic_search", {})["collection_keys"] = [sys.argv[3]]
json.dump(cfg, open(sys.argv[2], "w"))
EOF
WATCHDOG_CONFIG=/tmp/scoped.json bash ~/.local/bin/zotero-backfill-watchdog.sh
```

To converge the sparse index directly from ChromaDB without running update-db:
```python
from pathlib import Path
from zotero_mcp.chroma_client import create_chroma_client
from zotero_mcp.sparse_index import BM25Index
cc = create_chroma_client(str(Path.home()/'.config'/'zotero-mcp'/'config.json'))
idx = BM25Index(str(Path.home()/'.config'/'zotero-mcp'/'bm25_index.json'))
docs = [(d, t) for ids, docs, _ in cc.iter_documents() for d, t in zip(ids, docs) if t]
idx.build(docs)
idx.save()
```
Restart `zotero-mcp.service` after rebuilding.

## Retrieval hygiene (v5 hybrid filters)

Managed via `[hybrid filter patch]` (`zotero-mcp-hybrid-filter-patch.py`, applied during `sjust update`):

1. **Reference-Chunk Classifier:** Uses high-precision DCR breadcrumbs (`is_bibliography_chunk`) to identify true bibliography sections. Density-only heuristics are excluded to safeguard literature review text.
2. **Sparse-Leg Exclusion:** Excludes bibliography chunks from the BM25 lexical index (`semantic_search.hybrid.exclude_reference_chunks: true`).
3. **Rerank-Score Floor:** Discards matches below threshold (`semantic_search.hybrid.rerank_floor: -4.0`).
4. **Figure Boost:** On visual queries (e.g., "plot of estimates over time"), injects schema chunks via BM25 probe and applies score boost (`figure_boost: 2.5`).
5. **BM25 Rescue Scores:** Computes real cosine similarity against query embedding for sparse rescues instead of defaulting to zero.
6. **Rerank Score Exposure:** Surfaces raw cross-encoder scores as `Rerank` field for downstream citation verification.
7. **Dense-Leg Suppression & Annotation:** Drops bibliography chunks from the dense leg on general queries (`suppress_reference_chunks_dense: true`), while allowing citation-shaped lookups to retain them with `[REF]` annotation tags.

## GPU stability & CPU fallback

- **ROCm Fixes on gfx1151:**
  - `VIRTUAL_VRAM_SIZE=4` and `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` in `mineru.py` prevent GTT memory ballooning.
  - `bf_16_support = False` in `pdf_parse_union_core_v2.py` forces float32 on `LayoutLMv3`, preventing GPU MES ring lockups.
- **CPU Rescue Runner:** `~/.local/bin/zotero-cpu-rescue.py [item_key...]` processes problematic PDFs on CPU using identical extraction logic.

## Chunk cap configuration

`semantic_search.chunking.max_chunks_per_item` is set to 3000 to index long books completely. Adjust with `~/.local/bin/zotero-cap-raise.sh` if needed.

## Bounded AST Chunking Architecture

Managed via `[ast chunker patch]` (`zotero-mcp-ast-chunker-patch.py`, applied during `sjust update`):

Replaces naive character-count slicing with a Bounded AST-Aware Markdown Chunker (`ast_chunker.py`):
1. **Atomic Structural Blocks:** HTML tables (`<table>...</table>`), LaTeX display math (`$$...$$`), and `[Figure Schema]` blocks stay 100% atomic up to 3,800 characters (>94% table atomicity).
2. **Heading Boundary Fences:** `#`, `##`, `###` headings act as hard chunk boundaries, preventing cross-section context bleed.
3. **Sibling Paragraph Packing:** Small paragraphs merge up to `min_chunk_size = 600` chars, eliminating vector starvation on short list items.
4. **Prose Token Ceilings:** Prose splits on sentence and newline boundaries with an upper bound of `chunk_size = 2400` chars (~600 tokens) and 200-char overlap.
5. **Bibliography & Index Safety:** Unpunctuated reference lists and A–Z subject indices split on single newlines (`\n`) with recursive slicing fallback, strictly bounding all chunks $\le 2600$ chars.
6. **ChromaDB Sub-Batching:** embedding requests are batched at `batch=16` (chromadb `openai_embedding_function.py`) — llama-server embeds per-input sequences, so a request's total token count is NOT bounded by ctx (verified: 8 × 3.4K-tok inputs OK at ctx 4096). Each request carries a `timeout=120` so a wedged request raises instead of hanging the batch forever. The `[batch size patch]` also caps `upsert_documents` write sub-batches at `min(get_max_batch_size(), 512)` — ChromaDB's native ~5,461 sub-batch silently wedged mid-write at scale (see Zotero-MCP.md §11.7) — and sets the update-db item batch to 2. `DEFAULT_REQUEST_BATCH_SIZE` in `chroma_client.py` is 16.

## Sparse-index process cache

The server caches the BM25 index in memory. After CLI runs that modify ChromaDB documents, reload the cache:
```bash
systemctl --user restart zotero-mcp.service
```

## Reranker internals

- Configured under `semantic_search.reranker.*` in `~/.config/zotero-mcp/config.json`. Toggles take effect live per request without service restart.
- Model: `bge-reranker-v2-m3` on :8083 via `serve-reranker` (physical batch `-ub 2048`).
- Hybrid retrieval (BM25 + RRF) fuses lexical and dense candidate sets prior to cross-encoder reranking.

### Figure-schema maintenance (`zotero-vlm-enrich.py`)

The VLM enrichment script (`~/.local/bin/zotero-vlm-enrich.py`, chezmoi'd) has three modes:

- Default (no flag): full VLM enrichment of figures lacking a schema (needs :8084). The patched version inserts each schema **directly below its image** (per-image re-resolution) and stamps `- Caption: …` from the adjacent caption text — the caption is extracted locally, never from the VLM (keeps the "no guessing" discipline).
- `--captions-only`: no VLM — stamps missing captions onto existing schema blocks that sit within 9 lines below their image.
- `--relocate`: no VLM — one-time repair for sidecars enriched by the pre-fix script (whose stale-line bug drifted later figures' schemas progressively backward). Moves each schema below its image and stamps the adjacent caption, producing the same layout the patched VLM path would. Only runs when the schema count matches the reproducible expected count (resolvable + dimension-filter-passing images); mismatched files fall back to adjacent-only stamping and are reported — never guesses an association.

All modes are idempotent. After any mode changes sidecars, re-embed the affected items (sidecar edits do NOT trigger re-indexing by themselves):
`cc.delete_item_chunks('<key>')` for each changed item, then one incremental `update-db` run re-chunks + re-embeds them all.
