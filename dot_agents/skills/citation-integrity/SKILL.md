---
name: citation-integrity
description: Enforces evidence contracts for claims from Samuel's Zotero passage RAG, bibliography index, direct source reads, and citation graph. Use whenever an answer asserts source content, a citation occurrence, graph structure, findings, numbers, mechanisms, or cross-paper comparisons grounded in Zotero.
---

# Citation Integrity & Evidence Contracts

## Scope & Non-Negotiable Rules

Enforce this skill for every Zotero-grounded claim, including casual chat and literature synthesis.

1. **Ground Every Claim:** Every finding, number, reference occurrence, or graph metric must trace directly to its own retrieved source record.
2. **Verify Empirical Numbers:** Confirm exact values, units, sign, sample, specification, and horizon verbatim in the cited text. Otherwise escalate to `zotero_zotero_read_pdf_pages`, drop the value, or mark it `UNVERIFIED`.
3. **Gate Confidence on Raw `Rerank`:** Scores `> 0` indicate confident matches. Negative scores are weak/noisy. Missing `Rerank` indicates an instrumentation failure—never invent scores.
4. **Isolate Sources:** Never let one paper's passage or graph measure carry another paper's claim. Attach distinct tokens to each clause in multi-paper comparisons.
5. **Respect Resolution Boundaries:** `unresolved` or `ambiguous` references support only literal raw-string occurrences, never clean target identities or graph edges.
6. **Reject Bibliography Snippets:** Chunks marked `REF` or containing reference lists are discovery metadata, not substantive evidence for findings.
7. **External Reference Constraints:** `ext:*` nodes are metadata-only without outgoing references. Never infer source findings from an external citation. Check library metadata before asserting absence.
8. **Explicit Failure Reporting:** State "No evidence found in the library" or "Unverified" rather than hallucinating from memory.
9. **Source Metadata in Tokens:** Every cited local Zotero source must carry its verified native `itemType` and derived `source_group`; also include canonical `review:*` and `type:*` tags when present. Retrieve metadata only for final cited sources. These labels describe/filter the source and never prove the claim.
10. **Exact Retrieval Route:** Name the actual evidence route (`semantic_search`, `read_pdf_pages`, or `get_item_fulltext`) rather than the vague legacy label `direct PDF`.

## Evidence Router & Canonical Tokens

| Claim Type | Evidence Source Tool | Canonical Token |
|---|---|---|
| Substantive passage / findings | `zotero_zotero_semantic_search` | `{Author Year, item KEY, passage N/M, p. X, Rerank +S; itemType/source_group; canonical tags}` |
| Direct page / full-text read | `zotero_zotero_read_pdf_pages` / `get_item_fulltext` | `{Author Year, item KEY, p. X, read_pdf_pages; itemType/source_group; canonical tags}` or `{Author Year, item KEY, get_item_fulltext; itemType/source_group; canonical tags}` |
| Bibliography occurrence / identity | `zotero_zotero_search_references` | `{search_references → citing KEY, entry N, status, confidence, parse P}` |
| Citation graph structure / coupling | Graph tools (`get_collection_hubs`, `lineage`, `connected`) | `{tool → scope, node kind, returned measure}` |

*Metadata fields:* Use compact labels such as `journalArticle/article; review:checked`. Include only verified canonical `review:*` and `type:*` tags; omit the tag segment when none are present or metadata could not be retrieved. Never emit noncanonical legacy/subject tags in evidence tokens.
*API Facts:* Plain metadata claims (title, creators, year, key, tags, collections) require verification. When a token supports a substantive local-source claim, the token itself carries the source classification above.
*Multisource:* Invoking `/skill:multisource` changes response structure only; it never relaxes these evidence contracts.

## Progressive Disclosure

- For exact token schemas, field constraints, and syntax examples, load [evidence contracts](references/evidence-contracts.md).
- For score thresholds, number verification checklists, figure handling, and failure phrasing, load [verification workflow](references/verification-workflow.md).
