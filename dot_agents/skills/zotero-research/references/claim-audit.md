# Explicit Claim Audit: API and Error Reference

**Load this file when** Samuel explicitly requests `zotero_audit_claims` or an automated evidence-contract audit; not for ordinary RAG.

The [research skill](../../zotero-research/SKILL.md) governs opt-in use, literal evidence, interpretation, and the request-wide repair budget. Inspect the deployed tool schema before constructing a payload.

## Payload Fields

Each claim has `claim_id`, `text`, `risk_tags`, and 1–4 `evidence` references. A claim should contain one attributed result, estimand, null finding, or comparison, rather than bundling sample details and multiple findings.

| Route | Locator fields | Additional fields |
|---|---|---|
| `semantic` | Exact parent `item_key`, original successful `query`, literal `quote` | Returned `chunk_id`, `content_hash`, `index_generation` when available |
| `pdf_page` | Exact parent `item_key`, `page`, optional `end_page`, literal `quote` | Returned `attachment_key` and `content_hash` when available |
| `mineru_sidecar` | Exact parent `item_key`, `locator` or line range, literal `quote` | Returned `content_hash` and `index_generation` when available |

The audit does not accept caller-supplied source bodies, filesystem paths, or reranker scores. Numeric claims require direct-page evidence or the supported weaker sidecar fallback, with values and units inside the accepted quotes.

- `risk_tags=["comparison"]` requires evidence from at least two distinct items.
- `risk_tags=["within_item_comparison"]` applies within one item. These tags are mutually exclusive.
- `escalation="none"` is the initial setting. `"bounded"` is available for a specific unresolved gap within the main skill's repair budget.
- Parenthetical citation years are stripped from claim text by a pre-tool hook. Bare dates remain numeric obligations; include them only when material and evidenced.
- For a sentence crossing a page boundary, separate exact fragment references may avoid a containment failure without reconstructing the source text.

## Error Diagnostics

| Result | Meaning and next step |
|---|---|
| `QUOTE_NOT_FOUND` | Compare the quote with the returned text for OCR repairs, omitted layout text, or changed hyphenation. A shorter exact quote or one targeted read may resolve it. It does not establish source absence. |
| `NUMBER_MISMATCH` / `UNIT_MISMATCH` | Check signs, ranges, thresholds, and whether the submitted quote contains the stated value and unit. Correct or omit the claim. |
| `check_mode`, `CHECKER_UNAVAILABLE`, or `CHECKER_SKIPPED` | Legacy deployment. Stop the audit; do not consume the rerun trying different wording. |
| Retained evidence preview omits its quote, or score diagnostics conflict | Response-contract problem. Do not infer fabrication or a source-level contradiction. |

If service diagnosis is needed, load [service operations](../../zotero-pipeline/references/service-ops.md). Reinstallation is a separate maintenance task, not an automatic part of answering a research question.
