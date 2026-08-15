---
name: zotero
description: Manage Samuel's Zotero library in Open WebUI — semantic and structured search, fulltext, metadata, citations, item ingestion, and indexing via the zotero_* MCP tools. Use when searching papers, retrieving literature, extracting findings, citing or exporting references, or managing Zotero library items in Open WebUI.
---

# Zotero Library Management (Open WebUI)

## Quick start

- **Library:** Zotero 9, data dir `~/Zotero`. PDFs are **local-only** (file sync off). **Never upload PDF bytes to Zotero cloud** — metadata sync is fine.
- **MCP tools:** served over loopback HTTP (`http://127.0.0.1:13308/mcp`), prefixed `zotero_*` (e.g. `zotero_semantic_search`, `zotero_get_item_fulltext`). Enable the `zotero` toolset in Open WebUI (➕ → Integrations → Tools). Exact names may vary with the MCP prefix — match what the toolset exposes.
- **Attachments:** Open WebUI agents work **metadata-only**. Samuel links PDFs on the host with `zotero-link <item_key> <pdf>` (linked attachment, zero bytes). Always pass `attach_mode="none"`; never attach files via MCP. If a paper needs its PDF, create the item and ask Samuel to link it.
- **Indexing:** after adding items, run `zotero_update_search_database` (embedder must be up). MinerU auto-parses PDFs (text, tables, LaTeX) before embedding.

## Known collections (scope searches directly)

| Collection | Key |
|---|---|
| Detroit-Paper | `TRGBCDX5` |
| Methods | `2QWMWY2P` |
| Programming | `YKQ7724G` |
| Test-collection | `7UU8LJJ5` |

No subcollections as of last refresh. `collection=<KEY>` scopes semantic search to the collection **and its subcollections**. Refresh the map with `zotero_read_zotero_collections` (no args, returns name → key → count); keys are stable per library until a collection is deleted/recreated — re-verify after reorganizations. For names not listed, use `zotero_search_collections` and record the key.

## Service preconditions

| Service | Gates | If down |
|---|---|---|
| Embedder :8082 | Semantic search **and** index updates (the query is embedded too) | **Ask Samuel** to run `serve-embedder` — never auto-start; it loads a multi-GB model into RAM and has crashed the machine |
| Reranker :8083 | Search precision only (graceful fallback) | Auto-degrades to dense+BM25 |
| Zotero desktop :23119 | Result title/creator enrichment, fulltext | Ask Samuel to open the Zotero desktop app |

- `Semantic search error: Connection error.` = **embedder down**, not a desktop problem.
- `Error enriching result for item <key>` = **desktop down**; retrieval results are still returned.
- Open WebUI agents cannot run `serve-*` commands or `curl` — if a service is down, report which one and ask Samuel to start it.

## Choosing a tool

- **Topic / concept** → `zotero_semantic_search(query, collection=<KEY>, limit, filters, library_id)` — best for topics; hybrid BM25+RRF means exact strings (variable names, author names, formula fragments) surface too.
- **Known title / author** → `zotero_search_items(query, qmode="titleCreatorYear", tag, collection_key)`.
- **Tag** → `zotero_search_by_tag(tag=["a OR b", "-exclude"], collection_key)`. **Structured filter** → `zotero_advanced_search(conditions, join_mode="all"|"any", sort, limit)`.
- **Citekey** → `zotero_search_by_citation_key` (Better BibTeX installed; keys follow author+year, e.g. `atuaheneTaxedOutIllegal2018`).
- **Read a paper / extract content** → `zotero_get_item_fulltext(item_key)` (desktop must be up). When quoting equations or numbers from a paper, quote them exactly from the tool result — never fabricate. Wrap quoted math in `$...$` (Open WebUI renders KaTeX).
- **Orient in a long PDF** → `zotero_get_pdf_outline(item_key)` (works only with embedded bookmarks). **Figure/table coordinates** → `zotero_get_page_layout(attachment_key, page)` (1-indexed).
- **Bibliography** → `zotero_export_bibliography(item_keys or collection_key, style, export_format="bib"|"citation"|"bibtex")` — scope it; cap is 100 items per call.

## Workflows

### 1. Adding a paper
1. `zotero_add_item(source=<DOI or ISBN>, source_type="doi"|"isbn", attach_mode="none", collections=[...], if_exists="file")` — metadata from CrossRef; `if_exists="file"` reuses an existing DOI match instead of creating a duplicate.
2. Ask Samuel to link the PDF (`zotero-link <new_key> <path.pdf>`) — the Dropbox original is the canonical copy.
3. Verify: `zotero_get_item_children(<new_key>)` shows the expected attachment; spot-check `zotero_get_item_fulltext`.
4. Index it: `zotero_update_search_database()` — check the embedder first (preconditions table).
5. **ISBN adds are noisy** (Open Library → Google Books) — verify the metadata afterward. **No DOI?** resolve via a web search of CrossRef, or ask Samuel for the PDF's first page.

### 2. Item types (Zotero 9 — no workingPaper type)
- `journalArticle` — published articles (fill publication_title/volume/issue/pages).
- `preprint` — **working papers** (FEDS, NBER, job-market). Series → Extra (`Series: 2018-035`) or `repository`.
- `report` — institutional white papers. `bookSection` — chapters (set book_title/publisher). `book` — books by ISBN. `document` — lecture notes/handouts.
- Change type with `zotero_update_item(item_key, fields={"item_type": "..."})`.

### 3. Duplicates
- **Prevent:** `if_exists="file"` is idempotent on DOI/ISBN.
- **Identical twins** (same file imported twice) → keep one; delete the other parent **and** its child attachment (`zotero_delete_item` does NOT cascade).
- **Working vs published** → keep both; type differently (preprint vs journalArticle).
- Never dedupe by title alone.

### 4. Indexing
- `zotero_update_search_database()` — incremental, cheap when nothing changed. Run after any ingest; suggest it if Samuel adds items directly in desktop.
- Check readiness any time: `zotero_get_search_database_status` (doc count, model, last update).
- Expect a text-layer paper searchable in ~1–2 min, a scanned book far longer (MinerU parses before embedding; no separate OCR step).

## Known quirks

- `uv tool upgrade zotero-mcp-server` wipes ALL local patches (fulltext, MinerU, reranker, scoped, sparse, instruct, toc). `sjust update` re-applies them. Symptom of a lost fulltext patch: `get_item_fulltext` says "File download failed" → tell Samuel to run `sjust update`.
- `get_item_fulltext` and semantic-search enrichment both fetch metadata via the web API FIRST — with desktop closed they fail before reaching the local sidecar. Retrieval itself is unaffected.
- Linked attachments created by older `zotero-link` versions carry an empty `contentType`; the script now sets it and legacy empties were backfilled. Don't re-diagnose "not a PDF" complaints from `create_annotation`/`get_pdf_outline`.
- Zotero's local API (port 23119) is read-only for writes; all writes go through the web API and need Samuel's sync enabled.

## Verification checklist (tool-based)

- [ ] New items indexed — `get_search_database_status` reflects them after `update_search_database`
- [ ] Every item has ≥1 attachment (`get_item_children`); no filename-titled leftovers
- [ ] Fulltext works on a linked item
- [ ] Citekey resolves (`search_by_citation_key`)
- [ ] Type distribution and collection membership match expectations
