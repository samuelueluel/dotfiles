# Search and Retrieval

**Load this file when** choosing among semantic RAG, bibliography search, metadata search, or citation-graph tools; selecting graph scope; handling an external reference; or executing a discovery-to-evidence workflow.

## Fast router

| User goal | First tool |
|---|---|
| Findings, mechanisms, estimates, equations, robustness, figure prose | `zotero_zotero_semantic_search` |
| Exact DOI/title in bibliographies; “which local items cite X?”; raw reference entry | `zotero_zotero_search_references` |
| **Citation counts** (“how many times is X cited”, “most-cited work in / external to a collection”) | `zotero_zotero_search_references` — count raw occurrences, dedupe citing items per identity. **Never read counts off `get_collection_hubs`** (see below). |
| Known Zotero metadata or item identity | `zotero_zotero_search_items`, `zotero_zotero_advanced_search`, or citekey lookup |
| Citation anchors / hub structure (graph-edge counts; approximate for external) | `zotero_zotero_get_collection_hubs` with `collection` or `library` |
| Direct cited/citing neighbors of a known graph node | `zotero_zotero_get_paper_lineage` |
| Local papers sharing references with a known local seed | `zotero_zotero_find_connected_papers` |
| Reference parsing/resolution coverage | `zotero_zotero_audit_references` |

`zotero_zotero_rebuild_citation_graph` and `zotero_zotero_rebuild_reference_index` are maintenance tools, not query-time discovery tools.

## Three distinct retrieval layers

1. **Passage RAG** searches locally indexed Zotero full text. It can support substantive source claims.
2. **Reference search** uses a separate BM25 index over individual bibliography entries. It supports literal citation-occurrence and reference-metadata claims, not the cited work's findings.
3. **Citation graph** traverses resolved citation identities and computes structural measures. It is deterministic but incomplete because parsing and entity resolution are incomplete.

**`get_collection_hubs` counts are graph-edge based, not raw-occurrence based.** A node's `inward_citations` counts bibliography entries that became graph edges: resolved library items, DOI-carrying `ext:doi:*` nodes, and — since the metadata-external fix — heuristic `ext:meta:*` nodes for DOI-less entries. Entries that stay `unresolved` (broad/collapsed/garbled) still contribute zero edges; in economics sidecars the unresolved share can be large (run `zotero_zotero_audit_references` to see current coverage). Consequences: (a) hubs counts remain a **lower bound** on true citations (unresolved leftovers, self-citations, and title-variant splits are not counted); (b) `ext:meta` counts are **approximate** — OCR-garbled entries can add spurious nodes, and typos can split one work across nodes. Use `zotero_zotero_search_references` for exact counts; use `zotero_zotero_audit_references` to check residual resolution coverage before trusting any graph-derived count.

Do not use semantic RAG for exact DOI/bibliography lookup, and do not use reference or graph metadata to assert findings.

## External-reference decision tree

Run `zotero_zotero_search_references` with an exact DOI when available, otherwise a distinctive title/author query. Inspect each result:

- `resolution: resolved`, target type `zotero_item` → use the returned Zotero key for graph traversal or local passage retrieval.
- `resolution: external_reference`, target key `ext:*` → metadata-only graph node. Two kinds: `ext:doi:*` (DOI-backed, confidence ~0.95) and `ext:meta:*` (derived from first-author surname + year + title fingerprint, confidence ≤ 0.72 — heuristic). Use an expanded lineage scope to find local source items with known incoming citations to that node. **Verify `ext:meta:*` labels with `search_references` before presenting them as clean metadata** — they are extracted from possibly OCR-garbled bibliography text and can be mislabeled (e.g. a garbled entry attributed to the wrong author) or split across title-variant nodes.
- `resolution: unresolved` or `ambiguous` → the raw bibliography occurrence is available, but there is no trustworthy graph edge. Report that limitation; never force a match.

Before declaring an `external_reference` absent from the library, search Zotero metadata by DOI, title, authors, and likely preprint/published variants. A conservative resolver may keep two versions separate. Do not merge them without identity evidence.

An external node can have incoming edges from local sidecar-backed sources. It cannot supply its own outgoing bibliography, findings, or bibliographic coupling because it is never a graph source. `find_connected_papers` therefore starts from a resolved local item, not an `ext:*` node.

Metadata-based external nodes (`ext:meta:*`) are created from DOI-less entries that match no library item, using a conservative (surname, year, title) extraction. They make previously `unresolved` citations visible to hubs/lineage, but carry real noise: OCR-garbled entries can produce spurious nodes, and title variants (typos, "housing prices" vs "house prices", quoted vs unquoted) can split one work across several nodes. Treat their inward counts as approximate and verify with `search_references`. A work cited sometimes with and sometimes without a DOI may split into `ext:doi` + `ext:meta` nodes (version-splitting).

## Graph scopes

| Scope | Sources | Allowed citation targets | Use when |
|---|---|---|---|
| `collection` | selected collection | resolved items in the same collection | closed project map |
| `library` | resolved library items | resolved library items | closed library map |
| `collection-expanded` | selected collection | resolved items anywhere plus external nodes | collection's wider intellectual context |
| `library-expanded` | all sidecar-backed library sources | resolved items plus external nodes | library-wide external context |

`collection-expanded` is not merely “collection plus external works”: resolved targets outside the collection also enter.

Always pass an explicit scope. Pass `collection_key` for either collection scope. Expanded scopes cover only references extracted from local sidecars; they are not universal citation indexes.

## Membership taxonomy & routing

Five phrasings map onto three distinct membership states. The pair that causes confusion is the first two rows — “external to the collection” can mean a library item outside the collection, or a work outside the library entirely. Disambiguate with `zotero_zotero_search_items` (rows 1–2) vs `search_references` resolution (row 3).

| Membership state | How to identify | Graph visibility | Count semantics | Routing |
|---|---|---|---|---|
| **In the scoped collection** (library item, member) | `zotero_zotero_get_collection_items`; item `Collections` field | all scopes; closed `collection` limits both ends to members | graph edges in; complete on the source side only if members have sidecars | closed scope for internal structure; `search_references(collection_key=...)` for occurrence counts |
| **In the library, outside the scoped collection** (= “external to the collection but internal to the library”) | `search_items` finds it; `Collections` lacks the key | `collection-expanded` as a *resolved* target; `library` / `library-expanded` | counted as a resolved node, NOT an `ext:*` node | expanded lineage/hubs to see it as a target of collection papers; `search_references` to enumerate citing collection items |
| **Outside the library entirely** (= “external to the collection and to the library”) | no `search_items` match; `search_references` returns `resolution: external_reference` | `collection-expanded` / `library-expanded` only, as `ext:doi:*` (confident) or `ext:meta:*` (heuristic) | counted via `ext:*` edges; `ext:meta` approximate and fragmented across title/version variants | expanded lineage to find local citers; verify every `ext:*` label with `search_references` before treating it as clean metadata; never infer findings from an ext node |

“External to the library” alone always means row 3; “internal to the library” means rows 1–2 together. A resolved item outside the collection must never be reported as an external work, and an `ext:*` node must never be presented as a library item.

### What citation counts still miss

All citation counts — graph hubs **and** `search_references` occurrence counts — are **lower bounds**. Not counted:

- **Sources without sidecars.** Only sidecar-backed library items contribute bibliography entries, so citations *from* sidecar-less papers are invisible to both graph and reference search. Library-wide coverage is partial (run `zotero_zotero_audit_references` for the current figure); a collection's counts are only as complete as that collection's sidecar coverage.
- **Collapsed/broad entries.** Where the parser merged several references into one line, the entry stays `unresolved` and contributes no edge — these are real citations lost to parsing, not to absence.
- **Fragmented works.** A single work cited under title variants splits across multiple `ext:meta:*` nodes; a work cited sometimes with and sometimes without a DOI splits into `ext:doi` + `ext:meta`. Per-node counts therefore undercount the work — add variant nodes when presenting totals.
- **Self-citations** (source citing its own earlier version) are excluded by design.

Verify a candidate's count with `search_references` on its exact identity before quoting it.

## Tool-specific limits

- `get_paper_lineage(depth=...)` currently returns direct neighbors only; do not claim recursive depth traversal.
- Expanded lineage on books/manuals can return hundreds of nodes and exceed the MCP output guard. Prefer a targeted reference query first; use lineage only after resolving a specific target or when a broad list is explicitly needed.
- `search_references(collection_key=...)` filters citing source items by direct membership only; it does not include subcollections.
- `semantic_search(collection=...)` resolves live membership and includes subcollections.
- `find_connected_papers` couples on **resolved** outgoing citations. A paper can be a hub with many incoming citations yet have few resolved outgoing references (old-style citations without DOIs, references to works outside the library) and return few or no connected papers. That is a coverage property, not an error, and not evidence the paper lacks related work. If it returns empty, fall back to `get_paper_lineage` (citing papers), `get_collection_hubs` on the scope, or a semantic search using the paper's key terms.
- `get_collection_hubs` ranks **graph nodes** (library items + `ext:doi:*` + `ext:meta:*` external works) by inbound graph edges. Counts are directional, not exact: unresolved leftovers and title-variant splits are excluded, and `ext:meta` counts are approximate. For exact totals, count raw occurrences via `search_references`.
- Expanded hub/connected output can contain noisy labels from imperfect bibliography parsing — especially `ext:meta:*` nodes (see the external-reference section). Verify an external label, DOI, and confidence with `search_references` before presenting it as clean metadata.

## Topic-conditioned discovery

Graph tools do not accept a semantic topic query. `get_collection_hubs` ranks the whole selected scope among graph nodes (library + external); it is a good quick map of a genuinely narrow project collection, but its counts are directional, never exact citation totals (see the graph-edge warning above).

For a topic inside a broad or mixed collection:

1. Use collection-scoped semantic search or metadata search to identify local seed items.
2. Expand from their item keys with lineage or connected-papers, choosing closed or expanded scope based on the question.
3. Return to targeted semantic search or direct PDF pages for substantive evidence.

For a narrow collection overview, hubs may come first — it now surfaces external anchors too, but label its counts as graph-edge/directional; if the question is “what is cited most,” count occurrences with `search_references` for precision.

## Query construction and verification

- Prefer task-oriented phrasing over bare keywords.
- Include author/year or title when targeting a known local paper; DCR breadcrumbs are indexed.
- Use `collection=<key>` for project-scoped semantic RAG.
- Treat `Rerank` as the passage-confidence signal. `Relevance` alone is not sufficient.
- Never use a hit marked `REF`, a `References` breadcrumb, or a bibliography-only passage as substantive evidence.
- For numbers, use direct PDF/full-text tools if the returned passage is truncated or incomplete.
- Apply the citation-integrity skill to passage, reference-index, and graph claims.

## Concrete routing examples

- “What assumptions identify Callaway–Sant'Anna group-time effects?” → semantic search, preferably Methods-scoped; cite the matched passage and raw Rerank score.
- “Which of my papers cite DOI 10.x/y?” → exact DOI reference search; optionally traverse the returned target key.
- “Which Programming items cite this external preprint?” → reference search scoped to the Programming collection, then `collection-expanded` lineage on the returned `ext:*` key.
- “What external works anchor my Detroit collection?” → quick map: `collection-expanded` hubs lists both resolved and external (`ext:meta:*`) anchors with graph-edge counts — good for a first pass, but counts are directional. For citation *totals*, run `search_references` scoped to the collection on candidate identities (or topical queries) and count distinct citing items; cross-check the returned `resolution` field.
- "What local papers are related to this paper despite different vocabulary?" → connected-papers from the local item key; use an expanded scope when shared external citations should count. If connected-papers returns empty, the seed may have few *resolved* outgoing references — fall back to citing papers via lineage or a semantic search rather than concluding no related work exists.
