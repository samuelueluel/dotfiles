---
name: citation-integrity
description: Enforces evidence contracts for claims from Samuel's Zotero passage RAG, bibliography index, direct source reads, and citation graph. Use whenever an answer asserts source content, a citation occurrence, graph structure, findings, numbers, mechanisms, or cross-paper comparisons grounded in Zotero.
---

# Citation-Integrity Discipline

## Scope

Apply this skill to every Zotero-grounded answer, including casual chat.

- Source-content claims—findings, estimates, definitions, mechanisms, comparisons—require source text.
- Citation-occurrence and bibliography-identity claims require a returned reference entry or graph edge.
- Structural claims require the deterministic graph output and its returned measure.
- Plain Zotero metadata facts (title, creators, year, key, tags, collection, attachment status) are API facts: verify them, but no brace token is required.
- “Use multisource” changes presentation only; it never relaxes this contract.

## Evidence router

| Claim | Evidence source | Canonical token |
|---|---|---|
| Substantive passage | `zotero_zotero_semantic_search` | `{Author Year, passage N/M, p. X, Rerank +S}` |
| Direct page/full-text verification | `zotero_zotero_read_pdf_pages` or `zotero_zotero_get_item_fulltext` | `{Author Year, p. X, direct PDF}` or `{Author Year, direct fulltext, item KEY}` |
| Bibliography occurrence / resolved identity | `zotero_zotero_search_references` | `{search_references → citing KEY, entry N, resolution, confidence}` |
| Citation structure / coupling / hubs | graph tools | `{tool → scope, node kind if external, returned measure}` |

Use only fields actually returned. Never fabricate a page, score, entry number, confidence, edge, rank, or count. Detailed token rules and examples are in [evidence contracts](references/evidence-contracts.md); load that file whenever composing a Zotero-grounded answer.

## Non-negotiable rules

1. **Ground every claim.** A bibliographic entry cannot support the cited work's findings; a graph edge cannot support an empirical result; one paper's passage cannot support another paper's number.
2. **Verify every empirical number.** Confirm the value verbatim or in provably equivalent form in the cited passage/page. Otherwise locate it directly, drop it, or mark it `UNVERIFIED`.
3. **Gate passage confidence on raw `Rerank`.** Positive is confident; negative evidence must be flagged or excluded under the score guidance. `Relevance` alone is not sufficient.
4. **Treat missing instrumentation as failure.** If a semantic result omits `Rerank`, do not invent it or silently cite the hit. Repair/retry, or verify the claim against a direct source read and use the direct-source token.
5. **Keep papers isolated.** Each finding, number, graph measure, and reference occurrence traces to its own source record.
6. **Respect resolution limits.** `unresolved` or `ambiguous` reference results support only the literal raw-entry occurrence, not a clean entity match or graph edge.
7. **Be honest.** “No evidence found in the library” is complete. Weak, stale, incomplete, or conflicting evidence must be labeled rather than repaired from memory.

## External-reference boundary

An `external_reference` is metadata not resolved to a Zotero item, not proof that no local preprint/published equivalent exists. Search library metadata before declaring absence, but never merge versions silently.

- Incoming citations from local sidecar-backed sources may be visible through expanded lineage.
- The external node itself supplies no outgoing bibliography or findings.
- Never download, attach, parse, or embed a paper merely because its citation appears.

## Retrieval-to-answer workflow

1. Route the question with the Zotero skill: substantive passage, direct source, reference entry, graph structure, or metadata.
2. Read the actual matched passage, raw reference, or graph measure—not just the result title.
3. Apply the correct confidence signal and verify numbers.
4. If a semantic hit is marked `REF` or is bibliography-only, discard it as substantive evidence and use reference search.
5. Compose one brace token per evidence-bearing claim; keep cross-paper claims separately sourced.
6. If evidence is truncated, weak, unresolved, stale, or absent, escalate to the appropriate direct tool or say so.

Load [verification workflow](references/verification-workflow.md) for score thresholds, figure-schema handling, cross-paper comparisons, and direct number checks.
