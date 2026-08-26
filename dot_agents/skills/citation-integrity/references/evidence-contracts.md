# Evidence Contracts

**Load this file when** writing any Zotero-grounded claim or deciding which brace token and confidence fields belong to passage, direct-source, bibliography-index, or graph evidence.

## 1. Semantic-passage evidence

Use for findings, mechanisms, definitions, specifications, and estimates retrieved by `zotero_zotero_semantic_search`.

Canonical form:

`{Author Year, passage N/M, p. X if available, Rerank +S}`

Example:

`{Stacy 2018, passage 27/40, p. 14, Rerank +3.22}`

Requirements:

- Read the displayed `Matched Passage`.
- Use the displayed raw `Rerank`; never substitute `Relevance`.
- Include only available location fields. Do not invent a page.
- A passage marked `REF`, a `References` breadcrumb, or bibliography-only text is discovery metadata, not substantive evidence.
- Author/year should come from the returned item metadata or DCR prefix. If attribution is unavailable, verify the item before citing or say attribution is unavailable.

## 2. Direct-source evidence

Use when a semantic snippet is incomplete, a number needs verification, or semantic score instrumentation is unavailable but the source itself can be read.

Canonical forms:

- `{Author Year, p. X, direct PDF}`
- `{Author Year, direct fulltext, item KEY}` when the full-text tool has no reliable page mapping

Quote or paraphrase only text actually returned by `zotero_zotero_read_pdf_pages` or `zotero_zotero_get_item_fulltext`. Prefer page reads for manuscript-grade numerical claims.

## 3. Bibliography-reference evidence

Use `zotero_zotero_search_references` for literal bibliography occurrences, DOI/title lookup, citing-source context, and graph-target resolution.

Canonical form:

`{search_references → citing KEY, entry N, status/method, resolution confidence C, parse P}`

Examples:

- `{search_references → citing F7EGNIBT, entry 20, unresolved, parse 0.78}`
- `{search_references → citing BXCIHFPR, entry 73, external_reference via DOI, resolution 0.95, parse 0.78}`

Rules:

- BM25 is a ranking signal, not identity confidence.
- An exact raw-entry occurrence may be reported even when unresolved, but phrase it literally: “the bibliography contains an entry rendered as …”.
- `unresolved` cannot support a clean target identity or graph edge.
- `ambiguous` cannot support a chosen identity.
- For `resolved` or `external_reference`, include the returned method/confidence when identity matters.
- External labels can inherit parser noise. Verify title/DOI against the raw entry and library metadata before normalizing it.
- Reference evidence never supports the target paper's substantive findings.

## 4. Citation-graph evidence

Use for hubs, direct cited/citing neighbors, and bibliographic coupling.

Canonical forms:

- `{get_collection_hubs → scope collection, hub #1, 14 inward citations}`
- `{get_paper_lineage → scope library-expanded, direct incoming neighbor of ext:…}`
- `{find_connected_papers → scope collection-expanded, Jaccard 0.50, 1 shared citation}`

Rules:

- State the exact scope.
- Report only the returned rank, direction, count, or coupling score.
- Never present a graph count as an empirical estimate.
- Deterministic does not mean complete: sidecar coverage, reference parsing, entity matching, and index freshness bound the claim.
- Citation counts are **lower bounds**. Sidecar-less sources, collapsed/unresolved entries, and variant/version-split nodes are excluded; phrase a hub count as a graph-edge count, not as total citations.
- When a hub/lineage count involves external nodes, name the node kind in the token (`ext:doi` vs `ext:meta`). `ext:meta` counts are heuristic and approximate — verify with `search_references` before quoting.
- Expanded graph labels involving external nodes should be verified with `search_references` before being presented as clean bibliography metadata.
- Current lineage output is direct-neighbor evidence even if the tool accepts a larger `depth` value; never claim unreturned recursive paths.

## 5. Metadata facts

Title, creators, year, item key, tags, collection membership, attachment status, and existence are API facts. They need no brace token, but must be verified and must not be inferred from an external-reference label when a Zotero metadata lookup is available.
