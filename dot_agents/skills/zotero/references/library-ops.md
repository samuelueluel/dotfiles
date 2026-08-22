# Library Operations (citing, searching, bulk edits, tool availability)

**Load this file when** you need to cite or export references for a manuscript, pick between search tools, edit tags or Extra fields across items, work with collections or multiple libraries, or check tool dependencies.

## Tool availability

The `[pdf]` extra (PyMuPDF) and Better BibTeX are installed with the setup:

| Tool | Status | Notes |
|---|---|---|
| `get_pdf_outline` | Active | TOC bookmarks via PyMuPDF extracted in an isolated child process using `[toc patch]`. PDFs without bookmarks return a clean message. |
| `get_page_layout` | Active | Coordinate-level figure/table region detection per page (1-indexed). |
| `create_annotation` | Active | Area annotations (normalized 0–1 rect) and text highlights (pass rect OR text). Requires desktop up and sync. |
| `search_by_citation_key` | Active | Better BibTeX citekey lookup (e.g. `atuaheneTaxedOutIllegal2018`). Resolves `\citep{key}` references. |

Consequences:
- Extraction of table/figure content uses MinerU sidecar HTML (`deep-dive-reading.md`), while PyMuPDF provides geometric region bounds.
- `get_pdf_outline` provides fast orientation in long documents prior to full-text retrieval.

## Annotation tools

`get_annotations`, `synthesize_annotations`, and `manage_note` operate on Zotero SQLite database annotations. Note that external annotations (e.g. Okular highlights) remain embedded in Dropbox PDF files and appear read-only in Zotero without populating SQLite tables. Database annotations are created via Zotero desktop or `create_annotation`.

`synthesize_annotations(collection_key=...)` compiles highlights and notes grouped by paper across a collection for literature synthesis.

## Citing and exporting for manuscripts

`zotero_zotero_export_bibliography` renders via Zotero's CSL engine in local mode:

- `export_format`: `"bib"` (reference list), `"citation"` (in-text strings), `"bibtex"` (raw BibTeX entries).
- `style`: CSL short name, default `"apa"` (e.g. `"chicago-author-date"`, `"modern-language-association"`, `"ieee"`). Ignored for `bibtex`.
- Scope: Pass `item_keys` or `collection_key`.

Always scope exports: whole-collection BibTeX dumps of large libraries can exceed LLM context windows. Write large `.bib` files directly to disk.

## Choosing among search tools

| Objective | Tool |
|---|---|
| Topic / conceptual exploration | `semantic_search` (optionally `collection=<KEY>`) |
| Known author / title string fragment | `search_items` |
| Items tagged with specific labels | `search_by_tag` |
| Filtered metadata queries (date ranges, item types) | `advanced_search` |
| Complete contents of a collection | `get_collection_items` |

`advanced_search` takes conditions formatted as `[{field, operation, value}]` with `join_mode: "all"|"any"`. Supported operations: `is`, `isNot`, `contains`, `doesNotContain`, `beginsWith`, `endsWith`, `isGreaterThan`, `isLessThan`, `isBefore`, `isAfter`.

### advanced_search date filters

Date range operations (`isAfter`, `isBefore`, `isGreaterThan`, `isLessThan`) compare parsed dates numerically. Month-first display (`"5/2018"`, `"08/2024"`), year-only (`"2023"`), ISO (`"2019-09-01"`), and month-name dates sort correctly against any bound. Unknown month/day resolve inclusively (e.g. `date isAfter "2023-01-01"` includes 2023-dated items). Items with no date never match a date-range filter. The `year` field filters specifically by the 4-digit year.

## Resolving attachment paths

`get_attachment_path(item_key=...)` accepts the **parent** item key and returns both the `file://` URI and the local filesystem path. Use for MD5 hashing and verifying linked file availability.

`get_item_children(item_key)` lists child attachment keys, titles, and content types.

## Bulk metadata edits

`batch_update` modifies multiple items in a single request:
- Select items via `item_keys`, `query`, or `tag`.
- `add_tags` and `remove_tags` modify tags additively/subtractively without erasing unlisted tags.
- `set_keys` upserts key-value lines in the `Extra` field; `remove_keys` deletes specified keys.
- Requires desktop application running.

## Lecture notes convention (Methods / Mathematics collections)

Established 2026-08 for the PhD-methods course materials. Follow it for any new lecture notes/books dropped into `Methods` (`2QWMWY2P`) or `Mathematics` (`C8JGJRG7`):

- **Item type:** `document` for lecture notes, `presentation` for slide decks, `book` for published textbooks (even chapter excerpts, e.g. Tao ch. 2). Never `journalArticle` for lecture notes.
- **Title:** `Course: Lecture N — Topic` for individual lectures (e.g. `Econ 715: Lecture 3 — Consistency of Extremum Estimators`, `14.382: Lecture 12 — Treatment Effects`); plain title for compiled course notes/books.
- **Extra (structured lines):** `Type: Lecture Notes|Slides`, `Course: <code> <name>`, `Institution:`, `Instructor:`, `URL:` (e.g. OCW page). Upsert via `batch_update(set_keys=...)` — never overwrite the whole Extra field (Citation Key lives there).
- **Date:** year of the version/course offering (e.g. Econ 715 → 2012, 14.382 OCW → 2017, Spreij notes → 2016). Leave blank when unknown.
- **Tags:** type tag (`lecture-notes` / `slides` / `book` / `article`) + subject tags: `econometrics`, `asymptotics`, `measure-theory`, `probability`, `real-analysis`, `conditional-expectation`, `did`, `rdd`, `panel-data`, `time-series`, `machine-learning`, `causal-inference`, `nonparametrics`, `spatial`, `discrete-choice`, `identification`, `cluster-robust`, `treatment-effects`, `program-evaluation`, `potential-outcomes`, `statistics`, `bootstrap`, `weak-instruments`.
- **Files (Samuel's rule — TWO copies on disk):** the Zotero directory holds an **imported copy** of every PDF (`~/Zotero/storage/`, made by GUI drag-drop or scripted import) AND the original stays in `~/Dropbox/References/**`. **Never delete a `~/Zotero/storage/` copy, never "dedupe" against Dropbox.**
  - *Exception (linked_file, pointer only):* PDFs that must stay put — system docs (Stata manuals in `/usr/local/stata19/docs/`), project files you deliberately keep single-copy. Those use `zotero-link <parent_key> <abs_path>` and have NO storage copy.
  - *After CLI ingestion* (`zotero-auto-ingest`/`zotero-link` create linked pointers): if the PDF is an ordinary paper that should also live in the Zotero directory, either have Samuel drag it into Zotero GUI, or run a scripted local import (Zotero closed, backup first). Do not leave it linked-only and call it done.
  - Known course sets: Econ 715 (Xiaoxia Shi, UW-Madison 2012) = 11 separate `document` items; MIT 14.382 (Chernozhukov & Fernández-Val, Spring 2017) = per-lecture items; MIT 6.436J/15.085J (Bertsekas & Tsitsiklis, Fall 2008) = per-lecture items.

## Collections and library management

- `get_collections` lists available collections; `search_collections` searches by name; `create_collection` and `delete_collection` modify structure.
- `set_item_collections` updates collection memberships. `add_item(collections=[...], create_missing_collections=True)` assigns membership at ingestion.
- Collection movements sync to semantic search during subsequent `update_search_database` runs.
- `list_libraries` displays accessible libraries; `switch_library` switches active library context for subsequent calls.

## Metadata Operations: Ingestion, Audit, Correction & Lifecycle

`~/.local/bin/zotero-auto-ingest` provides a unified, deterministic pipeline to get, audit, correct, and replace publication-grade metadata for local PDFs:

### 1. Ingesting New Bare PDFs (Zero-Friction Ingest)
- **Single PDF:** `zotero-auto-ingest <path_to_pdf> [--collection <KEY>]`
- **Batch Directory:** `zotero-auto-ingest ~/Downloads/papers/*.pdf [--collection <KEY>]`
- **Workflow:**
  1. PyMuPDF extracts Page-1 DOI (`10.xxxx/...`), arXiv, or ISBN.
  2. Queries **Crossref REST API** for official publisher metadata (authors, journal, volume, issue, pages).
  3. If no DOI is printed, queries **OpenAlex API** with title candidate (Levenshtein match >0.85).
  4. Creates clean Zotero record (`preprint` for working papers, `journalArticle` for published papers).
  5. Better BibTeX auto-assigns citation key (e.g. `\citep{baumsnow2020}`).
  6. Automatically executes `zotero-link` to attach the local PDF as a `linked_file` (path pointer, no bytes to cloud). **Remember: linked_file = pointer only, NO copy in `~/Zotero/storage/`. For ordinary papers Samuel wants an imported copy in the Zotero directory (drag-drop or scripted import). Never delete an existing storage copy.**

### 2. Auditing & Backfilling Existing Library Metadata
- **Dry-run Preview:** `zotero-auto-ingest --enrich-existing --dry-run`
- **Live Library Backfill:** `zotero-auto-ingest --enrich-existing [--collection <KEY>]`
- **Behavior:** Scans existing items for missing DOIs, filename-only titles (`draft_v4.pdf`), or missing author lists. Resolves canonical records via OpenAlex/Crossref and updates the Zotero database in place.

### 3. Correcting Wrong / Incomplete Metadata on Specific Items
- **Direct DOI Update:** Call `zotero_zotero_update_item(item_key, {"DOI": "<correct_doi>", "publicationTitle": "..."})` or use `batch_update(item_keys=[KEY], set_keys={"DOI": "..."})`.
- **Replacing Broken Record:** If metadata is completely corrupt, delete item (`delete_item` + delete child attachment) and re-ingest the PDF with `zotero-auto-ingest <pdf_path>`.

### 4. Working Paper $\to$ Published Journal Article Lifecycle
- When an NBER/SSRN preprint is published in a journal:
  1. Update `itemType` from `preprint` to `journalArticle`.
  2. Update `DOI` to the journal DOI; add `publicationTitle`, `volume`, `issue`, and `pages`.
  3. Linked PDF attachment and BBT citekey are preserved automatically.
  4. If the title changed, run `zotero-sidecar.sh reembed <COLLECTION>` so DCR vector prefixes (`[Paper: Title (Author Year) | Section: Breadcrumb]`) re-index cleanly.
