# Library Operations (citing, searching, bulk edits, tool availability)

**Load this file when** you need to cite or export references for a manuscript, pick between the several search tools, edit tags or Extra fields across many items, work with collections or multiple libraries — or when a tool errors out with a missing dependency and you need to know whether it works here at all.

## Tool availability (install-specific — keep in sync with sjust update)

The `[pdf]` extra (PyMuPDF) is part of the uv install, so PDF-inspection tools are live; Better BibTeX is installed too, so citekey lookup is live. `sjust update` installs `zotero-mcp-server[semantic,pdf]`. If that extras list ever changes again, update this section in the SAME change as the justfile — the two must not drift.

| Tool | Status | Notes |
|---|---|---|
| `get_pdf_outline` | ✅ works | TOC/bookmarks via PyMuPDF, extracted in an isolated child process. Runs off the `[toc patch]` (child imports `pymupdf as fitz` — the legacy `fitz` shim prints a deprecation warning to STDOUT that used to corrupt the child's JSON and produced "unreadable outline data"). PDFs without bookmarks return a clean "no TOC" message. |
| `get_page_layout` | ✅ works | coordinate-level figure/table region detection, per page (1-indexed). Text-only pages legitimately report no regions. |
| `create_annotation` | ✅ works | area annotations (normalized 0-1 rect) and text highlights — pass rect OR text, not both. Needs a writable library (desktop up + sync). `zotero-link` attachments now carry contentType so they pass the "is it a PDF" gate. |
| `search_by_citation_key` | ✅ works | Better BibTeX installed — every item carries a citekey (author+year scheme, e.g. `atuaheneTaxedOutIllegal2018`). Use it to resolve `\citep{key}`-style strings back to items; keys are stable for the LaTeX workflow. |

Consequences worth internalizing:

- Table/figure WORK now runs through the MinerU sidecar HTML (`deep-dive-reading.md`) **and** PyMuPDF layout detection — the sidecar has the content, `get_page_layout` has the geometry.
- `get_pdf_outline` is the cheap way to orient in a long document before `get_item_fulltext` (a few hundred tokens vs 10K+); bookmarks exist only in publisher-built PDFs (e.g. the Rossi-Hansberg 2020 appendix has 59).

## Annotation tools: work, but DB annotations are currently absent

`get_annotations`, `synthesize_annotations`, and `manage_note` all work, but this library has zero Zotero-DB annotations (the pre-existing rows were purged with the trash during dedupe cleanup), so they return "nothing found" library-wide. That is correct behavior, not a bug: don't debug it. Samuel's Okular highlights live INSIDE the Dropbox PDF files; Zotero shows those read-only (lock icon) and does not auto-import them. To get DB annotations (and thus `synthesize_annotations` digests): highlight in Zotero desktop, use `create_annotation`, or File → "Import Annotations…" per PDF (moves them out of the file).

`synthesize_annotations(collection_key=...)` becomes genuinely valuable once Samuel starts highlighting in Zotero desktop: it gathers every highlight and note grouped per paper into one digest, which is the natural input to a thematic literature review. It does no LLM work itself — the synthesis is yours. Consider suggesting it for lit-review tasks, but verify it returns content before building a workflow on it.

## Citing and exporting for manuscripts

`zotero_zotero_export_bibliography` renders through Zotero's own CSL engine, works in local mode with no API credentials.

- `export_format`: `"bib"` (reference-list entries, default), `"citation"` (in-text strings), `"bibtex"` (raw, for a `.bib` file).
- `style`: CSL short name, default `"apa"` — e.g. `"chicago-author-date"`, `"chicago-note-bibliography"`, `"modern-language-association"`, `"ieee"`. Ignored for `bibtex`.
- Scope with `item_keys` (takes precedence) or `collection_key`.

**Always scope it.** Capped at 100 items per call, and a whole-collection BibTeX export of a ~90-item collection runs to tens of thousands of lines — enough to blow out the context window. For a `.bib` file, write it to disk rather than pulling it through context: resolve the keys you actually cite and export those.

BibTeX entries include a `file =` field pointing at the linked PDF path, which is what you want for a local TeX workflow.

## Choosing among the search tools

`semantic_search` is the default for discovery, but it is the wrong tool for several common asks:

| Ask | Tool |
|---|---|
| "papers about X" / conceptual topic | `semantic_search` (optionally `collection=<KEY>`) |
| "the Greenstone paper" — known author/title fragment | `search_items` |
| "everything tagged to-read" | `search_by_tag` |
| "what did I add this month?" / "all preprints since 2026-03" | `advanced_search` |
| "items in the Detroit-Paper collection" | `get_collection_items` |

`advanced_search` takes `conditions: [{field, operation, value}]` joined by `join_mode: "all"|"any"`. Fields include title, creator, date, dateAdded, dateModified, tag, itemType, publicationTitle, abstractNote, collection. Operations (exhaustive): `is`, `isNot`, `contains`, `doesNotContain`, `beginsWith`, `endsWith`, `isGreaterThan`, `isLessThan`, `isBefore`, `isAfter`. For "added in the last N days" use `dateAdded` + `isAfter` + an ISO date. Sort with `sort_by`/`sort_direction`; `limit` defaults to 50, max 500.

Semantic-search scoping notes: `collection` takes an 8-character collection KEY and includes subcollections, resolved DB-side. Find keys with `search_collections` or `get_collections`. A weak match inside a scoped search correctly returns a low or negative relevance score — treat that as an honest "not in this collection" signal rather than a result.

## Resolving attachment paths

`get_attachment_path(item_key=...)` **works** and returns both the stored `file://` reference and the resolved local path. Pass the **parent** item key — passing an attachment key returns "No attachments found", which reads like a missing file but is just the wrong key level. Use it for md5 dedupe work, for locating a Dropbox original, or to confirm a linked path still resolves.

`get_item_children(item_key)` lists attachment keys, titles, and types. Note that linked attachments show an empty type because of the `contentType` issue (SKILL.md § Known quirks).

## Bulk metadata edits

`batch_update` edits many items in one call — add/remove tags, and upsert or remove `Key: value` lines in Extra (useful for BibTeX-adjacent fields).

- Select by `item_keys` (wins), and/or free-text `query`, and/or `tag` (query and tag are ANDed; tag may be a list to OR). `limit` caps query/tag selection, default 50.
- `add_tags`/`remove_tags` are additive/subtractive, **not** replace-all — other tags survive.
- `set_keys` upserts Extra lines, matching case-insensitively on the `key:` prefix and replacing in place, else appending. Lines without a colon are preserved. `remove_keys` deletes matching lines.
- Requires a writable library (desktop up). Attachments and no-op items are skipped and counted.

Prefer this over looping `update_item` when retagging a reading list or stamping a series field across a set of working papers.

## Collections and libraries

- `get_collections` lists collections with keys; `search_collections` finds by name; `create_collection` / `delete_collection` manage them.
- `set_item_collections` changes membership for existing items. `add_item(collections=[...], create_missing_collections=True)` files at creation time; collection specs accept keys, names, or `'/'`-paths and are validated **before** anything is created, so a bad spec fails the call rather than leaving an unfiled item.
- Filing/unfiling is picked up by the index's collection-metadata sync on the next update run — re-run `update_search_database` if collection-scoped search should reflect a move.
- `list_libraries` shows addressable libraries with IDs and item counts; `switch_library` changes the active context for **every** subsequent call and persists for the session. Discover IDs before switching, never guess, and switch back with `library_type: "default"` when done.
