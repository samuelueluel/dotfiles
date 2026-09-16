# Run the Deterministic Claim-Contract Audit

**Load this file when** preparing the automatic final `zotero_audit_claims` call for audit-ready claims or diagnosing its validation errors.

Follow [citation integrity](../SKILL.md) for the automatic audit boundary, evidence eligibility, and failure handling. Inspect the installed tool schema before calling because its accepted fields are stricter than ordinary source reading.

## Prepare the Tool Arguments

Submit no more than eight atomic claims in one call with `escalation="none"`. For a validated comparison, pass the selected top-one or top-three parent keys as `allowed_item_keys`. Each claim has `claim_id`, `text`, `risk_tags`, optional structured `expected_values`, and one to four evidence references. One claim represents one attributed result, quotation, estimate, null finding, or comparison rather than several unrelated findings.

| Evidence route | Required fields | Optional source-location and hash fields |
|---|---|---|
| `semantic` | Exact parent `item_key`, original `query`, literal `quote` | `chunk_id`, `content_hash`, `index_generation` |
| `pdf_page` | Exact parent `item_key`, one-based `page`, literal `quote` | `end_page`, `attachment_key`, `content_hash` |
| `mineru_sidecar` | Exact parent `item_key`, literal `quote` | `locator`, `start_line`, `end_line`, `content_hash`, `index_generation` |

Item keys are eight-character parent keys, not titles, DOIs, paths, or collections. The tool rejects caller-supplied source bodies and reranker scores.

Numeric claims require evidence from a PDF-page read, or the supported weaker MinerU-sidecar fallback after a PDF-page route fails. Accepted quotes must contain the values and any explicitly asserted units; a unit-less expected value matches any source unit for that number, so an SE printed as `(10.66%)` satisfies a unit-less `se` entry. Supply `expected_values` for the empirical values to audit so structural numbers such as `Table 6`, `Figure 2`, publication years, and PDF pages are not treated as findings.

```json
{
  "expected_values": [
    {"role": "estimate", "value": "-0.164"},
    {"role": "se", "value": "0.052"},
    {"role": "p_threshold", "operator": "<", "value": "0.01"}
  ]
}
```

Supported roles include `estimate`, `se`, `ci_lower`, `ci_upper`, `p_value`, `p_threshold`, `sample_size`, and `other`. A `p_threshold` requires `<`, `<=`, `=`, `>=`, or `>`. Use `risk_tags=["comparison"]` for a cross-paper comparison with evidence from at least two distinct items. Use `risk_tags=["within_item_comparison"]` for a comparison inside one item. The tags are mutually exclusive.

## Preserve Exact Evidence

Reuse evidence already collected by the governing task skill. Do not run new searches merely to make a claim audit-ready.

- Semantic evidence uses the original exact-item query and a literal quote from the accepted passage.
- Expand a clipped semantic hit with `zotero_read_passage` before copying its quote when the substantive workflow already requires that context.
- PDF evidence uses the actual one-based PDF page and an exact contiguous fragment.
- Sidecar evidence uses the returned locator or line range and a literal source fragment.
- A sentence spanning pages uses separate exact fragments rather than reconstructed cross-page text.

Passage expansion may supply `content_hash`. Sidecar lookup supplies `source_hash` for continuation as `expected_hash`. These fields are not aliases. Omit an optional audit hash unless its route and semantics are established.

The Pi argument hook may remove parenthetical citation years from claim text while preserving quotes and bare years. Quotes must support any bare dates, sample sizes, and other numbers retained in the claim.

## Interpret the Result

- `supported`: The configured mechanical evidence gates passed.
- `unsupported`: A deterministic contradiction such as a quote, number, unit, or comparator mismatch was found.
- `insufficient`: The supplied evidence did not establish the required contract.

Each result carries `gate_failures` entries (code, message, blocking) whose messages list the missing and quoted tokens behind `NUMBER_MISMATCH` and `UNIT_MISMATCH`; read them before deciding whether a failure is a caller-payload error.

None of these statuses decides whether the source substantively entails the claim, whether causal wording is justified, whether a table was interpreted correctly, or whether estimates are comparable. The final answer cites the source evidence, never the audit result.

## Handle Validation Errors

| Result | Diagnostic check |
|---|---|
| `QUOTE_NOT_FOUND` | Compare the literal quote with the source, including layout breaks; correct a genuine transcription or locator error rather than rewriting source text. |
| `NUMBER_MISMATCH` / `UNIT_MISMATCH` | Read the `gate_failures` message first — it lists the missing and quoted tokens — then inspect signs, ranges, thresholds, and whether the accepted excerpt contains the stated value and unit. |
| `CHUNK_NOT_FOUND` | Check the returned chunk identifier and whether the indexed evidence changed. |
| `check_mode`, `CHECKER_UNAVAILABLE`, `CHECKER_SKIPPED` | Treat as an outdated schema or unavailable capability, not a finding about the source. |
| Retained preview omits its quote or diagnostics conflict | Treat as a response-contract failure, not evidence that the author or agent fabricated a result. |

Correct genuine claim-to-evidence errors before answering. One audit cycle permits one corrected resubmission only for a genuine caller-payload error. Do not resubmit for a parser defect when the accepted excerpt visibly contains the values. Do not weaken checks, repair OCR, alter quotes, or start repeated retrieval cycles to force acceptance. If the tool itself is stale or unavailable, report the capability limitation only when material and continue under the substantive evidence rules in `citation-integrity`.

For a diagnosed service problem requiring maintenance, load [service operations](../../zotero-pipeline/references/service-ops.md).
