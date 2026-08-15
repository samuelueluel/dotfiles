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
- First commits of large items can land 20+ min in. Throughput on this box: ~40 chunks/min early (embedder warming) ramping to ~135/min; ~9,000 chunks ≈ 1.5–2 h total.

## Verify MinerU treatment of an item

- (a) the sidecar file exists for its key; (b) retrieved passages contain real LaTeX (`$$\frac{...}$$`) rather than garbled Unicode (`𝜆i,t = e x,ti𝛽`). If neither, the item is plain text-layer embedded.

## Failure modes

### Embedder wedge

See `service-ops.md` § Embedder wedge for the probe and the `podman restart embedder` fix. Summary: it can wedge at any container start, either deadlocked at 0% CPU or slow-crawling while looking healthy; always re-probe after a restart before launching a long job.

### Watchdog (self-healing long runs)

~={magenta}2026-08-15: EMBED-HANG false positives on embed-only runs=~ — the old hang heuristic (run log stale >600s + embedder <5% CPU over a single 4s sample) is incompatible with embed-only runs, where the run log is legitimately silent for the whole embedding phase and llama-server CPU samples 0% between HTTP requests. It false-killed healthy runs three times (2026-08-14 21:43, 23:13; 2026-08-15 00:07) — once DURING the bulk upsert, leaving a partial commit (5 items complete + ESL chunk0–41; ESL's ~1,070 missing chunks became a silent gap because chunk0 exists → classified "up to date" forever). ~={green}Fix (2026-08-15, in the script):=~ hang now requires the llama-server task counter (`podman logs --tail 1 embedder` → `task N`, advances per chunk) to be stuck AND CPU <5% for 3+ consecutive iterations (~60s). ~={magenta}If a run is ever killed by EMBED-HANG, verify with the task counter before trusting it=~ — advancing counter = false positive. ~={magenta}After any watchdog kill: verify per-item chunk counts=~ (an item whose chunk0 exists is skipped by all future incremental runs; partial commits are real and permanent until explicitly fixed). To re-index a partially-committed item: delete its docs from ChromaDB (e.g. `col.delete(where={'item_key': '<KEY>'})`), then run `update-db --fulltext` — the chunk0 probe fails and the item re-embeds.

`~/.local/bin/zotero-backfill-watchdog.sh` — self-healing runner for long `update-db` runs. Guards:
1. GTT balloon — SIGKILLs magic-pdf when amdgpu GTT >50 GB (update-db falls back to text-layer and continues);
2. Embedder deadlock (0% CPU, stale log) — restarts embedder + update-db;
3. Embedder slow-crawl (≥5 accumulating `saving for retry` / `Error upserting` lines) — same recovery.

Launch: `setsid nohup ~/.local/bin/zotero-backfill-watchdog.sh > /dev/null 2>&1 < /dev/null &`. Exits with `=== BACKFILL COMPLETE ===` when the run's stats summary (`Database update completed:`) appears. Logs: `~/.cache/zotero-mcp/logs/backfill-run.log` (progress) + `backfill-watchdog.log` (heartbeat every ~5 min: `hb: ... emb_cpu=... upsert_fails=... gtt=...`). Gotcha: update-db NEVER prints the literal `Update completed` (that string only exists in the self-`update` command) — the watchdog's completion check matches `Database update completed:`.

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

Docs scale with library size and with the configured chunk size, so an absolute count means little on its own — **re-chunking changes it even when nothing was lost**. Spot-check a few known items instead. Full fix: `zotero-mcp-server update-db --fulltext --force-rebuild --allow-mass-deletion` (hours on a healthy embedder; sidecars are never re-parsed). The ≈6,878 figure in older notes is stale; the 2026-08-15 count is ~18.7k chunks (MinerU sidecar fulltext is far larger than raw text extraction).

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

### GPU stability fixes & CPU rescue fallback

- **GPU stability fixes: RESOLVED (2026-08-14)**:
  1. *MFR GTT ballooning:* `magic-pdf` saw 124 GB unified VRAM and defaulted `batch_ratio=16` (256 formulas/batch in UniMERNet). Fixed in `mineru.py` by injecting `VIRTUAL_VRAM_SIZE=4` (keeps batch_size=16) and `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`.
  2. *LayoutReader bfloat16 hardware reset:* `pdf_parse_union_core_v2.py` loaded `LayoutLMv3` in `bfloat16`, causing an AMDGPU MES microcode ring lockup on RDNA3/3.5 (`gfx1151`). Fixed by forcing `bf_16_support = False` (`float32`).
  - All previously poison PDFs (Gregory, etc.) and large books (Wooldridge) now parse cleanly on the Radeon 8060S GPU without ballooning or resets.
- `~/.local/bin/zotero-cpu-rescue.py [item_key ...]`: CPU fallback runner for any future problematic PDFs (uses same `run_mineru()` code path → byte-identical sidecars). Run under a CPU-tuned profile (`tuned-adm`, e.g. `cpu-sustained`). Log: `~/.cache/zotero-mcp/logs/cpu-rescue.log`.

### Cap-raise / truncation fix

`~/.local/bin/zotero-cap-raise.sh`: raises `chunking.max_chunks_per_item`, chezmoi-adds the config, deletes the truncated items' docs, and re-embeds them — fixes books silently cut at the cap. Symptom of a too-low cap: every query against a long book hits its table of contents, because only the opening chunks were indexed. Read the config for the current value.

Historical narrative for these failures (GPU GTT balloon bug, slow-crawl variant, invisible gaps): `10_Projects/Local-LLMs/Memories/New-RAG-Setup.md` — provenance and evidence, not operating procedure.

## Sparse-index process cache (restart after CLI runs) — 2026-08-15

`get_cached_sparse_index` caches the BM25 index **in-process** and only invalidates when an update-db runs in that same process. The long-running MCP server therefore holds a stale sparse index after CLI `update-db` runs change the index file (adds/deletes of chunks) — the on-disk `bm25_index.json` is correct, the server just doesn't reload it. Symptom: a **collection-scoped** `semantic_search` fails with `Error executing plan: Internal error: Error finding id` (the hybrid leg's scope post-filter does `collection.get(ids=[sparse hits])` and hits an ID deleted since the server last loaded the index — e.g. chunks removed by `delete_item_chunks`/manual cleanup). Unscoped searches skip that post-filter and keep working, which makes this confusing. ~={green}Fix:=~ `systemctl --user restart zotero-mcp.service` after any CLI update-db that changes the index; verify with one collection-scoped search. (Unscoped-working-but-scoped-failing is the fingerprint.)

## Reranker internals

- Config toggles apply live (re-read per request, no service restart): `semantic_search.reranker.{enabled,url,model,candidate_multiplier,batch_size,timeout}` in `~/.config/zotero-mcp/config.json`. Only the code patch needs a restart, and `sjust update` re-applies it after `uv tool upgrade`.
- Verify active: results reorder vs dense-only and no `HTTP reranker error` lines in the service log (`journalctl --user -u zotero-mcp.service`). A demoted references-list chunk is the classic signal that reranking is doing its job.
- Model: bge-reranker-v2-m3, ramalama `reranker` container :8083, llama.cpp `/v1/rerank`. Gotcha: `-ub` sets the PHYSICAL batch size — query+doc pairs longer than it (formula/LaTeX-heavy MinerU chunks) fail with "increase the physical batch size", so it must stay well above the default 512.
- Hybrid retrieval (BM25 + Reciprocal Rank Fusion) runs *before* the reranker, config `semantic_search.hybrid.*`. The sparse index rebuilds on each `update-db`. After a force rebuild it can be built EMPTY (the hook ran while the collection was empty) — one incremental `update_search_database` repopulates it in seconds. If it is missing, search silently falls back to dense-only with a log warning.
- ~={magenta}Sparse lags one run:=~ the rebuild hook sits BEFORE the batch upserts in `update_database` (verified 2026-08-15), so the BM25 index on disk always reflects the pre-run state. Chunks added by a run only appear in the sparse leg after the NEXT `update-db`. Benign (converges), but don't expect fresh chunks in BM25 immediately after an ingest.
- Model-choice evidence and build history: `10_Projects/Local-LLMs/Memories/New-RAG-Setup.md` "Reranker: BUILT" and `Zotero-MCP.md` §5.
