---
name: zotero
description: Manage Samuel's Zotero library via the zotero MCP server — add papers by DOI/ISBN, attach local PDFs without cloud upload (zotero-link linked attachments), set correct item types (Zotero 9 has no workingPaper — use preprint), verify metadata, dedupe duplicates, export bibliographies and BibTeX for manuscripts, run semantic/structured searches, extract findings from papers, and index new items for semantic search (MinerU auto-parses PDFs before embedding). Use when working with the Zotero library, adding literature or PDFs, fixing item metadata, deduping items, citing or exporting references, searching or reading papers, or running the semantic-search index.
---

# Zotero Library Management

## Quick start

- Library: Zotero 9, data dir `~/Zotero`. PDFs are **local-only** (file sync off). **Never upload PDF bytes to Zotero cloud** — metadata sync is fine.
- MCP server: `zotero` — endpoint already configured in `~/.pi/agent/mcp.json`; don't hardcode an address. All MCP tools are named `zotero_zotero_*`.
- Gateway quirk (lazy-load race): `mcp({connect:"zotero"})` can report "configured but not connected" even while the server is up — direct calls with `server:"zotero"` ALWAYS work, so prefer them; `connect` typically succeeds on retry. Don't waste time re-diagnosing.
- **Never attach PDFs via the MCP** (`zotero_zotero_attach_file` / `add_item` with a file source / `attach_mode: auto` upload bytes). Attach with the shell helper `~/.local/bin/zotero-link <item_key> <pdf_path> [title]` — linked attachment, zero bytes.
- Create items with `zotero_zotero_add_item` by DOI/ISBN, `attach_mode: "none"` (metadata only), then `zotero-link` the PDF.
- Tools: the `[pdf]` extra (PyMuPDF) is installed — `get_pdf_outline`, `get_page_layout`, `create_annotation` are live. Better BibTeX is installed too — `search_by_citation_key` works. Check `references/library-ops.md` before using an unfamiliar tool — don't burn turns on a dependency error.

## Service preconditions (canonical — all other sections defer here)

Three services gate different capabilities. Probe before acting; policy differs per service.

| Service | Gates | Probe | If down |
|---|---|---|---|
| Embedder :8082 | Indexing AND every search (the query is embedded too) | `curl -sf -m 2 http://127.0.0.1:8082/v1/models` | **ASK Samuel** to run `serve-embedder`; never auto-start |
| Reranker :8083 | Search precision only (graceful fallback) | `curl -s -m 2 http://127.0.0.1:8083/health` | **Auto-start** `serve-reranker`, don't ask |
| Zotero desktop :23119 | Result enrichment (title/creators/page), fulltext, all writes | `pgrep -i zotero` / `ss -tln \| grep 23119` | Ask Samuel to open Zotero, or use the read-only DB fallback |

- Embedder is never auto-started: it loads a multi-GB model into unified RAM and has crashed the machine. This is an explicit standing rule, not a default to reason around.
- `Semantic search error: Connection error.` = **embedder down**, not a desktop problem. `Error enriching result for item <key>: Connection refused` = **desktop down**, non-fatal.
- Sandbox gate: run `command -v ramalama`; if empty you are in a pi-safe container and CANNOT run `serve-*` — report which service is down and ask Samuel to start it on the host, then wait for the port.
- Rationale, wedge diagnosis, and the desktop-down DB fallback: `references/service-ops.md`.

## Choosing a tool

- **Topic / concept discovery** → `zotero_zotero_semantic_search`. Scope with `collection=<8-char KEY>` whenever the user names a collection or project (`zotero_zotero_search_collections` finds keys). Hybrid BM25+RRF is on by default, so exact strings (variable names, author names, formula fragments) surface too.
- **Known string** (title/author substring) → `search_items`. **Tag** → `search_by_tag`. **Structured filter** (itemType, date ranges, "added since X") → `advanced_search`.
- **Extract numbers, SEs, table values, method details from a paper** → grep the MinerU sidecar, not fulltext. `references/deep-dive-reading.md`.
- **Read a paper whole** (synthesis, lit-review prose) → `get_item_fulltext` (desktop must be up).
- **Orient in a long PDF / find a section** → `get_pdf_outline` (bookmarks → hierarchical TOC with page numbers; only works if the PDF has embedded bookmarks — publisher PDFs and appendices usually do, scans and some journal PDFs don't).
- **Locate figures/tables geometrically** → `get_page_layout` (attachment key + 1-indexed page; returns candidate regions. Content still comes from the MinerU sidecar — this adds the coordinates).
- **Highlight or area-annotate a PDF** → `create_annotation` (area mode: normalized 0–1 rect; highlight mode: text. Pass rect OR text, not both. Write op — desktop up + sync needed).
- **Find an item from a `\citep{key}` citekey** → `search_by_citation_key` (Better BibTeX installed; keys follow BBT's author+year scheme, e.g. `atuaheneTaxedOutIllegal2018`).
- **Cite / export for a manuscript** → `export_bibliography` (APA/Chicago/BibTeX/in-text; scope it — see `references/library-ops.md`).
- Bulk tag/Extra edits, collection ops, library switching, and the unavailable-tool list: `references/library-ops.md`.

## Workflows

### 1. Adding a paper

1. `zotero_zotero_add_item(source=<DOI or ISBN>, source_type="doi"|"isbn", attach_mode="none", collections=[...])` — metadata from CrossRef. Pass `if_exists="file"` to reuse an existing DOI match instead of creating a duplicate. **ISBN adds are noisy** (Open Library → Google Books): verify the metadata afterward.
2. `zotero-link <new_key> <local/path.pdf>` (the Dropbox original is the canonical copy).
3. Verify `zotero_zotero_get_item_children(<new_key>)` shows the expected attachment(s); spot-check `get_item_fulltext`. `get_attachment_path(item_key=<PARENT key>)` returns the resolved local path — useful for hashing or sidecar work.
4. Index it with `zotero_zotero_update_search_database()` — MinerU auto-parses the PDF before embedding (§4). Check the embedder first per the preconditions table.
5. No DOI (old article): resolve via CrossRef title search (`curl "https://api.crossref.org/works?query.bibliographic=<title+author>"`) or read the PDF's first page (`pdftotext -f 1 -l 1 file.pdf -`) and verify metadata against it.

### 2. Item types (Zotero 9 — no workingPaper type)

- `journalArticle` — published articles; fill publication_title/volume/issue/pages from CrossRef.
- `preprint` — **working papers** (FEDS, NBER, job-market papers). Series → Extra (`Series: 2018-035`) or `repository`.
- `report` — institutional reports (Urban Institute, consulting, white papers). `bookSection` — chapters (set book_title/publisher). `book` — books (by ISBN). `document` — lecture notes/handouts.
- Appendix PDFs: link onto the main item as a second attachment, or retitle `Title [Online Appendix]` if top-level. Never let the recognizer parent an appendix into a duplicate paper item.
- Change type with `zotero_zotero_update_item(item_key, fields={"item_type": "..."})` (overlapping fields kept, type-specific dropped).

### 3. Duplicates (classify by content hash, never by title alone)

1. md5 every `~/Zotero/storage/<key>/*` file and the originals; group attachments by hash. `get_attachment_path` resolves linked-file paths.
2. **Identical twins** (same file imported twice — e.g. the drag-in double-import quirk) → keep one, delete the other parent **and** its child attachment (`zotero_zotero_delete_item` does NOT cascade).
3. **Appendix-matched** (appendix PDF recognized as the main paper) → keep; link/retitle as appendix — not a real duplicate.
4. **Intentional versions** (working vs published) → keep both; type differently (preprint vs journalArticle).
5. The client may auto-fetch OA PDFs for new items (stored locally) — dedupe against your links if redundant.
6. Prevention beats cleanup: `add_item(if_exists="file")` is idempotent on DOI/ISBN/URL.

### 4. Indexing

- `zotero_zotero_update_search_database()` — incremental, cheap when nothing changed. Run after any ingest; suggest it if Samuel adds items directly in Zotero desktop.
- Embedder must be up first (preconditions table). Expect a text-layer paper to be searchable in ~1-2 min, a scanned book far longer — MinerU parses before embedding, no separate OCR step.
- Check readiness/stats any time with `zotero_zotero_get_search_database_status` (doc count, model, last update, whether an update is due).
- Force rebuilds go through the CLI under `setsid`, never the MCP tool. That and all failure modes: `references/index-maintenance.md`.

### 5. Verification checklist after any ingest/cleanup

- [ ] No live standalone attachments — count `parentItemID IS NULL` **excluding trash** (a raw count is misleading; trashed attachments are legitimately parentless)
- [ ] Every item has ≥1 attachment; no filename-titled leftovers
- [ ] Type distribution sane; collection membership complete
- [ ] Fulltext works on a linked item — if `get_item_fulltext` says "File download failed", the fulltext patch was lost (run `sjust update`)
- [ ] New items indexed (`update_search_database` run; `get_search_database_status` reflects it)
- SQL for these checks (including the read-only-with-desktop-open trick): `references/service-ops.md`.

## Known quirks

- `uv tool upgrade zotero-mcp-server` wipes ALL local patches (fulltext, MinerU, reranker, scoped, sparse, instruct, toc). `sjust update` re-applies them idempotently; it also installs the `[semantic,pdf]` extras. Symptom of a lost fulltext patch: "File download failed" on a linked attachment.
- The `~/.local/bin` zotero scripts live OUTSIDE the uv package — upgrades don't touch them; they are chezmoi-tracked (restore via `chezmoi apply`).
- Zotero's local API (port 23119) is read-only for writes; all writes go through the web API and need Samuel's sync enabled.
- `get_item_fulltext` and semantic-search enrichment both fetch metadata via the web API FIRST — with desktop closed they fail before reaching the local sidecar. Retrieval itself is unaffected.
- Linked attachments created by older `zotero-link` versions carry an empty `contentType`; the script now sets it explicitly from the file extension, and the legacy empties were backfilled. All live linked attachments have a proper contentType — `create_annotation`/`get_pdf_outline` no longer claim "not a PDF". Don't re-diagnose.
- Service-level quirks (embedder wedge, sandbox absence of ramalama) → `references/service-ops.md`.
