# Search & Retrieval (RAG)

**Load this file when** doing semantic or structured search, constructing queries, verifying retrieved passages, or running the retrieval → answer loop.

## Tool selection

| Goal | Tool |
|---|---|
| Find papers by concept/topic | `zotero_zotero_semantic_search(query, collection=<KEY>, limit=10)` |
| Precise metadata filters (date range, item type) | `zotero_zotero_advanced_search` |
| Find a specific paper by name | `zotero_zotero_search_items` (substring) |
| Exact citekey lookup | `zotero_zotero_search_by_citation_key` |
| Items with a tag | `zotero_zotero_search_by_tag` |
| Collection key lookup | `zotero_zotero_search_collections` / `references/collections.md` |

## Query construction

- **Instruct prefix:** the embedder prepends `Instruct: <task>` to queries, so task-style phrasing ("which papers estimate event-study DiD designs?") retrieves better than bare keywords.
- **Titles & Author/Year in DCR prefix:** the DCR prefix (`[Paper: <title> (<author> <year>) | Section: <breadcrumb>]`) imprints the title, author citation (e.g. `Larson 2019`, `Callaway & Sant'Anna 2021`, or `Carrillo et al. 2019`), and section heading on every chunk across both the dense and BM25 indexes.
- **Figure-query composition:** content-bearing phrasing + author/figure numbers (e.g. "Larson 2019 figure 1 demolitions bar chart") hits the exact figure schema and caption chunk. Pure meta-style phrasing ("what does figure 1 show") misses.
- **Collection scoping:** pass `collection=<8-char KEY>` (includes subcollections) to restrict a search to a project.

## Retrieval limitations

- **Metadata staleness:** a title change needs a re-embed (the old title is baked into every chunk's DCR prefix). Result display is live (enriched from the Zotero API at query time), but semantic/BM25 matching is stale until re-embed.
- **Reference-chunk suppression:** bibliography chunks are dropped from dense/sparse retrieval on general queries (`[REF]` annotation on surviving citations). Citation-shaped lookups still retain them.
- **No-date items** no longer match date-range filters in `advanced_search` (see the `[date patch]`).
- **Result enrichment** (title/creators/page/citation) requires the Zotero desktop/API up; otherwise `semantic_search` returns passages with a `Connection refused` enrich error — read the passage directly from the sidecar instead.

## Interpreting results

- Each result carries `item_key`, `chunk_index`, char offsets, matched text, and a `Rerank` score (cross-encoder). A rerank floor (~-2.0) trims junk; scores are rank-correct, not calibrated.
- Gate answer confidence on `Rerank` and verify numbers against the passage text — see the `citation-integrity` skill.

## Retrieval → answer loop

1. `semantic_search(query)` → candidate passages.
2. Verify: grep the sidecar (`references/deep-dive-reading.md`) or `get_item_fulltext` (needs desktop).
3. Synthesize + cite per `citation-integrity`: every claim cites a retrieved passage (author, year, passage, page), numbers verified against passage text, confidence gated on `Rerank`. "No evidence found" is a complete answer.
