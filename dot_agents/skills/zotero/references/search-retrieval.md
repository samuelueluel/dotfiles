# Search, Retrieval & Citation Graph Routing

**Load this file when** handling exact-source edge cases, semantic filters, difficult comparisons, citation counts, external references, or citation-graph scopes.

## Exact-Source Identity Obligation

Apply this procedure only when the request names a particular source or item. It is a transient obligation for the current task, not a permanent candidate ledger.

### 1. Detect an exact-source request

Trigger it when the user supplies a title, author/title/year combination, DOI, Better BibTeX citation key, Zotero item key, or language such as “in this paper.” Do not trigger it merely because the topic is narrow; “find papers about…” and collection-wide comparisons are discovery tasks.

### 2. Resolve identity before substantive retrieval

Use `zotero_resolve_exact_source` for the first identity check. Pass the original request in `source`; pass `title`, `author`, `year`, `doi`, `citation_key`, or `item_key` explicitly when available, and pass `collection_key` when scope matters. The tool performs metadata-only lookup and returns `identity_status`, `exact_matches`, `ambiguous_matches`, `related_matches`, `conflicts`, and `collection_scope`; each match summary includes `in_requested_scope` and `scope_basis` for interpreting a requested collection. Preserve the original target exactly: do not delete qualifiers, “repair” the title using a related result, or turn a related result into a new exact-source query during the same task.

If the resolver is unavailable, use the narrowest legacy route:

- item key: `zotero_get_item_metadata`;
- Better BibTeX key: `zotero_find_item_by_citation_key`;
- title/author/year or DOI fragment: `zotero_search_items`, then metadata for plausible exact candidates;
- collection membership: use the resolver's `in_requested_scope` and `scope_basis` fields when present; otherwise use the collection-scoped lookup. Do not infer non-membership from an empty `collections` display field.

Read the resolver's exact-match status separately from any related-results field. The ordinary `zotero_search_items` tool may return simplified or semantically related records after reporting that the original exact search found no result. Those records do not satisfy identity.

Treat the resolver's `identity_status` as authoritative for the identity phase:

- `exact`: the identifiers and metadata resolve to one record, and the record is in scope when a collection is specified;
- `ambiguous`: multiple plausible records remain, or identifiers conflict (for example, a real title paired with another item's DOI);
- `absent`: a bounded exact metadata check finds no in-scope record matching the requested identity.

Do not use a semantic RAG score, shared author, similar title, or topical relevance as an identity match. The resolver is an identity gate, not evidence for the source's findings. For `ambiguous`, stop source-specific retrieval until the identity is clarified; conditional results must be labeled by item. For `absent`, stop source-specific retrieval entirely: do not call semantic search, full text, outline, graph, or another broad metadata fallback to answer from a neighbor. The resolver's `related_matches` are metadata-only context and must not be given substantive findings. Do not issue another resolver call for a related title unless the user explicitly changes or clarifies the target, or separately asks about that related work.

### 3. Bind evidence to identity

For `exact`, prefer a direct source route. When semantic search is needed to locate a passage, pass the resolver's verified key as an exact identity scope: `filters={"item_keys": ["<KEY>"]}`. This restricts both dense and sparse retrieval to that paper's chunks at query time; an empty result means no passage in the verified item matched the query — fall back to direct reading rather than removing the filter to admit neighbors. Substantive evidence and the final token must cite that same key. Do not silently combine a working paper, published version, or related study with the named record.

For `ambiguous`, present the competing records or metadata conflict and ask for clarification or give conditional answers explicitly labeled by item. For an identifier conflict, state that no in-scope record satisfies the full supplied identity. Do not merge findings.

For `absent`, report that the requested source or source-specific evidence was not found. Never answer the named-source question from a semantic neighbor. Related records may be offered separately as metadata-only related works, but must not be presented as the requested source. When a collection was requested, use each related match's `in_requested_scope` and `scope_basis`; do not call it out-of-scope from an empty `collections` display field. If the user later asks about one of those works, begin a new explicitly labeled source task.

Identity absence is not claim absence. If the source is `exact` but the requested finding is not present in its retrieved evidence, state that the source-specific claim was not established rather than substituting another paper.

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

Type, source-group, tag, and collection scopes use parent Zotero `item_key` identity. Tags and native types are resolved from the local SQLite snapshot at query time, and the same item-key scope reaches dense and BM25 retrieval, so changes do not require re-embedding. After Zotero writes or sync, close Desktop and allow WAL checkpointing before relying on newly changed metadata. If live tag filtering cannot access local SQLite, report the failure rather than returning unfiltered results.

Minimal patterns:

```python
zotero_semantic_search(query="treatment effects", filters={"tags": ["review:checked"]})
zotero_semantic_search(query="econometrics", filters={"item_type": "book"})
zotero_semantic_search(query="urban policy", filters={"source_group": "article"})
zotero_semantic_search(query="causal inference", filters={"source_group": "article", "tags": ["review:checked"]}, collection="<KEY>")
```

Results may report `Source Group`, but tags and source groups are user/query metadata—not evidence. For substantive claims, retain the matched passage, location, reranker score, and citation-integrity verification.

## Retrieval Architecture: Evidence Layer vs. Judgment Layer

1. **Passage RAG (`zotero_semantic_search`):** Dense vector + BM25 search over local MinerU sidecars, reranked by `:8083`. Supports substantive claims, estimates, and equations. Exposes raw `Rerank` scores.
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
| **In scoped collection** | `zotero_list_collection_items`; item `Collections` contains key | All scopes; closed `collection` limits both ends to members | Closed scope for internal structure; `zotero_search_bibliography_entries(collection_key=...)` for counts |
| **In library, outside collection** | `zotero_search_items` finds item; `Collections` lacks key | `collection-expanded` as a *resolved* target; `library` / `library-expanded` | Counted as a resolved node (NOT `ext:*`); expanded citation-neighbor query to view as target |
| **Outside library entirely** | No `zotero_search_items` match; `zotero_search_bibliography_entries` returns `external_reference` | `collection-expanded` / `library-expanded` only, as `ext:doi:*` or `ext:meta:*` | Counted via `ext:*` edges; verify metadata via `zotero_search_bibliography_entries`; never infer findings |

## Tool Constraints & Fallbacks

- **Neighbor Depth:** `zotero_get_citation_neighbors` requires `depth=1` and returns direct neighbors only. Other values are rejected; multi-hop traversal is not implemented.
- **Output Bounds:** Expanded citation-neighbor queries on broad textbooks can return hundreds of nodes. Use targeted `zotero_search_bibliography_entries` first.
- **Collection Scope Filtering:**
  - `semantic_search(collection=...)` dynamically includes child subcollections.
  - `zotero_search_bibliography_entries(collection_key=...)` filters citing sources by direct collection membership only.
- **Bibliographic Coupling (`zotero_find_bibliographically_coupled_papers`):** Couples on **resolved** outgoing citations. If a seed paper has few resolved outgoing references (e.g., older citations without DOIs), results may be empty. Fall back to citing papers via `zotero_get_citation_neighbors` or semantic search on key terms.

## Difficult Comparisons and Superlatives

Use this section only after the core bounded RAG workflow exposes a concrete comparability or candidate-recall problem.

### Comparability

For plausible leaders, establish the dimensions required by the question—commonly outcome, sign, unit, treatment dose, geography, horizon, and specification. Rank only sufficiently comparable estimates. If estimands differ, name a truthful dimension such as “largest reported nearby-spillover percentage” rather than asserting a universal winner.

### Bounded candidate recall

Semantic top-k retrieval is not proof of exhaustive recall. When a missed candidate could plausibly change a collection-wide superlative, run one orthogonal collection-scoped metadata or lexical search over discriminating title or abstract terms. Union plausible candidates with the semantic shortlist. Enumerate the collection only when targeted discovery leaves a concrete completeness problem or the user requests an audit.

### Verification and stopping

Verify the winning claim and only the challengers needed to justify or qualify it. Stop when the requested comparison is supported, units and context are verified, plausible challengers from bounded discovery are resolved, remaining incompatibilities are disclosed, and another call is unlikely to change the answer. Fetch metadata only for sources that will appear in the answer.

## Topic-Conditioned Graph Discovery

When the task genuinely asks for structural neighbors or broader topical exploration:
1. **Identify Seeds:** Run scoped semantic or metadata search.
2. **Expand Graph:** Run citation-neighbor or bibliographic-coupling tools on selected seeds with an explicit scope.
3. **Extract Evidence:** Return to semantic passages or direct pages for substantive claims; graph edges do not prove findings.

## Query Construction

- Use task-oriented search phrases rather than bare keywords.
- Include author/year or title tokens when targeting known papers because DCR headers are indexed.
- For substantive claims, return to the core fast path and apply `citation-integrity`; metadata and graph output never substitute for passage or page evidence.
