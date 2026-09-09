---
name: citation-integrity
description: Enforces evidence contracts for claims from Samuel's Zotero passage RAG, bibliography index, direct source reads, and citation graph. Use whenever an answer asserts source content, a citation occurrence, graph structure, findings, numbers, mechanisms, or cross-paper comparisons grounded in Zotero.
---

# Citation Integrity & Evidence Contracts

## Claim-to-Evidence Playbook

Apply this sequence separately to every material Zotero-grounded claim. This maps claims to evidence types; it does not replace the main Zotero skill's routing or the rules below.

```text
MATERIAL CLAIM
→ classify the claim
  ├─ finding / mechanism / definition ─→ positive-Rerank passage or direct source read
  ├─ empirical number / table value ──→ exact passage + direct page verification when needed
  ├─ source identity / scope ─────────→ resolve_exact_source (identity metadata only)
  ├─ bibliography occurrence / count → zotero_search_bibliography_entries (raw entries / distinct citers)
  ├─ graph relationship / ranking ───→ graph tool with explicit scope
  └─ plain metadata fact ─────────────→ verified metadata lookup
→ for a high-risk ordinary-RAG draft ─→ Zotero skill's bounded audit / capability fallback
→ check that the chosen route is permitted to support this claim
→ isolate the claim to its own source; comparisons require separate evidence per clause
→ verify value, unit, sign (+/-), specification, attribution, and time horizon
→ attach an internal evidence record naming the item and locator; render as a footnote
→ if evidence is insufficient: retrieve stronger evidence, mark UNVERIFIED, or omit
```

Remember what each tool can and cannot prove:
- The resolver proves only source identity and collection membership.
- Bibliography search proves only that a paper appears in a reference list.
- Citation graph tools prove only the graph structure returned by the tool.
- Metadata lookups prove only descriptive facts (like title, author, or year).
None of these tools prove a paper's actual empirical findings. To support a finding, you must have a passage with `Rerank > 0` (not a reference list) or read the actual source text directly. The `zotero_audit_claims` tool checks your work; it is not an evidence source by itself.

## Scope & Non-Negotiable Rules

Follow these rules for every Zotero-grounded claim, including casual chat and literature reviews.

1. **Ground Every Claim:** Every finding, number, reference count, or graph metric must trace directly to its own retrieved source record.
2. **Verify Numbers in the Source Text:** Confirm exact values, units, signs (+/-), samples, specifications, and time horizons directly in the cited text. If the passage does not show the exact number, read the actual PDF page with `zotero_read_pdf_pages` (or use a targeted MinerU sidecar extraction if the page tool fails). If you cannot verify the exact number, drop it or mark it `UNVERIFIED`.
3. **Only Use Positive Rerank Scores:** Passages with a `Rerank` score of 0 or lower cannot support a claim about a paper's findings. Treat zero or negative scores as search clues only. Never make up a `Rerank` score. A positive score makes a passage eligible for inspection; it does not establish truth or entailment. Read sufficient context to verify the proposition, attribution, and necessary conditions. Check quotations verbatim. A higher score after re-querying is not independent corroboration.
4. **Keep Sources Separate:** Never use one paper's evidence to back up a claim about a different paper. In comparisons between papers, give each claim its own separate footnote.
5. **Handle Unclear References Carefully:** If a reference search returns ambiguous or unresolved results, state only that the raw text string appeared. Do not assume the paper identity or build graph links from it.
6. **Do Not Cite Bibliography Sections as Findings:** Passages marked `REF` or containing reference lists only prove what a paper cited. They never prove the paper's own findings.
7. **External References (`ext:*`):** External nodes contain basic metadata only and do not link to outgoing citations. Never infer a paper's findings from an external reference. Check your local library before claiming a paper is missing.
8. **Admit Missing Evidence:** Say "No supporting evidence found in the retrieved passages" or mark the claim "Unverified" instead of guessing from memory. Without exhaustive coverage, limit rankings to the comparable estimates retrieved; do not imply a collection-wide winner. Check headings and connective prose as carefully as quotations: retain important hypotheses, remove overstatements, and label your own deductions as synthesis.
9. **Keep Source Details Internally:** Retain verified `itemType`, `source_group`, and any canonical `review:*` or `type:*` tags in the internal evidence record. Reuse verified metadata already returned; look up missing fields only for sources you actually cite. These labels describe the source—they do not prove the claim. Ordinary footnotes use the concise format below; show diagnostic fields only when requested or material to the answer.
10. **Use Truthful Retrieval Routes:**
    - Every claim must come from a valid tool route (`zotero_semantic_search`, `zotero_read_pdf_pages`, `zotero_get_item_fulltext`, or `mineru_sidecar`).
    - Never label sidecar or shell text as a page read, and do not use the vague label "direct PDF".
    - Footnotes do not show internal tool names. Show the exact location (e.g., `passage 12/40`, `PDF p. 14`, `lines 45–60`). Distinguish printed page numbers from PDF page indices when known. Do not present an ambiguous page label as a verified PDF page; use the stable passage or section locator instead.
    - If your evidence comes from a weaker source (like a sidecar rather than the original PDF page), explain that directly in your text.
    - Never print raw curly-brace records (`{...}`) in chat; format them as standard footnotes.
11. **Use the Resolver Only for Identity:** `zotero_resolve_exact_source` tells you whether a paper exists in a collection. It gives you the `item_key` to search, but it does not prove any findings. If the result is ambiguous or absent, report the conflict. Never use `related_matches` as evidence or silently switch to another paper.
12. **Interpret Deterministic Claim Audits:** Follow the Zotero skill's high-risk triggers and request-wide repair budget. Conceptual explanations and ordinary quotations do not require an audit solely because they quote or compare sources.
    - `zotero_audit_claims` validates evidence identity, freshness, route, quote, reranker, numeric, and comparison gates. `supported` means the evidence contract passed; it does not independently establish semantic entailment or correct claim wording. Review those inferences, qualifications, and causal language in the main session.
    - For `unsupported` or `insufficient` results, retrieve stronger evidence within the repair budget, omit the claim, or explain the specific gap. Neither status alone establishes contradiction unless the deterministic reason identifies one, such as `NUMBER_MISMATCH` or `UNIT_MISMATCH`.
    - A failed re-retrieval or quote-containment check is not proof that the original quote was absent. Resolve it with a targeted source read within the Zotero skill's repair budget. Unresolved evidence gaps still require qualification or omission.
    - Never cite the audit check itself as proof for a claim.
    - Do not use `zotero_audit_claims` inside `zotero-extract` collection runs.

## Human-Facing Evidence Presentation

For chat responses, use standard Markdown footnotes rather than raw curly-brace records:

- Put a `[^cN]` marker immediately after the supported clause. Number markers in order of appearance.
- Reuse a marker only for the exact same source and page/passage locator. Different passages, pages, or sources receive separate markers.
- Place one `### Evidence` block at the very end of your response, listing only the cited entries. Omit the block only if no evidence was cited.
- Format ordinary footnotes with author/year, title when available, item key, and exact passage, page, section, or line locator. Retain scores, route details, hashes, classifications, and tags internally; show them only for a requested evidence audit or when material to the answer. Do not print original/recheck score histories as corroboration.
- Keep operational capability notes brief and before the final Evidence block. A conceptual answer that does not require an audit needs no audit-status note.
- If web evidence is also present, combine the `[^wN]` and `[^cN]` definitions in this same final block while keeping the numbers distinct.

```markdown
A paper reports the claimed mechanism.[^c1]

### Evidence
[^c1]: Author — Title (Year); item KEY; passage 12/40, PDF p. 14.
```

Keep structured JSON and raw canonical evidence records unchanged for machine-facing background tasks; only human-facing chat responses use footnotes.

## Zotero-Extraction Packet Adjudication

A validated `zotero-extract` packet contains candidate evidence; it is not an automatic citation and not a new tool route. The main session reviews packets after `zotero-extract submit` accepts them and before writing cross-paper conclusions.

| Packet field | Purpose in Review |
|---|---|
| `packet_version`, accepted `processed` state | Confirms the packet passed the validator. Failed, escalated, or pending items cannot be cited. |
| `item_key`, `inclusion_rule` | Ensures the item matches the assigned source and rule. Never substitute another paper. |
| `extraction_route`, `route_fidelity` | Shows how the worker read the source. This is provenance, not a `Rerank` score. |
| `source.path`, `source.sha256` | Verifies that the packet came from an unchanged source file. |
| `records[].kind`, `records[].quote`, `records[].anchor` | Contains the verbatim quote and page/section locator. Re-check before final approval. |
| `records[].confidence`, `ambiguous`, `note` | Review flags only. Worker confidence never replaces checking the source. |
| `omission_pass`, `negative_result` | Indicates whether the worker checked the whole document. An empty result is an honest negative finding. |
| `worker` | Model and process metadata for the audit trail. |

Review steps:

1. Confirm item identity, manifest state, source hash, and quotes. If you cannot verify the packet against the original source or sidecar, mark the evidence unverified.
2. Packet extraction routes describe how the worker read the text; they do not provide `Rerank` scores. If a claim requires semantic search, run `zotero_semantic_search` separately.
3. Compare findings across papers in the main session. Workers extract evidence from single papers; they do not synthesize cross-paper conclusions.
4. The extraction manifest proves that papers were processed, not that their claims are true. An empty packet proves only that no matching evidence was found under the inclusion rule.
5. Format final findings as human-readable footnotes; do not dump raw JSON packets in chat.

## Evidence Router & Canonical Tokens

| Claim Type | Evidence Tool | Internal Record (Render as Footnote) |
|---|---|---|
| Substantive passage / findings | `zotero_semantic_search` | `{Author Year, item KEY, passage N/M, p. X, Rerank +S; itemType/source_group; canonical tags}` |
| Direct page / full-text read | `zotero_read_pdf_pages` / `zotero_get_item_fulltext` | `{Author Year, item KEY, p. X; itemType/source_group; canonical tags}` or `{Author Year, item KEY, § heading; ...}` |
| Known-item sidecar extraction | Targeted `grep`/`sed` on MinerU sidecar | `{Author Year, item KEY, p. X if mapped, lines X–Y; itemType/source_group; canonical tags}` |
| Source identity / collection scope | `zotero_resolve_exact_source` | `{resolve_exact_source → status, item KEY or conflict, collection scope}` (identity metadata only) |
| Bibliography occurrence | `zotero_search_bibliography_entries` | `{search_bibliography_entries → citing KEY, entry N, status, confidence, parse P}` |
| Citation graph structure | `zotero_rank_works_by_inbound_citations` / neighbors | `{tool → scope, seed/target item keys, node kind, returned measure}` |

- *Metadata formatting:* In internal evidence records and requested diagnostic footnotes, use compact labels such as `journalArticle/article; review:checked`. Include only verified canonical `review:*` and `type:*` tags. Omit the tag section when none exist.
- *API Facts:* Basic metadata claims (title, authors, year, key, collections) must be verified. The resolver can prove collection membership, but never proves an empirical finding.

## Progressive Disclosure

- For exact internal evidence schemas and field rules, load [evidence contracts](references/evidence-contracts.md).
- For score thresholds, number verification checklists, and failure phrasing, load [verification workflow](references/verification-workflow.md).
