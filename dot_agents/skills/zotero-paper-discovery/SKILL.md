---
name: zotero-paper-discovery
description: Creates a collection-scoped or library-scoped list of Zotero papers that satisfy a substantive inclusion rule and returns a frozen candidate set with evidence locators. Use when Samuel asks which papers address a topic, requests a list of papers satisfying a condition, or asks to identify studies before a later comparison.
---

# Zotero Paper Discovery

## Non-Negotiable Rules

- The requested collection, library, subcollection policy, item-type filters, and explicit exclusions define the scope. Study geography does not substitute for collection membership.
- Treat titles, abstracts, tags, and inventory metadata as discovery signals, not proof that a paper estimates or finds something.
- Verify each included paper against its own source text. A paper's description of another work cannot establish the other work's eligibility.
- A missing hit, nonpositive rerank, or irrelevant passage leaves a plausible paper unresolved. It does not prove exclusion. In particular, a plausible title or model paired with an uninformative abstract passage requires a targeted section or exact-item check before exclusion.
- Never screen a broad concept with one literal word. Cover the permitted outcome and treatment vocabulary with distinct semantic facets.
- Do not broaden scope, update indexes, parse missing files, or modify Zotero metadata during research.
- Stop after producing the requested frozen list. Do not compare or rank results unless the user also requested that separate task.

## Workflow

### 1. Define the inclusion rule

Rewrite the request internally as:

```text
Scope: <collection/library/items and subcollection policy>
Treatment/topic: <allowed concepts and synonyms>
Outcome: <allowed concepts and synonyms>
Evidence threshold: <what source text must show for inclusion>
Output: <metadata-only list or list with concise inclusion rationale>
```

If one consequential boundary is unresolved, ask one focused question. Otherwise preserve the user's deliberately broad definition.

For “which papers discuss X?”, include papers that substantively discuss X even if they do not estimate the same quantity. For a broad housing-supply-elasticity request, include source-verified discussion of both housing quantity's response to price and price or rent's response to added housing supply. Label which response each paper studies; do not treat the elasticities as numerically interchangeable. If the user asks for papers *estimating* a specific elasticity, use that narrower rule. A paper that merely mentions housing supply or price without discussing their responsiveness does not qualify.

### 2. Establish exact scope

- For an unknown collection key, use `zotero_search_collections` or the maintained [collection key reference](../zotero-library/references/collections.md).
- Include subcollections only when requested or when the named project scope convention includes them.
- For explicit items, preserve the exact parent keys.
- For a named source, use `zotero_resolve_exact_source`; related matches are not substitutes.
- If resuming a prior task, check `~/.agents/scratch/<YYYY-MM-DD>-<task-slug>-discovery.md` for a frozen list before rebuilding scope; rebuild the scope if it changed rather than trusting a stale file.

### 3. Build one bounded candidate scope

Inspect the deployed schema, then call `zotero_build_candidate_scope` directly. When the collection key is already known from step 2, do not call `zotero_list_collection_items` first and do not paginate it: the composite tool already inventories and validates the scope, so a separate listing pass only spends calls. Reserve that listing route for the fallback case below.

Supply two to four distinct semantic facets and no more — each extra facet costs a full retrieval pass. Each facet should cover a different way a qualifying paper could describe the treatment or outcome. For example, a crime request may need separate facets for neighborhood offenses, violence or homicide, and individual arrests or incarceration.

Normally use `limit_per_facet=5–8`. Raise it only when the collection is large or the inclusion rule is unusually broad. The tool inventories the verified collection, deduplicates parent items, preserves evidence IDs, and rejects out-of-scope hits. It does not decide inclusion. The full inventory array ships only when `include_inventory=true`; scope coverage fields are always present — request it when candidate screening needs row-level identity metadata.

If the composite tool is unavailable:

1. Call `zotero_list_collection_items(detail="summary", include_subcollections=<requested>)` and follow pagination.
2. Run the same two to four bounded `zotero_semantic_search` facets within scope.
3. Deduplicate candidates by exact parent item key.

For exact filter syntax and collection pagination, load [search and retrieval details](../../references/zotero/search-retrieval.md). Check these parameter bounds before the first retrieval call — the deployed schema is authoritative and the full list lives in [tool parameters](../../references/zotero/tool-params.md). `find_in_item` has no `limit` (use `max_matches` 1–10; `max_chars` 256–16000 total; `context_lines` 0–20). `read_pdf_pages` requires `start_page` (no `page` param). `read_passage` and collect `neighbors` max out at 2; collect takes at most 4 items and 2 phrases per route. `find_in_pdf` rejects page ranges over 50.

### 4. Adjudicate candidates

Maintain a short internal ledger:

- `included`: source text shows the paper estimates, evaluates, models, or directly reports the requested relationship.
- `outside`: source text establishes a different treatment, outcome, population, or task.
- `unresolved`: the relevant source text has not been adequately checked.

A positive rerank passage can support inclusion only after its text is read in context. Expand the retained evidence ID with `zotero_read_passage`; do not rerun semantic search to see the same hit again.

Expand positive candidate evidence in batch before making inclusion decisions. After the scope build, collect every retained evidence ID across the whole candidate ledger, expand them in one consecutive batch, and only then classify each candidate. Interleaving search, expansion, and decisions per candidate costs one extra retrieval round per item and invites repeated generic searches.

Use exact-item semantic searches only for title-plausible misses the facets did not surface, and give each one a distinctive phrase. Exception: if an expanded anchor cannot decide inclusion (e.g., a budget-capped window showing only background prose), run one exact-item findings-query per ambiguous candidate instead of another expansion round. Never re-screen with a generic single word (`crime`, `demolition`, `health`); if no distinctive phrase can be named, leave the item unresolved instead of running another broad query. Do not use a single no-match for a broad term as proof of absence. Searches that pin exact item keys report the keys that returned no passage; treat a reported no-hit exactly like any other missing hit.

After two uninformative attempts on the same missing inclusion fact, change the reading method once or leave the item unresolved. Do not cycle through synonyms.

### 5. Freeze the list

Return an explicit parent-item list that a later task can reuse without rediscovery. Include:

- Author, year, title, and item key.
- A one-clause inclusion rationale when useful.
- A reader-facing `Paper | Relevance | Evidence` table. Put the one-clause inclusion rationale under Relevance. Under Evidence, name the supporting section and verified one-based PDF page when available.
- Link the paper title directly to that PDF page, using the attachment key returned by the PDF tool. Do not add a second PDF link in Evidence. If no page is verified, link the title to the Zotero parent item instead and give the section or a short supporting excerpt; say when the PDF page is unverified. Do not show indexed chunk IDs as reader-facing evidence locators.
- Any plausible unresolved item that could alter downstream work.
- For each included paper whose retrieval results carried an `item_warning` (unresolved or single-route tables, scanned pages, or a legacy-unverified sidecar), record the warning with the frozen key so a later comparison or reading task inherits it.
- A bounded coverage statement such as “I found eight qualifying papers in the scoped search,” not an unsupported exhaustive claim.

For each included paper with an accessible PDF, try to locate a distinctive part of the supporting passage in the PDF text. Split long PDFs into page ranges within the tool's limit. `zotero_find_in_pdf` returns the one-based PDF page and attachment key; a section heading in indexed text or a `#22` chunk ID does not establish a PDF page. If the phrase does not match, check one targeted PDF section or a shorter distinctive phrase, then stop. If the text layer is unusable or the PDF route is unavailable, do not guess a page, OCR automatically, or delay the list with repeated lookups. Use the verified section or excerpt instead. The PDF page index may differ from the printed journal page.

Persist the frozen list to `~/.agents/scratch/<YYYY-MM-DD>-<task-slug>-discovery.md` — keys, rationale, evidence IDs or chunk IDs, and actual locators only, no prose — so a compacted or later session resumes without re-reads. Rebuild the file if the scope changes; never trust a stale one.

Follow the compact paper-list format in `citation-integrity`; metadata-only rows need no footnote. Do not enumerate screened-out papers unless Samuel requests exclusions or one materially limits the result.

## Evidence Rules

Load `citation-integrity` whenever the output attributes a substantive estimand or finding to a paper.

- Only positive-Rerank semantic text or verified direct source reading can support substantive inclusion.
- Keep indexed passages, MinerU sidecars, extracted PDF text, and inspected images distinct.
- Retain exact item keys, evidence IDs, source hashes, and actual locators internally.
- Never claim PDF-page verification or image inspection from an indexed passage or sidecar line.

## Stop Condition

Stop when every plausible candidate is `included`, `outside`, or disclosed as `unresolved`, and the frozen list is ready for the next task. Do not retrieve detailed estimates merely because a later comparison might need them.
