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

## Topic-Conditioned Discovery Pipeline

For topical exploration inside broad collections:
1. **Identify Seeds:** Run `zotero_zotero_semantic_search` (with `collection=<KEY>`) or metadata search to locate relevant seed items.
2. **Expand Graph:** Run `get_paper_lineage` or `find_connected_papers` on seed keys (choose closed or expanded scope based on need).
3. **Extract Evidence:** Retrieve substantive findings from identified papers using targeted semantic search or direct sidecar extraction.

## Query Construction & Evidence Hygiene

- Use task-oriented search phrases rather than bare keywords.
- Include author/year or title tokens when targeting known papers (DCR headers are indexed).
- Treat `Rerank` score as the primary relevance threshold. Never cite matches that lack a reranker score.
- Reject chunks marked `REF` or containing bibliography lists for substantive evidence.
- Verify empirical numbers against exact sidecar tables/passages or full-text extraction per `citation-integrity` rules.
