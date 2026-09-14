# Evidence Verification Diagnostics

**Load this file when** resolving unclear numeric extraction, interpreting figure schemas, or diagnosing missing or ineligible reranker evidence.

The [citation integrity skill](../SKILL.md) governs evidence eligibility and statistical reporting. The [research skill](../../zotero-research/SKILL.md) governs route selection, stopping, and service-failure boundaries. This reference is not another mandatory verification pass.

## Reranker Output

Raw cross-encoder scores are query-dependent relevance signals, not calibrated confidence in a claim. The main skill's positive-score gate applies:

| Displayed result | Interpretation |
|---|---|
| `Rerank > 0` | Eligible for inspection; attribution and context still determine what it supports |
| `Rerank <= 0` | Discovery clue only; a direct-source read may independently verify the finding |
| `Rerank` missing | Semantic result is discovery-only; use available bounded direct reading or report the limitation |
| `Relevance` present without `Rerank` | Dense similarity is not a replacement for the missing score |

A positive score on a contents heading or clipped sentence does not supply its missing content. A higher score after re-querying does not independently corroborate the source.

For a missing-score case, bounded direct routes include `zotero_read_pdf_pages` and `zotero_find_in_item`. Service diagnosis is separate from answering the research question; the research skill prohibits automatic service startup or repair.

## Extraction Problems

| Symptom | Useful next step |
|---|---|
| Search preview ends before the estimate or note | Expand the existing `evidence_id` with `zotero_read_passage` |
| Expanded passage or sidecar window is still truncated | Continue from the returned locator rather than repeating the lookup |
| Decisive table's PDF page is known | Read that page directly |
| No PDF locator, but exact item and result phrase are known | Use a bounded `zotero_find_in_item` window and disclose the sidecar route |
| Signs or columns are missing from extracted table text | Look for unambiguous source prose or inspect a page image if available |
| Estimate and uncertainty appear on different scales | Check table notes and the main skill's statistical-reporting rules |
| Reported CI and p-value appear inconsistent | Check whether they use the same inferential procedure; otherwise disclose the discrepancy |
| Sentence crosses a page boundary | Read the continuation needed for meaning |

For tool parameters and continuation examples, load [targeted reading](../../zotero-research/references/deep-dive-reading.md). Complete, unambiguous prose may suffice without another page read, but both prose and PDF text layers can contain errors.

For an explicitly requested automated audit only, separate exact fragments can resolve quote-containment failures across page boundaries; see [audit API details](../../zotero-research/references/claim-audit.md). Ordinary reading does not require audit payloads.

## Generated Figure Schemas

A `[Figure Schema]` block describes a figure for discovery. Useful source evidence may be in its caption, surrounding prose, a table, or the page image itself. A reranker score for the chunk does not turn a generated schema into observed numerical data.

## Failure Phrasing Examples

Use only the statement warranted by the retrieved evidence:

- “No supporting evidence found in the retrieved passages.”
- “The estimate is available, but its SE was not retrieved.”
- “The checked table reports p < 0.05, not an exact p-value.”
- “The extracted table's sign is unclear; this estimate remains unverified.”
- “The bibliography occurrence is unresolved, so the target identity is not established.”
- “These are graph-edge counts, not raw bibliography occurrence counts.”
