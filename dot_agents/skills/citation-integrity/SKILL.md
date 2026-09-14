---
name: citation-integrity
description: Enforces evidence contracts for claims from Samuel's Zotero passage RAG, bibliography index, direct source reads, and citation graph. Use whenever an answer asserts source content, a citation occurrence, graph structure, findings, numbers, mechanisms, or cross-paper comparisons grounded in Zotero.
---

# Citation Integrity & Evidence Contracts

## Request-Routing Playbook

```text
MATERIAL CLAIM
│
├─ Classify the claim
│  ├─ finding / mechanism / definition ──→ positive-Rerank passage or direct source read
│  ├─ empirical number / table value ────→ exact passage + direct page verification when needed
│  ├─ source identity / scope ────────────→ resolve_exact_source (identity metadata only)
│  ├─ bibliography occurrence / count ────→ zotero_search_bibliography_entries (raw entries / distinct citers)
│  ├─ graph relationship / ranking ───────→ graph tool with explicit scope
│  └─ plain metadata fact ─────────────────→ verified metadata lookup
├─ Explicit automated audit requested? ──→ Zotero research skill's opt-in claim-audit workflow
├─ Is the route permitted for this claim? ─→ Continue only with that route
├─ Is the claim a comparison? ────────────→ Keep each clause tied to its own source
├─ Are values or attributes material? ────→ Verify value, unit, sign (+/-), specification, attribution, and time horizon
├─ Is evidence sufficient? ───────────────→ Attach an internal evidence record and render it as a footnote
└─ Evidence insufficient? ─────────────────→ Retrieve stronger evidence, mark UNVERIFIED, or omit
```

Apply this sequence separately to every material Zotero-grounded claim. It maps claims to evidence types; it does not replace the Zotero research skill's routing or the rules below.

## Scope & Non-Negotiable Rules

Follow these rules for every Zotero-grounded claim, including casual chat and literature reviews.

1. **Ground Every Claim:** Every finding, number, reference count, or graph metric must trace directly to its own retrieved source record. Generated `[Figure Schema]` descriptions are discovery aids, not standalone empirical evidence; verify against source text, captions, tables, or a page image.
2. **Verify Numbers in the Source Text:** Confirm exact values, units, signs (+/-), samples, specifications, and time horizons directly in the cited text. For decisive estimates and rankings, verify the targeted result and necessary notes once — from a PDF page when the value comes from table text, or from complete unambiguous prose when it does not. Complete positive-Rerank passages can support incidental numbers when they contain both value and context. Use a precise known-item sidecar window with `zotero_find_in_item` when page extraction fails, the locator is unavailable, or a precise window avoids a broad read. Reuse verified evidence rather than retrieving it again for certification. If you cannot verify the exact number, drop it or mark it `UNVERIFIED`.
3. **Only Use Positive Rerank Scores:** Passages with a `Rerank` score of 0 or lower cannot support a claim about a paper's findings. Treat zero or negative scores as search clues only. Never make up a `Rerank` score. A positive score makes a passage eligible for inspection; it does not establish truth or entailment. Read sufficient context to verify the proposition, attribution, and necessary conditions. Check quotations verbatim. A higher score after re-querying is not independent corroboration. An expanded hit and its adjacent chunks may supply the needed context; cite the chunk actually supporting the claim and never assign the anchor's score to a neighbor. Expansion adds no new score. An ineligible anchor does not become eligible merely by expansion; use a direct-source route to verify it.
4. **Keep Sources Separate:** Never use one paper's evidence to back up a claim about a different paper. In comparisons between papers, give each claim its own separate footnote. Follow the Zotero ranking workflow: align estimands and resolve plausible challengers before choosing a winner; supported individual numbers alone do not establish a ranking.
5. **Handle Unclear References Carefully:** If a reference search returns ambiguous or unresolved results, state only that the raw text string appeared. Do not assume the paper identity or build graph links from it.
6. **Do Not Cite Bibliography Sections as Findings:** Passages marked `REF` or containing reference lists only prove what a paper cited. They never prove the paper's own findings.
7. **External References (`ext:*`):** External nodes contain basic metadata only and do not link to outgoing citations. Never infer a paper's findings from an external reference. Check your local library before claiming a paper is missing.
8. **Admit Missing Evidence:** Say "No supporting evidence found in the retrieved passages" or mark the claim "Unverified" instead of guessing from memory. Without exhaustive coverage, limit rankings to the comparable estimates retrieved; do not imply a collection-wide winner. Check headings and connective prose as carefully as quotations: retain important hypotheses, remove overstatements, and label your own deductions as synthesis.
9. **Keep Source Details Internally:** Retain verified `itemType`, `source_group`, and any canonical `review:*` or `type:*` tags in the internal evidence record. Reuse verified metadata already returned; fetch missing citation identity only for sources actually cited. Do not make calls solely to fill internal classification or tag fields. These labels describe the source—they do not prove the claim. Ordinary footnotes use the concise format below; show diagnostic fields only when requested or material to the answer.
10. **Use Truthful Retrieval Routes:**
    - Every substantive finding must come from a valid source route (`zotero_semantic_search`, its bounded expansion `zotero_read_passage`, `zotero_read_pdf_pages`, `zotero_get_item_fulltext`, or `zotero_find_in_item` for sidecar lookups). Identity, metadata, bibliography, and graph claims use their own routes in the router above.
    - Distinguish extracted PDF-page text, MinerU sidecar text, and visual inspection of a rendered page image. `zotero_read_pdf_pages` returns text; never claim a visual check unless an image was actually inspected. Never label sidecar text as a page read, and do not use the vague label "direct PDF".
    - Indexed passages may expose the same sidecar text as literal lookups. Agreement across those views is not independent corroboration. All extracted text, including prose and PDF text layers, can contain errors. Resolve broken signs or columns using unambiguous source prose or a page image; never silently repair a table.
    - Footnotes do not show internal tool names. Show the exact location (e.g., `passage 12/40`, `PDF p. 14`, `lines 45–60`). Distinguish printed page numbers from PDF page indices when known. Do not present an ambiguous page label as a verified PDF page; use the stable passage or section locator instead.
    - If your evidence comes from a weaker source (like a sidecar rather than the original PDF page), explain that directly in your text.
    - A value quoted from table text (PDF text layer or sidecar) that is load-bearing for a lead claim or a ranking should be labeled as table-extracted unless the surrounding prose independently states it.
    - Never print raw curly-brace records (`{...}`) in chat; format them as standard footnotes.
11. **Use the Resolver Only for Identity:** `zotero_resolve_exact_source` tells you whether a paper exists in a collection. It gives you the `item_key` to search, but it does not prove any findings. If the result is ambiguous or absent, report the conflict. Never use `related_matches` as evidence or silently switch to another paper.
12. **Automated Audits Are Opt-In:** Ordinary RAG, including numbers, causal claims, and rankings, does not require `zotero_audit_claims`. Verify source evidence while retrieving it. Use the tool only when Samuel explicitly requests automated auditing, following the [Zotero research audit workflow](../zotero-research/SKILL.md) and its bounded repair rules. Never use it inside `zotero-extract`.
    - A successful audit validates its evidence contract, not semantic entailment, causal identification, comparable estimands, or candidate coverage. Never cite the audit as source evidence.
    - Keep evidence quotes literal and provenance truthful. Do not repair OCR or alter thresholds to make a quote pass. Qualify or omit unresolved claims rather than retrying indefinitely.
    - Describe verification coverage accurately. Never say all figures were audited or page-verified unless each material final figure was covered that way.

## Statistical Reporting

- Preserve the reported scale: coefficient, semielasticity, marginal effect, IRR, or percentage change. Read the table notes; parentheses do not always mean standard errors. Do not exponentiate an already transformed estimate.
- For every estimate discussed, include the user's requested uncertainty fields or distinguish “not reported in the checked result” from “not retrieved.” Do not claim a statistic is absent from the whole paper after a partial read.
- Keep reported statistics separate from your calculations. Never invent an exact p-value from significance stars, rounded coefficients, or rounded SEs. Report the stated threshold when only a threshold is available.
- Calculate uncertainty only when the scale and inferential assumptions justify it. Label calculated CIs or p-values as approximate, state the method and assumptions, and use available degrees of freedom where required. A normal approximation from clustered SEs is not an exact reproduction of the paper's inference.
- Transform interval endpoints consistently with the estimate and present bounds in ascending order. Do not mix a positive “reduction” scale with signed percentage-change bounds.
- If a reported p-value and CI appear inconsistent, check the inferential method or disclose the unresolved discrepancy. They may use different procedures; never silently repair either value.

## Human-Facing Evidence Presentation

For chat responses, use standard Markdown footnotes rather than raw curly-brace records:

- Put a `[^cN]` marker immediately after the supported clause. Number markers in order of appearance.
- Reuse a marker only for the exact same source and page/passage locator. Different passages, pages, or sources receive separate markers.
- Place one `### Evidence` block at the very end of your response, listing only the cited entries. Omit the block only if no evidence was cited.
- Format ordinary footnotes with author/year, title when available, item key, and exact passage, page, section, or line locator. Retain scores, route details, hashes, classifications, and tags internally; show them only for a requested evidence audit or when material to the answer. Do not print original/recheck score histories as corroboration.
- Keep operational capability notes brief and before the final Evidence block. Ordinary answers need no audit-status note.
- If web evidence is also present, combine the `[^wN]` and `[^cN]` definitions in this same final block while keeping the numbers distinct.

```markdown
A paper reports the claimed mechanism.[^c1]

### Evidence
[^c1]: Author — Title (Year); item KEY; passage 12/40, PDF p. 14.
```

Keep structured JSON and raw canonical evidence records unchanged for machine-facing background tasks; only human-facing chat responses use footnotes.

## Zotero-Extraction Packet Adjudication

A validated `zotero-extract` packet contains candidate evidence; it is not an automatic citation and not a new tool route. The main session reviews packets after `zotero-extract submit` accepts them and before writing cross-paper conclusions.

For packet field meanings, load [extraction packet fields](references/extraction-packet.md).

Review steps:

1. Use only validated packets for items in the accepted `processed` state. Confirm item identity, manifest state, source hash, and quotes against the source or sidecar. Worker confidence never substitutes for verification; unresolved evidence stays unverified.
2. Packet extraction routes describe how the worker read the text; they do not provide `Rerank` scores. Verified direct-source evidence needs no reranker score. Use semantic search only for an unresolved retrieval gap, not to certify an adequate direct read.
3. Compare findings across papers in the main session. Workers extract evidence from single papers; they do not synthesize cross-paper conclusions.
4. The extraction manifest proves that papers were processed, not that their claims are true. An empty packet proves only that no matching evidence was found under the inclusion rule.
5. Format final findings as human-readable footnotes; do not dump raw JSON packets in chat.

## Progressive Disclosure

- For machine-readable evidence records or an explicit provenance inspection, load [evidence contracts](references/evidence-contracts.md). Ordinary cited answers do not require loading this schema reference.
- For unclear extraction, figure schemas, missing reranker evidence, or failure phrasing, load [verification diagnostics](references/verification-workflow.md).
