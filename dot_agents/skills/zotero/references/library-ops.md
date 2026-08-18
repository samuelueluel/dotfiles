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

Date range ops (`isAfter`/`isBefore`/`isGreaterThan`/`isLessThan`) compare parsed dates numerically (`[date patch]`, see Zotero-MCP.md §11.6) — Zotero's month-first display (`"5/2018"`, `"08/2024"`), year-only (`"2023"`), ISO (`"2019-09-01"`), and month-name dates all sort correctly against any bound. Unknown month/day resolve inclusively: Dec 31 for isAfter/isGreaterThan, Jan 1 for isBefore/isLessThan — so `date isAfter "2023-01-01"` includes a 2023-dated item and `date isBefore "2023-01-01"` excludes it. Items with no date never match a range (pre-patch they vacuously matched every isBefore). The `year` field filters by the parsed year. Older builds compared display strings lexicographically and mis-sorted month-first dates in both directions — re-run `sjust update` if a build regresses.

## Resolving attachment paths

`get_attachment_path(item_key=...)` accepts the **parent** item key and returns both the `file://` URI and the local filesystem path. Use for MD5 hashing and verifying linked file availability.

`get_item_children(item_key)` lists child attachment keys, titles, and content types.

## Bulk metadata edits

`batch_update` modifies multiple items in a single request:
- Select items via `item_keys`, `query`, or `tag`.
- `add_tags` and `remove_tags` modify tags additively/subtractively without erasing unlisted tags.
- `set_keys` upserts key-value lines in the `Extra` field; `remove_keys` deletes specified keys.
- Requires desktop application running.

## Collections and library management

- `get_collections` lists available collections; `search_collections` searches by name; `create_collection` and `delete_collection` modify structure.
- `set_item_collections` updates collection memberships. `add_item(collections=[...], create_missing_collections=True)` assigns membership at ingestion.
- Collection movements sync to semantic search during subsequent `update_search_database` runs.
- `list_libraries` displays accessible libraries; `switch_library` switches active library context for subsequent calls.
