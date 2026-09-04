# Library Operations & Metadata Management

**Load this file when** ingesting PDFs, exporting manuscript bibliographies, managing annotations, running bulk updates, or filing course materials.

## Extended Tool Capabilities

Pi exposes every Zotero MCP tool with one gateway-qualified `zotero_*` prefix. The transport-specific connector tools are `zotero_search` and `zotero_fetch`:

| Tool | Capability | Notes |
|---|---|---|
| `zotero_get_pdf_outline` | PDF Table of Contents | Extracts TOC bookmarks via PyMuPDF in an isolated child process. |
| `zotero_detect_pdf_regions` | Figure/Table Geometry | Extracts coordinate bounding boxes (1-indexed pages). |
| `zotero_create_annotation` | Highlight & Area Notes | Writes annotations directly to Zotero SQLite database. |
| `zotero_find_item_by_citation_key` | Better BibTeX Lookup | Resolves citekeys (e.g., `\citep{baumsnow2020}`). |
| `zotero_compile_annotation_digest` | Collection Annotations | Compiles highlights and notes grouped by paper across a collection. |

*Annotation Storage Note:* Highlights made in external PDF viewers (e.g., Okular) remain embedded in Dropbox PDF files and are read-only in Zotero. Only annotations created in Zotero Desktop or via `create_annotation` populate SQLite tables.

## CSL Manuscript Exports

Generate formatted citations via `zotero_export_bibliography`:
- `export_format`: `"bib"` (reference list), `"citation"` (in-text citations), `"bibtex"` (raw entries).
- `style`: CSL style identifier (e.g., `"apa"`, `"chicago-author-date"`, `"modern-language-association"`, `"ieee"`). Ignored for `"bibtex"`.
- `item_keys` / `collection_key`: Scope queries explicitly. Avoid unconstrained whole-library exports.

## Mutation Target Lookup

Resolve the exact target before changing library data. Use `zotero_find_item_by_citation_key` for a Better BibTeX key, `zotero_search_items` for a known author/title fragment, `zotero_search_items_by_tag` for tags, or `zotero_search_items_advanced` for filtered metadata. Semantic search may discover candidates but cannot bind an ambiguous mutation target.

`zotero_search_items_by_tag` ANDs list entries, accepts `OR`/`||` within one entry, and uses a leading `-` for exclusion; its default `item_type="-attachment"` excludes attachments. Metadata search and `get_item_metadata` reflect successful API tag writes immediately. Semantic tag filters instead read the local SQLite snapshot and may remain stale until Zotero Desktop closes and its WAL checkpoints.

### Advanced Search & Date Filters
`zotero_search_items_advanced` takes conditions formatted as `[{field, operation, value}]` with `join_mode: "all"|"any"`. Supported operations include: `is`, `isNot`, `contains`, `doesNotContain`, `beginsWith`, `endsWith`, `isGreaterThan`, `isLessThan`, `isBefore`, `isAfter`.

- **Date comparisons** (`isAfter`, `isBefore`, etc.) compare dates numerically across formats (`"5/2018"`, `"08/2024"`, `"2023"`, `"2019-09-01"`).
- Underspecified dates resolve inclusively (`date isAfter "2023-01-01"` includes 2023-dated items). Items without dates never match date filters.
- Use `year` to filter specifically on the 4-digit year.

## Attachment Resolution & Bulk Updates

- **Attachment Paths:** `zotero_get_attachment_paths(item_key=...)` takes the parent key and returns the `file://` URI and local filesystem path.
- **Child Records:** `zotero_list_item_children(item_key)` lists child attachment keys, titles, and MIME types.
- **Bulk Updates:** `zotero_batch_edit_tags_and_extra` modifies multiple records simultaneously:
  - `add_tags` / `remove_tags`: Modifies tags additively/subtractively. Prefer these incremental fields; `zotero_update_item(tags=...)` replaces the complete tag list.
  - `set_keys` / `remove_keys`: Updates key-value lines in the `Extra` field without erasing citekeys.

## Lecture Notes & Course Materials Standard

When filing lecture notes or textbooks into `Methods` (`2QWMWY2P`) or `Mathematics` (`C8JGJRG7`):

- **Item Type:** `manuscript` for personal/unpublished compiled notes, `report` for institution-issued notes, `book` for published textbooks/excerpts, and `presentation` for slide decks. Never use Zotero `note` for a PDF or duplicate a native itemType as a tag.
- **Title Format:** `Course: Lecture N — Topic` (e.g., `Econ 715: Lecture 3 — Consistency of Extremum Estimators`); plain title for compiled notes or books.
- **Extra Field (structured lines):** `Type: Lecture Notes|Slides`, `Course: <code> <name>`, `Institution:`, `Instructor:`, `URL:`. Upsert via `zotero_batch_edit_tags_and_extra(set_keys=...)`.
- **Date:** Year of the course offering/version (e.g., `2017`).
- **Tags:** Use only `review:unreviewed`, `review:skimmed`, or `review:checked`, plus missing-subtype tags such as `type:lecture-notes` or `type:textbook` when needed. Do not create credibility, standing, research-role, publication-status, or subject tags.
- **Attachments:** Use `zotero-link` to attach local Dropbox PDFs; never upload raw bytes to cloud storage.

## Ingestion, Audit & Lifecycle CLI (`zotero-auto-ingest`)

`~/.local/bin/zotero-auto-ingest` provides a deterministic ingestion and metadata resolution pipeline:

### 1. Ingesting Local Bare PDFs (Explicit Request Only)
- **Single PDF:** `zotero-auto-ingest <path_to_pdf> [--collection <KEY>]`
- **Batch Directory:** `zotero-auto-ingest ~/Downloads/papers/*.pdf [--collection <KEY>]`
- **Execution Steps:**
  1. PyMuPDF extracts Page-1 DOI (`10.xxxx/...`), arXiv, or ISBN.
  2. Queries Crossref REST API for official metadata (authors, journal, volume, issue, pages).
  3. If DOI is missing, queries OpenAlex API with candidate title (Levenshtein match >0.85).
  4. Creates Zotero record (`preprint` for working papers, `journalArticle` for published articles).
  5. Better BibTeX auto-assigns citekey (e.g., `\citep{baumsnow2020}`).
  6. Executes `zotero-link` to create a `linked_file` record pointing to the local PDF.

### 2. Auditing & Backfilling Existing Metadata
- **Dry-run Preview:** `zotero-auto-ingest --enrich-existing --dry-run`
- **Live Library Backfill:** `zotero-auto-ingest --enrich-existing [--collection <KEY>]`
- Resolves canonical records via OpenAlex/Crossref and updates records with missing DOIs or author lists in place.

### 3. Correcting & Updating Records
- **Update Metadata:** `zotero_update_item(item_key="<KEY>", fields={"DOI": "...", "publicationTitle": "..."})`. `zotero_batch_edit_tags_and_extra(set_keys=...)` edits structured `Key: value` lines in `Extra`; it does not update native DOI or publication fields.
- **Corrupt Metadata Replacement:** Delete item (`zotero_delete_item`) and re-ingest via `zotero-auto-ingest <pdf_path>`.

### 4. Working Paper to Published Journal Article Lifecycle
1. Update `itemType` from `preprint` to `journalArticle`.
2. Update `DOI` to the journal DOI; add `publicationTitle`, `volume`, `issue`, and `pages`.
3. Linked PDF attachment and BBT citekey are preserved automatically.
4. If title changed, run `zotero-sidecar.sh reembed <COLLECTION>` to refresh DCR vector prefixes.
