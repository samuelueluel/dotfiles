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
- Read only papers that can plausibly lead or change the ranking. Once the leader and up to two relevant alternatives are supported, stop.
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

Write one precise internal rule before extracting numbers. Examples:

```text
Maximum percentage reduction for any crime subtype in each paper's primary local specification; exclude robustness and dynamic maxima.
```

```text
Largest main intention-to-treat effect on the overall outcome at the paper's stated follow-up horizon.
```

When Samuel authorizes judgment, choose and state the rule. If one unresolved definition would select a different winner and judgment was not authorized, ask one focused question.

### 2. Triage the frozen papers

Maintain these states:

- `comparable`: source evidence establishes an estimate on the chosen basis.
- `different_estimand`: relevant finding, but not on the selected basis.
- `outside_comparison`: the frozen paper cannot win under the rule.
- `unresolved`: a missing fact could still change the ranking.

Use discovery passages and existing working context first. Do not reread evidence already adequate in the current session.

Prioritize:

1. The apparent leader.
2. The paper most likely to exceed it.
3. A third paper only when it remains a credible challenger or clarifies the comparison.

### 3. Collect decisive evidence

Inspect the deployed schema, then prefer `zotero_collect_result_evidence` for up to four exact items at once. Supply retained evidence IDs and distinctive sidecar/PDF phrases or table labels. The tool expands existing passages first, chains sidecar hashes, preserves route boundaries, locates PDF text, and flags extraction conflicts. Route success does not verify a substantive field.

If the composite tool is unavailable, use this bounded sequence:

1. `zotero_read_passage` for an existing evidence ID.
2. `zotero_find_in_item` with a distinctive table label or source phrase.
3. Continue a sidecar read with the returned `source_hash` as `expected_hash`.
4. `zotero_find_in_pdf` to establish the actual one-based PDF page.
5. `zotero_read_pdf_pages` for the targeted result and notes.
6. `zotero_render_pdf_page` only when text leaves a decisive visual ambiguity.

For detailed parameter examples, load [bounded source-reading syntax](../zotero-research/references/deep-dive-reading.md).

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

A decisive table read must include row and column labels plus notes. PDF text can lose signs and alignment just as sidecars can.

Use unambiguous source prose only when it directly describes the same result. If text routes disagree or remain ambiguous, inspect the actual rendered page image. If image inspection is unavailable or inconclusive, omit the value or mark it unverified.

If a CI and p-value disagree, inspect the methods and table layout. Otherwise state that the extracted or reported values disagree; never say “as printed” without verified page evidence.

### 5. Validate the draft evidence structure

For a multi-paper numerical ranking, use `zotero_validate_evidence_bundle` after selecting the exact claim evidence. Treat it as a linter only. It can detect missing evidence links, scale or uncertainty fields, comparator items, calculation labels, page provenance, and unresolved ambiguity. Passing does not establish substantive support and is never cited.

Do not run `zotero_audit_claims` unless Samuel explicitly requested an automated evidence audit.

### 6. Answer and stop

Lead with the winner and the qualification needed to interpret it. Normally give:

- One explicit comparison basis.
- The winning paper and decisive estimate with inference.
- One or two alternatives only when needed to show why the winner leads.
- Material differences in dose, denominator, population, area, or horizon.
- One bounded uncertainty statement if an unresolved paper could change the result.

Do not summarize the rest of the frozen list. Follow `citation-integrity` for claim-level footnotes; one tightly bounded table or passage may use one marker for several values.

## Evidence Invariants

- Positive rerank permits semantic evidence to be considered; it does not prove the claim or causal interpretation.
- Source prose, sidecars, PDF text, and page images remain distinct evidence routes.
- Agreement between sidecar and PDF text is not independent corroboration or visual inspection.
- Label agent conversions and approximate inference; never present them as source-reported.
- Do not infer exact p-values from stars or coefficient/SE ratios.
- A significant estimate and an insignificant estimate do not establish a significant difference.
- A numerical maximum among unlike results must be labeled as such, not called the strongest overall evidence.

## Stop Condition

Stop when the comparison rule, leader, requested inference, and only the necessary alternatives are supported. Do not retrieve extra statistics for papers that will only be named.
