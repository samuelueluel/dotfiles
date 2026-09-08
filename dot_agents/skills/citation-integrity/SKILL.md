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
→ for a high-risk ordinary-RAG draft ─→ zotero_audit_claims after evidence retrieval/verification
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
3. **Only Use Positive Rerank Scores:** Passages with a `Rerank` score of 0 or lower cannot support a claim about a paper's findings. Treat zero or negative scores as search clues only. Never make up a `Rerank` score.
4. **Keep Sources Separate:** Never use one paper's evidence to back up a claim about a different paper. In comparisons between papers, give each claim its own separate footnote.
5. **Handle Unclear References Carefully:** If a reference search returns ambiguous or unresolved results, state only that the raw text string appeared. Do not assume the paper identity or build graph links from it.
6. **Do Not Cite Bibliography Sections as Findings:** Passages marked `REF` or containing reference lists only prove what a paper cited. They never prove the paper's own findings.
7. **External References (`ext:*`):** External nodes contain basic metadata only and do not link to outgoing citations. Never infer a paper's findings from an external reference. Check your local library before claiming a paper is missing.
8. **Admit Missing Evidence:** Say "No evidence found in the library" or mark the claim "Unverified" instead of guessing from memory.
9. **Include Source Details in Evidence Notes:** In each footnote, include the verified `itemType` and `source_group` (e.g., `journalArticle/article`), along with any `review:*` or `type:*` tags. Only look up metadata for sources you actually cite. These tags describe the source—they do not prove the claim.
10. **Use Truthful Retrieval Routes:**
    - Every claim must come from a valid tool route (`zotero_semantic_search`, `zotero_read_pdf_pages`, `zotero_get_item_fulltext`, or `mineru_sidecar`).
    - Never label sidecar or shell text as a page read, and do not use the vague label "direct PDF".
    - Footnotes do not show internal tool names. Instead, show the exact location (e.g., `passage 12/40`, `p. 14`, `lines 45–60`, `Rerank +3.2`).
    - If your evidence comes from a weaker source (like a sidecar rather than the original PDF page), explain that directly in your text.
    - Never print raw curly-brace records (`{...}`) in chat; format them as standard footnotes.
11. **Use the Resolver Only for Identity:** `zotero_resolve_exact_source` tells you whether a paper exists in a collection. It gives you the `item_key` to search, but it does not prove any findings. If the result is ambiguous or absent, report the conflict. Never use `related_matches` as evidence or silently switch to another paper.
12. **Auditing High-Risk Claims:** When making critical or exact claims in regular Zotero searches, run `zotero_audit_claims` after gathering evidence and before writing your final answer.
    - Check each claim against the tool's verdict: `supported` means you can cite it; `revise` means soften your wording; `unsupported` or `insufficient` means drop the claim or explain the gap.
    - Never cite the audit check itself as proof for a claim.
    - Do not use `zotero_audit_claims` inside `zotero-extract` collection runs.
    - If the tool is not available on the current server, keep the existing strict evidence checks without widening your search.

## Human-Facing Evidence Presentation

For chat responses, use standard Markdown footnotes rather than raw curly-brace records:

- Put a `[^cN]` marker immediately after the supported clause. Number markers in order of appearance.
- Reuse a marker only for the exact same source and page/passage locator. Different passages, pages, or sources receive separate markers.
- Place one `### Evidence` block at the very end of your response, listing only the cited entries. Omit the block only if no evidence was cited.
- Format each footnote with author/year, title when available, item key, locator (`passage`, `p.`, `lines`), `Rerank` when applicable, and source tags.
- If web evidence is also present, combine the `[^wN]` and `[^cN]` definitions in this same final block while keeping the numbers distinct.

```markdown
A paper reports the claimed mechanism.[^c1]

### Evidence
[^c1]: Author — Title (Year); item KEY; passage 12/40, p. 14, Rerank +3.22; journalArticle/article; review:checked
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

- *Metadata formatting:* In evidence records and footnotes, use compact labels such as `journalArticle/article; review:checked`. Include only verified canonical `review:*` and `type:*` tags. Omit the tag section when none exist.
- *API Facts:* Basic metadata claims (title, authors, year, key, collections) must be verified. The resolver can prove collection membership, but never proves an empirical finding.
- *Multisource:* Using `/skill:multisource` changes how responses are structured; it never relaxes these evidence rules.

## Progressive Disclosure

- For exact internal evidence schemas and field rules, load [evidence contracts](references/evidence-contracts.md).
- For score thresholds, number verification checklists, and failure phrasing, load [verification workflow](references/verification-workflow.md).
