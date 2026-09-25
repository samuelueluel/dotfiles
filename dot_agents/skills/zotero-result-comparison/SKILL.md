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
- Do not let an agent-calculated conversion silently determine a ranking. Store source inputs, formula, calculated result, and source-reported status for any value you computed.
- Report a tie or “top-k plus tie” when the top-k boundary is tied or an inference conflict on a close alternative remains unresolved. Never declare a clear winner in either situation.
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

Comparison runs in two passes. Pass 1 (steps 2–4) builds a complete result inventory for every frozen paper at inventory depth: eligible results, primary and maximum-substantive roles, uncertainty status, and named unresolved fields. Pass 2 (step 6) deep-verifies only the leader and the close alternatives needed to explain the ranking, with full tables, notes, and conflict resolution. Do not deep-verify a paper during pass 1, and do not rank before every card is terminal.

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

Comparison requires checking every location where an eligible estimate could appear, for every frozen paper: the abstract, the results section or sections, every numbered table with its notes, and figure captions (figures presenting estimates count as tables). Check appendices and supplements only when the main text points to an eligible estimate there or the ranking margin is close; otherwise record them as unchecked. This does not require reading every page of every paper.

Maintain one terminal result card for every frozen parent item:

```text
item_key
status: eligible | no_eligible_result | unresolved
inventory_status: complete | partial — complete means all four locations above were checked; partial names the unchecked locations. Either value describes locations checked, not certainty that nothing was missed
unresolved_fields: fields that could not be verified, with the attempted route (empty when none)
eligible_results:
  outcome, point estimate, scale, uncertainty
  treatment, dose, denominator, population, geography, horizon
  result_class: main | subgroup | dosage | dynamic | supplemental | robustness | model_based
  specification status and evidence IDs (retained `zr1:...` IDs or
  route-prefixed locators: `pdf:KEY:p12:label`, `mineru:KEY:line7`)
  source_reported: whether the value is source-reported or agent-calculated
  calculation_method: for agent-calculated values — source inputs, formula,
  calculated result, and unit/scale
primary_result_id: paper's preferred or headline result
maximum_substantive_result_id: largest significant substantive result
selected_result_id: result selected by the declared eligibility policy
inventory_locators: exact tables, PDF pages, or bounded passages read
source_reliability: block_status of each value's source and any item_warning
close_alternative: item key and margin for the nearest competing estimate, or none
tie_group: result IDs or item keys tied at the top-k boundary, if any
reason: required for no_eligible_result; explain unresolved fields when unresolved
```

These ledger fields are internal working state. The `zotero_validate_comparison_manifest` submission still uses the deployed schema; do not add unsupported fields to it.

`eligible` requires at least one result, all three result-role IDs, and exact inventory locators. Keep cards to the primary and maximum-substantive results plus any alternative the ranking discussion needs; extra rows cost reads without changing top-k. `no_eligible_result` requires an explicit reason and no result records. `unresolved` may contain partial results but cannot supply a selected maximum for a complete-scope comparison. Record whether primary-only and substantive-all policies would produce different top sets.

Use discovery passages and existing working context first. Do not reread evidence already adequate in the current session. Do not rank, deep-verify only the apparent leader, or silently omit a frozen paper before every card is terminal.

A paper cannot be dropped from contention, or ranked below the leader, on a value whose source is `single-route`, `unresolved`, or `legacy-unverified`. Read that value from the PDF page first, or keep the card `unresolved` for that field. Treat a `REQUIRES_PDF_CHECK` flag from `zotero_collect_result_evidence` as required follow-up for any value that affects selection or ranking.

### 3. Collect decisive evidence

Inspect the deployed schema, then prefer `zotero_collect_result_evidence` for up to four exact items at once. Supply retained evidence IDs and distinctive sidecar/PDF phrases or table labels. The tool expands existing passages first, chains sidecar hashes, preserves route boundaries, locates PDF text, and flags extraction conflicts. Route success does not verify a substantive field.

If the composite tool is unavailable, use this bounded sequence:

1. `zotero_read_passage` for an existing evidence ID.
2. `zotero_find_in_item` with a distinctive table label or source phrase.
3. Continue a sidecar read with the returned `source_hash` as `expected_hash`.
4. `zotero_find_in_pdf` to establish the actual one-based PDF page. When `has_more_matches` is true, inspect `match_pages` and `omitted_match_pages`, then continue with `offset` or a narrower late-page range. On multi-PDF items, pass `attachment_key` and keep the echoed resolved attachment key with the locator.
5. `zotero_read_pdf_pages` for the targeted result and notes.
6. `zotero_render_pdf_page` only when text leaves a decisive visual ambiguity.

For detailed parameter examples, load [bounded source-reading syntax](../../references/zotero/deep-dive-reading.md). Check these parameter bounds before the first retrieval call — the deployed schema is authoritative and the full list lives in [tool parameters](../../references/zotero/tool-params.md). `find_in_item` has no `limit` (use `max_matches` 1–10; `max_chars` 256–16000 total). `read_pdf_pages` requires `start_page` (no `page` param). Collect takes at most 4 items and 2 phrases per route, with `neighbors` max 2. Manifest `max_reported_items` is 1–3; audits take max 8 claims with `escalation: "none"`.

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

A decisive table read must include row and column labels plus notes. When complete source prose already reports the estimate with its uncertainty and significance, that prose establishes the paper-level maximum without a redundant table read; read the table only when prose lacks a decision-relevant field or the ranking margin is close. Treat `REFERENCED_TABLE_NOT_READ` as required follow-up only in those cases. PDF text can lose signs and alignment just as sidecars can.

Use unambiguous source prose only when it directly describes the same result. If text routes disagree or remain ambiguous, inspect the actual rendered page image. If image inspection is unavailable or inconclusive, omit the value or mark it unverified.

When a ranking depends on an agent-calculated value — a unit conversion, per-capita rescaling, or subgroup combination — record the source inputs, the formula, the calculated result, and the unit/scale on the result card, and mark the estimate `source_reported: false`. A winner determined only by such a calculation is not a clear numerical winner; report it with the same caution as any other approximate comparison.

If a CI and p-value disagree, inspect the methods and table layout. Otherwise state that the extracted or reported values disagree; never say “as printed” without verified page evidence.

### 5. Validate coverage and evidence structure

Before ranking, submit the completed manifest to `zotero_validate_comparison_manifest`. Include the frozen item keys, one terminal result card per item, the ranking rule, eligibility policy, primary and maximum-substantive result IDs, inventory locators, selected item keys, numerical and substantive winner status, whether an alternative policy changes the top set, and the maximum number of items permitted in the final analysis. Every result `evidence_ids` entry must be a route-prefixed retained-evidence ID or locator; bare item keys, titles, and free prose are rejected. The tool checks coverage, result-policy consistency, unresolved-item policy, selected maxima, and declared output scope; it does not read sources or judge estimates.

A clear numerical winner is merely the largest value under the rule. A clear substantive winner remains persuasive after accounting for dose, denominator, population, area, and horizon. Use `top_k` when the numerical winner is clear but the substantive winner is not.

If the top-k boundary is tied — two estimates indistinguishable under the ranking rule — or an inference conflict on a close alternative remains unresolved after the available checks, do not declare a clear winner. Set `numerical_winner_status` or `substantive_winner_status` to `not_clear`, use `winner_type: top_k`, and report the outcome as a tie or “top-k plus tie”, naming the tied group. Tie-group estimates need verified source locators like any reported result, but they are not audit-bundle members; the audit covers the selected maxima and the ranking claim only. An unresolved p-value/CI or table-alignment conflict on the nearest competitor blocks a clear-winner declaration even when the leader's own evidence is unambiguous.

For a multi-paper numerical ranking, draft the final quantitative and comparison claims in structured form and call `zotero_validate_evidence_bundle` with `allowed_item_keys` set to the selected top-one or top-three keys. Treat it as a linter only. It can detect evidence from unselected papers, missing evidence links, scale or uncertainty fields, comparator items, calculation labels, page provenance, and unresolved ambiguity. Passing does not establish substantive support and is never cited.

After substantive verification, apply `citation-integrity`’s one-pass final contract-audit rule to the audit-ready claims that will actually appear in the answer. Persist the terminal cards to `~/.agents/scratch/<YYYY-MM-DD>-<task-slug>-cards.md` (cards only, no prose) once the manifest validates, so a compacted or later session resumes without re-reads. Rebuild the file if the scope changes; never trust a stale one.

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
