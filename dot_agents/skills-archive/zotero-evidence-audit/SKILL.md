---
name: zotero-evidence-audit
description: Runs the opt-in deterministic Zotero claim-evidence contract audit over bounded caller-identified evidence without treating the audit as proof of substantive support. Use only when Samuel explicitly asks for an automated evidence audit, claim audit, or `zotero_audit_claims`.
---

# Zotero Evidence Audit

## Non-Negotiable Rules

- Run `zotero_audit_claims` only when Samuel explicitly requests an automated audit.
- Ordinary requests to verify estimates, inspect significance, or compare papers use `zotero-source-reading` or `zotero-result-comparison`, not this skill.
- Never run this audit inside `zotero-extract`.
- An audit checks its deterministic evidence contract. It does not establish causal identification, comparability, collection coverage, or that the source substantively entails the claim.
- Never cite the audit result as source evidence.
- Keep quotes literal and provenance truthful. Do not repair OCR, alter source text, or tune thresholds to force acceptance.
- Allow one request-wide repair pass only: at most three targeted retrievals and one audit rerun, including tool-side bounded escalation.

## Workflow

### 1. Prepare atomic claims

Submit no more than eight claims. Each claim covers one result, null finding, attribution, or comparison.

A claim contains:

- `claim_id`
- bounded claim `text`
- `risk_tags`
- one to four exact evidence references

Use `risk_tags=["comparison"]` for claims requiring evidence from at least two distinct papers. Use `within_item_comparison` for a comparison inside one paper. The tags are mutually exclusive.

### 2. Prepare route-specific evidence

Accepted evidence routes are:

- `semantic`: exact parent `item_key`, original query, and literal quote; optional chunk and hash fields.
- `pdf_page`: exact parent `item_key`, one-based PDF page, and literal quote; optional end page, attachment key, and compatible content hash.
- `mineru_sidecar`: exact parent `item_key`, literal quote, and an actual locator or line range; optional compatible fields.

Do not supply titles, DOIs, filesystem paths, source bodies, or caller-invented rerank scores as item or evidence identity.

Numeric claims require evidence containing the values and units from a PDF-page read, or the supported weaker sidecar fallback after a PDF-page route fails.

For the exact deployed payload and error codes, load [claim-audit schema](references/claim-audit.md) and inspect the current tool schema before calling.

### 3. Expand evidence before quoting

- Expand clipped semantic hits with `zotero_read_passage` before copying a quote.
- Continue sidecar windows using their returned `source_hash` as `expected_hash`.
- Preserve exact page fragments rather than reconstructing sentences across pages.
- Omit optional hashes unless the route and field semantics are established. `source_hash` and `content_hash` are not aliases.

### 4. Run the bounded audit

Start with `escalation="none"`.

Inspect each claim's status, reason codes, retained evidence preview, and route. A passing result still requires the agent to check that the source actually supports the wording and that any causal or comparative interpretation is valid.

### 5. Repair once when justified

If the first audit exposes a fixable missing quote, locator, page, or numeric unit:

1. Run no more than three targeted retrievals across the whole request.
2. Correct only the evidence reference or claim wording justified by the source.
3. Rerun the audit once.

Do not broaden the search, rewrite quotes, or change a claim merely to satisfy the checker.

On a legacy schema, `CHECKER_UNAVAILABLE`, `CHECKER_SKIPPED`, or contradictory tool diagnostics, report the capability problem and stop.

## Use Audit Results Carefully

- `supported` means the configured evidence gates passed.
- It does not prove source entailment, causal validity, estimate comparability, or complete paper coverage.
- Preserve source evidence separately and cite that evidence under `citation-integrity`.
- Failed retrieval is not evidence that the paper lacks the result.
- Passing semantic evidence still requires a positive raw rerank and correct source attribution.

## Stop Condition

Stop after the initial audit and at most one bounded repair pass. Report unresolved reason codes without additional search cycles.
