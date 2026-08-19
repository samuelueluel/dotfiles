# Search & Retrieval (RAG)

**Load this file when** doing semantic or structured search, constructing queries, verifying retrieved passages, or running the retrieval → answer loop.

## Tool selection

| Goal | Tool |
|---|---|
| Find papers by concept/topic | `zotero_zotero_semantic_search(query, collection=<KEY>, limit=10)` |
| Find foundational hub papers in a collection | `zotero_zotero_get_collection_hubs(collection_key=<KEY>, top_n=5)` |
| Trace paper lineage (ancestors & descendants) | `zotero_zotero_get_paper_lineage(item_key=<KEY>, depth=1)` |
| Find co-cited / connected papers | `zotero_zotero_find_connected_papers(item_key=<KEY>, top_n=5)` |
| Precise metadata filters (date range, item type) | `zotero_zotero_advanced_search` |
| Find a specific paper by name | `zotero_zotero_search_items` (substring) |
| Exact citekey lookup | `zotero_zotero_search_by_citation_key` |
| Items with a tag | `zotero_zotero_search_by_tag` |
| Collection key lookup | `zotero_zotero_search_collections` / `references/collections.md` |

## Query routing: Semantic RAG vs. Citation Graph

Pick the retrieval tool matching the question's structure:

1. **Cross-Paper Empirical Synthesis & Literature Consensus $\to$ `semantic_search`:**
   - *Triggers:* "What does my literature say about the effect of Y?", "What are the estimated elasticities across my papers?", "What mechanisms link foreclosure to blight?", "What is the empirical consensus on X?"
   - *Mechanism:* Cross-corpus hybrid dense + BM25 retrieval with cross-encoder reranking. Pulls top passages across multiple papers for comparative empirical synthesis under the `citation-integrity` discipline.

2. **Specific Empirical Estimates, Equations, or Figures $\to$ `semantic_search`:**
   - *Triggers:* "What point estimate did Larson report in Table 4?", "What estimator did X use?", "Find papers discussing parallel trends testing", "Show me event study figures with 95% CIs."
   - *Mechanism:* Chunk-level retrieval matching specific model specifications, numbers, formulas, and VLM figure schemas.

3. **Collection Overviews & Foundational Literature $\to$ `get_collection_hubs`:**
   - *Triggers:* "What are the core / anchor papers in my Detroit collection?", "What foundational literature is most cited across this project?", "Give me an overview of collection X."
   - *Mechanism:* Inward citation in-degree and PageRank centrality across `# References` sections in local sidecars.

4. **Intellectual Lineage & Follow-Up Literature $\to$ `get_paper_lineage`:**
   - *Triggers:* "What literature does paper X build on?", "What papers in my library cite Glaeser & Gyourko (2005)?", "Trace the descendants of the Bartik paper."
   - *Mechanism:* Directed graph traversal of local ancestor citations (`cites`) and descendant papers (`cited_by`).

5. **Structural Paper Similarity & Related Work $\to$ `find_connected_papers`:**
   - *Triggers:* "Find papers in my library related to X even if they use different terminology", "What papers share the same theoretical foundation as paper X?"
   - *Mechanism:* Jaccard bibliographic coupling (overlap in cited reference sets). Completely immune to vocabulary mismatch.

6. **Two-Stage Literature Synthesis Loop (Graph $\to$ RAG):**
   - For broad literature review queries:
     - **Stage 1 (Graph):** Call `get_collection_hubs` or `find_connected_papers` to identify the anchor papers in the collection.
     - **Stage 2 (RAG):** Run targeted `semantic_search` or deep-dive sidecar reading on those exact keys for specific empirical claims and equations.

## Query construction

- **Instruct prefix:** the embedder prepends `Instruct: <task>` to queries, so task-style phrasing ("which papers estimate event-study DiD designs?") retrieves better than bare keywords.
- **Titles & Author/Year in DCR prefix:** the DCR prefix (`[Paper: <title> (<author> <year>) | Section: <breadcrumb>]`) imprints the title, author citation (e.g. `Larson 2019`, `Callaway & Sant'Anna 2021`, or `Carrillo et al. 2019`), and section heading on every chunk across both the dense and BM25 indexes.
- **Figure-query composition:** content-bearing phrasing + author/figure numbers (e.g. "Larson 2019 figure 1 demolitions bar chart") hits the exact figure schema and caption chunk. Pure meta-style phrasing ("what does figure 1 show") misses.
- **Quantitative concept reformulation:** when performing a search related to a quantitative concept in economics, econometrics, statistics, or mathematics, keep in mind that the same quantitative concept can be expressed in multiple ways. For example:
  - *Staggered DiD / rollout:* "differential timing of adoption", "variation in treatment timing", "two-way fixed effects decomposition"
  - *Event study / pre-trends:* "leads and lags of adoption", "dynamic treatment effects", "$H_0: \gamma_k = 0$"
  - *Weak IV:* "first-stage F-statistic", "Montiel Olea Pflueger effective F", "Anderson-Rubin confidence set"
  - *RD manipulation:* "McCrary density test", "continuity of the score density at cutoff"
  - *Bunching:* "excess mass around the kink point", "notch in the tax schedule"
  If initial results seem poor (empty results, or top passage `Rerank` < 0.0), try a few reformulations or translations of the concept.
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
