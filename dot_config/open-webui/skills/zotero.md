---
name: zotero
description: Manage Samuel's Zotero library in Open WebUI — search, fulltext, metadata, citations, and item ingestion via zotero_* MCP tools. Use when searching papers, retrieving literature, extracting findings, or managing Zotero library items in Open WebUI.
---

# Zotero Library Management (Open WebUI)

## Quick start

- **Library:** Zotero 9, data dir `~/Zotero`. PDFs are **local-only** (file sync off). **Never upload PDF bytes to Zotero cloud** — metadata sync is fine.
- **MCP Tools:** Served over loopback HTTP (`http://127.0.0.1:13308/mcp`). Tools are prefixed as `zotero_*` (e.g. `zotero_semantic_search`, `zotero_get_item_fulltext`). Enable the `zotero` toolset in Open WebUI (➕ → Integrations → Tools).
- **Ingestion:** Create items via `zotero_add_item(source=<DOI/ISBN>, source_type="doi"|"isbn", attach_mode="none")` for metadata-only creation.

## Service Preconditions

Three background services gate different capabilities. Check before troubleshooting:

| Service | Gates | Endpoint / Check | If Down |
|---|---|---|---|
| Embedder :8082 | Semantic search & DB updates | `http://127.0.0.1:8082/v1/models` | **Ask Samuel** to run `serve-embedder`; never auto-start |
| Reranker :8083 | RERANK precision (dense+BM25 fallback) | `http://127.0.0.1:8083/health` | Auto-degrades to dense+BM25 gracefully if down |
| Zotero Desktop :23119 | Result title/creator enrichment & fulltext | `pgrep -i zotero` | Ask Samuel to open Zotero desktop app |

- `Semantic search error: Connection error.` = **embedder :8082 down**, not a desktop issue.
- `Error enriching result for item <key>` = **desktop down**, retrieval results are still returned.

## Choosing a Tool

- **Topic / Concept Search** → `zotero_semantic_search`. Scope with `collection=<8-char KEY>` when searching a specific project (`zotero_search_collections` finds collection keys). Backed by dense vector + BM25 hybrid ranking and cross-encoder reranking.
- **Known Title / Author** → `zotero_search_items`. **Tag** → `zotero_search_by_tag`. **Structured Filter** → `zotero_advanced_search`.
- **Citekey Search** → `zotero_search_by_citation_key` (Better BibTeX installed; keys use author+year scheme, e.g. `atuaheneTaxedOutIllegal2018`).
- **Read Full Paper** → `zotero_get_item_fulltext` (prefers MinerU OCR/LaTeX sidecars when available).
- **Orient in PDF / Document TOC** → `zotero_get_pdf_outline`.
- **Export Bibliography** → `zotero_export_bibliography` (APA/Chicago/BibTeX).

## Workflows & Best Practices

### 1. Ingesting & Indexing New Papers
1. `zotero_add_item(source=<DOI or ISBN>, source_type="doi"|"isbn", attach_mode="none", collections=[...])` — metadata from CrossRef. Pass `if_exists="file"` to reuse an existing DOI match.
2. Index with `zotero_update_search_database()` (requires embedder `:8082` running). MinerU automatically parses PDF text/tables/LaTeX before embedding.

### 2. Item Types (Zotero 9)
- `journalArticle` — published articles.
- `preprint` — **working papers** (FEDS, NBER, job-market papers). Series → Extra (`Series: 2018-035`) or `repository`.
- `report` — institutional white papers. `bookSection` — chapters. `book` — books by ISBN.
- Update item type via `zotero_update_item(item_key, fields={"item_type": "..."})`.

### 3. Verification Checklist
- Confirm items have attachments (`zotero_get_item_children`).
- Verify fulltext extraction works (`zotero_get_item_fulltext`).
- Verify citekey resolution (`zotero_search_by_citation_key`).
