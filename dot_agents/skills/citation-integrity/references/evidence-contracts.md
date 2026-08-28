# Evidence Contracts & Token Specifications

**Load this file when** composing Zotero-grounded claims or formatting canonical brace tokens for passages, direct source reads, bibliography entries, or graph structures.

## 1. Semantic-Passage Evidence

Use for substantive findings, mechanisms, definitions, formulas, and empirical estimates retrieved via `zotero_zotero_semantic_search`.

- **Canonical Format:** `{Author Year, item KEY, passage N/M, p. X if available, Rerank +S; itemType/source_group; canonical tags if present}`
- **Example:** `{Author 2024, item ABCDEFGH, passage 27/40, p. 14, Rerank +3.22; journalArticle/article; review:checked}`
- **Rules:**
  - Quote or paraphrase only from the displayed `Matched Passage`.
  - Use the raw `Rerank` score; never substitute `Relevance` (`1 - distance`).
  - Include page numbers only when present in the snippet or DCR breadcrumb; never invent pages.
  - Exclude passages marked `REF`, `References` breadcrumbs, or bibliography lists from substantive claims.
  - Derive author and year from item metadata or DCR prefixes.
  - Verify native `itemType` and canonical `review:*` / `type:*` tags for final cited sources via item metadata; derive `source_group` from semantic output or the locked mapping. Retrieve this metadata once per final source, not for discarded candidates.
  - Include only canonical `review:*` and `type:*` tags. Omit the tag segment when none are present or retrieval fails; never copy legacy subject tags into the token.

## 2. Direct-Source Evidence

Use when verifying empirical numbers, resolving truncated snippets, or operating when semantic score instrumentation is unavailable.

- **Canonical Formats:**
  - `{Author Year, item KEY, p. X, read_pdf_pages; itemType/source_group; canonical tags if present}`
  - `{Author Year, item KEY, get_item_fulltext; itemType/source_group; canonical tags if present}` (when exact page numbers are unmapped)
- **Rules:**
  - Quote or paraphrase only text returned by `zotero_zotero_read_pdf_pages` or `zotero_zotero_get_item_fulltext`.
  - Prefer page reads (`read_pdf_pages`) for paper-grade numerical claims.
  - Do not use the legacy route label `direct PDF`; name the actual tool route.
  - Append verified source classification exactly as for semantic-passage evidence.

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

## 5. Metadata API Facts & Token Labels

Plain metadata (title, creators, year, item key, tags, collection membership, attachment status) are API facts and require verification. For substantive local Zotero claims, include these compact source labels inside the evidence token:

- Native `itemType` (for example, `journalArticle`, `preprint`, `report`).
- Derived `source_group` (`article`, `unpublished`, `institutional`, `reference`, `web-media`, or `other`).
- Canonical tags only when present: `review:unreviewed`, `review:skimmed`, `review:checked`, `type:textbook`, or `type:lecture-notes`.

Example suffix: `; journalArticle/article; review:checked`. Metadata labels never raise evidentiary confidence and never replace passage/page provenance or `Rerank` gating.
