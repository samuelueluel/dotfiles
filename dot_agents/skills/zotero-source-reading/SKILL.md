---
name: zotero-source-reading
description: Resolves and reads named or exact Zotero papers to answer bounded questions about their findings, definitions, methods, tables, and statistical results. Use when Samuel names a stored paper, DOI, citation key, or item key, asks what a paper finds, requests a passage or table, or asks a substantive question about an explicit item set without ranking papers.
---

# Zotero Source Reading

## Non-Negotiable Rules

- Bind every read to an exact parent item. Never substitute a semantically related paper for a named source.
- Preserve the requested library, collection, version, DOI, citation key, author, year, and title constraints.
- Read the source's own result. A paper's discussion of prior work establishes only what it says about that work.
- Use the smallest source window that supplies the requested fact and necessary context.
- Reuse adequate evidence already read in the current session. Do not retrieve another representation for reassurance.
- Never repair extracted tables by intuition. Render the actual page when a decisive sign, digit, star, or column remains ambiguous.
- After two uninformative attempts to locate the same missing fact, change the reading method once or report it unresolved.
- Do not modify metadata, process attachments, rebuild indexes, or download cited papers during source reading.

## Workflow

### 1. Resolve the exact source

Call `zotero_resolve_exact_source` with Samuel's original identifier and any explicit fields available.

- `exact`: bind all later reads to the returned parent key.
- `ambiguous`: report the conflict and ask Samuel; do not choose by semantic relevance.
- `absent`: report absence in the requested scope and stop.

Related matches are never substitutes. Do not silently combine working-paper and published versions.

If the resolver is unavailable, use exact metadata lookup and verify all supplied identifiers before reading. For identity fields and collection membership details, load [exact-source retrieval syntax](../../references/zotero/search-retrieval.md).

### 2. Define the missing fact

Before each retrieval, identify one concrete need:

- Finding or mechanism.
- Outcome or treatment definition.
- Point estimate and scale.
- SE, CI, p-value, or significance threshold.
- Sample, specification, dose, denominator, or horizon.
- Table row, column, note, or figure detail.

If the answer is already supported by source text in context, stop retrieving.

### 3. Find the relevant passage

For a conceptual question with no locator, run one focused `zotero_semantic_search` restricted to the exact item key. A finding requires a positive-Rerank passage or verified direct source reading.

Use the returned evidence ID with `zotero_read_passage`. Add `neighbors=1` only when adjacent context is needed. Continue a truncated anchor with its returned character offset rather than rerunning search.

For a known phrase, table label, heading, or statistic, use `zotero_find_in_item`. Prefer a distinctive phrase over a common word. When continuing the sidecar, pass its `source_hash` as `expected_hash`.

Before quoting any number from a passage or sidecar window, read its `reliability` field and the paper-level `item_warning`. For a table listed in `problem_tables` or a window with `requires_pdf_check: true`, go straight to the PDF page in step 5 instead of trying another sidecar lookup. Use the returned `pdf_pages` as the page to search, not as a verified page for citation.

Inspect the deployed schema before using an unfamiliar tool. For detailed lookup and continuation examples, load [bounded source-reading syntax](../../references/zotero/deep-dive-reading.md).

### 4. Collect multiple exact routes when useful

For up to four known items or several related table lookups, prefer `zotero_collect_result_evidence`. Supply exact parent keys, retained evidence IDs, and no more than two distinctive sidecar or PDF phrases per item.

The composite tool:

- Expands supplied evidence IDs first.
- Chains sidecar hashes.
- Preserves indexed, sidecar, and PDF routes separately.
- Reports PDF text-layer coverage and one-based pages.
- Flags numeric or significance-marker disagreements.

Its output contains candidate evidence, not verified substantive fields. Inspect the returned text and resolve any flag before using a value.

### 5. Verify decisive numerical evidence

For every estimate reported, establish:

- Outcome, sign, and statistical scale.
- Treatment definition and dose.
- Baseline denominator.
- Sample, population, geography, and horizon.
- Specification and whether the result is main, subgroup, dynamic, robustness, or model-based.
- Meaning of parentheses and significance marks.

For a decisive table value:

1. Locate its actual PDF page with `zotero_find_in_pdf` or a verified outline. On multi-PDF items, pass `attachment_key` and keep the echoed resolved attachment key with the locator.
2. Read the result and notes with `zotero_read_pdf_pages`.
3. Compare with unambiguous source prose when available.
4. If signs, digits, stars, or columns remain unclear, call `zotero_render_pdf_page` and inspect the image.
5. Omit or label the value unverified if the image remains inconclusive, and list it under **Check yourself** as `citation-integrity` describes. Never supply a `⟦withheld⟧` number from any other route.

`zotero_read_pdf_pages` returns extracted text, not visual inspection. PDF text can also lose minus signs and alignment. Never describe it as an inspected page image.

### 6. Report uncertainty honestly

- Give the requested SE, CI, p-value, or significance threshold.
- Say `not reported in the checked result` only when the checked result omits it.
- Say `not retrieved` when the bounded read did not locate it.
- Do not infer an exact p-value from stars.
- Label coefficient/SE ratios, transformed intervals, and other calculations as approximate agent calculations with their method.
- If reported CI and p-value disagree, check whether they use different methods or disclose the unresolved discrepancy.

### 7. Answer

Lead with the requested finding. Keep the source's scale and qualifications attached to the claim. Follow `citation-integrity` for material claims, exact statistics, and source locations.

Use one citation marker for several values from the same tightly bounded result context. Do not add an unrelated literature review, retrieval diary, or audit-status section.

## Failure Boundaries

- Missing sidecars or inaccessible attachments are access limitations, not negative findings.
- A no-match on partial PDF text coverage cannot establish absence.
- If the embedder or reranker is unavailable, report the specific service limitation; never start it automatically.
- Infrastructure repair belongs to `zotero-pipeline`.
- Full-document, every-item extraction belongs to `zotero-extract` only when explicitly requested.

## Stop Condition

Stop when the requested finding and necessary interpretation are supported, or when the bounded attempts leave a clearly described unresolved field.
