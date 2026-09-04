# Evidence Contracts & Token Specifications

**Load this file when** composing Zotero-grounded claims or formatting canonical brace tokens for passages, direct source reads, bibliography entries, or graph structures.

## 1. Semantic-Passage Evidence

Use for substantive findings, mechanisms, definitions, formulas, and empirical estimates retrieved via `zotero_semantic_search`.

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
  - `{Author Year, item KEY, p. X; itemType/source_group; canonical tags if present}`
  - `{Author Year, item KEY, § heading; itemType/source_group; canonical tags if present}` (when exact page numbers are unmapped)
  - `{Author Year, item KEY, p. X if mapped, lines X–Y; itemType/source_group; canonical tags if present}`
  - Substantive content tokens never display internal route labels (`zotero_read_pdf_pages`, `zotero_get_item_fulltext`, `mineru_sidecar`); the location fields carry the audit trail. Identity, bibliography, and graph audit tokens use the explicit operation labels shown in their canonical formats below.
- **Rules:**
  - Quote or paraphrase only text actually returned by the read route or sidecar extraction used.
  - Prefer page reads (`zotero_read_pdf_pages`) for paper-grade numerical claims when page extraction is reliable.
  - Use `mineru_sidecar` when page extraction is unavailable or malformed, or when a precise window in a large known work avoids loading irrelevant text. Include the PDF page only when the sidecar maps it; otherwise include the extracted line range.
  - Sidecar extraction is limited to an already identified local item. Never treat MCP gateway temporary/spill files as source evidence.
  - Do not use the vague label `direct PDF`. Keep provenance truthful internally: sidecar, shell, or other local extraction is never treated or described as a page read. Cite sidecar evidence with its line range (plus mapped page if any) and never imply a page read occurred when it did not.
  - Append verified source classification exactly as for semantic-passage evidence.

## 3. Exact-Source Identity Evidence (Gate)

Use `zotero_resolve_exact_source` when a request names a source by title, author/title/year, DOI, citation key, item key, or explicit “in this paper” language.

- **Canonical Formats:**
  - `{resolve_exact_source → exact, item KEY, collection scope verified}`
  - `{resolve_exact_source → absent, requested identity, collection scope}`
  - `{resolve_exact_source → ambiguous, competing item KEYs or metadata conflict}`
- **Rules:**
  - This route verifies metadata identity and collection membership only; it does not support findings, mechanisms, estimates, equations, or numerical claims.
  - For `exact`, use the returned `item_key` to retrieve substantive evidence and cite that separate route. Emit a resolver token only when identity or collection membership is material; do not duplicate it in an ordinary substantive answer whose content token already identifies the verified item.
  - For `ambiguous` or `absent`, report only the identity boundary/conflict. `related_matches` are metadata-only and cannot be used as substantive evidence.
  - Preserve the original requested identity. Do not shorten a title or issue a new resolver call for a related result unless the user explicitly clarifies/changes the target or asks about that related work as a separate task.

## 4. Bibliography-Reference Evidence (Evidence Layer)

Use `zotero_search_bibliography_entries` for literal reference occurrences, raw bibliography strings, citing-source context, and graph resolution status.

- **Canonical Format:** `{zotero_search_bibliography_entries → citing KEY, entry N, status/method, resolution confidence C, parse P}`
- **Examples:**
  - `{zotero_search_bibliography_entries → citing F7EGNIBT, entry 20, unresolved, parse 0.78}`
  - `{zotero_search_bibliography_entries → citing BXCIHFPR, entry 73, external_reference via DOI, resolution 0.95, parse 0.78}`
- **Rules:**
  - BM25 score reflects text match ranking, not entity identity confidence.
  - Report raw bibliography occurrences literally (e.g., "The bibliography contains an entry rendered as...").
  - `unresolved` or `ambiguous` statuses support raw string occurrences only, never clean target identities or graph edges.
  - Reference search evidence proves citation occurrence only, never the cited paper's substantive findings.

## 5. Citation-Graph Evidence (Judgment Layer)

Use for inbound-citation rankings, direct citation neighbors, and bibliographic coupling.

- **Canonical Formats:**
  - `{zotero_rank_works_by_inbound_citations → scope collection KEY, item ABCDEFGH, rank #1, 14 inward citations}`
  - `{zotero_get_citation_neighbors → seed ABCDEFGH, scope library-expanded, direct incoming neighbor ext:...}`
  - `{zotero_find_bibliographically_coupled_papers → seed ABCDEFGH, result HGFEDCBA, scope collection-expanded, Jaccard 0.50, 1 shared citation}`
- **Rules:**
  - State the explicit `scope` parameter in every graph token.
  - The inbound-citation ranking is a simple graph in-degree ordering, not a hub, authority, or centrality measure. Phrase claims as "top-cited in scope".
  - Graph counts are graph-edge counts and directional, not total citation counts (unresolved and sidecar-less citations are omitted).
  - Cross-check graph identities and counts against `zotero_search_bibliography_entries` (the evidence layer).
  - Explicitly identify external node kinds (`ext:doi` vs. `ext:meta`). Treat `ext:meta` counts as heuristic and approximate.
  - `zotero_get_citation_neighbors` requires `depth=1` and supports direct neighbors only; multi-hop values are rejected.

## 6. Metadata API Facts & Token Labels

Plain metadata (title, creators, year, item key, tags, collection membership, attachment status) are API facts and require verification. The resolver may verify an identity or collection-membership claim, but it cannot replace substantive passage/page evidence. For substantive local Zotero claims, include these compact source labels inside the evidence token:

- Native `itemType` (for example, `journalArticle`, `preprint`, `report`).
- Derived `source_group` (`article`, `unpublished`, `institutional`, `reference`, `web-media`, or `other`).
- Canonical tags only when present: `review:unreviewed`, `review:skimmed`, `review:checked`, `type:textbook`, or `type:lecture-notes`.

Example suffix: `; journalArticle/article; review:checked`. Metadata labels never raise evidentiary confidence and never replace passage/page provenance or `Rerank` gating.
