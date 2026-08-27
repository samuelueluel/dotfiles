# Evidence Contracts & Token Specifications

**Load this file when** composing Zotero-grounded claims or formatting canonical brace tokens for passages, direct source reads, bibliography entries, or graph structures.

## 1. Semantic-Passage Evidence

Use for substantive findings, mechanisms, definitions, formulas, and empirical estimates retrieved via `zotero_zotero_semantic_search`.

- **Canonical Format:** `{Author Year, passage N/M, p. X if available, Rerank +S}`
- **Example:** `{Stacy 2018, passage 27/40, p. 14, Rerank +3.22}`
- **Rules:**
  - Quote or paraphrase only from the displayed `Matched Passage`.
  - Use the raw `Rerank` score; never substitute `Relevance` (`1 - distance`).
  - Include page numbers only when present in the snippet or DCR breadcrumb; never invent pages.
  - Exclude passages marked `REF`, `References` breadcrumbs, or bibliography lists from substantive claims.
  - Derive author and year from item metadata or DCR prefixes.

## 2. Direct-Source Evidence

Use when verifying empirical numbers, resolving truncated snippets, or operating when semantic score instrumentation is unavailable.

- **Canonical Formats:**
  - `{Author Year, p. X, direct PDF}`
  - `{Author Year, direct fulltext, item KEY}` (when exact page numbers are unmapped)
- **Rules:**
  - Quote or paraphrase only text returned by `zotero_zotero_read_pdf_pages` or `zotero_zotero_get_item_fulltext`.
  - Prefer page reads (`read_pdf_pages`) for paper-grade numerical claims.

## 3. Bibliography-Reference Evidence (Evidence Layer)

Use `zotero_zotero_search_references` for literal reference occurrences, raw bibliography strings, citing-source context, and graph resolution status.

- **Canonical Format:** `{search_references → citing KEY, entry N, status/method, resolution confidence C, parse P}`
- **Examples:**
  - `{search_references → citing F7EGNIBT, entry 20, unresolved, parse 0.78}`
  - `{search_references → citing BXCIHFPR, entry 73, external_reference via DOI, resolution 0.95, parse 0.78}`
- **Rules:**
  - BM25 score reflects text match ranking, not entity identity confidence.
  - Report raw bibliography occurrences literally (e.g., "The bibliography contains an entry rendered as...").
  - `unresolved` or `ambiguous` statuses support raw string occurrences only, never clean target identities or graph edges.
  - Reference search evidence proves citation occurrence only, never the cited paper's substantive findings.

## 4. Citation-Graph Evidence (Judgment Layer)

Use for most-cited rankings, direct lineage neighbors, and bibliographic coupling.

- **Canonical Formats:**
  - `{get_collection_hubs → scope collection, hub #1, 14 inward citations}`
  - `{get_paper_lineage → scope library-expanded, direct incoming neighbor of ext:...}`
  - `{find_connected_papers → scope collection-expanded, Jaccard 0.50, 1 shared citation}`
- **Rules:**
  - State the explicit `scope` parameter in every graph token.
  - "Hub" denotes a **most-cited ranking in scope** (inbound edges), not network centrality. Phrase claims as "top-cited in scope".
  - Graph counts are graph-edge counts and directional, not total citation counts (unresolved and sidecar-less citations are omitted).
  - Cross-check graph identities and counts against `search_references` (the evidence layer).
  - Explicitly identify external node kinds (`ext:doi` vs. `ext:meta`). Treat `ext:meta` counts as heuristic and approximate.
  - `get_paper_lineage` output reflects direct (depth 1) neighbors only.

## 5. Metadata API Facts

Plain metadata (title, creators, year, item key, tags, collection membership, attachment status) are API facts. They require verification but do not require brace tokens.
