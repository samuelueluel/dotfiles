---
name: citation-integrity
description: Enforces evidence contracts for claims from Samuel's Zotero passage RAG, bibliography index, direct source reads, and citation graph. Use whenever an answer asserts source content, a citation occurrence, graph structure, findings, numbers, mechanisms, or cross-paper comparisons grounded in Zotero.
---

# Citation Integrity & Evidence Contracts

## Claim-to-Evidence Playbook

Apply this sequence separately to every material Zotero-grounded claim. This is a claim-level evidence map, not a replacement for the Zotero skill's request routing or the detailed contracts below.

```text
MATERIAL CLAIM
→ classify the claim
  ├─ finding / mechanism / definition ─→ positive-Rerank passage or direct source
  ├─ empirical number / table value ──→ exact passage + direct page verification when needed
  ├─ source identity / scope ─────────→ resolve_exact_source (identity metadata only)
  ├─ bibliography occurrence / count → zotero_search_bibliography_entries (raw entries / distinct citers)
  ├─ graph relationship / ranking ───→ graph tool with explicit scope
  └─ plain metadata fact ─────────────→ verified metadata lookup
→ check that the chosen route is permitted to support this claim
→ isolate the claim to its own source; comparisons require separate evidence per clause
→ verify value, unit, sign, specification, attribution, and horizon when applicable
→ attach an internal canonical evidence record naming the actual item, evidence location/type, and source classification; render it as a human-facing evidence footnote
→ if the contract fails: retrieve stronger evidence, qualify/mark UNVERIFIED, or omit
```

Hard boundaries: resolver output proves identity/scope, reference search proves bibliography occurrence, graph tools prove returned structure, and metadata proves descriptive facts. None of those routes proves a paper's substantive findings. Semantic evidence requires raw `Rerank > 0` and a non-`REF` passage; direct evidence must genuinely come from a truthful read route. Substantive content tokens omit internal route labels; identity, bibliography, and graph audit tokens use the explicit operation labels defined below.

## Scope & Non-Negotiable Rules

Enforce this skill for every Zotero-grounded claim, including casual chat and literature synthesis.

1. **Ground Every Claim:** Every finding, number, reference occurrence, or graph metric must trace directly to its own retrieved source record.
2. **Verify Empirical Numbers:** Confirm exact values, units, sign, sample, specification, and horizon verbatim in the cited text. Escalate to `zotero_read_pdf_pages`, or to a targeted known-item MinerU sidecar extraction when page retrieval is unavailable or malformed; otherwise drop the value or mark it `UNVERIFIED`.
3. **Gate Confidence on Raw `Rerank`:** Only scores `> 0` may support substantive claims after passage verification. Negative scores are diagnostic/discovery evidence only. Missing `Rerank` indicates an instrumentation failure—never invent scores.
4. **Isolate Sources:** Never let one paper's passage or graph measure carry another paper's claim. Attach distinct tokens to each clause in multi-paper comparisons.
5. **Respect Resolution Boundaries:** `unresolved` or `ambiguous` references support only literal raw-string occurrences, never clean target identities or graph edges.
6. **Reject Bibliography Snippets:** Chunks marked `REF` or containing reference lists are discovery metadata, not substantive evidence for findings.
7. **External Reference Constraints:** `ext:*` nodes are metadata-only without outgoing references. Never infer source findings from an external citation. Check library metadata before asserting absence.
8. **Explicit Failure Reporting:** State "No evidence found in the library" or "Unverified" rather than hallucinating from memory.
9. **Source Metadata in Evidence Records:** Every cited local Zotero source must carry its verified native `itemType` and derived `source_group`; also include canonical `review:*` and `type:*` tags when present in the internal record and its corresponding human-facing evidence note. Retrieve metadata only for final cited sources. These labels describe/filter the source and never prove the claim.
10. **True Internal Route, Context-Specific Evidence Labels:** Every claim must genuinely originate from a permitted retrieval route (`zotero_semantic_search`, `zotero_read_pdf_pages`, `zotero_get_item_fulltext`, or `mineru_sidecar`); sidecar, shell, or other local output must never be passed off as a page read, and the vague legacy label `direct PDF` remains banned internally. Substantive evidence records and their human-facing notes do **not** display internal route names—the location (`passage N/M`, `p. X`, `lines X–Y`, `Rerank`) carries the audit trail. Identity, bibliography, and graph evidence notes use the explicit operation labels specified below. When a claim rests on weaker-than-page evidence, disclose that in prose, not in the footnote marker. Raw canonical records may remain available to machine-facing and adjudication paths, but never emit brace-delimited records as human-facing citation stamps.
11. **Resolver Is an Identity Gate:** Treat `zotero_resolve_exact_source` as metadata identity and collection-scope evidence only. An `exact` result permits retrieval from its returned `item_key` but does not support a finding; `ambiguous` and `absent` results support only the reported identity boundary or conflict. Never use `related_matches` as substantive evidence or silently replace the requested source with one of them.

## Human-Facing Evidence Presentation

For interactive, machine-to-human responses, use Markdown footnotes rather than raw brace-delimited evidence stamps:

- Put a `[^cN]` marker immediately after the supported clause. Number markers by first appearance.
- Reuse a marker only for the same source and evidence locator. Different passages, pages, sections, or supporting records receive separate markers; attach multiple markers when one claim has multiple sources.
- Place one `### Evidence` block at the absolute end of the response, containing only the referenced entries. Omit the shared block only when neither web nor Zotero evidence is cited.
- Render each internal canonical record as a readable entry while retaining every required field: author/year, title when available, item key, passage/page/section/line locator, `Rerank` when applicable, source classification, canonical tags, and explicit operation labels for identity, bibliography, or graph evidence.
- If web evidence is also present, combine the `[^wN]` and `[^cN]` definitions in this same final block while keeping the namespaces separate.

```markdown
A paper reports the claimed mechanism.[^c1]

### Evidence
[^c1]: Author — Title (Year); item KEY; passage 12/40, p. 14, Rerank +3.22; journalArticle/article; review:checked
```

Keep structured JSON and raw canonical evidence records unchanged for machine-facing or background-adjudication paths; only the human-facing rendering changes.

## Zotero-Extraction Packet Adjudication

A validated `zotero-extract` packet is a candidate-evidence container, not an approved citation and not a new retrieval route. The main session performs this handoff after `zotero-extract submit` accepts the packet and before cross-paper synthesis.

| Packet field | Adjudication use |
|---|---|
| `packet_version`, accepted `processed` state | Confirms the packet passed the deterministic validator; failed, escalated, excluded, or pending items are not citation evidence. |
| `item_key`, `inclusion_rule` | Exact source identity and run-scope gates; never substitute a related match or silently change the rule. |
| `extraction_route`, `route_fidelity` | Preserve provenance. These fields describe how the worker read the source; they do not create a new citation route or a `Rerank` score. |
| `source.path`, `source.sha256` | Confirm the packet is bound to the manifest and unchanged source before using any record. |
| `records[].kind`, `records[].quote`, `records[].anchor` | Map the claim class, verbatim candidate evidence, and page/section/table locator. Recheck the quote and locator before final approval. |
| `records[].confidence`, `ambiguous`, `note` | Adjudication flags only; worker confidence never replaces source verification. |
| `omission_pass`, `negative_result` | Completeness and honest-negative signals; neither proves a substantive claim by itself. |
| `worker` | Model/provenance metadata for the audit trail. |

Adjudication gates:

1. Confirm item identity, manifest state, source hash, verbatim quote, and anchor. If a `mineru_sidecar` packet cannot be rechecked against the permitted sidecar route, or a `pdf_text_layer` packet cannot be re-read through `zotero_get_item_fulltext` or `zotero_read_pdf_pages`, keep it as a candidate and mark it unverified.
2. Treat the packet route as provenance, never as a semantic-search score. If the final claim relies on RAG retrieval, obtain a separate `zotero_semantic_search` passage with raw `Rerank > 0`; never fabricate `Rerank` for full-document, sidecar, or direct page evidence.
3. Resolve conflicting records, source comparability, units, samples, specifications, and cross-paper attribution in the main session. Workers and the manifest do not adjudicate them.
4. The manifest proves collection coverage and terminal state, not the truth of findings. Empty packets support only an honest full-document negative result under the recorded rule.
5. Keep the validated JSON packet unchanged for machine-facing review. Human-facing claims use the footnote contract above, not raw packet JSON or brace-delimited records.

## Evidence Router & Canonical Tokens

| Claim Type | Evidence Source Tool | Internal canonical record (render as footnote) |
|---|---|---|
| Substantive passage / findings | `zotero_semantic_search` | `{Author Year, item KEY, passage N/M, p. X, Rerank +S; itemType/source_group; canonical tags}` |
| Direct page / full-text read | `zotero_read_pdf_pages` / `zotero_get_item_fulltext` | `{Author Year, item KEY, p. X; itemType/source_group; canonical tags}` or, when no page is mapped, `{Author Year, item KEY, § heading; itemType/source_group; canonical tags}` |
| Known-item sidecar extraction | Targeted `grep`/`sed` on the item's MinerU sidecar | `{Author Year, item KEY, p. X if mapped, lines X–Y; itemType/source_group; canonical tags}` |
| Source identity / collection membership | `zotero_resolve_exact_source` | `{resolve_exact_source → status, item KEY or conflict, collection scope}` — identity metadata only; not support for findings |
| Bibliography occurrence / identity | `zotero_search_bibliography_entries` | `{search_bibliography_entries → citing KEY, entry N, status, confidence, parse P}` |
| Citation graph structure / coupling | `zotero_rank_works_by_inbound_citations` / `zotero_get_citation_neighbors` / `zotero_find_bibliographically_coupled_papers` | `{tool → scope, seed/target item keys, node kind, returned measure}` |

*Metadata fields:* In the internal record and corresponding evidence note, use compact labels such as `journalArticle/article; review:checked`. Include only verified canonical `review:*` and `type:*` tags; omit the tag segment when none are present or metadata could not be retrieved. Never emit noncanonical legacy/subject tags in evidence records.
*API Facts:* Plain metadata claims (title, creators, year, key, tags, collections) require verification. The resolver may support a plain identity or collection-membership claim, but it never supports a substantive finding. Emit a resolver evidence record and corresponding footnote only when identity, absence, ambiguity, or collection membership is itself material; resolver-only identity notes do not require a separate metadata call unless the related record is substantively discussed. Substantive evidence records carry the evidence location; the route behind them must internally be one permitted for that claim type.
*Multisource:* Invoking `/skill:multisource` changes response structure only; it never relaxes these evidence contracts.

## Progressive Disclosure

- For exact internal evidence-record schemas, field constraints, and syntax examples, load [evidence contracts](references/evidence-contracts.md).
- For score thresholds, number verification checklists, figure handling, and failure phrasing, load [verification workflow](references/verification-workflow.md).
