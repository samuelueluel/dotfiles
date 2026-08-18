---
name: zotero
description: Manage Samuel's Zotero library via the zotero MCP server — add papers by DOI/ISBN, attach local PDFs without cloud upload (zotero-link linked attachments), set correct item types (Zotero 9 has no workingPaper — use preprint), verify metadata, dedupe duplicates, export bibliographies and BibTeX for manuscripts, run semantic/structured searches, extract findings from papers, and index new items for semantic search (MinerU auto-parses PDFs before embedding). Use when working with the Zotero library, adding literature or PDFs, fixing item metadata, deduping items, citing or exporting references, searching or reading papers, or running the semantic-search index.
---

# Zotero Library Management

## Quick start

- **Storage & Ingestion:** Zotero 9, data dir `~/Zotero`. PDFs are local-only (file sync off). **Never upload PDF bytes to Zotero cloud** or attach via MCP (`zotero_zotero_attach_file`). Ingest metadata via `zotero_zotero_add_item(source=<DOI/ISBN>, attach_mode="none")`, then link the PDF with `~/.local/bin/zotero-link <item_key> <pdf_path> [title]`.
- **MCP Calls:** Server `zotero` on `http://127.0.0.1:13308/mcp`. Use direct server-scoped calls (`mcp({server:"zotero", tool, args})`) to avoid lazy gateway connect races. All tools are named `zotero_zotero_*`.
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
4. Index item: verify :8082 embedder is up, then call `zotero_zotero_update_search_database()`. MinerU automatically parses PDF before embedding.

   ~={green}Incremental guarantee:=~ existing items are NEVER reprocessed — two gates: (1) an existing MinerU sidecar (`~/.config/zotero-mcp/mineru-sidecars/<key>.md`) is read directly, no re-parse; (2) items with existing chunks + `has_fulltext` + unchanged attachments are skipped as "up to date". Only new items get parsed (MinerU → VLM enrichment → chunk → embed → BM25). To force a re-embed of ONE item, see the item-scoped procedure in `references/index-maintenance.md`.

### 2. Item Types & Duplicates (Zotero 9)
- **Item Types:** Use `preprint` for working papers (NBER, FEDS, JMPs); record series info in `Extra` or `repository`. Use `journalArticle` for published papers, `report` for institutional reports, `bookSection` for chapters.
- **Duplicates:** Dedupe by file content hash (MD5), never title alone. If deleting, delete parent and child attachments separately (`delete_item` does not cascade).

### 3. Topic Search & Reading
- **Topic Search:** `zotero_zotero_semantic_search(query=<text>, collection=<8-char KEY>, limit=10)`. Hybrid BM25+RRF and cross-encoder reranking run automatically.
- **Targeted Fact Extraction:** Grep MinerU sidecars (`~/.config/zotero-mcp/mineru-sidecars/<item_key>.md`) directly for regression coefficients, standard errors, and HTML tables without loading full text into context.
- **Holistic Reading:** Use `zotero_zotero_get_item_fulltext(item_key)` (requires desktop) or inspect bookmarks with `zotero_zotero_get_pdf_outline`.

### 4. Post-Ingest Verification Checklist
- [ ] Count `parentItemID IS NULL` excluding trash (expect 0 standalone attachments).
- [ ] Every item has $\ge 1$ attachment; no filename-only titles.
- [ ] New items indexed (`zotero_zotero_get_search_database_status` reflects new documents).

## Advanced features

- **Deep-Dive Reading & Sidecar Extraction:** For targeted regex extraction of SEs, coefficients, and HTML table structures without desktop dependency, see [references/deep-dive-reading.md](references/deep-dive-reading.md).
- **Service Operations & DB Fallback:** For service error recovery, embedder deadlock probes, and desktop-closed SQLite queries, see [references/service-ops.md](references/service-ops.md).
- **Index Maintenance & Recovery:** For watchdog runs, pause/resume protocols, VLM schema enrichment, retrieval hygiene filters, and store recovery, see [references/index-maintenance.md](references/index-maintenance.md).
- **Library Operations & Tool Reference:** For manuscript BibTeX exports, citekey lookups, annotations, and bulk metadata tagging, see [references/library-ops.md](references/library-ops.md).
- **Collection Scopes:** For fast collection key lookups (`Detroit-Paper`, `Methods`, etc.) and scoping rules, see [references/collections.md](references/collections.md).
