---
name: citation-integrity
description: Governs evidence eligibility, statistical fidelity, final mechanical claim auditing, and citations for claims grounded in Samuel's Zotero sources. Use when reporting Zotero findings, estimates, mechanisms, cross-paper comparisons, bibliography occurrences, citation graphs, or validated zotero-extract evidence packets.
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
| A final audit-ready quantitative claim, direct quotation, or cross-paper numerical comparison | Supporting source evidence plus one mechanical contract audit | Section 5 |
| A finding from an extraction packet | Check what the packet validates and whether the source supports the claim | Section 5 |

## What This Skill Covers

This skill governs what evidence permits you to say, including in headings, summaries, and casual answers.
Use the task-specific Zotero skill to decide which papers to check, what to read next, and when to stop: [paper discovery](../zotero-paper-discovery/SKILL.md), [result comparison](../zotero-result-comparison/SKILL.md), [source reading](../zotero-source-reading/SKILL.md), [bibliography search](../zotero-bibliography-search/SKILL.md), or [citation analysis](../zotero-citation-analysis/SKILL.md).
Reuse adequate evidence rather than retrieving another representation for reassurance. The final contract audit checks evidence wiring, not substantive support.

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
A precise known-item sidecar window is permitted when page extraction fails, no page locator is available, or the window avoids a broad read, and only if its block status permits it (Section 3). Disclose that weaker route.
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

Sidecar-backed tool results carry a `reliability` field (`block_status`, `requires_pdf_check`, `pdf_pages`, `check_pages`, and a paper-level `item_level`/`item_warning`). Sidecars may also show visible `[Table status: ...]` lines and `⟦withheld: ...⟧` markers. Read these before using any number:

| Block status | Screening / inventory | Final answer |
|---|---|---|
| `verified` | Usable | A decisive number still needs a PDF-page locator |
| `repaired` | Usable; disclose the repair | Same as `verified` |
| `single-route`, `legacy-unverified` | Read the PDF page text first | Render the page and inspect it |
| `unresolved` (numbers withheld) | Not usable | Render and inspect the page; if you cannot settle it, list it for Samuel under **Check yourself** |

Never fill a withheld number from memory, another route's guess, or a neighboring cell. A paper-level `item_warning` applies to the whole paper even when the retrieved chunk itself is `verified`. A sidecar result with no `reliability` field is `legacy-unverified`.

`zotero_find_in_pdf` is a bounded literal lookup over the authoritative PDF text layer. It returns one-based PDF page locators, verbatim extracted windows, exact total/returned match counts, and text-layer coverage. Coverage is `complete`, `partial_text_coverage`, or `no_usable_text`; a no-match on incomplete coverage cannot establish absence. Its PDF page index is distinct from a printed label, MinerU sidecar line, or indexed offset. On multi-PDF items, pass `attachment_key` and keep the echoed resolved attachment key in the locator.

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

### Give readers usable evidence locations for paper lists

For candidate, eligibility, or inventory lists, use `Paper | Relevance | Evidence` rather than a footnote for each row. Relevance says why the paper qualifies; Evidence names the section, table, and verified one-based PDF page where the supporting passage appears. Link the title to that PDF page, not to a separate item link. Do not repeat the PDF link in Evidence.

```markdown
| Paper | Relevance | Evidence |
|---|---|---|
| [Author (Year), Title](zotero://open-pdf/library/items/ATT_KEY?page=6) | Estimates treatment effects on outcome | Results, Table 2; PDF p. 6 |
| [Author (Year), Title](zotero://select/library/items/KEY) | Discusses the outcome | Conclusion; PDF page not verified |
```

Use the attachment key and exact URL returned by the PDF tool; never infer a page from an indexed chunk number or sidecar line. A PDF-text match must locate the supporting passage, not merely the paper title. If no PDF page is verified, link the title to the Zotero parent item and give the section or a brief supporting excerpt in Evidence. State when the page is unverified. Keep evidence IDs, chunk IDs, sidecar lines, and source hashes in the internal record, not as the only reader-facing location. For a metadata-only list, a title linked to the item is sufficient; omit Relevance and Evidence when they add nothing.

### Keep narrative citations precise and bounded

- Number footnote markers in order of appearance.
- One marker may support several claims drawn from the same table, passage, or tightly bounded result context in one paragraph or table row. Use a new marker when the source location, evidence route, or result context materially changes.
- End with one `### Evidence` block containing only cited entries. Omit it when the answer contains no material source-grounded claims requiring footnotes or uses only compact list locators.
- Each entry gives author/year, title when available, item key, and exact PDF page, passage, section, or sidecar lines. Distinguish printed pages from PDF indices when known.
- Footnotes give source locations, not internal tool names or raw curly-brace records. Keep scores, hashes, and classification fields internal unless requested or material; never present score histories as corroboration.
- Disclose reliance on weaker sidecar evidence in the answer; one brief note can cover several claims. Label table values needed to support the answer **table-extracted** unless source prose independently states them.
- When a needed value stayed `unresolved`, `single-route`, or `legacy-unverified` and you did not inspect the rendered page, end the answer (before Evidence) with a short **Check yourself** list: paper, table, the `[PDF p. N](zotero://open-pdf/...)` link from the PDF tool, and the reason (e.g., "duplicated rows in the extraction"). Do not state the value as established.
- Never claim visual inspection, page verification, exhaustive coverage, or automated auditing that did not occur.
- Keep capability notes brief and before the Evidence block. Ordinary answers need no audit-status note.
- If web sources also appear, combine `[^wN]` and `[^cN]` definitions in that final Evidence block.

```markdown
The paper reports the stated result.[^c1]

### Evidence
[^c1]: [Author — Title (Year)](zotero://select/library/items/KEY); Table 2, [PDF p. 6](zotero://open-pdf/library/items/ATT_KEY?page=6).
```

For narrative footnotes, wrap cited titles with their `zotero://select/library/items/<PARENT_KEY>` link. When citing a verified PDF page in a footnote, paste the tool-returned `[PDF p. X](zotero://open-pdf/library/items/<ATT_KEY>?page=X)` token. In paper-list tables, instead put that verified PDF URL on the title as instructed above. Do not hand-craft attachment URLs if an attachment key was not returned; use the plain text locator.

Keep structured JSON and canonical evidence records unchanged in machine-facing tasks; use footnotes or compact evidence locators for human-facing synthesis.
For record fields or when checking where evidence came from, load [evidence record formats](references/evidence-contracts.md).

## 5. Run Final Contract Audits and Review Extraction Packets

### Automatic mechanical audit

After substantive source review and before the final answer, run one `zotero_audit_claims` audit cycle with `escalation="none"` when the answer contains audit-ready evidence for any of these:

- Exact empirical estimates or uncertainty measures.
- Direct quotations.
- Cross-paper numerical comparisons.
- Other material quantitative claims where a wrong item, quote, number, or unit would change the answer.

Audit no more than eight atomic claims, and audit only claims that will actually appear in the final answer. For a comparison, audit the reported maxima and the ranking claim only — typically three or four claims, never intermediate working estimates.
Keep `expected_values` minimal: one estimate plus its inference value (SE, CI endpoint pair, p-value, or threshold) per claim. Extra entries are extra mismatch surface; sample sizes, years, and table/figure locator numbers are not findings and do not belong here.
Mirror the source's printed notation exactly. Copy quotes verbatim from text already returned in-session — never retype — so Unicode minus signs (`−0.020`, not `-0.020`), printed percent units (`%`, never `pp`), and CI punctuation survive; bare years need no `expected_values` entry. `p_threshold` entries require `operator: "<"`.
At most two audit executions per question: one call plus one corrected resubmission. Fix rejected payloads from the hook's one-line pre-dispatch reason, never by retyping blind. Call the audit directly, not wrapped in scripting, so the pre-dispatch checks apply. For a comparison, pass `allowed_item_keys` from the validated top-one or top-three selection. Prioritize the decisive estimates and ranking claim; do not audit intermediate working claims. Use `expected_values` for empirical estimates, SEs, CI endpoints, p-values, thresholds, and sample sizes so table, figure, model, page, and year numbers in prose are not audited as findings. Use the exact parent item keys, evidence routes, locators, queries, and literal quotes already collected by the governing task skill. Do not retrieve another representation merely to make the payload audit-ready.

Skip the audit for metadata-only inventories, paper-discovery lists with compact locators, bibliography occurrences, citation-graph results, routine qualitative summaries, and claims without audit-ready evidence. Never call `zotero_audit_claims` inside `zotero-extract`.

The audit rehydrates evidence and checks mechanical contracts such as source identity, quote containment, fresh positive semantic rerank, numbers and units, and comparator-item coverage. It does not establish entailment, causal validity, table interpretation, comparability, or scope completeness. Never cite the audit as source evidence or describe a passing status as proof.

One audit cycle permits one initial call and at most one corrected resubmission. Resubmit only when the first result exposes a genuine caller-payload error such as a wrong locator, truncated quote, omitted expected value, or incorrect item key. Do not resubmit when the returned excerpt visibly contains the claimed values and the diagnostic indicates a parser defect. Correct genuine errors before answering, but do not alter source text, weaken thresholds, or begin a search cycle solely to obtain a passing status. Treat stale schemas and unavailable checkers as tool failures rather than source findings. Never include audit status or diagnostics in the final answer unless the capability failure materially limits the answer.

For payload fields, route rules, and reason codes, load [claim-audit reference](references/claim-audit.md).

### Extraction packets

A validated extraction packet contains evidence to review, not an automatic citation or a new source of evidence.
When reviewing extraction results in the main session:
1. Use only validated packets from accepted `processed` items. Confirm identity, manifest state, source hash, and quotes against the source or sidecar.
2. Treat worker confidence as a review flag, not verification. Unresolved evidence stays unverified.
3. Packet routes describe where the evidence came from; they are not reranker scores. Verified direct reading needs no semantic search to certify it.
4. Synthesize across papers in the main session; extraction workers report only their assigned source.
5. Treat a completed manifest as coverage evidence, not proof of claims. An empty packet establishes only no matching evidence found under its inclusion rule.
6. Present the resulting claims with the footnotes above, not raw packet JSON.

For the meaning of packet fields, load [extraction packet fields](references/extraction-packet.md).
