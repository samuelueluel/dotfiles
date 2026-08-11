---
name: zotero
description: Manage Samuel's Zotero library via the zotero MCP server — add papers by DOI/ISBN, attach local PDFs without cloud upload (zotero-link linked attachments), set correct item types (Zotero 9 has no workingPaper — use preprint), verify metadata, dedupe duplicates, index new items for semantic search (MinerU auto-parses PDFs before embedding), and organize collections. Use when working with the Zotero library, adding literature or PDFs, fixing item metadata, deduping items, or running the semantic-search index.
---

# Zotero Library Management

## Quick start

- Library: Zotero 9.0.6, data dir `~/Zotero`. PDFs are **local-only** (file sync off). **Never upload PDF bytes to Zotero cloud** — metadata sync is fine.
- MCP server: `zotero` — endpoint already configured in `~/.pi/agent/mcp.json`; don't hardcode an address. If a direct call needs the host IP, resolve it at runtime (`hostname -I | awk '{print $1}'`). All MCP tools are named `zotero_zotero_*`.
- Gateway quirk (lazy-load race): `mcp({connect:"zotero"})` can report "configured but not connected" even while the server is up — direct calls with `server:"zotero"` ALWAYS work, so prefer them; `connect` typically succeeds on retry. Don't waste time re-diagnosing (verified 2026-08-10+).
- **Never attach PDFs via the MCP** (`zotero_zotero_attach_file` / `zotero_zotero_add_item` with a file source / `attach_mode: auto` upload bytes). Attach with the shell helper `~/.local/bin/zotero-link <item_key> <pdf_path> [title]` — linked attachment, zero bytes.
- Create items with `zotero_zotero_add_item` by DOI/ISBN, `attach_mode: "none"` (metadata only), then `zotero-link` the PDF.
- Reference: `10_Projects/Local-LLMs/Agents/Pi/General-Tooling.md` §3.2.2–3.2.5; MinerU machinery in `10_Projects/Local-LLMs/Memories/New-RAG-Setup.md`; library plan in `10_Projects/Local-LLMs/Memories/Literature-Knowledge-Todos.md`.

## Workflows

### 1. Adding a paper

1. `zotero_zotero_add_item(source=<DOI or ISBN>, source_type="doi"|"isbn", attach_mode="none", collections=[...])` — metadata from CrossRef. **ISBN adds are noisy** (Open Library → Google Books): verify the metadata afterward.
2. `zotero-link <new_key> <local/path.pdf>` (the Dropbox original is the canonical copy).
3. Verify `zotero_zotero_get_item_children(<new_key>)` shows the expected attachment(s); spot-check `zotero_zotero_get_item_fulltext` (works on linked files only because of the fulltext patch — see Known quirks).
4. Run `zotero_zotero_update_search_database()` to index it — MinerU auto-parses the PDF before embedding (see §4). Check `model-check` first; the :8082 embedder must be up.
5. No DOI (old article): resolve via CrossRef title search (`curl "https://api.crossref.org/works?query.bibliographic=<title+author>"`) or read the PDF's first page (`pdftotext -f 1 -l 1 file.pdf -`) and verify the metadata against it.

### 2. Item types (Zotero 9 — no workingPaper type)

- `journalArticle` — published articles; fill publication_title/volume/issue/pages from CrossRef.
- `preprint` — **working papers** (FEDS, NBER, job-market papers). Series → Extra (`Series: 2018-035`) or `repository`.
- `report` — institutional reports (Urban Institute, consulting, white papers). `bookSection` — chapters (set book_title/publisher). `book` — books (by ISBN). `document` — lecture notes/handouts.
- Appendix PDFs: link onto the main item as a second attachment, or retitle `Title [Online Appendix]` if top-level. Never let the recognizer parent an appendix into a duplicate paper item.
- Change type with `zotero_zotero_update_item(item_key, fields={"item_type": "..."})` (overlapping fields kept, type-specific dropped).

### 3. Duplicates (classify by content hash, never by title alone)

1. md5 every `~/Zotero/storage/<key>/*` file and the originals; group attachments by hash.
2. **Identical twins** (same file imported twice — e.g. the drag-in double-import quirk) → keep one, delete the other parent **and** its child attachment (`zotero_zotero_delete_item` does NOT cascade).
3. **Appendix-matched** (appendix PDF recognized as the main paper) → keep; link/retitle as appendix — not a real duplicate.
4. **Intentional versions** (working vs published) → keep both; type differently (preprint vs journalArticle).
5. The client may auto-fetch OA PDFs for new items (stored locally) — dedupe against your links if redundant.

### 4. Semantic search indexing & MinerU (auto-parse before embedding)

- Index new/changed items with `zotero_zotero_update_search_database()` — incremental, cheap when nothing changed. Run it after any ingest (step 4 of §1); suggest it if the user adds items directly in Zotero desktop.
- ~={green}MinerU auto-parse:=~ during the update, every item being (re)embedded that has a PDF and no cached sidecar is parsed by MinerU (magic-pdf, ROCm GPU) BEFORE embedding — equations become LaTeX, tables HTML, scans OCR'd. No separate OCR step. Sidecars cache at `~/.config/zotero-mcp/mineru-sidecars/<item_key>.md`; per-item parse logs at `~/.cache/zotero-mcp/mineru-work/<item_key>/run.log`.
- ~={green}Before an update, ensure the embedder is up=~: check `model-check`; if :8082 is down, ~={green}auto-start it with `serve-embedder` (do NOT ask the user)=~ and wait until it responds, then run the update. If the start fails or the update still reports the embedder unreachable, include the actionable warning in your reply ("start `serve-embedder`, then re-run"). MinerU parses complete even with the embedder down and sidecars are saved, so a re-run never re-parses. Expect a new paper to take ~1-2 min (text-layer) to ~30 min (scanned book) before it becomes searchable.
- Previously-failed items (PDF extraction failed at some point) are auto-retried by MinerU — re-running the update rescues them.
- Query with `zotero_zotero_semantic_search(query)` — covers MinerU'd and plain-embedded content alike. ~={green}Collection scoping:=~ pass `collection=<8-char KEY>` to restrict to one collection (subcollections included, resolved from the local DB); find keys with `zotero_search_collections`. Use it whenever the user names a collection/project/workspace to search within. Out of scope: results only from that collection, and the relevance score correctly drops if the match is weak (built 2026-08-10, `[scoped patch]`).
- ~={green}Hybrid search (BM25 + RRF) is on by default=~ (config `semantic_search.hybrid.enabled`): dense + keyword results are fused by rank before the reranker, so exact-match terms that dense embeddings miss (variable names, model acronyms, formula fragments, author names) can still surface. No per-query step; the sparse index rebuilds automatically on `zotero_update_search_database`. If the index is missing, search falls back to dense-only with a log warning (built 2026-08-11, `[sparse patch]`).
- ~={green}Verify MinerU treatment of an item:=~ (a) the sidecar file exists for its key; (b) retrieved passages contain real LaTeX (`$$\frac{...}$$`) rather than garbled Unicode (`𝜆i,t = e x,ti𝛽`). If neither, the item is plain text-layer embedded.
- Backfill: `semantic_search.mineru.backfill` in `~/.config/zotero-mcp/config.json` gates re-parsing of already-indexed items (one-time library-wide parse ~2-4 h parse + ~1-3 h embedding — run when GPU idle; `enabled: true` by default).

### 5. Verification checklist after any ingest/cleanup

- [ ] No standalone attachments (DB: `parentItemID IS NULL` count = 0)
- [ ] Every item has ≥1 attachment; no filename-titled leftovers
- [ ] Type distribution sane; collection membership complete
- [ ] Fulltext works on a linked item — if `zotero_zotero_get_item_fulltext` says "File download failed", the fulltext patch was lost (run `sjust update`, or re-apply `zotero-mcp-patch.py` to `tools/retrieval.py`)
- [ ] New items indexed (`zotero_zotero_update_search_database` run; embedder up)

### 6. Index maintenance scripts & failure modes

- ~={green}The watchdog=~ `~/.local/bin/zotero-backfill-watchdog.sh` — self-healing runner for long `update-db` runs. Guards: (1) GTT balloon — SIGKILLs magic-pdf when amdgpu GTT >50 GB (update-db falls back to text-layer and continues); (2) embedder deadlock (0% CPU, stale log) — restarts embedder + update-db; (3) embedder slow-crawl (≥5 accumulating `saving for retry` / `Error upserting` lines) — same recovery. Launch: `setsid nohup ~/.local/bin/zotero-backfill-watchdog.sh > /dev/null 2>&1 < /dev/null &`. Exits with `=== BACKFILL COMPLETE ===` when the run's stats summary (`Database update completed:`) appears. Logs: `~/.cache/zotero-mcp/logs/backfill-run.log` (progress) + `backfill-watchdog.log` (heartbeat every ~5 min: `hb: ... emb_cpu=... upsert_fails=... gtt=...`).
- ~={orange}Embedder wedge (the recurring gremlin)=~: the :8082 llama-server can wedge at ANY container start — deadlock (0% CPU, ignores SIGTERM) or slow-crawl (looks healthy by CPU/GPU, but ~24 s per tiny embedding and upserts fail). Probe: tiny `curl -s localhost:8082/v1/embeddings` — healthy ≈0.3 s, wedged ≈20 s+. Fix: `podman restart embedder` (may need SIGKILL). Verify with the probe after any restart, before long jobs.
- ~={orange}Invisible gaps=~: incremental runs judge "up to date" by item METADATA, not doc counts — after a crawl or interrupted run, chunks can be missing while runs report success. Verify completeness by doc count (ChromaDB: `~/.config/zotero-mcp/chroma_db`, collection `zotero_library`): `~/.local/share/uv/tools/zotero-mcp-server/bin/python -c "import chromadb,pathlib; c=chromadb.PersistentClient(path=str(pathlib.Path.home()/'.config/zotero-mcp/chroma_db')); print(c.get_collection('zotero_library').count())"` (full 92-item library ≈ 9,735 docs). Full fix: `zotero-mcp-server update-db --fulltext --force-rebuild --allow-mass-deletion` (~1-2 h on a healthy embedder; sidecars never re-parsed).
- ~={orange}CPU rescue for GPU-poison PDFs=~ `~/.local/bin/zotero-cpu-rescue.py [item_key ...]`: PDFs that deterministically balloon GTT on the ROCm path parse cleanly on CPU (same `run_mineru()` code path → byte-identical sidecars). Run under a CPU-tuned profile (`tuned-adm`, e.g. `cpu-sustained`). Log: `~/.cache/zotero-mcp/logs/cpu-rescue.log`.
- ~={green}Cap-raise / truncation fix=~ `~/.local/bin/zotero-cap-raise.sh`: raises `chunking.max_chunks_per_item` (1000 → 3000), chezmoi-adds the config, deletes the truncated items' docs, and re-embeds them — fixes books silently cut at the old cap.
- Config state (2026-08-10): `semantic_search.mineru.backfill: false`, `chunking.max_chunks_per_item: 3000`, index complete (~9,735 docs / 92 items). Full failure-mode history: `10_Projects/Local-LLMs/Memories/New-RAG-Setup.md` (GPU GTT balloon bug, Slow-crawl variant, Invisible gaps sections).

## 7. Reranker (cross-encoder precision stage, built 2026-08-10)

Semantic search optionally reranks candidates with a cross-encoder before returning them. ~={green}Automatic once the container is up:=~ `zotero_zotero_semantic_search` includes the reranker on every query when it's running — no per-query step, no tool arg.

- ~={green}Samuel's default: reranker ON for almost every search.=~ Before running `zotero_zotero_semantic_search`, check :8083 (`curl -s -m 2 http://127.0.0.1:8083/health` or `model-check`); if down, ~={green}auto-start it with `serve-reranker` (do NOT ask the user)=~ and wait until it responds, then search. If it still won't start, search anyway (dense-only fallback is fine) and mention it in the reply.

- ~={green}Turn on:=~ `serve-reranker` (ramalama `reranker` container, :8083, bge-reranker-v2-m3 Q8_0, llama.cpp `/v1/rerank`). Adds ~1 s per search and demotes dense false positives (verified 2026-08-10: a references-list chunk that ranked #1 on dense-only dropped to #5).
- ~={green}Turn off / reranker down:=~ search still works — falls back to dense-only ordering and logs `HTTP reranker error ... returning unreranked order` in `journalctl --user -u zotero-mcp.service` (harmless, graceful).
- ~={green}Config toggles apply live=~ (re-read per request, no service restart): `semantic_search.reranker.{enabled,url,model,candidate_multiplier,batch_size,timeout}` in `~/.config/zotero-mcp/config.json`. Only the code patch needs a restart, and `sjust update` re-applies it after `uv tool upgrade`.
- Verify active: results reorder vs dense-only and no `HTTP reranker error` lines in the service log.
- Details (model choice evidence, `-ub 2048` physical-batch gotcha, client batching): Zotero-MCP §5 and `10_Projects/Local-LLMs/Memories/New-RAG-Setup.md` "Reranker: BUILT".

## Known quirks

- `uv tool upgrade zotero-mcp-server` wipes BOTH patches — the linked-file fulltext patch (`[local patch]`) AND the auto-MinerU patch (`[mineru patch]`). `sjust update` re-applies both idempotently (`zotero-mcp-patch.py` + `zotero-mcp-mineru-patch.py` in the turquoise repo; markers `[local patch]` / `[mineru patch]`).
- The watchdog's completion check matches `Database update completed:` — update-db NEVER prints the literal `Update completed` (that string only exists in the self-`update` command).
- The `~/.local/bin` index scripts live OUTSIDE the uv package — `uv tool upgrade zotero-mcp-server` does not touch them; they are chezmoi-tracked (restore via `chezmoi apply`).
- `zotero_zotero_get_attachment_path` requires local mode (unavailable on the hybrid server) — use `zotero_zotero_get_item_children` for filenames.
- Zotero's local API (port 23119) is read-only for writes; fine for reads.
- `zotero_zotero_get_item_fulltext` fetches item metadata via the web API first — if Zotero desktop/API is unreachable it errors out before the local sidecar path is reached (pre-existing flow; not a MinerU regression).
- `zotero_zotero_semantic_search` result ENRICHMENT has the same dependency: without Zotero desktop/API up it logs `Error enriching result for item <key>: Connection refused` and returns passages with `item_key`/`chunk_index`/char offsets but NO title/creators/page/citation — retrieval itself is unaffected (verified 2026-08-10).
  - **If enrichment matters** (want title/creators/page/citation in results) **and Zotero desktop is closed: ask Samuel to open Zotero, then re-run the query.** Check desktop state with `pgrep -i zotero` / `ss -tln | grep 23119`.
  - **Fallback when desktop is down:** identify hit items read-only from the local DB — `sqlite3 ~/Zotero/zotero.sqlite`, joining `items`→`itemData`→`itemDataValues`+`fields` (title/DOI/journal/date) and `items`→`itemCreators`→`creators`+`creatorTypes` (authors); safe with desktop closed (no lock contention). Read full text from the MinerU sidecar `~/.config/zotero-mcp/mineru-sidecars/<item_key>.md`, since `get_item_fulltext` has the same web-API-first dependency.
