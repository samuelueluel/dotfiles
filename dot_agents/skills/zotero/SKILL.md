---
name: zotero
description: Manage Samuel's Zotero library via the zotero MCP server — add papers by DOI/ISBN, attach local PDFs without cloud upload (zotero-link linked attachments), set correct item types (Zotero 9 has no workingPaper — use preprint), verify metadata, dedupe duplicates, export bibliographies and BibTeX for manuscripts, run semantic/structured searches, extract findings from papers, and index new items for semantic search (MinerU auto-parses PDFs before embedding). Use when working with the Zotero library, adding literature or PDFs, fixing item metadata, deduping items, citing or exporting references, searching or reading papers, or running the semantic-search index.
---

# Zotero Library Management

## Quick start

- **Storage & Ingestion:** Zotero 9, data dir `~/Zotero`. PDFs are local-only (file sync off). **Never upload PDF bytes to Zotero cloud** or attach via MCP (`zotero_zotero_attach_file`). Ingest metadata via `zotero_zotero_add_item(source=<DOI/ISBN>, attach_mode="none")`, then link the PDF with `~/.local/bin/zotero-link <item_key> <pdf_path> [title]`.
- **MCP Calls:** Server `zotero` on `http://127.0.0.1:13308/mcp`. Use direct server-scoped calls (`mcp({server:"zotero", tool, args})`) to avoid lazy gateway connect races. All tools are named `zotero_zotero_*`.
- **Subagent policy:** Zotero work is main-session only. NEVER delegate zotero tasks to subagents — they have no zotero MCP access, and curl workarounds against `127.0.0.1:13308/mcp` burn ~100k tokens. If a subagent needs zotero data, the main session fetches it via the gateway and passes results back.
- **Service Preconditions:**
  - *Embedder (:8082):* Gates indexing and search queries. **Ask Samuel** to run `serve-embedder`; **never auto-start**.
  - *Reranker (:8083):* Enhances search ranking. Auto-start via `serve-reranker` if down.
  - *Desktop (:23119):* Required for metadata enrichment and writes. If closed, use read-only SQLite URI `sqlite3 "file:$HOME/Zotero/zotero.sqlite?immutable=1"`.
  - *Never host-wide `pkill llama-server`* — terminates containerized embedder/reranker/VLM engines.

## Workflows

### 1. Adding a Paper
1. Ingest metadata: `zotero_zotero_add_item(source=<DOI or ISBN>, source_type="doi"|"isbn", attach_mode="none", if_exists="file")`.
2. Attach PDF locally: `~/.local/bin/zotero-link <new_key> <path_to_pdf>`.
3. Verify attachment: `zotero_zotero_get_item_children(<new_key>)`.
4. Index item: verify :8082 embedder is up, then create the sidecar and embed it via the sidecar pipeline below (`zotero-sidecar.sh create <KEY>` → `enrich` → `embed`).

   **Incremental guarantee:** existing items are NEVER reprocessed — two gates: (1) an existing MinerU sidecar (`~/.config/zotero-mcp/mineru-sidecars/<key>.md`) is read directly, no re-parse; (2) items with existing chunks + `has_fulltext` + unchanged attachments are skipped as "up to date". Only new items get parsed (MinerU → VLM enrichment → chunk → embed → BM25). To force a re-embed of ONE item, see the item-scoped procedure in `references/index-maintenance.md`.

### 2. Item Types & Duplicates (Zotero 9)
- **Item Types:** Use `preprint` for working papers (NBER, FEDS, JMPs); record series info in `Extra` or `repository`. Use `journalArticle` for published papers, `report` for institutional reports, `bookSection` for chapters.
- **Duplicates:** Dedupe by file content hash (MD5), never title alone. If deleting, delete parent and child attachments separately (`delete_item` does not cascade).

### 3. Searching & Retrieval (RAG)
- **Tool matrix:** `semantic_search` = conceptual topic search (hybrid BM25+RRF + cross-encoder rerank run automatically; `collection=<8-char KEY>` scopes to a collection). `advanced_search` = structured metadata filters (date ranges, item type). `search_items` = substring title/creator match (find a specific paper by name). `search_by_citation_key` / `search_by_tag` = exact citekey / tag lookup.
- **Query construction:** phrase queries as task-style instructions (the embedder prepends `Instruct: <task>`). Both titles and author/year citations are imprinted on every chunk via the DCR prefix (`[Paper: <title> (<author> <year>) | Section: <breadcrumb>]`). Use content-bearing phrasing for figure/passage lookups ("bar chart demolitions per year" or "Larson 2019 figure 1 demolitions" hits a figure schema; "what does figure 1 show" misses). Scope with `collection=<KEY>`.
- **Retrieval → answer loop:** `semantic_search` → verify the passage against the sidecar (grep; see `references/deep-dive-reading.md`) or `get_item_fulltext` (requires desktop) → synthesize + cite per the `citation-integrity` skill (verify numbers vs passage text, gate confidence on `Rerank`). Full detail: `references/search-retrieval.md`.

### 4. Post-Ingest Verification Checklist
- [ ] Count `parentItemID IS NULL` excluding trash (expect 0 standalone attachments).
- [ ] Every item has $\ge 1$ attachment; no filename-only titles.
- [ ] New items indexed (`zotero_zotero_get_search_database_status` reflects new documents).

## Creating MinerU + VLM sidecars for new PDFs (no existing sidecar)

**When:** you have new PDFs (single, several, or a whole subcollection) that lack MinerU sidecars and want them parsed + VLM-enriched + indexed. This is the ONE recipe — do not reverse-engineer it.

**Prereqs:** embedder :8082 up, VLM :8084 up (for `enrich`). Get the collection key from `references/collections.md` or `zotero_read_zotero_collections`. For long parse batches (a whole subcollection), wrap `create` in the GTT balloon watcher (below) — the create path has no built-in GTT guard.

**Pipeline = 3 cleanly-separated stages: create (MinerU parse) → enrich (VLM) → embed (index).** One command per stage:
```bash
zotero-sidecar.sh create  <COLLECTION_KEY | KEY...>   # MinerU parse ONLY -> <key>.md (GPU, background)
zotero-sidecar.sh enrich  <COLLECTION_KEY | KEY...>   # VLM [Figure Schema] blocks (needs :8084)
zotero-sidecar.sh embed   <COLLECTION_KEY...>         # chunk+embed+index NEW sidecars
zotero-sidecar.sh reembed <COLLECTION_KEY...>         # delete chunks + re-embed (changed sidecar/script)
```
- `create` runs in the background (log `~/.cache/zotero-mcp/logs/sidecar-create.log`); parses each PDF → writes `~/.config/zotero-mcp/mineru-sidecars/<key>.md`, no embedding.
- **`create` has NO built-in GTT guard** (raw GPU path, by design). On long batches run `zotero-sidecar-watch.sh` alongside it (background, launched from the same shell): it reuses the backfill watchdog's calibrated GTT logic (default 105 GB, 3 samples, 20 s) and on a genuine amdgpu GTT balloon SIGKILLs **mineru/magic-pdf children only** — create.py logs `FAIL <key>` and continues, the item is CPU-rescued later — instead of letting the machine hard-hang. See `references/index-maintenance.md` (GTT balloon / operational notes).
- `enrich` adds `[Figure Schema]` blocks to the sidecars (idempotent).
- `embed` chunks + embeds + indexes the now-final sidecars, then restarts the service.
- `reembed` deletes the target items' chunks first, then embeds — use when a sidecar was re-created/enriched after a prior embed, or when a chunker/embedding script changed.

**Scope:** `create`/`enrich` take a collection key OR explicit item keys (a group of PDFs across different collections works — pass the keys). `embed`/`reembed` take one or more collection keys (scoped so nothing outside them is touched). To embed a specific cross-collection *subset* that isn't a whole collection, add the items to a temp collection and embed that, or run unscoped `update-db --fulltext` (safe: sidecars exist + `backfill=false`, so nothing outside is re-parsed).

**When to run each (the full matrix):**
| Operation | Run when | Re-run? |
|---|---|---|
| `create` | sidecar does NOT exist | Re-create a corrupt/stale sidecar with `zotero-sidecar-create.py --force <KEY>` (deletes the old sidecar first) |
| `enrich` | sidecar already exists (it reads sidecar files; no-op if none) | Rare — idempotent, safe to re-run after VLM improvements |
| `embed` | new sidecars never embedded | No-op if already embedded (update-db skips up-to-date items) |
| `reembed` | sidecar changed after a prior embed, or a chunker/embedding script changed | As needed |

**Custom patches are inherited automatically** — these commands call the same production code paths, so the MinerU ROCm fixes (`run_mineru`) all apply. Current stack: MinerU **3.4.5** in `~/mineru-upgrade-venv`, CLI `mineru -p <pdf> -o <out> -m txt -b pipeline`; the 1.x venv `~/mineru-rocm-venv` (magic-pdf) is the CPU-rescue/fallback path. GTT guard env: `MINERU_VIRTUAL_VRAM_SIZE` — unset → batch_ratio 16 (fastest; the sidecar GTT watcher backstops genuine balloons), set `4` for conservative batch_ratio 1. OCR-det runs GPU-batched (`enable_ocr_det_batch`, torch ≥2.8) with proper `-m txt`/`ocr` gating. AST chunker + DCR breadcrumbs + hybrid filter (`update-db`), and VLM caption stamping (`zotero-vlm-enrich.py`) also apply. Search-time patches (`[date patch]` in `tools/search.py`, hybrid-filter, sparse, reranker, toc, local) are orthogonal to sidecar creation and unaffected.

## Advanced features

- **Search & Retrieval (RAG):** For query construction, retrieval limitations, and the retrieval→answer loop, see [references/search-retrieval.md](references/search-retrieval.md).
- **Deep-Dive Reading & Sidecar Extraction:** For targeted regex extraction of SEs, coefficients, and HTML table structures without desktop dependency, see [references/deep-dive-reading.md](references/deep-dive-reading.md).
- **Service Operations & DB Fallback:** For service error recovery, embedder deadlock probes, and desktop-closed SQLite queries, see [references/service-ops.md](references/service-ops.md).
- **Index Maintenance & Recovery:** For watchdog runs, pause/resume protocols, VLM schema enrichment, retrieval hygiene filters, and store recovery, see [references/index-maintenance.md](references/index-maintenance.md).
- **Library Operations & Tool Reference:** For manuscript BibTeX exports, citekey lookups, annotations, and bulk metadata tagging, see [references/library-ops.md](references/library-ops.md).
- **Collection Scopes:** For fast collection key lookups (`Detroit-Paper`, `Methods`, etc.) and scoping rules, see [references/collections.md](references/collections.md).
