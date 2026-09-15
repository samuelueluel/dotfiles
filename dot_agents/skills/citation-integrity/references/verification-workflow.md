# Extraction Diagnostics and Failure Wording

**Load this file when** a table has broken signs or columns, inferential statistics conflict, or it is unclear whether a retrieved passage can support a claim.

The [citation integrity skill](../SKILL.md) owns the governing checks. This reference illustrates failure cases; it is not a second audit workflow.

## Table and Numerical Symptoms

| Symptom | What to inspect | What to say if unresolved |
|---|---|---|
| Coefficient sign disagrees with the IRR's position relative to 1 | Outcome row, transformation note, source prose, or actual table image | “The extracted columns disagree; the estimate remains unverified.” |
| Stars appear below the table, detached from cells | Actual cell alignment and star legend | “The estimate and SE are available; the significance marker could not be assigned reliably.” |
| Minus signs disappear in PDF text | Prose describing direction or actual page image | “The extracted sign is unclear.” |
| CI excludes the null but p-value is nonsignificant | Methods for both interval and test; clustering, resampling, or alternative procedures | “The reported CI and p-value disagree; I could not establish whether the interval and test used different methods.” |
| Large percentage is normalized from counts | Baseline denominator, treatment dose, and whether it is a cumulative program effect | “The dose or denominator is unverified, so this cannot support a per-building comparison.” |
| Number is visible but uncertainty is outside the read window | Table continuation and notes | “The estimate was retrieved, but its uncertainty was not.” |

Use these statements only after the appropriate bounded follow-up, or when source access prevents resolving the problem.
A page-text extraction and a sidecar reconstruction can fail differently. Neither is equivalent to inspecting the table image.

## Retrieval and Score Symptoms

- A positive rerank score on a heading can locate a result without revealing its estimate.
- A negative or missing score means the search result cannot support the finding under the score rule; it is not proof that the source lacks the result.
- A higher score after another query is not another source or independent corroboration.
- A `[Figure Schema]` block can identify a relevant figure, but its generated numbers and descriptions are not source observations.

For lookup or continuation syntax, load [source-reading details](../../zotero-research/references/deep-dive-reading.md).
The active task skill—normally `zotero-source-reading` or `zotero-result-comparison`—chooses the next action and bounds retries.

## Distinguish Missing Evidence from Negative Findings

| Evidence actually checked | Appropriate wording |
|---|---|
| Search returned no usable passage | “No supporting evidence found in the retrieved passages.” |
| Checked table supplies stars and their legend, but no exact p-value | “The checked table reports a significance threshold, not an exact p-value.” |
| Uncertainty field has not been located | “Not retrieved.” |
| Checked result omits the requested uncertainty field | “Not reported in the checked result.” |
| Bibliography entry remains ambiguous | “The raw occurrence is verified; the target identity is unresolved.” |
| Tool reports resolved inbound edges | “These are graph-edge counts, not raw bibliography occurrence counts.” |

Exact wording depends on what was read. A partial source read does not establish that the paper lacks the result entirely.
