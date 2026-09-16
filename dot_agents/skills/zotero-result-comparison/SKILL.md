---
name: zotero-result-comparison
description: Compares or ranks empirical findings across an explicit Zotero item set while preserving each estimate's scale, dose, denominator, population, horizon, and inference. Use when Samuel asks which paper finds the largest, smallest, strongest, or most precise effect, or asks for an apples-to-oranges quantitative comparison.
---

# Zotero Result Comparison

## Non-Negotiable Rules

- Start from an explicit, frozen parent-item list. Do not silently rediscover or broaden the set during comparison.
- If the current request first asks for eligible papers, run `zotero-paper-discovery`, freeze its list, and then continue with this skill.
- State the comparison basis before detailed extraction. Distinguish overall outcomes, subtypes, counts, rates, percentages, treatment doses, populations, areas, and horizons.
- Do not normalize unlike estimates without justification. Never assume linear dose scaling.
- Separate the largest point estimate, significance against zero, and evidence that estimates differ.
- Classify estimates as main, subgroup, dosage, dynamic, supplemental, robustness, or model-based. Dynamic and subgroup estimates remain eligible unless the user's rule or declared policy excludes them.
- For largest-effect requests, record both the paper's primary result and its maximum substantive significant result. Do not let an auxiliary placebo or mechanical robustness cell become a paper's representative maximum.
- Exhaustively inventory eligible results for every item in the frozen set before ranking. Selective deep verification applies after result-level coverage, not before it.
- Do not declare a collection-wide winner while any frozen item lacks a terminal result card.
- Never repair signs, digits, stars, columns, confidence intervals, or p-values by intuition.
- Discuss only the leader and the alternatives needed to explain the result. Name, but do not summarize, the remaining papers when the user requests only identification.

## Required Input

Use one of these exact scopes:

- A frozen list produced earlier in the current turn.
- Explicit Zotero parent item keys supplied by Samuel.
- Named sources resolved individually with `zotero_resolve_exact_source`.

If no bounded item set exists and plausible definitions would materially change the set, run the separate discovery task first. Do not make collection-wide maximum claims from an unbounded semantic search.

## Workflow

### 1. Choose the ranking rule

Write one precise internal rule and one eligibility policy before extracting numbers. Supported policies are:

```text
primary_only: rank each paper's preferred or headline result.
substantive_all: rank the largest statistically significant substantive result across main, subgroup, dosage, and dynamic estimates; exclude placebos and mechanical robustness checks.
custom: follow the user's explicit eligibility rule.
```

Use `substantive_all` when Samuel asks for the largest effect “however measured,” broadly authorizes judgment, or otherwise requests the maximum without limiting the specification. Use `primary_only` for main, preferred, headline, or intention-to-treat findings. Do not silently exclude dynamic estimates; identify their period and duration and decide whether a short-lived maximum is substantively impressive under the ranking rule.

When Samuel authorizes judgment, choose and state the rule. If one unresolved definition would select a different winner and judgment was not authorized, ask one focused question.

### 2. Build a complete result inventory

Comparison requires exhaustive relevant-result coverage across the frozen set. This means reading enough of each paper's relevant results, tables, captions, notes, and source prose to identify every estimate eligible under the ranking rule; it does not require reading every page of every paper.

Maintain one terminal result card for every frozen parent item:

```text
item_key
status: eligible | no_eligible_result | unresolved
eligible_results:
  outcome, point estimate, scale, uncertainty
  treatment, dose, denominator, population, geography, horizon
  result_class: main | subgroup | dosage | dynamic | supplemental | robustness | model_based
  specification status and evidence locator
primary_result_id: paper's preferred or headline result
maximum_substantive_result_id: largest significant substantive result
selected_result_id: result selected by the declared eligibility policy
inventory_locators: exact tables, PDF pages, or bounded passages read
reason: required for no_eligible_result; explain unresolved fields when unresolved
```

`eligible` requires at least one result, all three result-role IDs, and exact inventory locators. `no_eligible_result` requires an explicit reason and no result records. `unresolved` may contain partial results but cannot supply a selected maximum for a complete-scope comparison. Record whether primary-only and substantive-all policies would produce different top sets.

Use discovery passages and existing working context first. Do not reread evidence already adequate in the current session. Do not rank, deep-verify only the apparent leader, or silently omit a frozen paper before every card is terminal.

### 3. Collect decisive evidence

Inspect the deployed schema, then prefer `zotero_collect_result_evidence` for up to four exact items at once. Supply retained evidence IDs and distinctive sidecar/PDF phrases or table labels. The tool expands existing passages first, chains sidecar hashes, preserves route boundaries, locates PDF text, and flags extraction conflicts. Route success does not verify a substantive field.

If the composite tool is unavailable, use this bounded sequence:

1. `zotero_read_passage` for an existing evidence ID.
2. `zotero_find_in_item` with a distinctive table label or source phrase.
3. Continue a sidecar read with the returned `source_hash` as `expected_hash`.
4. `zotero_find_in_pdf` to establish the actual one-based PDF page. When `has_more_matches` is true, inspect `match_pages` and `omitted_match_pages`, then continue with `offset` or a narrower late-page range.
5. `zotero_read_pdf_pages` for the targeted result and notes.
6. `zotero_render_pdf_page` only when text leaves a decisive visual ambiguity.

For detailed parameter examples, load [bounded source-reading syntax](../../references/zotero/deep-dive-reading.md).

### 4. Verify statistical meaning

For every estimate that will appear in the answer, establish:

- Outcome, sign, and scale.
- Treatment definition and dose.
- Baseline denominator.
- Sample, geography, and population.
- Specification and time horizon.
- Main, subgroup, dynamic, model, or robustness status.
- Whether parentheses are SEs, CIs, or another statistic.
- Exact reported p-value, CI, SE, or significance threshold when available.

A decisive table read must include row and column labels plus notes. Source prose that names a table does not complete a paper-level maximum until the referenced table is read; treat `REFERENCED_TABLE_NOT_READ` as required follow-up. PDF text can lose signs and alignment just as sidecars can.

Use unambiguous source prose only when it directly describes the same result. If text routes disagree or remain ambiguous, inspect the actual rendered page image. If image inspection is unavailable or inconclusive, omit the value or mark it unverified.

If a CI and p-value disagree, inspect the methods and table layout. Otherwise state that the extracted or reported values disagree; never say “as printed” without verified page evidence.

### 5. Validate coverage and evidence structure

Before ranking, submit the completed manifest to `zotero_validate_comparison_manifest`. Include the frozen item keys, one terminal result card per item, the ranking rule, eligibility policy, primary and maximum-substantive result IDs, inventory locators, selected item keys, numerical and substantive winner status, whether an alternative policy changes the top set, and the maximum number of items permitted in the final analysis. The tool checks coverage, result-policy consistency, unresolved-item policy, selected maxima, and declared output scope; it does not read sources or judge estimates.

A clear numerical winner is merely the largest value under the rule. A clear substantive winner remains persuasive after accounting for dose, denominator, population, area, and horizon. Use `top_k` when the numerical winner is clear but the substantive winner is not.

For a multi-paper numerical ranking, draft the final quantitative and comparison claims in structured form and call `zotero_validate_evidence_bundle` with `allowed_item_keys` set to the selected top-one or top-three keys. Treat it as a linter only. It can detect evidence from unselected papers, missing evidence links, scale or uncertainty fields, comparator items, calculation labels, page provenance, and unresolved ambiguity. Passing does not establish substantive support and is never cited.

After substantive verification, apply `citation-integrity`'s one-pass final contract-audit rule to the audit-ready claims that will actually appear in the answer.

### 6. Deep-verify, answer, and stop

After every item has a terminal result card, deep-verify the winner and only the close alternatives needed to explain the ranking. Do not retrieve detailed statistics for papers that will only be named.

Lead with the winner and the qualification needed to interpret it. Normally give:

- One explicit comparison basis.
- The winning paper and decisive estimate with inference.
- Alternatives only when the ranking is genuinely close or the user requests a top-three set.
- Material differences in dose, denominator, population, area, or horizon.
- One bounded uncertainty statement if the conclusion is limited to verified estimates.

Respect the requested output boundary. If both the numerical and substantive winner are clear, analyze one paper. When estimands differ materially and Samuel permits alternatives, report the top three even if one paper is the numerical leader, and say so directly. Analyze no unselected paper; name the remaining papers without statistics or summary. Follow `citation-integrity` for claim-level footnotes; one tightly bounded table or passage may use one marker for several values.

## Evidence Invariants

- Positive rerank permits semantic evidence to be considered; it does not prove the claim or causal interpretation.
- Source prose, sidecars, PDF text, and page images remain distinct evidence routes.
- Agreement between sidecar and PDF text is not independent corroboration or visual inspection.
- Label agent conversions and approximate inference; never present them as source-reported.
- Do not infer exact p-values from stars or coefficient/SE ratios.
- A significant estimate and an insignificant estimate do not establish a significant difference.
- A numerical maximum among unlike results must be labeled as such, not called the strongest overall evidence.

## Stop Condition

Stop only after every frozen item has a terminal result card, the comparison manifest validates, and the comparison rule, leader, requested inference, and only the necessary alternatives are supported. Do not retrieve extra statistics for papers that will only be named.
