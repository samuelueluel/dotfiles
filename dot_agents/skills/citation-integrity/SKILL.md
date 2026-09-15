---
name: citation-integrity
description: Governs evidence eligibility, statistical fidelity, and citations for claims grounded in Samuel's Zotero sources. Use when reporting Zotero findings, estimates, mechanisms, cross-paper comparisons, bibliography occurrences, citation graphs, or validated zotero-extract evidence packets.
---

# Citation Integrity

## Choose the Evidence Needed

Use every row that applies. A single answer or claim may require several kinds of evidence.

| If reporting… | Evidence needed | Guidance |
|---|---|---|
| A finding, mechanism, or definition | A supporting passage from the source itself | Section 1 |
| An estimate, uncertainty measure, or table value | The result and notes; verify its scale and uncertainty | Section 2 |
| A paper's identity, metadata, or collection membership | The exact-source resolver or verified metadata, not as proof of findings | Section 1 |
| A bibliography mention or count | Raw bibliography entries from the requested set of citing papers | Section 1 |
| A citation relationship or citation-based ranking | Graph results with an explicit scope and measure | Section 1 |
| A finding from an audit result or extraction packet | Check what it validates and whether the source supports the claim | Section 5 |

## What This Skill Covers

This skill governs what evidence permits you to say, including in headings, summaries, and casual answers.
Use the task-specific Zotero skill to decide which papers to check, what to read next, and when to stop: [paper discovery](../zotero-paper-discovery/SKILL.md), [result comparison](../zotero-result-comparison/SKILL.md), [source reading](../zotero-source-reading/SKILL.md), [bibliography search](../zotero-bibliography-search/SKILL.md), or [citation analysis](../zotero-citation-analysis/SKILL.md).
Do not run a separate verification pass when adequate evidence has already been read.

- Ground every material claim in its own retrieved evidence. Never supply a paper's estimates, setting, specification, or mechanism from model memory.
- Never use one paper's evidence as proof of another paper's findings. A paper's description of prior work establishes what it says about that work, not independent verification of the cited result.
- Metadata abstracts, titles, membership, bibliography entries, and graph relationships do not establish empirical findings.
- Passages marked `REF` or consisting of reference lists establish citations only.
- Generated `[Figure Schema]` descriptions are discovery aids, not observed results. Verify findings against source prose, captions, tables, or an actually inspected image.
- Never invent scores, quotes, provenance, or missing statistics. Mark unresolved claims `UNVERIFIED`, qualify them, or omit them.

## 1. Decide Whether the Evidence Supports the Claim

### Source passages and direct reading

Only a displayed **positive `Rerank`** makes a semantic hit eligible for supporting findings.
Zero, negative, or missing scores make it discovery-only. `Relevance` is not a substitute; never fabricate a score.
A positive score signals relevance; it does not establish that the text is accurate, supports the claim, or identifies a causal effect. Check whose finding is described and read enough context.

An eligible hit's expansion and neighbors may supply context. Cite the chunk that actually supports the claim.
Expansion adds no score; never assign the anchor's score to a neighbor. Expanding an ineligible anchor does not make it eligible.
A verified direct-source read can establish the finding without a reranker score. Reading and checking the source itself counts as this kind of read.

Tools for finding and reading evidence include `zotero_semantic_search`, `zotero_read_passage`, `zotero_read_pdf_pages`, `zotero_get_item_fulltext`, `zotero_find_in_item`, and `zotero_find_in_pdf`.
For visual evidence, use `zotero_render_pdf_page` when text or layout remains ambiguous; retain the actual one-based PDF-page/region locator and record that the returned image was inspected. A coordinate, extracted text block, or generated description is not an image inspection.
A clipped preview or heading alone does not support the missing result.

### Evidence for Paper Identity, Bibliography Mentions, and Citation Relationships

The exact-source resolver establishes identity and scope, not findings. Ambiguous, absent, and related matches do not authorize substitution.
For an unresolved or ambiguous bibliography entry, state only the verified raw occurrence; do not invent target identity or graph links.
External `ext:*` nodes contain metadata and incoming relationships, not the external work's findings or outgoing references.
An external-node label does not prove the work is absent from the library.

Name the measure actually returned: raw occurrences, distinct citing items, inbound edges, or bibliographic coupling.
Graph-edge counts are not raw citation totals, and inbound ranking is not hub centrality.
Keep scope, direction, node identity, and resolution limits attached to any graph or count claim.

### What the Evidence Does Not Establish

Failed retrieval does not prove that a paper lacks a result. An irrelevant passage does not rule out a paper that could change the answer.
An insignificant estimate is not evidence of zero effect. A plausible mechanism is not an established explanation.
Distinguish your interpretation from what the paper reports, and retain the assumptions and limitations needed to interpret the finding.
For a bounded comparison, limit the conclusion to the comparable estimates checked; do not imply a collection-wide winner without exhaustive coverage.

## 2. Preserve Statistical Meaning

### Verify the result and its context

For each estimate reported, establish:
- Outcome, sign, scale, and baseline denominator.
- Treatment definition and dose; units, buildings, events, and programs are not interchangeable.
- Sample, geography, specification, and time horizon.
- Whether it is a main estimate, subgroup/dosage result, dynamic estimate, robustness check, or model prediction.
- What the uncertainty notation means and how inference was performed.

For a decisive table value, verify the targeted result and notes from its PDF page when available.
Complete, unambiguous source prose can independently establish a number; incidental numbers may use complete positive-Rerank passages.
A precise known-item sidecar window is permitted when page extraction fails, no page locator is available, or the window avoids a broad read. Disclose that weaker route.
Reuse verified evidence; a second view of the same text is not independent corroboration.

Read the table notes before interpreting parentheses or stars. Parentheses can contain SEs, CIs, or test statistics.
Preserve the reported scale: coefficient, semielasticity, marginal effect, IRR, or percentage change.
Do not exponentiate an already transformed estimate or assume a log-link coefficient and a reported semielasticity are interchangeable.

### Report uncertainty honestly

For every estimate discussed, include the requested uncertainty fields.
In comparisons, supply an available SE, CI, or p-value even if the user did not specify a particular one.
If unavailable, distinguish **not reported in the checked result** from **not retrieved**; do not leave uncertainty silently blank.
A partial read does not establish that a statistic is absent from the entire paper.

Keep source-reported statistics separate from your calculations.
Never infer an exact p-value from stars or rounded coefficients and SEs. Report the source's significance threshold when that is all it supplies.
A coefficient/SE ratio is a test-statistic approximation, not a p-value.
Calculate CIs or p-values only when the scale and inferential assumptions justify it; label them approximate and state the method.
Use available degrees of freedom where required. A normal approximation using clustered SEs does not reproduce the paper's exact inference.
Transform interval endpoints with the estimate, sort bounds in ascending order, and distinguish positive reductions from signed changes.
If a reported CI and p-value disagree, check whether they use different methods or disclose the unresolved discrepancy; do not silently repair either.

### Keep comparisons on an explicit basis

Supported individual numbers do not by themselves support a ranking.
Percentages with different outcomes, doses, denominators, horizons, or geographic coverage are not automatically comparable.
Do not normalize across these differences without justification; label any conversion as your calculation and never assume linear dose scaling.
Separate **largest point estimate**, **significance against zero**, and **evidence that estimates differ**.
One significant estimate and one insignificant estimate do not establish a significant difference between them.
A numerical maximum among unlike results must be labeled that way, not called the strongest overall effect.

## 3. Check Extracted Text and Record Its Source

Distinguish extracted PDF-page text, MinerU sidecar text, indexed passages, and visual inspection.
`zotero_read_pdf_pages` returns text, not an image inspection. Describe the evidence as extracted PDF-page text, not the vague label “direct PDF.”
Indexed passages and literal lookups may expose the same sidecar. Agreement does not independently verify its accuracy.

`zotero_find_in_pdf` is a bounded literal lookup over the authoritative PDF text layer. It returns one-based PDF page locators, verbatim extracted windows, exact total/returned match counts, and text-layer coverage. Coverage is `complete`, `partial_text_coverage`, or `no_usable_text`; a no-match on incomplete coverage cannot establish absence. Its PDF page index is distinct from a printed label, MinerU sidecar line, or indexed offset.

All extracted text can lose signs, digits, stars, or column alignment, including PDF text layers.
If a value needed to support the answer is ambiguous, use unambiguous source prose or inspect the actual page/table image with an available tool.
Never silently repair a table, reattach detached stars by guesswork, or choose the coefficient/IRR column that fits expectations.
If the ambiguity cannot be resolved from text, render the targeted PDF page or normalized region with `zotero_render_pdf_page` and inspect the actual image. If visual inspection is unavailable or still inconclusive, omit the value or mark it unverified.
For specific symptoms and failure wording, load [extraction diagnostics](references/verification-workflow.md).

Keep the exact returned item key and the supporting page, passage, section, or sidecar window that was actually read.
Never present sidecar lines, passage numbers, or unmapped page labels as verified PDF page indices.
Keep evidence IDs and returned hashes internal. Never relabel hash types by assumption; use fields with matching documented semantics.
Indexed character offsets, sidecar character offsets, and PDF page indices are different source locations.
Preserve verified `itemType`, `source_group`, and canonical `review:*` or `type:*` tags when available; they describe the source, not evidence quality.
Reuse metadata. Fetch missing citation identity only for papers actually cited, never solely to fill internal labels.

## 4. Write Claims and Cite Their Sources

### Cite material claims, not every inventory entry

Use a Markdown `[^cN]` footnote immediately after:
- Exact estimates, uncertainty measures, table values, and calculated transformations.
- Findings, mechanisms, definitions, or interpretations attributed to a source.
- Comparison and ranking claims. Give each paper whose result establishes the comparison its own support.
- Consequential or genuinely contestable inclusion or exclusion decisions.

Plain metadata may be listed without an evidence footnote when the claim goes no further than verified author, title, year, item key, item type, or scoped collection membership. Retain the item key or another compact identity locator in the list. Do not enumerate and cite every screened-out paper unless the user requests exclusions or an exclusion materially limits the answer. A failed search is not a source finding; report a material unresolved exclusion using the bounded wording in [extraction diagnostics](references/verification-workflow.md).

### Use compact evidence locators for paper lists

For candidate, eligibility, or inventory lists, prefer a compact evidence column over one footnote per row:

```markdown
| Paper | Why included | Evidence locator |
|---|---|---|
| Author (Year), Title | Estimates treatment effects on outcome | item KEY; Results, Table 2 |
```

The locator must identify the exact parent item and the supporting section, table, PDF page, passage, or sidecar window actually read. This compact format replaces row-level footnotes for the inclusion rationale. If the list contains metadata only, the item key is sufficient and the rationale column may be omitted.

### Keep narrative citations precise and bounded

- Number footnote markers in order of appearance.
- One marker may support several claims drawn from the same table, passage, or tightly bounded result context in one paragraph or table row. Use a new marker when the source location, evidence route, or result context materially changes.
- End with one `### Evidence` block containing only cited entries. Omit it when the answer contains no material source-grounded claims requiring footnotes or uses only compact list locators.
- Each entry gives author/year, title when available, item key, and exact PDF page, passage, section, or sidecar lines. Distinguish printed pages from PDF indices when known.
- Footnotes give source locations, not internal tool names or raw curly-brace records. Keep scores, hashes, and classification fields internal unless requested or material; never present score histories as corroboration.
- Disclose reliance on weaker sidecar evidence in the answer; one brief note can cover several claims. Label table values needed to support the answer **table-extracted** unless source prose independently states them.
- Never claim visual inspection, page verification, exhaustive coverage, or automated auditing that did not occur.
- Keep capability notes brief and before the Evidence block. Ordinary answers need no audit-status note.
- If web sources also appear, combine `[^wN]` and `[^cN]` definitions in that final Evidence block.

```markdown
The paper reports the stated result.[^c1]

### Evidence
[^c1]: Author — Title (Year); item KEY; Table 2, PDF p. 6.
```

Keep structured JSON and canonical evidence records unchanged in machine-facing tasks; use footnotes or compact evidence locators for human-facing synthesis.
For record fields or when checking where evidence came from, load [evidence record formats](references/evidence-contracts.md).

## 5. Use Audit Results and Extraction Packets Carefully

Automated audits are opt-in, not a requirement for numbers, causal claims, or comparisons.
Use [Zotero evidence audit](../zotero-evidence-audit/SKILL.md) only when Samuel explicitly requests it; never use `zotero_audit_claims` inside `zotero-extract`.
An audit checks its specified evidence requirements; it does not establish that the source supports the claim, identifies a causal effect, makes estimates comparable, or covers all relevant papers. Never cite an audit as source evidence.
Keep audit quotes literal and provenance truthful; do not repair OCR or alter thresholds to obtain acceptance.

A validated extraction packet contains evidence to review, not an automatic citation or a new source of evidence.
When reviewing extraction results in the main session:
1. Use only validated packets from accepted `processed` items. Confirm identity, manifest state, source hash, and quotes against the source or sidecar.
2. Treat worker confidence as a review flag, not verification. Unresolved evidence stays unverified.
3. Packet routes describe where the evidence came from; they are not reranker scores. Verified direct reading needs no semantic search to certify it.
4. Synthesize across papers in the main session; extraction workers report only their assigned source.
5. Treat a completed manifest as coverage evidence, not proof of claims. An empty packet establishes only no matching evidence found under its inclusion rule.
6. Present the resulting claims with the footnotes above, not raw packet JSON.

For the meaning of packet fields, load [extraction packet fields](references/extraction-packet.md).
