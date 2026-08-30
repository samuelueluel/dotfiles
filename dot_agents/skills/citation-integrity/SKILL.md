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
  ├─ bibliography occurrence / count → search_references (raw entries / distinct citers)
  ├─ graph relationship / ranking ───→ graph tool with explicit scope
  └─ plain metadata fact ─────────────→ verified metadata lookup
→ check that the chosen route is permitted to support this claim
→ isolate the claim to its own source; comparisons require separate evidence per clause
→ verify value, unit, sign, specification, attribution, and horizon when applicable
→ attach a canonical token naming the actual item, route, and source classification
→ if the contract fails: retrieve stronger evidence, qualify/mark UNVERIFIED, or omit
```

Hard boundaries: resolver output proves identity/scope, reference search proves bibliography occurrence, graph tools prove returned structure, and metadata proves descriptive facts. None of those routes proves a paper's substantive findings. Semantic evidence requires raw `Rerank > 0` and a non-`REF` passage; direct evidence must genuinely come from a truthful read route, but tokens never display the route label.

## Scope & Non-Negotiable Rules

Enforce this skill for every Zotero-grounded claim, including casual chat and literature synthesis.

1. **Ground Every Claim:** Every finding, number, reference occurrence, or graph metric must trace directly to its own retrieved source record.
2. **Verify Empirical Numbers:** Confirm exact values, units, sign, sample, specification, and horizon verbatim in the cited text. Escalate to `zotero_zotero_read_pdf_pages`, or to a targeted known-item MinerU sidecar extraction when page retrieval is unavailable or malformed; otherwise drop the value or mark it `UNVERIFIED`.
3. **Gate Confidence on Raw `Rerank`:** Only scores `> 0` may support substantive claims after passage verification. Negative scores are diagnostic/discovery evidence only. Missing `Rerank` indicates an instrumentation failure—never invent scores.
4. **Isolate Sources:** Never let one paper's passage or graph measure carry another paper's claim. Attach distinct tokens to each clause in multi-paper comparisons.
5. **Respect Resolution Boundaries:** `unresolved` or `ambiguous` references support only literal raw-string occurrences, never clean target identities or graph edges.
6. **Reject Bibliography Snippets:** Chunks marked `REF` or containing reference lists are discovery metadata, not substantive evidence for findings.
7. **External Reference Constraints:** `ext:*` nodes are metadata-only without outgoing references. Never infer source findings from an external citation. Check library metadata before asserting absence.
8. **Explicit Failure Reporting:** State "No evidence found in the library" or "Unverified" rather than hallucinating from memory.
9. **Source Metadata in Tokens:** Every cited local Zotero source must carry its verified native `itemType` and derived `source_group`; also include canonical `review:*` and `type:*` tags when present. Retrieve metadata only for final cited sources. These labels describe/filter the source and never prove the claim.
10. **True Internal Route, Unlabeled Tokens:** Every claim must genuinely originate from a permitted retrieval route (`semantic_search`, `read_pdf_pages`, `get_item_fulltext`, or `mineru_sidecar`); sidecar, shell, or other local output must never be passed off as a page read, and the vague legacy label `direct PDF` remains banned internally. Evidence tokens do **not** display route names — the location (`passage N/M`, `p. X`, `lines X–Y`, `Rerank`) carries the audit trail. When a claim rests on weaker-than-page evidence, disclose that in prose, not in the token.
11. **Resolver Is an Identity Gate:** Treat `zotero_zotero_resolve_exact_source` as metadata identity and collection-scope evidence only. An `exact` result permits retrieval from its returned `item_key` but does not support a finding; `ambiguous` and `absent` results support only the reported identity boundary or conflict. Never use `related_matches` as substantive evidence or silently replace the requested source with one of them.

## Evidence Router & Canonical Tokens

| Claim Type | Evidence Source Tool | Canonical Token |
|---|---|---|
| Substantive passage / findings | `zotero_zotero_semantic_search` | `{Author Year, item KEY, passage N/M, p. X, Rerank +S; itemType/source_group; canonical tags}` |
| Direct page / full-text read | `zotero_zotero_read_pdf_pages` / `get_item_fulltext` | `{Author Year, item KEY, p. X; itemType/source_group; canonical tags}` or, when no page is mapped, `{Author Year, item KEY, § heading; itemType/source_group; canonical tags}` |
| Known-item sidecar extraction | Targeted `grep`/`sed` on the item's MinerU sidecar | `{Author Year, item KEY, p. X if mapped, lines X–Y; itemType/source_group; canonical tags}` |
| Source identity / collection membership | `zotero_zotero_resolve_exact_source` | `{resolve_exact_source → status, item KEY or conflict, collection scope}` — identity metadata only; not support for findings |
| Bibliography occurrence / identity | `zotero_zotero_search_references` | `{search_references → citing KEY, entry N, status, confidence, parse P}` |
| Citation graph structure / coupling | Graph tools (`get_collection_hubs`, `lineage`, `connected`) | `{tool → scope, seed/target item keys, node kind, returned measure}` |

*Metadata fields:* Use compact labels such as `journalArticle/article; review:checked`. Include only verified canonical `review:*` and `type:*` tags; omit the tag segment when none are present or metadata could not be retrieved. Never emit noncanonical legacy/subject tags in evidence tokens.
*API Facts:* Plain metadata claims (title, creators, year, key, tags, collections) require verification. The resolver may support a plain identity or collection-membership claim, but it never supports a substantive finding. Emit a resolver token only when identity, absence, ambiguity, or collection membership is itself material; resolver-only identity tokens do not require a separate metadata call unless the related record is substantively discussed. Substantive tokens carry the evidence location; the route behind them must internally be one permitted for that claim type.
*Multisource:* Invoking `/skill:multisource` changes response structure only; it never relaxes these evidence contracts.

## Progressive Disclosure

- For exact token schemas, field constraints, and syntax examples, load [evidence contracts](references/evidence-contracts.md).
- For score thresholds, number verification checklists, figure handling, and failure phrasing, load [verification workflow](references/verification-workflow.md).
