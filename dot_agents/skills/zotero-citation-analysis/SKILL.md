---
name: zotero-citation-analysis
description: Examines citation neighbors, resolved inbound-edge rankings, and bibliographic coupling within an explicit Zotero graph scope. Use when Samuel asks which works cite a paper, what a paper cites, which work is most cited in a collection, or which stored papers share references.
---

# Zotero Citation Analysis

## Non-Negotiable Rules

- State the graph scope and measure before calling a citation tool.
- Graph edges are resolved relationships, not raw bibliography occurrence counts.
- Preserve citing direction, target identity, node kind, and scope.
- Unresolved bibliography entries are invisible to graph-edge counts.
- External nodes establish incoming relationships and metadata only; they do not establish the external work's findings or outgoing bibliography.
- Never call inbound degree a raw citation total, HITS score, hub score, or general centrality.
- Read source passages separately before reporting substantive findings from any paper found through the graph.

## Choose the Graph Operation

- Direct cited or citing neighbors: `zotero_get_citation_neighbors`, `depth=1`.
- Works sharing resolved references: `zotero_find_bibliographically_coupled_papers`.
- Ranking by resolved inbound edges: `zotero_rank_works_by_inbound_citations`.
- True bibliography occurrences: stop and use `zotero-bibliography-search` instead.

For detailed node and scope semantics, load [citation graph details](../../references/zotero/bibliography-graphs.md).

## Scope Rules

Use one explicit scope:

- `collection`: citing sources and allowed resolved targets are inside the collection.
- `library`: citing sources and resolved targets are library items.
- `collection-expanded`: citing sources remain in the collection; targets may be elsewhere in the library or external nodes.
- `library-expanded`: sidecar-backed library sources may target resolved library items or external nodes.

Collection scopes require `collection_key`. Expanded scope changes allowed targets; it never adds citing papers outside the requested scope.

If Samuel names a topic rather than a seed paper, use `zotero-paper-discovery` first to identify bounded seed items. Do not use citation centrality as semantic topic relevance.

## Direct Neighbors

Call `zotero_get_citation_neighbors` with:

- Exact seed parent key.
- `depth=1`.
- Explicit direction when supported.
- Explicit scope and collection key when applicable.

Report each edge as incoming or outgoing. A one-hop result does not authorize recursive traversal or claims about the whole network.

## Bibliographic Coupling

Call `zotero_find_bibliographically_coupled_papers` with the exact seed and scope. Report:

- Related parent key.
- Shared resolved references.
- Returned Jaccard or other named similarity measure.
- Resolution limitations.

An empty result can reflect low reference-resolution coverage rather than substantive dissimilarity.

## Inbound Ranking

Call `zotero_rank_works_by_inbound_citations` with an explicit scope, collection key when needed, and bounded `top_n`.

Report the measure as `resolved inbound edges`. Attach the returned resolution-coverage limitation. Do not compare it directly with publisher, Google Scholar, or raw bibliography citation counts.

## Identity and External Nodes

- Verify a resolved item key before treating two labels as the same work.
- `ext:doi:*` identifies a DOI-backed external node.
- `ext:meta:*` is a heuristic metadata node and may split title variants.
- `unresolved` or `ambiguous` raw entries do not establish a graph edge.
- A target outside the requested collection can still be a resolved library item.

## Answer

Name the exact graph measure, scope, direction, and node type in the result. Use `citation-integrity` for graph claims and evidence locators.

If Samuel then asks what a discovered paper finds, switch to `zotero-source-reading`; graph evidence cannot support findings.

## Stop Condition

Stop after the requested one-hop, coupling, or bounded ranking result. Do not expand the graph merely to make the answer feel complete.
