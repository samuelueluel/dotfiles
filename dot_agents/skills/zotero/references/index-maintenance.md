# Index Maintenance & Failure Modes

Deep reference for the zotero semantic-search index: MinerU internals, failure modes, recovery procedures, and reranker tuning. **Load this file when** an index update fails, wedges, or silently misses content, when a parse looks wrong, or when tuning the reranker. The usage layer lives in SKILL.md §4; service policy and embedder-wedge recovery live in `service-ops.md`.

## Index updates and MinerU

- `zotero_zotero_update_search_database()` — incremental; cheap when nothing changed.
- MinerU auto-parse: during the update, every item being (re)embedded that has a PDF and no cached sidecar is parsed by MinerU (magic-pdf, ROCm GPU) BEFORE embedding — equations become LaTeX, tables HTML, scans OCR'd. No separate OCR step. Sidecars cache at `~/.config/zotero-mcp/mineru-sidecars/<item_key>.md`; per-item parse logs at `~/.cache/zotero-mcp/mineru-work/<item_key>/run.log`.
- Previously-failed items (PDF extraction failed at some point) are auto-retried by MinerU — re-running the update rescues them.
- Expect a new paper to take ~1-2 min (text-layer) to ~30 min (scanned book) before it becomes searchable.
- Backfill: `semantic_search.mineru.backfill` in `~/.config/zotero-mcp/config.json` gates re-parsing of already-indexed items (a library-wide parse is a multi-hour GPU job — run it when the GPU is idle). Read the config for its current value rather than assuming.
- Gotcha: magic-pdf exits 0 even on failure — the hook checks that the output `.md` exists, not the exit code.

## Verify MinerU treatment of an item

- (a) the sidecar file exists for its key; (b) retrieved passages contain real LaTeX (`$$\frac{...}$$`) rather than garbled Unicode (`𝜆i,t = e x,ti𝛽`). If neither, the item is plain text-layer embedded.

## Failure modes

### Embedder wedge

See `service-ops.md` § Embedder wedge for the probe and the `podman restart embedder` fix. Summary: it can wedge at any container start, either deadlocked at 0% CPU or slow-crawling while looking healthy; always re-probe after a restart before launching a long job.

### Watchdog (self-healing long runs)

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

Docs scale with library size and with the configured chunk size, so an absolute count means little on its own — **re-chunking changes it even when nothing was lost**. Spot-check a few known items instead. Full fix: `zotero-mcp-server update-db --fulltext --force-rebuild --allow-mass-deletion` (hours on a healthy embedder; sidecars are never re-parsed).

### CPU rescue for GPU-poison PDFs

`~/.local/bin/zotero-cpu-rescue.py [item_key ...]`: PDFs that deterministically balloon GTT on the ROCm path parse cleanly on CPU (same `run_mineru()` code path → byte-identical sidecars). Run under a CPU-tuned profile (`tuned-adm`, e.g. `cpu-sustained`). Log: `~/.cache/zotero-mcp/logs/cpu-rescue.log`.

### Cap-raise / truncation fix

`~/.local/bin/zotero-cap-raise.sh`: raises `chunking.max_chunks_per_item`, chezmoi-adds the config, deletes the truncated items' docs, and re-embeds them — fixes books silently cut at the cap. Symptom of a too-low cap: every query against a long book hits its table of contents, because only the opening chunks were indexed. Read the config for the current value.

Historical narrative for these failures (GPU GTT balloon bug, slow-crawl variant, invisible gaps): `10_Projects/Local-LLMs/Memories/New-RAG-Setup.md` — provenance and evidence, not operating procedure.

## Reranker internals

- Config toggles apply live (re-read per request, no service restart): `semantic_search.reranker.{enabled,url,model,candidate_multiplier,batch_size,timeout}` in `~/.config/zotero-mcp/config.json`. Only the code patch needs a restart, and `sjust update` re-applies it after `uv tool upgrade`.
- Verify active: results reorder vs dense-only and no `HTTP reranker error` lines in the service log (`journalctl --user -u zotero-mcp.service`). A demoted references-list chunk is the classic signal that reranking is doing its job.
- Model: bge-reranker-v2-m3, ramalama `reranker` container :8083, llama.cpp `/v1/rerank`. Gotcha: `-ub` sets the PHYSICAL batch size — query+doc pairs longer than it (formula/LaTeX-heavy MinerU chunks) fail with "increase the physical batch size", so it must stay well above the default 512.
- Hybrid retrieval (BM25 + Reciprocal Rank Fusion) runs *before* the reranker, config `semantic_search.hybrid.*`. The sparse index rebuilds on each `update-db`. After a force rebuild it can be built EMPTY (the hook ran while the collection was empty) — one incremental `update_search_database` repopulates it in seconds. If it is missing, search silently falls back to dense-only with a log warning.
- Model-choice evidence and build history: `10_Projects/Local-LLMs/Memories/New-RAG-Setup.md` "Reranker: BUILT" and `Zotero-MCP.md` §5.
