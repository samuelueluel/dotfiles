# Evidence Record Formats

**Load this file when** preparing machine-readable evidence records or performing an explicit provenance inspection, not for every ordinary cited answer.

The [citation integrity skill](../SKILL.md) governs evidence eligibility, statistical reporting, and human-facing footnotes. The formats below describe internal records, not citation stamps to paste into chat. Retain only returned or otherwise verified fields; optional metadata does not justify another retrieval call.

## 1. Semantic-Passage Evidence

Canonical record:

```text
{Author Year, item KEY, passage N/M, p. X if mapped, Rerank +S; itemType/source_group; canonical tags if present}
```

Retain returned `chunk_id`, `content_hash`, and `index_generation` alongside the record when available. Page labels require an established mapping to printed pages or PDF indices; otherwise the passage/section locator is sufficient.

Current semantic results contain bounded previews and an `evidence_id`, not necessarily a complete matched passage. `zotero_read_passage` expands that token and returns the anchor and any requested neighbors with their own chunk identifiers. For a claim supported by a neighbor, retain that neighbor's locator; expansion adds no score and the anchor's score does not become the neighbor's score. Eligibility is governed by the main skill.

## 2. Direct-Source Evidence

Canonical records:

```text
{Author Year, item KEY, PDF p. X; itemType/source_group; canonical tags if present}
{Author Year, item KEY, § heading; itemType/source_group; canonical tags if present}
{Author Year, item KEY, lines X–Y; itemType/source_group; canonical tags if present}
```

Internally retain which route supplied the text: extracted PDF-page text, full-source text, or MinerU sidecar. Record visual inspection separately only if a page image was actually viewed. For sidecars, retain the returned `source_hash` and line/character window. Indexed offsets, source-file character offsets, sidecar lines, and PDF indices are different locators.

## 3. Exact-Source Identity Evidence

Canonical records:

```text
{resolve_exact_source → exact, item KEY, collection scope verified}
{resolve_exact_source → absent, requested identity, collection scope}
{resolve_exact_source → ambiguous, competing item KEYs or metadata conflict}
```

Resolver output includes identity status and membership context. These records describe identity only. A substantive answer instead cites its passage or direct-source evidence; it need not display a separate resolver record unless identity is material.

## 4. Bibliography-Reference Evidence

Canonical record:

```text
{zotero_search_bibliography_entries → citing KEY, entry N, status/method, resolution confidence C, parse P}
```

Retain the raw entry and its resolution status. BM25 scores measure text match, not identity confidence. `unresolved` or `ambiguous` entries remain raw occurrences rather than verified target identities.

## 5. Citation-Graph Evidence

Canonical records:

```text
{zotero_rank_works_by_inbound_citations → scope collection KEY, item ABCDEFGH, rank #1, 14 inward citations}
{zotero_get_citation_neighbors → scope collection-expanded KEY, seed ABCDEFGH, result ext:doi:..., incoming}
{zotero_find_bibliographically_coupled_papers → scope library, seed ABCDEFGH, result HGFEDCBA, Jaccard 0.50, 1 shared citation}
```

Retain the explicit scope, direction, node kind, and returned measure. An inbound-edge count is not a raw bibliography occurrence count. Bibliography retrieval is useful when the question asks for raw occurrences or a specific unresolved identity needs checking; it is not a mandatory second pass for every graph result.

For graph parameters and external-node scope details, load [search and retrieval](../../zotero-research/references/search-retrieval.md).

## 6. Source Classification Fields

When already available, retain:

- Native `itemType`, such as `journalArticle`, `preprint`, or `report`.
- Returned or mapped `source_group`, such as `article`, `unpublished`, or `institutional`.
- Canonical `review:*` or `type:*` tags, such as `review:checked` or `type:textbook`.

Example suffix: `; journalArticle/article; review:checked`. These fields describe the source; they do not strengthen its evidence. Omit missing labels rather than making calls solely to fill them.
