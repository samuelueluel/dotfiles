# Index Maintenance & Failure Modes

**Load this file when** an index update fails, wedges, or silently misses content, when configuring watchdog runners, pausing or resuming long jobs, recovering from store corruption, tuning the reranker, or adjusting retrieval hygiene filters.

## Index updates and MinerU

- `zotero_zotero_update_search_database()` — incremental; low cost when metadata is unchanged.
- MinerU auto-parse: during update, every item being (re)embedded with a PDF and no cached sidecar is parsed by MinerU (mineru 3.4.5 on ROCm GPU) before embedding — equations become LaTeX, tables HTML, scans OCR'd.
  - Sidecars cache at `~/.config/zotero-mcp/mineru-sidecars/<item_key>.md`.
  - Per-item parse logs cache at `~/.cache/zotero-mcp/mineru-work/<item_key>/run.log`.
- Previously-failed items (where text extraction failed) are auto-retried by MinerU on subsequent update runs.
- Execution speed: text-layer papers typically take ~1–2 min; scanned books take ~25–30 min.
- Backfill toggle: `semantic_search.mineru.backfill` in `~/.config/zotero-mcp/config.json` gates re-parsing of already-indexed items. Keep set to `false` for incremental operations; set to `true` only for full re-parsing.
- Verification: mineru can exit 0 even on extraction failure; hooks verify that output `.md` files exist on disk.

## Update run anatomy

- **Batch Dispatch:** Per-item progress lines (`[ 11%] 1/9 — Title`) print at dispatch before `_process_item_batch` runs. A run displaying `[100%]` may still have in-flight embedding.
- **Bulk Flushes:** ChromaDB doc counts grow via durable `upsert_documents` sub-batches capped at 512 chunks (embedding runs ahead; writes land every ~3–4 min), followed by BM25 sparse index rebuilding (~1 s).
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

The gate (`~/.local/bin/zotero-index-gate.py`) flags chunk duplication by shared TEXT, not span overlap: span overlap alone is not corruption (the chunker's oversized-block split can leave a pending heading whose later flush has a span wrapping an already-emitted region — text stays correct). A >1,000-char shared-text run between two chunks of an item = FAIL; span overlap without shared text = WARN. The >4,000-char failsafe remains a FAIL, measured on chunk CONTENT with the DCR prefix (`[Paper: … (<author> <year>) | Section: …]`, prepended post-chunking by the pipeline) stripped — stored text runs prefix+content, so a content-just-under-4,000 chunk legitimately stores at 4,00x.

### Watchdog (self-healing runner)

`~/.local/bin/zotero-backfill-watchdog.sh` manages long `update-db` runs and guards against:
1. **GTT Ballooning:** SIGKILLs mineru/magic-pdf when amdgpu GTT >50 GB (pipeline falls back to text-layer).
2. **Embedder Deadlock:** Restarts embedder and update-db when task counter hangs and CPU <5% across consecutive intervals.
3. **Embedder Slow-Crawl:** Restarts embedder when accumulating upsert errors occur.

Launch watchdog in background:
```bash
setsid nohup ~/.local/bin/zotero-backfill-watchdog.sh > /dev/null 2>&1 < /dev/null &
```
Logs:
- `~/.cache/zotero-mcp/logs/backfill-run.log` (progress)
- `~/.cache/zotero-mcp/logs/backfill-watchdog.log` (heartbeat: `task=<N> task_delta=<k>`)

### Sidecar-create GTT watchdog (`zotero-sidecar-watch.sh`)

`zotero-sidecar.sh create` is the raw GPU path with NO built-in GTT guard. For long parse batches (a whole subcollection), run it under the dedicated watcher — it reuses the backfill watchdog's calibrated GTT logic but targets the `create` process tree instead of `update-db`:
```bash
setsid nohup ~/.local/bin/zotero-sidecar-watch.sh > /dev/null 2>&1 < /dev/null &
```
- **GTT balloon:** threshold `WATCHDOG_GTT_THRESHOLD_MB` (default 105 GB), 3 consecutive bad samples @ 20 s → SIGKILL **mineru/magic-pdf children only** — create.py logs `FAIL <key>` and continues; the item is CPU-rescued later (`zotero-cpu-rescue.py`).
- **Per-item hang guard:** `ITEM_TIMEOUT_SEC` (default 3600; 869-pp manuals take ~30 min legitimately).
- **RAM/swap forensics:** logs WARN + top-RSS when free RAM < 8 GB or swap > 8 GB — log-only, never kills (no VLM-baseline false-positive risk).
- Log: `~/.cache/zotero-mcp/logs/sidecar-watch.log` (heartbeats every ~3.5 min; poison list + sidecar count at exit).

> **Operational notes:** (1) always run long `create` batches under the watcher — MinerU writes the `.md` only at completion, so an in-flight item is fully lost on any abort; (2) keep embedder/reranker/VLM OFF during parses — the leaner the unified-RAM footprint, the more headroom; (3) MinerU's own log is per-item-sparse (one `start <key>` line), so monitor via the watcher log or the sidecar dir.

### Live status monitoring

`~/.local/bin/zotero-run-status.sh <ITEMKEY...>` polls per-item ChromaDB counts and writes `~/.cache/zotero-mcp/logs/run-status.txt` (`committed=X/N in-flight=<keys> task=<counter> gpu=<busy%>`). It exits automatically when the watchdog and update-db terminate.

### Pausing and resuming batches

1. **Stop Order:** Stop the watchdog AND update-db together to prevent the watchdog from relaunching update-db:
   ```bash
   pkill -f "zotero-backfill-watchdog"
   pkill -f "update-db"
   pkill -f "magic-pdf"
   pkill -f "mineru"
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

A 1,200-chunk book takes ~18 min end-to-end; the procedure cleared the last oversized chunk and left the gate PASS.

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

> Gotcha: scoped config's `mineru.enabled` is IGNORED. The
> MinerU gate functions (`_mineru.try_auto_parse`, `is_parseable`,
> `is_backfill_target` in `zotero_mcp/mineru.py`) are called from
> `semantic_search.py` WITHOUT a `config_path`, so `load_mineru_config(None)`
> always reads the BASE `~/.config/zotero-mcp/config.json`. A scoped run whose
> `/tmp/scoped.json` sets `mineru.enabled: true` will silently report
> `0 items to index` if the base config still has `mineru.enabled: false`.
> **To trigger MinerU parsing in a scoped run, set `mineru.enabled: true` in
> the BASE config** (the scoped collection filter still limits candidates to
> the target collection, so no items outside it are parsed). Flip it back to
> `false` after the run. Candidate code fix: pass `config_path` through to the
> three `_mineru.*` calls in `semantic_search.py` so a scoped config is honored.

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
  - `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` in `mineru.py`; GTT guard env `MINERU_VIRTUAL_VRAM_SIZE` — unset → batch_ratio 16 (fastest; sidecar watcher backstops genuine balloons), set `4` → batch_ratio 1 (conservative).
  - `bf_16_support = False` in `pdf_parse_union_core_v2.py` forces float32 on `LayoutLMv3`, preventing GPU MES ring lockups.
  - **MinerU 3.4.5 stack (`~/mineru-upgrade-venv`):** CLI `mineru -p -o -m txt -b pipeline`; 1.x `~/mineru-rocm-venv` (magic-pdf) is the CPU-rescue/fallback venv. OCR-det is GPU-**batched** (`enable_ocr_det_batch`, torch ≥2.8) with proper `-m txt`/`ocr` gating; PP-OCRv6 OCR (+11% OmniDocBench). `ensure_ocr_flag_patch()` in the create/rescue scripts no-ops on 3.x (proper gating) and still self-heals the 1.x fallback venv. Config `semantic_search.mineru.bin` → `~/mineru-upgrade-venv/bin/mineru`; `config_json` not used (3.x defaults). Throughput on manuals is ~parity with the 1.x path; GPU is fully utilized during det.
- **VLM GTT baseline gotcha:** the VLM (Qwen3-VL-30B-A3B UD-Q8_K_XL, ~34 GB) + reranker + embedder loaded in unified memory hold ~44 GB baseline GTT. The watchdog's old fixed 50 GB balloon threshold falsely SIGKILLed every magic-pdf parse (rc=-9) while the VLM was loaded. The threshold is now env-configurable: `WATCHDOG_GTT_THRESHOLD_MB=<MB>` (default 105 GB), which sits above legit usage in all states (~30 GB no-VLM, ~44 GB with Qwen3-VL, ~65 GB with InternVL3-78B deep-pass) and below a real balloon (~114-124 GB). If a run reports `BALLOON` on every item while GTT hovers at baseline + ~10-30 GB, that is a VLM-baseline false positive — raise the threshold, don't assume the PDF is poison.
- **CPU Rescue Runner:** `~/.local/bin/zotero-cpu-rescue.py [item_key...]` processes problematic PDFs on CPU using identical extraction logic. (Run via `~/.local/share/uv/tools/zotero-mcp-server/bin/python` — the script itself is not executable.)
- **Sidecar-create runs:** use `zotero-sidecar-watch.sh` (failure-modes section above) for GTT protection — the `create` path has no built-in watchdog; the 2026-08-19 hard-hang lost a 19-item batch at 0 sidecars.

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
6. **Embedding/Write Tuning:** embedding requests batched at 16 with a 120 s timeout; `upsert_documents` write sub-batches capped at 512; update-db item batch 2 — see the wedge section above (and Zotero-MCP.md §11.7).

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
