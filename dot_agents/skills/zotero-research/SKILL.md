---
name: zotero-research
description: Answers questions about stored Zotero papers using scoped agentic retrieval, source verification, quantitative comparisons, bibliography search, and citation graphs. Use when Samuel asks about findings in Zotero, his library or a collection, names a stored paper, requests passage RAG, or compares papers' effects.
---

# Zotero Research

## Request-Routing Playbook

```text
REQUEST
├─ Explicit exhaustive extraction or complete collection review? → EXTRACTION: load zotero-extract
├─ Explicit automated claim audit? ─────────────────────────────→ AUDIT: bounded audit_claims workflow
├─ Named paper, DOI, citation key, or item key? ─────────────────→ IDENTITY: resolve_exact_source → read that item
├─ Largest, smallest, or strongest finding? ─────────────────────→ COMPARE: discover → check challengers
├─ Findings, mechanisms, or substantive question? ───────────────→ RESEARCH: semantic_search → targeted source reading
├─ Bibliography appearances or citation counts? ─────────────────→ REFERENCES: search_bibliography_entries
└─ Citation relationships or network structure? ────────────────→ GRAPH: neighbors, coupling, or inbound ranking
```

## Boundaries

- Use official Zotero MCP tools. Keep ordinary research in the main session; only explicit `zotero-extract` work uses extraction workers.
- Load [citation integrity](../citation-integrity/SKILL.md) for source-grounded claims. Apply it while reading, not through an extra audit pass.
- Preserve every requested collection, item, and metadata filter. A collection defines the source corpus, not necessarily study geography.
- Metadata, bibliography entries, and graph relationships do not establish empirical findings. Metadata abstracts guide retrieval; check findings in source passages or source text.
- Do not supply a paper's estimates, setting, specification, or mechanism from model memory.
- Read existing sources only. Library changes belong to [library management](../zotero-library/SKILL.md); parsing, embedding, and recovery belong to [pipeline operations](../zotero-pipeline/SKILL.md).
- Never download or embed a paper merely because it appears in a bibliography.
- Use known-item sidecars for targeted source reading or location through `zotero_find_in_item`. Never shell-parse sidecars, MCP internal files, or gateway temporary output.

## 1. Research: Discover, Read, Answer

The goal is a supported answer, not completion of a fixed tool sequence.
Before retrieval, identify the requested comparison and statistical fields. For each estimate you report, provide the requested fields or distinguish “not reported in the checked result” from “not retrieved.” Requested uncertainty statistics remain unresolved facts even when they cannot change the ranking.

### Discover

Start with one focused `zotero_semantic_search`, normally `limit=5–8`.
Pass `collection=<KEY>` when scoped; load [collection keys](../zotero-library/references/collections.md) if needed.
For a verified named source, also pass `filters={"item_keys": ["<KEY>"]}`.

Inspect the displayed evidence:
- Only positive `Rerank` passages are eligible semantic evidence. `Relevance` is not a substitute.
- Reference-list passages establish citations, not findings.
- A clipped preview or heading identifies where to look; expand that exact hit with `zotero_read_passage` instead of searching again.
- Search limits count items, not passages. Raising a limit never reveals more text inside a preview.
- Before re-searching an item you have already searched, name the specific missing fact the earlier hits did not supply. Re-running queries that already returned adequate hits is waste, not thoroughness.

### Read the missing context

Use the smallest available operation that resolves the missing fact:
- Adequate source text already in context: use it; make no new call.
- Clipped or partial preview of an existing hit: call `zotero_read_passage(evidence_id=...)`; add `neighbors=1` when adjacent context is needed. Never rerun a search to see the same passage in full.
- Condensing search output into working notes: keep the `evidence_id` (or `chunk_id` + `content_hash`) for any hit you may need to expand. If a handle is lost, recover it with one scoped exact-item search; never sweep synonyms to rediscover a passage you already saw.
- Truncated passage or sidecar window: continue that window using the returned character or line locator. Do not repeat the search or guess a new location.
- Known PDF-page locator: call `zotero_read_pdf_pages(item_key=..., start_page=..., end_page=...)`.
- Specific literal fact (number, quote, table label, heading) in a resolved item: call `zotero_find_in_item(item_key=..., query="...")` for a bounded sidecar lookup with line locators (personal library only).
- Conceptual gap and no useful passage: try one focused exact-item semantic search.
- Exact table extraction, continuation syntax, scanned or malformed pages, or route-selection doubt: load [targeted reading](references/deep-dive-reading.md).
- Whole-argument evaluation or explicit full-read request: read the full source, not fragments.

An outline can locate a section when available. Never infer PDF pages from passage numbers, sidecar line counts, or apparent paper length.
Inspect an unknown tool schema rather than guessing arguments. Do not cycle through synonymous queries when the same inadequate preview returns.
After two uninformative attempts on one gap, change the retrieval route or report the gap unresolved. Failed retrieval does not prove the source lacks a finding.
If a sidecar or local path is unavailable, report the access limitation; do not broaden scope or initiate processing automatically.

### Verify what matters

Read the decisive result and necessary surrounding notes once.
Confirm the outcome, sign, unit, treatment, setting, specification, and horizon that matter to the answer.
A complete positive-Rerank passage can support incidental details without another page read.

PDF-page text extraction is not visual inspection. If extraction loses signs or columns, find unambiguous prose or inspect a rendered page image with an available tool.
Never silently repair a table. If the value remains unclear, omit it or label it unverified.
Statistical insignificance is not proof of zero effect. A plausible explanation is not an established mechanism; label your interpretation as such.

### Stop and answer

Before a follow-up, ask internally: **What fact is missing: a requested detail, necessary context, or a ranking-changing result?**
If none is missing, answer now. If a requested detail cannot be resolved, disclose that gap. Omit optional claims instead of researching them solely to fill a table.
Reuse evidence already read. Do not retrieve it again for reassurance, a higher score, or citation bookkeeping.
Do not expand graphs or read full papers merely to feel thorough. Do not call `advisor` for ordinary searches.

## 2. Comparing Papers

For a ranking question, add three judgments to the research workflow:

1. **Choose the comparison.** Separate overall outcomes from subtypes, counts from percentages, per-unit from program effects, and local from aggregate outcomes. Separate main estimates from subgroup, dosage, and robustness maxima. After discovery, if plausible interpretations of “largest” would produce different answers, ask the user to choose the comparison before extracting detailed statistics. Otherwise, state the comparison and proceed.
2. **Check candidate coverage.** Supplement semantic discovery with a bounded collection inventory or an orthogonal scoped metadata search. Prefer a summary inventory, not full metadata for every item. Include descendants consistently and follow pagination. Titles identify plausible challengers, not their findings. For inventory parameters, load [search and retrieval](references/search-retrieval.md).
3. **Resolve challengers.** Keep one short internal shortlist of item keys and relevant estimates or missing facts. Read only enough to classify each as comparable, a different estimand, outside the question, or unresolved. An irrelevant passage does not resolve a candidate.
4. **Report uncertainty consistently.** For every estimate in a comparison, give its available SE, CI, or p-value, or mark it "not in the checked result." Never leave an uncertainty cell silently blank.

Prioritize the leading estimate and the challenger most likely to change the conclusion.
Do not discard a difficult large estimate in favor of an easily retrieved small one.
Percentages with different outcomes, doses, or denominators are not automatically comparable.
If reporting a numerical maximum across unlike estimates, call it the largest reported percentage among those checked; name its outcome and denominator, not the strongest overall effect. Put this qualification in the opening answer, not only a closing coverage note.
Any normalization must be justified and labeled as your calculation; do not assume linear scaling.
Once relevant challengers are resolved, stop. An unresolved challenger requires a qualified ranking.
Bounded discovery does not justify an unqualified collection-wide superlative or require exhaustive full-document extraction.

## 3. Identity, References, and Graphs

For a user-named source, call `zotero_resolve_exact_source` with the original identifier and requested collection scope. Preserve supplied qualifiers; never repair a conflicting identity using a related match or silently combine working-paper and published versions.
- `exact`: bind subsequent reads to the returned key; reuse its metadata.
- `ambiguous`: disclose the conflict and clarify; do not choose by semantic relevance.
- `absent`: report absence and stop the named-source task. Related matches are metadata-only context, not substitutes. Do not resolve or retrieve a related source unless the user separately requests it or changes the target.
If the resolver is unavailable, a uniquely verified exact metadata lookup may bind identity. Never silently substitute versions.
Ordinary metadata reads needed for research do not require loading the library-management skill.

For advanced filters, bibliography queries, or graph parameters, load [search and retrieval](references/search-retrieval.md).
Keep graph scope explicit. Inbound graph edges are not raw bibliography occurrence counts or hub centrality.
An external or unresolved bibliography entry does not prove absence from the library; verify identity before labeling it absent.
External nodes supply metadata and incoming relationships, not source findings or outgoing bibliographies.

## 4. Answer Format

- Lead with the answer and its essential qualification. For “which paper?”, usually give the candidate and one necessary comparison, not a literature-review table.
- Keep candidate ledgers, search plans, repeated deliberation, and speculative recollections out of commentary. Report only meaningful progress or blockers.
- Put a Markdown footnote marker immediately after each source-grounded claim, including table entries.
- End with one `### Evidence` block containing only cited entries: author/year, title, item key, and actual PDF page, passage, section, or sidecar lines.
- Reuse metadata already returned. Fetch missing citation identity only for papers actually cited, not internal classification fields.
- Never present sidecar lines as PDF pages. Disclose weaker sidecar evidence as required by citation integrity.
- Check the lead and comparisons for overstatement. Do not imply coverage, page verification, or automated auditing that did not occur.

## 5. Explicit Audits and Retrieval Failures

Use `zotero_audit_claims` only when Samuel explicitly requests automated auditing, never inside `zotero-extract`.
Load [audit API details](references/claim-audit.md); submit up to eight atomic claims with literal quotes and truthful evidence routes.
Build quotes from complete text first: expand semantic hits with `zotero_read_passage` and sidecar evidence with `zotero_find_in_item` before submitting, rather than copying from truncated previews.
Reuse successful queries unchanged. Never repair quotes, invent provenance, or tune scores to force acceptance.
Allow one repair pass: up to three targeted retrievals and one audit rerun. On legacy schemas or capability failure, report the problem and stop the audit.
An audit validates its evidence contract, not entailment, causal identification, or comparability.

Research errors are not authorization to rebuild, reinstall, or start services.
If the embedder or reranker is unavailable, ask Samuel to run `serve-embedder` or `serve-reranker`; never auto-start them or substitute unranked semantic evidence.
Missing `Rerank` makes semantic output discovery-only; verified direct reading remains a valid evidence route.
If metadata or filters fail, report the failure and retry without weakening scope. Use index status only after a readiness/index error.
For diagnosed infrastructure problems, load [pipeline operations](../zotero-pipeline/SKILL.md), not for an ordinary relevance miss.
