# Extraction Diagnostics and Failure Wording

**Load this file when** a sidecar status line or `reliability` field names a finding, a table has broken signs or columns, inferential statistics conflict, or it is unclear whether a retrieved passage can support a claim.

The [citation integrity skill](../SKILL.md) owns the governing checks. This reference illustrates failure cases; it is not a second audit workflow.

## What Each Status Line Means

Surya sidecars mark every table that is not `verified` with a `[Table status: ...]` line, every contradicted equation with an `[Equation status: ...]` line, every paragraph whose inline math disagrees with the page with a `[Math status: ...]` line, and content OCR returned for a blank scanned page with a `[Page status: ...]` line. The reason in parentheses is either a plain sentence or an internal code. A result with no `reliability` field (legacy MinerU text) is `legacy-unverified`: nothing was checked.

| What you see | Numbers | What remains unchecked |
|---|---|---|
| No status line on a table (`verified`) | Every number matches the PDF text layer one to one | Placement is checked for values unique in the table, but not label rows shifted against their numbers, swaps between identical values, group headers spanning the wrong columns, or stars the text layer does not print. A table without numbers is checked word by word and row order only |
| `REPAIRED (... corrected or filled from the PDF text layer)`, sign or star fixes | Misread cells, signs, or stars were replaced from the text layer and re-checked in full | Same as `verified` |
| `SINGLE-ROUTE (column headers do not line up with the page)` | Match the text layer | Which column a number belongs to |
| `SINGLE-ROUTE (significance stars on some values are not in the PDF text layer)` | Match the text layer | Significance; the sidecar shows stars the page may not print |
| `SINGLE-ROUTE (printed labels missing: ...)` | Match the text layer | The listed labels or headers are missing from the table |
| `SINGLE-ROUTE (re-read by a second model)` | A vision-model re-read whose numbers match the text layer | Labels can sit on the wrong rows |
| `SINGLE-ROUTE (no PDF text layer; Surya and a second model agree on every number ...)` | Scanned page: two independent image readings agree | No text layer; fine for screening, render for decisive numbers |
| `SINGLE-ROUTE (ocr_layer_agreement)` | Scanned page: the sidecar agrees with the page's own OCR text | Two OCR reads agreeing, not an independent check |
| `SINGLE-ROUTE (no_text_layer)` | Nothing: the table is a picture on a born-digital page | Everything; treat like a scanned table |
| `SINGLE-ROUTE (math_table)`, `(mark_cells)`, `(no_numbers)`, or `(no independent check)` | Formulas, symbols, or check marks the text layer cannot place, or nothing to compare | Everything; render the page |
| `UNRESOLVED (...)` on a table, with `⟦withheld⟧` markers | Withheld | Not applicable; render the page |
| No status line on an equation | Symbols match the text layer, or could not be checked | Fractions, sub- and superscripts, term order; render before quoting |
| `[Equation status: UNRESOLVED (symbols differ ...)]` or an equation-number mismatch | The listed symbols or number contradict the text layer | Render the page; never quote the sidecar version |
| `[Equation status: REPAIRED (...)]` or `[Math status: REPAIRED (...)]` | Look-alike symbols (ν read as v, ι read as t) were restored from the text layer, and the symbols now match it | Fractions, sub- and superscripts, term order; render before quoting |
| `[Page status: UNRESOLVED (the scanned page is blank ...)]` | Withheld: OCR returned text for a page with no ink, so it is invented | Render the page; never cite the withheld content |
| `[Math status: SINGLE-ROUTE (inline math or text differs ...)]` | The paragraph's inline math or wording differs from the page by the listed symbols | Render before quoting a formula or a word it names |

Long numbers in software output (Stata logs with many-digit coefficients) are often misread by OCR. On born-digital pages the checks catch and repair these; on a scan of such output nothing can, so treat those numbers as unconfirmed.

## Table and Numerical Symptoms

| Symptom | What to inspect | What to say if unresolved |
|---|---|---|
| Coefficient sign disagrees with the IRR's position relative to 1 | Outcome row, transformation note, source prose, or actual table image | “The extracted columns disagree; the estimate remains unverified.” |
| Stars appear below the table, detached from cells | Actual cell alignment and star legend | “The estimate and SE are available; the significance marker could not be assigned reliably.” |
| Minus signs disappear in PDF text, or a number starts with a stray `2` or `)` | Prose describing direction or actual page image | “The extracted sign is unclear.” |
| Sidecar value looks right but the page prints something odd (such as `6.144` for a count) | The rendered page | Report the printed value and flag a likely source typo |
| Equation symbols, sub- or superscripts, or a fraction look doubtful | The rendered equation | “The extracted equation could not be confirmed against the page.” |
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

For lookup or continuation syntax, load [source-reading details](../../../references/zotero/deep-dive-reading.md).
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
