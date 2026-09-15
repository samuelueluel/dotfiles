# Prepare an Explicitly Requested Audit and Handle Errors

**Load this file when** preparing arguments for a user-requested `zotero_audit_claims` call or diagnosing its validation errors.

Follow [Zotero evidence audit](../../zotero-evidence-audit/SKILL.md) for when audits are allowed, how to prepare quotes, and how many repair attempts are permitted for the request.
Check the installed tool's schema for accepted fields. Its validation requirements are stricter than ordinary source reading.

## Prepare the Tool Arguments

A claim has `claim_id`, `text`, `risk_tags`, and 1–4 evidence references.
Each claim represents one attributed result, null finding, or comparison, rather than several unrelated findings.

| Evidence route | Required fields | Optional source-location and hash fields |
|---|---|---|
| `semantic` | Exact parent `item_key`, original `query`, literal `quote` | `chunk_id`, `content_hash`, `index_generation` |
| `pdf_page` | Exact parent `item_key`, `page`, literal `quote` | `end_page`, `attachment_key`, `content_hash` |
| `mineru_sidecar` | Exact parent `item_key`, literal `quote` | `locator`, `start_line`, `end_line`, `content_hash`, `index_generation` |

Item keys are eight-character parent keys, not titles, DOIs, paths, or collections.
The tool does not accept caller-supplied source bodies or reranker scores.
Numeric claims require evidence from a PDF-page read, or the supported weaker sidecar fallback after the PDF-page read fails. Accepted quotes must contain the values and units.

`risk_tags=["comparison"]` requires evidence from at least two distinct items.
`risk_tags=["within_item_comparison"]` applies to one item. These tags are mutually exclusive.
`escalation="none"` disables tool-side follow-ups. `"bounded"` permits up to three targeted follow-ups, which count toward the core skill's repair limit.

## Preserve Exact Quotes, Source Locations, and Hashes

Passage expansion supplies complete chunk text and `content_hash`.
Sidecar lookup supplies source lines and `source_hash`; its continuations accept that value as `expected_hash`.
The audit evidence schema has `content_hash`, not `source_hash`. These fields are not aliases: omit an optional hash unless its compatibility with the audit route is established.

A sentence spanning pages may use separate exact fragment references when supported, rather than reconstructed cross-page text.
The Pi argument hook removes parenthetical citation years from claim text while preserving quotes and bare years.
Quotes must also support any bare dates, sample sizes, and other numbers included in the claim.

## Validation Errors

| Result | Diagnostic check |
|---|---|
| `QUOTE_NOT_FOUND` | Compare the literal quote with source text, including layout breaks; an exact shorter excerpt may locate the problem |
| `NUMBER_MISMATCH` / `UNIT_MISMATCH` | Inspect signs, ranges, thresholds, and whether the chosen excerpt contains the stated value and unit |
| `CHUNK_NOT_FOUND` | Check the returned chunk identifier and whether the underlying evidence changed |
| `check_mode`, `CHECKER_UNAVAILABLE`, `CHECKER_SKIPPED` | An outdated schema or tool capability, not a finding about the source; stop the audit as required by the core workflow |
| Retained preview omits its quote or diagnostics conflict | The tool response does not meet its documented requirements; this is not evidence that the author or agent fabricated a result |

Passing the audit does not establish that the source supports the claim. Apply citation-integrity's evidence rules when writing the answer.
For a diagnosed service problem requiring maintenance, load [service operations](../../../skills/zotero-pipeline/references/service-ops.md).
