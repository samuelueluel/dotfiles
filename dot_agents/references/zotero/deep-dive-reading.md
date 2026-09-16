# Expand Passages, Find Tables, and Continue Reading

**Load this file when** expanding a retrieved passage, continuing truncated text, locating a table, or checking damaged extracted text.

The active task skill—normally [source reading](../../skills/zotero-source-reading/SKILL.md) or [result comparison](../../skills/zotero-result-comparison/SKILL.md)—decides what to read next. Choose the example that fits the missing evidence; do not run every example for each claim.

## Expand an Existing Hit

Use the returned evidence ID. Neighbor chunks are useful when the hit ends at a table heading or omits its notes.

```python
zotero_read_passage(evidence_id=hit_evidence_id, neighbors=1, max_chars=8000)
# For a truncated anchor, copy the returned continuation offset:
zotero_read_passage(evidence_id=hit_evidence_id, start_char=next_char_start,
                    max_chars=8000)
```

`read_passage` accepts neighbors 0–2 and a total text budget of 256–16000 characters.
Offsets refer to the stored anchor chunk. Each returned neighbor has its own evidence ID and source location.
The tool checks the active library and rejects changed or missing evidence; it does not switch libraries.

## Locate a Table or Phrase in a Sidecar

A short distinctive phrase usually works better than a common word such as `crime`.
Literal lookup is case-insensitive, not semantic or regex-based; the existing sidecar must be in the personal library.

```python
zotero_find_in_item(item_key=item_key, query="Table 5", context_lines=1,
                   max_matches=3, max_chars=16000)
```

`context_lines` accepts 0–20, `max_matches` 1–10, and `max_chars` 256–16000.
The character limit covers all returned windows and is spent in document order across matches, so prose cross-references can use it up before the table window completes.
When the target is a table, request the full 16000-character budget with narrow context (`context_lines=1`, `max_matches=3`): one minified HTML table line can run several thousand characters with no line breaks.
Once the table is located, prefer the line-range read shown in the next section; it returns the table and its notes exactly, with no budget sharing across matches.
A literal search for a number can fail because math markup inserts spaces between its digits. A known table label or source phrase can locate the relevant text instead.

## Continue the Located Window

Use the returned `source_hash` as `expected_hash` so a changed source is rejected.

```python
# A long HTML table can occupy one line; continue by source character offset.
zotero_find_in_item(item_key=item_key, query=None, start_char=next_char_start,
                   expected_hash=source_hash, max_chars=8000)
# Or read a line range already located in the returned source:
zotero_find_in_item(item_key=item_key, query=None, start_line=table_start_line,
                   end_line=table_end_line, expected_hash=source_hash,
                   max_chars=8000)
```

Sidecar lines are one-based; source character offsets are zero-based with exclusive ends.
These offsets differ from `read_passage` chunk offsets. Continue using the source location returned by the same tool; do not transfer offsets between tools.

## Read or Render a Located PDF Page

First use the literal PDF route when an exact phrase, heading, or table label must be tied to a PDF page:

```python
zotero_find_in_pdf(item_key=item_key, query="Table 5", start_page=1,
                   end_page=20, max_matches=3, offset=0, max_chars=16000)
```

Then read the targeted page's extracted text:

```python
zotero_read_pdf_pages(item_key=item_key, start_page=verified_pdf_page,
                     end_page=verified_pdf_page)
```

Use an available PDF outline or `zotero_find_in_pdf` result to establish `verified_pdf_page`, the actual one-based page index in the file. Printed page labels, sidecar lines, and indexed offsets do not establish that locator. `zotero_find_in_pdf` reports exact total and returned matches, complete `match_pages`, `omitted_match_pages`, and whether the requested text layer is complete. When `has_more_matches` is true, continue with `next_offset` or narrow the page range to omitted late pages. `partial_text_coverage` and `no_usable_text` do not support an absence claim.
A section heading, printed page label, or sidecar line range alone does not establish that index.
If the PDF page index is unavailable, the core workflow permits reading a precise sidecar window and reporting its actual source location.

## Check a Table with Damaged Extracted Text

Read the row label, column headers, unit definition, and table notes together.
A PDF text read can restore stars lost in a sidecar, but it can also lose minus signs or detach columns itself.
When prose does not resolve the ambiguity, inspect the actual page or table crop:

```python
zotero_render_pdf_page(item_key=item_key, page=verified_pdf_page,
                       region=detected_bbox)  # optional normalized bbox
```

The rendering tool returns one PNG image block plus matching provenance. Use it for column alignment, signs, stars, figures, or other visual ambiguity. Coordinates, extracted page text, and generated descriptions cannot substitute for inspecting the actual image.

For symptom-specific examples, load [extraction diagnostics](../../skills/citation-integrity/references/verification-workflow.md).
Follow citation-integrity's core skill for statistical interpretation and how to record where the evidence came from.
