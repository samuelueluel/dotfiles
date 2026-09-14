# Search, Retrieval & Citation Graph Routing

**Load this file when** handling exact-source edge cases, semantic filters, difficult comparisons, citation counts, external references, or citation-graph scopes.

## Collection Inventory for Comparisons

For a ranking task, prefer `zotero_list_collection_items(collection_key=..., detail="summary", include_subcollections=true)` and follow the returned pagination. Inspect its deployed schema for pagination parameters. This checks candidate coverage without fetching every abstract or full record.

For a targeted metadata recall check, keep the same collection and descendant scope. The [research skill](../SKILL.md) governs challenger resolution and qualified rankings.

## Exact-Source API Details

For a user-named source, the [research skill](../SKILL.md) governs identity resolution and binding subsequent evidence to the verified item. A narrow topic or collection-wide comparison is not an exact-source request.

Pass the original identifier in `source` to `zotero_resolve_exact_source`. When available, also supply explicit `title`, `author`, `year`, `doi`, `citation_key`, or `item_key` fields, and `collection_key` for a scoped request. Results include `identity_status`, match lists, `conflicts`, and `collection_scope`. Each match's `in_requested_scope` and `scope_basis` describe its membership.

If the resolver is unavailable, these legacy lookups can establish identity:

| Known identifier | Targeted lookup |
|---|---|
| Item key | `zotero_get_item_metadata` |
| Better BibTeX key | `zotero_find_item_by_citation_key` |
| Title/author/year or DOI | `zotero_search_items`, then metadata for plausible exact matches |
| Collection membership | A collection-scoped lookup with the requested descendant scope |

`zotero_search_items` may return simplified or semantic fallback matches after an exact search miss. These are related records, not resolved identity. An empty metadata `collections` field does not establish non-membership.

Once identity is verified, `filters={"item_keys": ["<KEY>"]}` binds semantic retrieval to that parent item. A search miss within this scope is a finding-retrieval gap, not identity absence.

## Unified Semantic-Search Filters

Use one `zotero_semantic_search` call. Pass `collection=<KEY>` as the collection scope and put optional metadata filters in `filters`:

- `item_type` / `item_types`: exact native Zotero classifications.
- `item_key` / `item_keys`: exact parent-item identity scope; the canonical way to bind retrieval to a resolver-verified source. Combines with (intersects) other scopes and fails closed when nothing remains.
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

Type, source-group, tag, and collection scopes use parent Zotero `item_key` identity. Tags and native types are resolved from the local SQLite snapshot at query time, and the same item-key scope reaches dense and BM25 retrieval, so changes do not require re-embedding. If live tag filtering cannot access local SQLite, report the failure rather than returning unfiltered results. For diagnosed metadata freshness or SQLite/WAL problems after writes or sync, load [pipeline service operations](../../zotero-pipeline/references/service-ops.md); ordinary retrieval does not require closing Zotero Desktop.

Minimal patterns:

```python
zotero_semantic_search(query="treatment effects", filters={"tags": ["review:checked"]})
zotero_semantic_search(query="econometrics", filters={"item_type": "book"})
zotero_semantic_search(query="urban policy", filters={"source_group": "article"})
zotero_semantic_search(query="causal inference", filters={"source_group": "article", "tags": ["review:checked"]}, collection="<KEY>")
```

Results may report `Source Group`, but tags and source groups are user/query metadata—not evidence. For substantive claims, retain the matched passage, location, reranker score, and citation-integrity verification.

## Retrieval Architecture: Evidence Layer vs. Judgment Layer

1. **Passage RAG (`zotero_semantic_search`):** Dense vector + BM25 search over local MinerU sidecars, reranked by `:8083`. Supports substantive claims, estimates, and equations. Exposes raw `Rerank` scores. Expand an existing hit with `zotero_read_passage` (no new score) rather than searching again.
2. **Reference Index (`zotero_search_bibliography_entries`) — Evidence Layer:** BM25 index over raw sidecar bibliography strings (`bm25_reference_index.json`). Returns exact sidecar text without judging correctness. Use for exact citation counts and literal string matches.
3. **Citation Graph (`zotero_rank_works_by_inbound_citations`, `zotero_get_citation_neighbors`, `zotero_find_bibliographically_coupled_papers`) — Judgment Layer:** In-memory graph (`citation_graph.sqlite`) built from resolved library items and confident external references.

### Important Count Distinctions
- **`zotero_rank_works_by_inbound_citations` is a most-cited ranking:** Ranks nodes by inbound graph edges; it is not a structural hub metric (no HITS/hub-authority centrality).
- **Graph counts are graph-edge counts, not raw citation totals:** Unresolved bibliography entries drop out of the graph; `ext:meta:*` nodes are heuristic and can split across title variants. For precise citation totals, count distinct citing items via `zotero_search_bibliography_entries`.

## External Reference Decision Tree

Search candidate DOIs or title/author strings in `zotero_search_bibliography_entries`, then inspect `resolution`:

1. **`resolution: resolved` (`zotero_item`):**
   - Mapped to a local library item. Use the returned Zotero item key for full-text RAG or graph queries.
2. **`resolution: external_reference` (`ext:*`):**
   - **`ext:doi:*`:** DOI-backed and confident (~0.95 confidence).
   - **`ext:meta:*`:** Heuristic from DOI-less entries (confidence ≤ 0.72). Verify raw entry text in `zotero_search_bibliography_entries` before treating metadata as authoritative.
   - **Traversal:** Use citation neighbors with an expanded scope (`collection-expanded` / `library-expanded`) to identify local papers citing this node. External nodes have no outgoing references.
3. **`resolution: unresolved` or `ambiguous`:**
   - Present in the reference index and searchable via `zotero_search_bibliography_entries`, but **has no graph node** (inward count is 0 in graph tools).
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
| **In scoped collection** | Scoped inventory or resolver membership, including descendants when requested | All scopes; closed `collection` limits both ends to members | Closed scope for internal structure; `zotero_search_bibliography_entries(collection_key=...)` for counts |
| **In library, outside collection** | Verified library identity plus exclusion from the requested collection subtree; a missing parent collection key alone is insufficient | `collection-expanded` as a *resolved* target; `library` / `library-expanded` | Counted as a resolved node (NOT `ext:*`); expanded citation-neighbor query to view as target |
| **Outside library entirely** | Bounded exact library identity check establishes absence; an `external_reference` label alone is insufficient | `collection-expanded` / `library-expanded` only, as `ext:doi:*` or `ext:meta:*` | Counted via `ext:*` edges; verify metadata via `zotero_search_bibliography_entries`; never infer findings |

## Tool Constraints & Fallbacks

- **Call shapes:** `zotero_list_collection_items` takes `collection_key` (not `collection`); pair with `include_subcollections=true` to match semantic-search scoping. `zotero_read_pdf_pages` takes `start_page` / `end_page` (not `pages`). `zotero_read_passage` takes the `evidence_id` returned by `semantic_search` (`neighbors` 0–2, `max_chars` 256–16000). `zotero_find_in_item` takes `item_key` plus a literal `query` (no regex; personal library only); `query=null` reads lines. A pre-tool hook silently repairs the `collection` alias and `"N-M"` page ranges; anything it cannot parse falls through to normal validation, so use the canonical shapes.
- **Neighbor Depth:** `zotero_get_citation_neighbors` requires `depth=1` and returns direct neighbors only. Other values are rejected; multi-hop traversal is not implemented.
- **Output Bounds:** Expanded citation-neighbor queries on broad textbooks can return hundreds of nodes. Use targeted `zotero_search_bibliography_entries` first.
- **Collection Scope Filtering:**
  - `semantic_search(collection=...)` dynamically includes child subcollections.
  - `zotero_search_bibliography_entries(collection_key=...)` filters citing sources by direct collection membership only.
- **Bibliographic Coupling (`zotero_find_bibliographically_coupled_papers`):** Couples on **resolved** outgoing citations. If a seed paper has few resolved outgoing references (e.g., older citations without DOIs), results may be empty. Fall back to citing papers via `zotero_get_citation_neighbors` or semantic search on key terms.

## Topic-Conditioned Graph Discovery

When the task genuinely asks for structural neighbors or broader topical exploration:
1. **Identify Seeds:** Run scoped semantic or metadata search.
2. **Expand Graph:** Run citation-neighbor or bibliographic-coupling tools on selected seeds with an explicit scope.
3. **Extract Evidence:** Return to semantic passages or direct pages for substantive claims; graph edges do not prove findings.

## Query Construction

- Use task-oriented search phrases rather than bare keywords.
- Include author/year or title tokens when targeting known papers because DCR headers are indexed.
- For substantive claims, return to the core fast path and apply `citation-integrity`; metadata and graph output never substitute for passage or page evidence.
