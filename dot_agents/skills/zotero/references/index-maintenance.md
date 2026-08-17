# Index Maintenance & Failure Modes

Deep reference for the zotero semantic-search index: MinerU internals, failure modes, recovery procedures, and reranker tuning. **Load this file when** an index update fails, wedges, or silently misses content, when a parse looks wrong, or when tuning the reranker. The usage layer lives in SKILL.md §4; service policy and embedder-wedge recovery live in `service-ops.md`.

## Index updates and MinerU

- `zotero_zotero_update_search_database()` — incremental; cheap when nothing changed.
- MinerU auto-parse: during the update, every item being (re)embedded that has a PDF and no cached sidecar is parsed by MinerU (magic-pdf, ROCm GPU) BEFORE embedding — equations become LaTeX, tables HTML, scans OCR'd. No separate OCR step. Sidecars cache at `~/.config/zotero-mcp/mineru-sidecars/<item_key>.md`; per-item parse logs at `~/.cache/zotero-mcp/mineru-work/<item_key>/run.log`.
- Previously-failed items (PDF extraction failed at some point) are auto-retried by MinerU — re-running the update rescues them.
- Expect a new paper to take ~1-2 min (text-layer) to ~30 min (scanned book) before it becomes searchable.
- Backfill: `semantic_search.mineru.backfill` in `~/.config/zotero-mcp/config.json` gates re-parsing of already-indexed items (a library-wide parse is a multi-hour GPU job — run it when the GPU is idle). Read the config for its current value rather than assuming.
- Gotcha: magic-pdf exits 0 even on failure — the hook checks that the output `.md` exists, not the exit code.

## Update run anatomy (normal — don't debug it)

Verified 2026-08-14 on a 9-item textbook ingest; `semantic_search.py` behavior:

- Per-item progress lines (`[ 11%] 1/9 — Title`) print at **DISPATCH, not completion** — the code prints the whole batch's lines before `_process_item_batch` runs. A run sitting at `[100%]` can have hours left.
- ChromaDB doc count stays **FLAT for the whole run**: chunks are embedded into memory and `upsert_documents` fires **once at the end of the item batch** (batch_size=25 items), then the sparse index rebuilds (~1 s). The count jumps in a single step near the end.
- The run log goes **quiet during embedding** (no per-chunk lines) — normal. Live progress: `podman logs --tail 1 embedder` → the llama-server line shows `task N` advancing (~1 task ≈ 1 chunk). Healthy = advancing counter **and** 0 `saving for retry` / `Error upserting` lines in the run log. A flat doc count is not a stall — wait for `Database update completed:` before concluding anything.
- First commits of large items can land 20+ min in. Throughput varies with chunk mix (~60–150 chunks/min observed on this box; textbooks' long chunks embed slower than papers'); the live rate comes from the status monitor's `task_delta`, not a remembered ETA.

## Verify MinerU treatment of an item

- (a) the sidecar file exists for its key; (b) retrieved passages contain real LaTeX (`$$\frac{...}$$`) rather than garbled Unicode (`𝜆i,t = e x,ti𝛽`). If neither, the item is plain text-layer embedded.

## Failure modes

### Embedder wedge

See `service-ops.md` § Embedder wedge for the probe and the `podman restart embedder` fix. Summary: it can wedge at any container start, either deadlocked at 0% CPU or slow-crawling while looking healthy; always re-probe after a restart before launching a long job.

### Watchdog (self-healing long runs)

2026-08-15: EMBED-HANG false positives on embed-only runs — the old hang heuristic (run log stale >600s + embedder <5% CPU over a single 4s sample) is incompatible with embed-only runs, where the run log is legitimately silent for the whole embedding phase and llama-server CPU samples 0% between HTTP requests. It false-killed healthy runs three times (2026-08-14 21:43, 23:13; 2026-08-15 00:07) — once DURING the bulk upsert, leaving a partial commit (5 items complete + ESL chunk0–41; ESL's ~1,070 missing chunks became a silent gap because chunk0 exists → classified "up to date" forever). Fix (2026-08-15, in the script): hang now requires the llama-server task counter (`podman logs --tail 1 embedder` → `task N`, advances per chunk) to be stuck AND CPU <5% for 3+ consecutive iterations (~60s). If a run is ever killed by EMBED-HANG, verify with the task counter before trusting it — advancing counter = false positive. After any watchdog kill: verify per-item chunk counts (an item whose chunk0 exists is skipped by all future incremental runs; partial commits are real and permanent until explicitly fixed). To re-index a partially-committed item: delete its docs from ChromaDB (e.g. `col.delete(where={'item_key': '<KEY>'})`), then run `update-db --fulltext` — the chunk0 probe fails and the item re-embeds.

`~/.local/bin/zotero-backfill-watchdog.sh` — self-healing runner for long `update-db` runs. Guards:
1. GTT balloon — SIGKILLs magic-pdf when amdgpu GTT >50 GB (update-db falls back to text-layer and continues);
2. Embedder deadlock (0% CPU, stale log) — restarts embedder + update-db;
3. Embedder slow-crawl (≥5 accumulating `saving for retry` / `Error upserting` lines) — same recovery.

Launch: `setsid nohup ~/.local/bin/zotero-backfill-watchdog.sh > /dev/null 2>&1 < /dev/null &`. Exits with `=== BACKFILL COMPLETE ===` when the run's stats summary (`Database update completed:`) appears. Logs: `~/.cache/zotero-mcp/logs/backfill-run.log` (progress) + `backfill-watchdog.log` (heartbeat every ~5 min: `hb: ... emb_cpu=... upsert_fails=... gtt=...`). Gotcha: update-db NEVER prints the literal `Update completed` (that string only exists in the self-`update` command) — the watchdog's completion check matches `Database update completed:`.

2026-08-16 heartbeat fix: the heartbeat now logs the LIVE embedder task counter (`task=<N> task_delta=<k> runlog_age=<s>`) in addition to `item=[...]`. Read `task_delta` for progress — the `item=[...]` capture is STALE during the embed phase (it reads the block-buffered run log; it only updates during extraction). A task counter that advances = embedding is alive even when the run log is silent. Also fixed: the task counter grep must use `2>&1` — llama-server logs to STDERR only, so `2>/dev/null` silently returns an empty counter (the 2026-08-15 task-counter hang clause was therefore inert until this fix).

### Live run status (check BEFORE pausing — 2026-08-16)

`~/.local/bin/zotero-run-status.sh <ITEMKEY...>` — polls per-item ChromaDB counts (default 30s; `POLL_SEC=15` to tune), logs a COMMIT line the moment any flush lands, and overwrites `~/.cache/zotero-mcp/logs/run-status.txt` with the current state: `committed=X/N chunks=N in-flight/pending=<keys> task=<embedder counter> wd=<watchdog procs> ud=<update-db procs> gpu=<busy%>`. Self-exits (logging FINAL) when watchdog + update-db are both dead — i.e. after a clean completion or a deliberate pause-kill. The pipeline drivers auto-launch it at Phase C.

**Commit semantics (measured 2026-08-16):** flushes are NOT strictly per-item — the embedder batches across items, so a single flush can commit SEVERAL books at once (observed: ESL + Greene + Hansen-Econometrics landed in one window). A per-key count anywhere between 1 and the item's expected total means a flush is in flight; the status file is the pause-decision input, not the run log.

**Pre-pause procedure:** (1) `cat ~/.cache/zotero-mcp/logs/run-status.txt`; (2) confirm no key sits at a partial count (in-flight flush — pause now risks that item restarting from scratch, which is still clean, just slower); (3) confirm `wd`/`ud` values; (4) pause. The monitor's FINAL line after a pause-kill is the ground truth of what survived.

### Pausing and resuming a batch (deliberate stop, e.g. freeing the GPU)

A long `update-db` (full-library force-rebuild, or a collection re-embed like the Detroit/Methods pipelines) can be stopped and resumed cleanly — but "pause" is stop-and-restart, not a checkpoint, and the watchdog complicates the kill order:

1. **Pause = stop the watchdog AND update-db together, plus any orphaned magic-pdf.** The watchdog relaunches update-db when it dies (that's the self-healing design), so killing update-db alone buys ~4 min before it's back. Kill the watchdog first (or both in one command), not update-db alone. Killing update-db orphans its magic-pdf child (observed 2026-08-16: the manual's parse kept running after the kill) — after the kill, `pkill -f "magic-pdf"` and clean `~/.cache/zotero-mcp/mineru-work/<KEY>/` partials.
2. **Completed items are already durable** — chroma upserts commit in flushes that can cover SEVERAL in-flight items at once (not strictly per-item; measured 2026-08-16 — ESL + Greene + Hansen-Econometrics landed together). BUT: a SIGKILL landing mid-flush CAN corrupt the store — 2026-08-16: the 11:20 pause SIGKILL tore the hnsw segments; the first post-reboot write completed the corruption and every subsequent chroma access segfaulted (raw client included), forcing a full-library rebuild. So: pause with SIGTERM when possible, and ALWAYS run the monitor's post-stop store-health check (zotero-run-status.sh runs it on exit: `store-health: OK count=N` vs `CORRUPT`) before trusting a paused state. Run `zotero-run-status.sh <keys>` before pausing to see exactly which items have committed.
3. **The in-flight item restarts from scratch on resume** (no intra-item checkpoint; all-or-nothing per batch). Cost is that item's embed time (~20-30 min for a textbook).
4. **GPU vs RAM:** stopping update-db frees the GPU immediately (the embedder idles at ~0% busy), but the embedder keeps its model (~11.6 GB unified) resident — if the pause must free RAM too, stop the embedder service as well, and remember **you** run `serve-embedder` on resume (never auto-started).
5. **Resume checklist:** (a) delete the in-flight item's chunks from ChromaDB (`delete_item_chunks('<KEY>')` / `col.delete(where={'item_key': '<KEY>'})`) — a partial commit whose chunk0 exists is skipped as "up to date" forever (see § Invisible gaps); (b) relaunch the watchdog with the same env/config (`WATCHDOG_CONFIG=<scoped.json> bash ~/.local/bin/zotero-backfill-watchdog.sh` — bypasses Phase B entirely, but Phase D must then be run manually), **or** the pipeline driver with the pause-point-correct flags: `--skip-enrich` only when the pause happened BEFORE Phase B (B+C+D still pending — the Detroit case); **`--skip-enrich --skip-delete` when paused MID-Phase-C** — without `--skip-delete` the driver's Phase B re-deletes the already-committed items and forces a full re-embed; (c) after completion, verify per-item chunk counts for the whole collection (flat counts during an item are normal; the item's batch lands at once). Never edit a driver script (methods-pipeline.sh etc.) while it is running — bash re-reads later sections from the modified file mid-execution and dies with a parse error (observed 2026-08-16 after a pause-kill); edit drivers only while stopped.
6. **Watch for partial flushes mid-item:** chroma may show a few chunks (e.g. 30/1,086) while an item is in flight — those are pre-batch writes and are overwritten by the final commit; treat any count between 1 and the item total as "in flight", and if the run dies there, apply step 5a before resuming.

#### Per-step pause/resume (all three long steps)

The atomic unit differs per step, and that sets the resume cost — the embed guidance above is per-item; the other two steps are simpler or worse:

| Step | Atomic unit | In-flight loss on kill | Resume |
|---|---|---|---|
| **VLM enrich** (`zotero-vlm-enrich.py`) | **per figure** (schema block written to the sidecar immediately after each inference) | 1 figure (~40s) | re-run the same invocation (`--all`/`--key <K>`); finished figures skip via idempotency (`already=N`). `stop-vlm` frees ~58 GB anytime; no chroma, no watchdog, no state |
| **Embed** (`update-db`) | per item (batch commit to chroma) | in-flight item's embed (~20-30 min) | delete the partial item's chunks, relaunch watchdog (steps above) |
| **MinerU parse** | per item (sidecar `.md` written at the END of the item's parse) | in-flight item's **parse** — worst case for scanned/giant PDFs (hours) | re-run; completed sidecars persist (sidecar = parse cache, so restarts never re-parse) |

MinerU-specific notes: the watchdog's GTT-balloon guard SIGKILLs a runaway magic-pdf mid-parse (update-db then falls back to text-layer and continues — a degraded continuation, not a clean pause); a deliberate MinerU pause should therefore stop the watchdog + update-db together, and expect the in-flight PDF to re-parse on resume. Scoped runs (`semantic_search.collection_keys`) keep this predictable by limiting what the pool can even see.

### Store corruption recovery (2026-08-16 procedure)

Symptoms: every chroma access segfaults — raw `chromadb.PersistentClient` and the zotero wrapper alike, even on a fresh temp dir when the wrapper's defaults fall back to the real store; update-db crash-loops (watchdog: "exited unexpectedly … restarting" every ~25s); the MCP service dies on its first store-touching request. The Rust hnsw segments are the fragile part (SIGKILL mid-flush or a crash-loop can tear them; reads are tolerant, the first write completes the corruption).

Recovery (tested 2026-08-16): the vectors are irreplaceable except by re-embedding. Backups now exist: `~/.local/bin/zotero-backup.sh` (chezmoi-tracked) — layer 1 sidecars → `~/Dropbox/zotero-mcp-backups/` (28 MB, off-machine), layer 2 image crops → `~/zotero-mcp-backups/` (~1.2 GB tarball), layer 3 live chroma store → same local dir (fast-restore). Retention: 3 per layer. Safe to run during a rebuild (pure reads; a live chroma snapshot is partial — re-run after rebuild completes for the clean fast-restore layer). Steps:

1. Stop the crash loop: watchdog first, then update-db (kill order per the pause section).
2. Stop the service: `systemctl --user stop zotero-mcp.service` (it can't serve a corrupt store; also the Zotero MCP gateway depends on it — library-write calls fail while it's down).
3. Preserve the store for forensics: `mv ~/.config/zotero-mcp/chroma_db ~/.config/zotero-mcp/chroma_db.corrupt-YYYYMMDD` (fresh store is created by the rebuild).
4. Rebuild SCOPED to exactly the processed items — never unscoped: an unscoped force-rebuild discovers every never-indexed item (2026-08-16: 120 candidates vs 101 sidecars — the Stata manual + ~18 others) and MinerU-parses them, which is waste for unprocessed collections. The temp-collection trick:
   - `zotero_zotero_create_collection("rebuild-pool")` → key K
   - `zotero_zotero_set_item_collections(item_keys=<ALL sidecar stems>, add_to=[K])`
   - scoped config: `semantic_search.collection_keys=[K]` (the driver builds it)
   - `WATCHDOG_CONFIG=<scoped> bash ~/.local/bin/zotero-backfill-watchdog.sh` with `update-db --force-rebuild --allow-mass-deletion --config-path <scoped>`
   - after completion: `zotero_zotero_delete_collection(K)` — items keep their original memberships (reversible).
   The ready-made driver: `~/.cache/zotero-mcp/logs/rebuild-pipeline.sh` (phase 1 = scoped watchdog force-rebuild + status monitor; phase 2 = direct sparse rebuild + service restart + verify).
5. The status monitor's exit health-check (`store-health: OK count=N`) is the go/no-go signal after any rebuild or pause.

### Invisible gaps

Incremental runs judge "up to date" by item METADATA, not doc counts — after a crawl or interrupted run, chunks can be missing while runs report success.

First check is the MCP tool, which reports doc count, model, and last update with no shell work:

```
zotero_zotero_get_search_database_status
```

If the MCP server is itself unavailable, read ChromaDB directly (`~/.config/zotero-mcp/chroma_db`, collection `zotero_library`):

```
~/.local/share/uv/tools/zotero-mcp-server/bin/python -c "import chromadb,pathlib; c=chromadb.PersistentClient(path=str(pathlib.Path.home()/'.config/zotero-mcp/chroma_db')); print(c.get_collection('zotero_library').count())"
```

Docs scale with library size and with the configured chunk size, so an absolute count means little on its own — **re-chunking changes it even when nothing was lost**. Spot-check a few known items instead. Full fix: `zotero-mcp-server update-db --fulltext --force-rebuild --allow-mass-deletion` (hours on a healthy embedder; sidecars are never re-parsed). The ≈6,878 figure in older notes is stale; absolute counts change with every rebuild — run `get_search_database_status` (or the count command above) for the live number, never a remembered figure. MinerU sidecar fulltext (LaTeX + HTML tables) is far larger than raw text extraction, so sidecar-era counts are naturally ~2.5x the text-layer era.

### Sidecar edits do not trigger re-embedding

Incremental runs judge "up to date" by Zotero item METADATA (date_modified, attachment set, attachment priority) — never by the sidecar file. So `zotero-vlm-enrich.py` schema injection (or any manual sidecar change) is invisible to the next `update-db`; the item is skipped as up to date and the enriched text never reaches the index. To land changed sidecars for specific items: delete their chunks, then run an incremental `update-db` (the chunk0 probe fails and the item re-embeds):

```bash
~/.local/share/uv/tools/zotero-mcp-server/bin/python - <<'EOF'
from pathlib import Path
from zotero_mcp.chroma_client import create_chroma_client
cc = create_chroma_client(str(Path.home()/'.config'/'zotero-mcp'/'config.json'))
for k in ('KEY1','KEY2'):
    cc.delete_item_chunks(k)
EOF
zotero-mcp-server update-db --fulltext
```

Or force-rebuild the whole library once. After either, restart `zotero-mcp.service` so the sparse process cache reloads (see the sparse-cache section below).

### Scoping update-db runs to a collection

By default an incremental `update-db` scans the WHOLE library and processes any item it judges new/changed — including never-indexed items (e.g. a newly added giant PDF). To keep a pipeline run strictly inside a collection, set `semantic_search.collection_keys` in the config (or in a scoped copy passed via `--config-path` / the watchdog's `WATCHDOG_CONFIG` env var):

```bash
# scoped copy of the live config, then run update-db against it
~/.local/share/uv/tools/zotero-mcp-server/bin/python - ~/.config/zotero-mcp/config.json /tmp/scoped.json TRGBCDX5 <<'EOF'
import json, sys
cfg = json.load(open(sys.argv[1]))
cfg.setdefault("semantic_search", {})["collection_keys"] = [sys.argv[3]]
json.dump(cfg, open(sys.argv[2], "w"))
EOF
WATCHDOG_CONFIG=/tmp/scoped.json bash ~/.local/bin/zotero-backfill-watchdog.sh   # watchdog passes --config-path
```

With a filter set, update-db uses the local full scan (API incremental is disabled) and the pool is exactly the collection's items — out-of-scope items are invisible (2026-08-15: the Stata-19 manual would otherwise trigger an unguarded MinerU parse; scoped run completed in 25s, 0 items, no magic-pdf).

**Converging the sparse index without an update-db at all:** the second-run convergence step can be replaced by a direct rebuild from chroma (~2s, touches nothing but the BM25 file):

```python
from pathlib import Path
from zotero_mcp.chroma_client import create_chroma_client
from zotero_mcp.sparse_index import BM25Index
cc = create_chroma_client(str(Path.home()/'.config'/'zotero-mcp'/'config.json'))
idx = BM25Index(str(Path.home()/'.config'/'zotero-mcp'/'bm25_index.json'))
docs = [(d, t) for ids, docs, _ in cc.iter_documents() for d, t in zip(ids, docs) if t]
idx.build(docs); idx.save()
```

Still restart `zotero-mcp.service` afterwards to reload the process-side sparse cache.

### Retrieval hygiene (`[hybrid filter patch]`, v5)

Seven filters in `semantic_search.py`, applied by `zotero-mcp-hybrid-filter-patch.py` (re-applied by `sjust update`; backup `semantic_search.py.bak-hybrid-filter`). Zero re-embed: dense/chroma untouched, BM25 rebuilds in ~2s.

1. **Reference-chunk classifier** — v5 (2026-08-16) split: `is_bibliography_chunk(text)` (breadcrumb-only: DCR prefix names a reference section — the audited high-precision signal; 596/596 breadcrumb-flagged chunks were genuine References/Bibliography sections) vs the legacy density-inclusive `is_reference_chunk` (breadcrumb OR author-year density ≥3 and ≥1 per 200 chars). Corpus audit (18,950 chunks, 2026-08-16): the density signal alone flagged 34 chunks, of which 32 are PROSE (abstracts, conclusions, appendices, one lit review — the LAND BANK §3 literature review) and only ~2 are list-like. Density therefore stays OUT of all suppression (lit-review safety).
2. **Sparse-leg exclusion** — `_build_sparse_index()` skips breadcrumb-flagged bibliography chunks (`semantic_search.hybrid.exclude_reference_chunks` default true; `reference_chunk_signal` = `"breadcrumb"` default, `"either"` restores legacy density-inclusive). Rare tokens inside citation lists ("Journal of Monetary Economics") no longer match in BM25. Post-rebuild + v5: 18,354 docs, 596 excluded — re-derive via the direct chroma→BM25 rebuild if the count drifts. The 32 density-only prose chunks are IN the sparse leg (they were excluded pre-v5 by the density leg of the classifier — a small recall win).
3. **Rerank-score floor** — `semantic_search.hybrid.rerank_floor` (default None = off; live −4.0). Applied to the ADJUSTED rerank score (raw + figure boost) after `rerank_with_scores`; candidates below the floor are dropped. Calibrated on bge-reranker-v2-m3 via llama.cpp: relevant ≈ 0..+1, weak ≈ −2..−3 (Poterba references vs a monetary-policy query scored −2.44), junk ≤ −5 (−7.7 observed). −4.0 drops junk only; −2.5 also cuts weak bibliography hits; keep None to display weak matches as honest ~0/− signals.
4. **Figure boost** — on figure-style queries (`is_figure_query`: fig/graph/plot/chart/panel/visual/depict/illustrat/schematic/scatter/histogram/heatmap/curve), `_hybrid_search` injects schema-bearing chunks via a fixed `"Figure Schema"` BM25 probe (top 30) into the RRF fusion, and the rerank stage adds `semantic_search.hybrid.figure_boost` (live 2.5) to their score. The natural-query legs rarely rank schema YAML ("graph of coefficient estimates over time" shares no tokens), so schema chunks must enter the candidate set explicitly. Verified: that query now surfaces schema chunks 5EECGJ4X #50, RCYCTJCF #64, UH7SNQJY #30 (MCP displays chunk_index+1). Score-scale note: boost must be ~2–3 to matter on this reranker.
5. **Rescue-score fix (v3)** — BM25-only rescues (incl. figure-probe schema chunks) previously displayed similarity 0.000 (hardcoded distance 1.0). `_hybrid_search` now fetches their stored embeddings from chroma (`collection.get(include=["embeddings"])`) and computes the real cosine distance vs the query embedding (same `embedding_function.embed_query` the dense leg uses). Display-only: RRF order unchanged. Gotcha (v3a bug, fixed v3b): chroma returns embeddings as a numpy array — `embeddings or []` raises "truth value ambiguous" and silently fell back to 1.0; guard with `is not None and len(...)`. Verified: UH7SNQJY #23/24 IV-methodology rescue now displays 0.655 (was 0.000).
6. **Rerank-score exposure (v4)** — the raw cross-encoder score is carried through enrichment and displayed as `Rerank` in the MCP result (e.g. `Rerank: +2.85`; positive = confident, ≲ −4 = junk — calibration on bge-reranker-v2-m3 via llama.cpp, wider than first sampled). Feeds the `citation-integrity` skill's confidence gating.
7. **W1 dense-leg suppression + [REF] annotation (v5, 2026-08-16)** — the stress battery exposed bibliography chunks surfacing via the DENSE leg on broad queries with positive rerank (Diamond–McQuade's bibliography citing Greenstone–Gallagher at rank 2, +2.23). `semantic_search.hybrid.suppress_reference_chunks_dense` (default true): breadcrumb-flagged chunks are dropped from the dense leg BEFORE RRF fusion, gated by `is_citation_query` (author-year pattern or cite/reference words → gate opens, citation lookups keep them). `annotate_reference_chunks` (default true): surviving bibliography chunks render a `[REF]` marker ("bibliography entry - use to find the paper, not as a claim source"). Verified: the batch-1 query now returns only the paper (+5.37); gate-open queries surface in-text citations and reference lists; lit-review query (LAND BANK) unaffected (+5.81). Known residual (documented, not a regression): mixed chunks whose DCR breadcrumb is the pre-References section (conclusion+refs) and un-breadcrumbed reference lists are NOT breadcrumb-flagged → not suppressed, no [REF] marker. Measured at ~2–42 chunks depending on the detector; a structure-gated density test was prototyped and rejected (42 candidates, mostly tables/data appendices/acknowledgments — precision too low). Backstop: the citation-integrity skill + rerank scores. Build note: this was the hybrid-filter patch v4 → v5 migration (idempotent, `_ensure_v5()`).

### GPU stability fixes & CPU rescue fallback

- **GPU stability fixes: RESOLVED (2026-08-14)**:
  1. *MFR GTT ballooning:* `magic-pdf` saw 124 GB unified VRAM and defaulted `batch_ratio=16` (256 formulas/batch in UniMERNet). Fixed in `mineru.py` by injecting `VIRTUAL_VRAM_SIZE=4` (keeps batch_size=16) and `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`.
  2. *LayoutReader bfloat16 hardware reset:* `pdf_parse_union_core_v2.py` loaded `LayoutLMv3` in `bfloat16`, causing an AMDGPU MES microcode ring lockup on RDNA3/3.5 (`gfx1151`). Fixed by forcing `bf_16_support = False` (`float32`).
  - All previously poison PDFs (Gregory, etc.) and large books (Wooldridge) now parse cleanly on the Radeon 8060S GPU without ballooning or resets.
- `~/.local/bin/zotero-cpu-rescue.py [item_key ...]`: CPU fallback runner for any future problematic PDFs (uses same `run_mineru()` code path → byte-identical sidecars). Run under a CPU-tuned profile (`tuned-adm`, e.g. `cpu-sustained`). Log: `~/.cache/zotero-mcp/logs/cpu-rescue.log`.

### Cap-raise / truncation fix

`~/.local/bin/zotero-cap-raise.sh`: raises `chunking.max_chunks_per_item`, chezmoi-adds the config, deletes the truncated items' docs, and re-embeds them — fixes books silently cut at the cap. Symptom of a too-low cap: every query against a long book hits its table of contents, because only the opening chunks were indexed. Read the config for the current value.

Historical narrative for these failures (GPU GTT balloon bug, slow-crawl variant, invisible gaps): `02_Memories/New-RAG-Setup.md` — provenance and evidence, not operating procedure.

## Sparse-index process cache (restart after CLI runs) — 2026-08-15

`get_cached_sparse_index` caches the BM25 index **in-process** and only invalidates when an update-db runs in that same process. The long-running MCP server therefore holds a stale sparse index after CLI `update-db` runs change the index file (adds/deletes of chunks) — the on-disk `bm25_index.json` is correct, the server just doesn't reload it. Symptom: a **collection-scoped** `semantic_search` fails with `Error executing plan: Internal error: Error finding id` (the hybrid leg's scope post-filter does `collection.get(ids=[sparse hits])` and hits an ID deleted since the server last loaded the index — e.g. chunks removed by `delete_item_chunks`/manual cleanup). Unscoped searches skip that post-filter and keep working, which makes this confusing. Fix: `systemctl --user restart zotero-mcp.service` after any CLI update-db that changes the index; verify with one collection-scoped search. (Unscoped-working-but-scoped-failing is the fingerprint.)

## Reranker internals

- Config toggles apply live (re-read per request, no service restart): `semantic_search.reranker.{enabled,url,model,candidate_multiplier,batch_size,timeout}` in `~/.config/zotero-mcp/config.json`. Only the code patch needs a restart, and `sjust update` re-applies it after `uv tool upgrade`.
- Verify active: results reorder vs dense-only and no `HTTP reranker error` lines in the service log (`journalctl --user -u zotero-mcp.service`). A demoted references-list chunk is the classic signal that reranking is doing its job.
- Model: bge-reranker-v2-m3, ramalama `reranker` container :8083, llama.cpp `/v1/rerank`. Gotcha: `-ub` sets the PHYSICAL batch size — query+doc pairs longer than it (formula/LaTeX-heavy MinerU chunks) fail with "increase the physical batch size", so it must stay well above the default 512.
- Hybrid retrieval (BM25 + Reciprocal Rank Fusion) runs *before* the reranker, config `semantic_search.hybrid.*`. The sparse index rebuilds on each `update-db`. After a force rebuild it can be built EMPTY (the hook ran while the collection was empty) — one incremental `update_search_database` repopulates it in seconds. If it is missing, search silently falls back to dense-only with a log warning.
- Sparse lags one run: the rebuild hook sits BEFORE the batch upserts in `update_database` (verified 2026-08-15), so the BM25 index on disk always reflects the pre-run state. Chunks added by a run only appear in the sparse leg after the NEXT `update-db`. Benign (converges), but don't expect fresh chunks in BM25 immediately after an ingest.
- Model-choice evidence and build history: `02_Memories/New-RAG-Setup.md` "Reranker: BUILT" and `Zotero-MCP.md` §5.
