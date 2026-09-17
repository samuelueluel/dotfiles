---
name: zotero-paper-discovery
description: Creates a collection-scoped or library-scoped list of Zotero papers that satisfy a substantive inclusion rule and returns a frozen candidate set with evidence locators. Use when Samuel asks which papers address a topic, requests a list of papers satisfying a condition, or asks to identify studies before a later comparison.
---

# Zotero Paper Discovery

## Non-Negotiable Rules

- The requested collection, library, subcollection policy, item-type filters, and explicit exclusions define the scope. Study geography does not substitute for collection membership.
- Treat titles, abstracts, tags, and inventory metadata as discovery signals, not proof that a paper estimates or finds something.
- Verify each included paper against its own source text. A paper's description of another work cannot establish the other work's eligibility.
- A missing hit, nonpositive rerank, or irrelevant passage leaves a plausible paper unresolved. It does not prove exclusion.
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

### 2. Establish exact scope

- For an unknown collection key, use `zotero_search_collections` or the maintained [collection key reference](../zotero-library/references/collections.md).
- Include subcollections only when requested or when the named project scope convention includes them.
- For explicit items, preserve the exact parent keys.
- For a named source, use `zotero_resolve_exact_source`; related matches are not substitutes.

### 3. Build one bounded candidate scope

Inspect the deployed schema, then prefer `zotero_build_candidate_scope`.

Supply two to four distinct semantic facets and no more — each extra facet costs a full retrieval pass. Each facet should cover a different way a qualifying paper could describe the treatment or outcome. For example, a crime request may need separate facets for neighborhood offenses, violence or homicide, and individual arrests or incarceration.

Normally use `limit_per_facet=5–8`. Raise it only when the collection is large or the inclusion rule is unusually broad. The tool inventories the verified collection, deduplicates parent items, preserves evidence IDs, and rejects out-of-scope hits. It does not decide inclusion. The full inventory array ships only when `include_inventory=true`; scope coverage fields are always present — request it when candidate screening needs row-level identity metadata.

If the composite tool is unavailable:

1. Call `zotero_list_collection_items(detail="summary", include_subcollections=<requested>)` and follow pagination.
2. Run the same two to four bounded `zotero_semantic_search` facets within scope.
3. Deduplicate candidates by exact parent item key.

For exact filter syntax and collection pagination, load [search and retrieval details](../../references/zotero/search-retrieval.md).

### 4. Adjudicate candidates

Maintain a short internal ledger:

- `included`: source text shows the paper estimates, evaluates, models, or directly reports the requested relationship.
- `outside`: source text establishes a different treatment, outcome, population, or task.
- `unresolved`: the relevant source text has not been adequately checked.

A positive rerank passage can support inclusion only after its text is read in context. Expand the retained evidence ID with `zotero_read_passage`; do not rerun semantic search to see the same hit again.

For a plausible title missed by semantic retrieval, use one exact-item semantic search or a distinctive `zotero_find_in_item` phrase. Do not use a single no-match for `crime`, `health`, or another broad term as proof of absence. Searches that pin exact item keys report the keys that returned no passage; treat a reported no-hit exactly like any other missing hit.

After two uninformative attempts on the same missing inclusion fact, change the reading method once or leave the item unresolved. Do not cycle through synonyms.

### 5. Freeze the list

Return an explicit parent-item list that a later task can reuse without rediscovery. Include:

- Author, year, title, and item key.
- A one-clause inclusion rationale when useful.
- The exact supporting section, table, PDF page, passage, or sidecar locator actually read.
- Any plausible unresolved item that could alter downstream work.
- A bounded coverage statement such as “I found eight qualifying papers in the scoped search,” not an unsupported exhaustive claim.

Use the compact evidence-locator table in `citation-integrity`; metadata-only rows need no footnote. Do not enumerate screened-out papers unless Samuel requests exclusions or one materially limits the result.

## Evidence Rules

Load `citation-integrity` whenever the output attributes a substantive estimand or finding to a paper.

- Only positive-Rerank semantic text or verified direct source reading can support substantive inclusion.
- Keep indexed passages, MinerU sidecars, extracted PDF text, and inspected images distinct.
- Retain exact item keys, evidence IDs, source hashes, and actual locators internally.
- Never claim PDF-page verification or image inspection from an indexed passage or sidecar line.

## Stop Condition

Stop when every plausible candidate is `included`, `outside`, or disclosed as `unresolved`, and the frozen list is ready for the next task. Do not retrieve detailed estimates merely because a later comparison might need them.
