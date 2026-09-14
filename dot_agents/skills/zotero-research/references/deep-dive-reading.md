# Targeted Reading: Routes for Exact Source Content

**Load this file when** extracting coefficients or table notes, continuing truncated results, or choosing between indexed passages, sidecars, extracted PDF text, and page images.

## Choose the Route for the Missing Fact

The [research skill](../SKILL.md) governs retrieval and stopping; [citation integrity](../../citation-integrity/SKILL.md) governs numerical verification and provenance. These are alternatives, not a ladder to climb on every claim:

| Evidence already available | Smallest useful operation |
|---|---|
| A useful search preview is clipped | Expand its `evidence_id` with `zotero_read_passage` |
| A passage or sidecar window is truncated | Continue from the returned locator; examples below |
| The decisive table's PDF page is known | Read that page directly with `zotero_read_pdf_pages` |
| An exact item and literal phrase are known, but no page locator | Locate the phrase with `zotero_find_in_item` |
| PDF text has broken signs or columns | Read unambiguous surrounding prose, or inspect a page image if a visual tool is available |

`zotero_read_pdf_pages` returns extracted PDF-page text, not a visual inspection. A page text layer can also lose signs and columns. Sidecars are MinerU's OCR-and-parse reconstruction; indexed passages may come from those same sidecars. Agreement between these views is not independent corroboration.

When a PDF locator is unavailable, an outline or another available location tool may supply one. Otherwise use a precise sidecar window with the qualification required by citation integrity; do not estimate a page from passage numbers or document length.

## Expand and Continue an Indexed Passage

`zotero_read_passage` reads the stored anchor without embedding or reranking. Its default is the anchor alone; `neighbors=1` or `2` adds adjacent chunks within a total `max_chars` budget (256–16000, default 8000).

```python
zotero_read_passage(evidence_id=hit_evidence_id, neighbors=1, max_chars=8000)
# If the anchor is truncated, copy the returned next_char_start:
zotero_read_passage(evidence_id=hit_evidence_id, start_char=next_char_start, max_chars=8000)
```

Offsets are zero-based characters within the stored chunk, not source-file characters or PDF pages. Expansion preserves the original hit's provenance and adds no new reranker score.

## Locate and Continue a Sidecar Window

`zotero_find_in_item` supports personal-library sidecars only. It accepts one case-insensitive literal phrase, not regex. Prefer a distinctive table label or result phrase over a common word such as `crime`.

```python
zotero_find_in_item(item_key=item_key, query="Table 5", context_lines=2,
                   max_matches=3, max_chars=6000)
```

`max_chars` (256–16000) is a total budget across all windows. Large `context_lines` can spend it on prose before reaching a table. Use the returned locations to read the desired window rather than repeating the lookup with synonyms.

```python
# Continue a long truncated HTML table line from the returned source offset:
zotero_find_in_item(item_key=item_key, query=None,
                   start_char=next_char_start, expected_hash=source_hash,
                   max_chars=8000)
# Or read a known bounded line range:
zotero_find_in_item(item_key=item_key, query=None, start_line=table_start_line,
                   end_line=table_end_line, expected_hash=source_hash, max_chars=8000)
```

Lines are one-based; source character offsets are zero-based. Reuse the returned `source_hash` as `expected_hash` on follow-ups. Do not pass an indexed-passage offset to a sidecar lookup.

## Tables and Statistical Scales

Sidecar tables commonly contain HTML rows and cells. Parentheses often contain standard errors, but they may instead contain confidence intervals, t-statistics, or another quantity; read the table notes before assigning meaning. Establish row and column alignment before using a cell.

The main citation skill governs verification and calculated uncertainty. In particular, a reported semielasticity, an IRR, and a raw log-link coefficient are different scales. Do not exponentiate an estimate merely because the model uses a log link.

## Whole-Argument Reading

For an explicit full-read request or whole-argument evaluation, use `zotero_get_item_fulltext` or staged `zotero_find_in_item(query=None, ...)` windows. For a bounded question, use the relevant result and necessary context instead; “literature review” alone does not require full-paper reads.
