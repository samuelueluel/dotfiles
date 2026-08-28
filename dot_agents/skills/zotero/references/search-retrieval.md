# Search, Retrieval & Citation Graph Routing

**Load this file when** choosing search tools, routing citation queries, navigating the citation graph, handling external references, or verifying empirical claims.

## Fast Query Router

| Query Objective | First Tool | Notes |
|---|---|---|
| Substantive findings, mechanisms, estimates, equations, robustness | `zotero_zotero_semantic_search` | Uses hybrid RAG + reranker. Set `collection=<KEY>` to scope. |
| Exact DOI/title in bibliographies; raw reference entry; "which local items cite X?" | `zotero_zotero_search_references` | Reads the evidence layer (raw bibliography strings). |
| **Exact Citation Counts** ("how many times is X cited?", "most-cited work in collection") | `zotero_zotero_search_references` | Count distinct citing items per target identity. **Do not read exact totals from `get_collection_hubs`**. |
| Known library metadata / citekey lookup | `zotero_zotero_search_items`, `zotero_zotero_advanced_search`, or citekey lookup | Direct Zotero database lookups. |
| Leading collection anchors / most-cited ranking | `zotero_zotero_get_collection_hubs` | Fast ranking by inbound graph edges; counts are directional/approximate. |
| Direct cited / citing neighbors of a paper | `zotero_zotero_get_paper_lineage` | Traverses direct (depth 1) graph connections. |
| Local papers sharing references with a seed | `zotero_zotero_find_connected_papers` | Bibliographic coupling on resolved outgoing references. |
| Citation parsing & resolution coverage audit | `zotero_zotero_audit_references` | Reports resolution rates across parsed sidecars. |

## Unified Semantic-Search Filters

Use one `zotero_zotero_semantic_search` call. Pass `collection=<KEY>` as the collection scope and put optional metadata filters in `filters`:

- `item_type` / `item_types`: exact native Zotero classifications.
- `source_group` / `source_groups`: query-time aliases for the locked mapping below; never create these as tags.
- `tag` / `tags` / `required_tags`: live Zotero tag predicates; `exclude_tags` is also accepted. A tag-only call is valid.

Fields combine with `AND`. Multiple native types or source groups are alternatives within that field; tag-list entries are `AND`, while `OR`/`||` inside one tag entry is an alternative. Do not silently drop a supplied filter.

| `source_group` | Native `itemType` values |
|---|---|
| `reference` | `book`, `bookSection`, `dictionaryEntry`, `encyclopediaArticle` |
| `article` | `journalArticle`, `conferencePaper` |
| `unpublished` | `preprint`, `manuscript`, `presentation` |
| `institutional` | `report`, `dataset`, `standard` |
| `web-media` | `webpage`, `blogPost`, `forumPost`, `magazineArticle`, `newspaperArticle`, `podcast`, `radioBroadcast`, `film`, `videoRecording`, `tvBroadcast`, `audioRecording`, `interview`, `letter`, `email`, `instantMessage` |
| `other` | `artwork`, `map`, `document`, `computerProgram` |

The default paper RAG excludes `note`, `thesis`, `case`, `bill`, `hearing`, `statute`, `patent`, `attachment`, and `annotation`. `type:textbook` is a subtype of native `itemType=book`; `type:lecture-notes` has no single implied native type. Do not duplicate native item types as tags or invent credibility, standing, research-role, publication-status, or subject tags. The only review tags are `review:unreviewed`, `review:skimmed`, and `review:checked`.

Type, source-group, tag, and collection scopes use parent Zotero `item_key` identity. Tags and native types are resolved from the local SQLite snapshot at query time, and the same item-key scope reaches dense and BM25 retrieval, so changes do not require re-embedding. After Zotero writes or sync, close Desktop and allow WAL checkpointing before relying on newly changed metadata. If live tag filtering cannot access local SQLite, report the failure rather than returning unfiltered results.

Minimal patterns:

```python
zotero_zotero_semantic_search(query="treatment effects", filters={"tags": ["review:checked"]})
zotero_zotero_semantic_search(query="econometrics", filters={"item_type": "book"})
zotero_zotero_semantic_search(query="urban policy", filters={"source_group": "article"})
zotero_zotero_semantic_search(query="causal inference", filters={"source_group": "article", "tags": ["review:checked"]}, collection="<KEY>")
```

Results may report `Source Group`, but tags and source groups are user/query metadata—not evidence. For substantive claims, retain the matched passage, location, reranker score, and citation-integrity verification.

## Retrieval Architecture: Evidence Layer vs. Judgment Layer

1. **Passage RAG (`semantic_search`):** Dense vector + BM25 search over local MinerU sidecars, reranked by `:8083`. Supports substantive claims, estimates, and equations. Exposes raw `Rerank` scores.
2. **Reference Index (`search_references`) — Evidence Layer:** BM25 index over raw sidecar bibliography strings (`bm25_reference_index.json`). Returns exact sidecar text without judging correctness. Use for exact citation counts and literal string matches.
3. **Citation Graph (`get_collection_hubs`, `get_paper_lineage`, `find_connected_papers`) — Judgment Layer:** In-memory graph (`citation_graph.sqlite`) built from resolved library items and confident external references.

### Important Count Distinctions
- **`get_collection_hubs` is a most-cited ranking:** Ranks nodes by inbound graph edges; it is not a structural hub metric (no HITS/hub-authority centrality).
- **Graph counts are graph-edge counts, not raw citation totals:** Unresolved bibliography entries drop out of the graph; `ext:meta:*` nodes are heuristic and can split across title variants. For precise citation totals, count distinct citing items via `zotero_zotero_search_references`.

## External Reference Decision Tree

Search candidate DOIs or title/author strings in `zotero_zotero_search_references`, then inspect `resolution`:

1. **`resolution: resolved` (`zotero_item`):**
   - Mapped to a local library item. Use the returned Zotero item key for full-text RAG or graph queries.
2. **`resolution: external_reference` (`ext:*`):**
   - **`ext:doi:*`:** DOI-backed and confident (~0.95 confidence).
   - **`ext:meta:*`:** Heuristic from DOI-less entries (confidence ≤ 0.72). Verify raw entry text in `search_references` before treating metadata as authoritative.
   - **Traversal:** Use expanded lineage (`collection-expanded` / `library-expanded`) to identify local papers citing this node. External nodes have no outgoing references.
3. **`resolution: unresolved` or `ambiguous`:**
   - Present in the reference index and searchable via `search_references`, but **has no graph node** (inward count is 0 in graph tools).
4. **Library Verification:** Check Zotero metadata before concluding an external reference is absent from the library. Do not merge versions silently.

## Graph Scopes

| Scope | Citation Sources | Allowed Citation Targets | Use Case |
|---|---|---|---|
| `collection` | Scoped collection members | Resolved items in the same collection | Closed project structure |
| `library` | Resolved library items | Resolved library items | Closed library-wide map |
| `collection-expanded` | Scoped collection members | Resolved items anywhere + external nodes | Collection's intellectual context |
| `library-expanded` | All sidecar-backed library items | Resolved items + external nodes | Library-wide external context |

*Note:* `collection-expanded` includes resolved library items outside the collection as well as external nodes. Always provide explicit `collection_key` when using collection scopes.

## Membership Taxonomy & Disambiguation

| Membership State | Identification Method | Graph Visibility | Routing |
|---|---|---|---|
| **In scoped collection** | `get_collection_items`; item `Collections` contains key | All scopes; closed `collection` limits both ends to members | Closed scope for internal structure; `search_references(collection_key=...)` for counts |
| **In library, outside collection** | `search_items` finds item; `Collections` lacks key | `collection-expanded` as a *resolved* target; `library` / `library-expanded` | Counted as a resolved node (NOT `ext:*`); expanded lineage to view as target |
| **Outside library entirely** | No `search_items` match; `search_references` returns `external_reference` | `collection-expanded` / `library-expanded` only, as `ext:doi:*` or `ext:meta:*` | Counted via `ext:*` edges; verify metadata via `search_references`; never infer findings |

## Tool Constraints & Fallbacks

- **Lineage Depth:** `get_paper_lineage` traverses direct neighbors only (depth 1).
- **Output Bounds:** Expanded lineage on broad textbooks can return hundreds of nodes. Use targeted `search_references` first.
- **Collection Scope Filtering:**
  - `semantic_search(collection=...)` dynamically includes child subcollections.
  - `search_references(collection_key=...)` filters citing sources by direct collection membership only.
- **Bibliographic Coupling (`find_connected_papers`):** Couples on **resolved** outgoing citations. If a seed paper has few resolved outgoing references (e.g., older citations without DOIs), results may be empty. Fall back to citing papers via `get_paper_lineage` or semantic search on key terms.

## Bounded RAG Workflow

Use this default for substantive questions, especially “which paper?”, “what finds the largest effect?”, and other collection-scoped comparisons:

1. **One scoped discovery call:** Run one task-oriented `zotero_zotero_semantic_search`, normally with `limit=5–8` and `collection=<KEY>`.
2. **One reformulation at most:** Repeat only if the first results do not expose the requested finding or estimate. Change the query angle materially; do not issue near-duplicates.
3. **Shortlist from passages:** Keep only positive-`Rerank`, non-`REF` candidates whose displayed passages concern the requested claim. Do not enumerate the whole collection merely to feel exhaustive.
4. **Normalize the comparison:** Record outcome, sign, unit, treatment dose, geography, horizon, and specification for each leading candidate. Compare magnitudes only when these dimensions are sufficiently alike.
5. **Verify narrowly:** Directly page-read the exact table/prose for the likely winner and, when needed, one close comparator. Do not outline or read every candidate.
6. **Fetch final metadata once:** Retrieve metadata only for sources that will appear in the answer, capturing native `itemType` and canonical `review:*` / `type:*` tags for evidence tokens.
7. **Answer with limits:** If estimands differ, say “largest reported estimate in the scoped collection” and identify the dimension on which it is largest; do not present it as universally largest.

A collection scope defines the retrieval corpus, not the study geography. “Scope to Detroit-Paper” includes Chicago, Saginaw, or other studies filed in that collection unless the user separately requests Detroit-only evidence.

### Minimal superlative example

For “Within Detroit-Paper, what paper finds the largest demolition effect on crime?” use:
1. One scoped semantic query containing demolition, crime, effect size, and comparison language (`limit=5–8`).
2. At most one targeted reformulation if a leading result lacks its magnitude.
3. One page read for the likely winner's exact table/prose, plus one close comparator only if needed.
4. One metadata read for each source actually cited.

Do not preflight database status, enumerate the collection, read every outline, or parse gateway output with shell commands.

### Calls to avoid in ordinary RAG

- `get_collection_items` unless inventory/completeness is the actual task or semantic retrieval demonstrably fails.
- `get_search_database_status` unless semantic search reports readiness/service failure.
- `get_pdf_outline` when the relevant page/table is already exposed.
- `get_item_fulltext` when a passage or page read is sufficient.
- Shell parsing of MCP temporary/spill files. If output is oversized, reduce `limit` or narrow the MCP query.
- Graph tools unless the question concerns citations/relationships or explicitly requests expansion beyond semantic seeds.

## Topic-Conditioned Graph Discovery

When the task genuinely asks for structural neighbors or broader topical exploration:
1. **Identify Seeds:** Run scoped semantic or metadata search.
2. **Expand Graph:** Run lineage or connected-paper tools on selected seeds with an explicit scope.
3. **Extract Evidence:** Return to semantic passages or direct pages for substantive claims; graph edges do not prove findings.

## Query Construction & Evidence Hygiene

- Use task-oriented search phrases rather than bare keywords.
- Include author/year or title tokens when targeting known papers (DCR headers are indexed).
- Treat `Rerank` as the relevance gate; never cite a semantic match without it.
- Reject `REF`/bibliography chunks for substantive evidence.
- Verify empirical numbers against exact passages or direct pages per `citation-integrity`.
- Metadata labels (`itemType`, `source_group`, canonical tags) describe the source and never substitute for claim evidence.
