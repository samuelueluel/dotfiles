---
name: zotero
description: Manages Samuel's local Zotero library through MCP, including identity resolution, collection-scoped RAG, source verification, metadata, references, citation graphs, exports, ingestion, maintenance, and handoff to zotero-extract for explicit exhaustive extraction. Use when Samuel names Zotero, his Zotero library, a collection, stored item, passage RAG, citation graph, or explicitly asks for Zotero RAG, library management, or zotero-extract.
---

# Zotero

## Non-Negotiable Rules

- If Samuel asks for `zotero-extract` or asks for an exhaustive/complete collection review, route to the `zotero-extract` skill. Do not answer it with ordinary search or reduce the scope.
- Keep ordinary Zotero work in the main session; never delegate it to subagents. (The only exception is collection extraction workers under `zotero-extract`). Identity resolution, verification, and synthesis always stay in the main session.
- For claims about paper content or numbers, load and follow `~/.agents/skills/citation-integrity/SKILL.md`.
- Match verification effort to the claim. Conceptual explanations, definitions, and ordinary quotations use passage checks; material empirical numbers, causal interpretations, disputed attributions, quantitative comparisons, and superlatives use targeted source verification and the final claim audit below. Explicit requests for automated claim auditing also use that audit. Do not use this tool inside `zotero-extract`.
- Use the official `zotero_*` MCP tools. Never parse MCP internal files or temporary files with shell commands.
- Do not call `advisor` for ordinary Zotero searches. This skill and `citation-integrity` govern retrieval.
- Never upload PDF files to Zotero Cloud, call `zotero_attach_file`, or use `zotero_add_item` with a file. To add papers, read [library operations](references/library-ops.md) and attach local PDFs with `zotero-link`.
- Never download, parse, or embed a paper just because it appears in a bibliography. Never delete a library item without Samuel's explicit confirmation.
- Never run a host-wide `pkill llama-server`.

## Request-Routing Playbook

```text
REQUEST
├─ Explicit `zotero-extract` or complete collection audit? ─→ EXTRACTION HANDOFF: zotero-extract
├─ Library mutation or adding papers? ─────────────────────→ MUTATION: load library-ops; confirm destructive actions
├─ Bibliography occurrence or citation count? ─────────────→ REFERENCE: search_bibliography_entries
├─ Named paper or item? ───────────────────────────────────→ IDENTITY: resolve_exact_source
│                                                            ├─ exact → bind item_key, then CONTENT and/or VERIFY
│                                                            ├─ ambiguous → clarify; do not guess semantically
│                                                            └─ absent → stop; never substitute another paper
├─ Substantive topic or question? ─────────────────────────→ CONTENT: scoped semantic_search → positive Rerank evidence
├─ Exact number, table, or page? ──────────────────────────→ VERIFY: read_pdf_pages; outline only if page unknown;
│                                                                     known-item sidecar only if page reading fails
├─ Citation relationships or coupling? ────────────────────→ GRAPH: neighbors / coupling / inbound ranking
└─ Metadata or inventory? ─────────────────────────────────→ METADATA: metadata lookup / collection items
```

Common tool chains:
- Named paper findings: IDENTITY → CONTENT → VERIFY when numbers or missing context require it
- Named number: IDENTITY → VERIFY
- Quantitative comparison between papers: CONTENT → VERIFY winner and challenger
- Exact citation count: REFERENCE
- Citation graph expansion: CONTENT seeds → GRAPH → CONTENT/VERIFY
For high-risk claims in ordinary searches, follow the final claim audit below, including its capability fallback and request-wide budget.

Remember what each tool proves: REFERENCE proves bibliography appearances; IDENTITY proves item identity; GRAPH proves network structure; METADATA proves descriptive facts. None of these prove a paper's empirical findings.

## Adaptive Literature Search

For findings, mechanisms, estimates, equations, and "which paper?" questions, use this loop. If a paper is named, resolve its identity first.

1. **Start with one focused search:** Call `zotero_semantic_search` with a clear query, `limit=5–8`, and `collection=<KEY>` when searching a specific collection. Do not launch parallel near-duplicate opening queries. Known keys are in [collections](references/collections.md).
2. **Check passage eligibility and context:**
   - Keep passages with `Rerank > 0`, then read the text. The score measures relevance, not truth or entailment.
   - Never treat passages marked `REF` as findings. Never substitute `Relevance` for `Rerank`.
   - A heading, contents list, or fragment is not enough unless it actually supports the claim. If the proposition, attribution, or necessary qualifications are missing, retrieve the smallest useful surrounding section before drafting.
3. **Follow evidence gaps:** Before searching again, ask what missing information would actually change your answer. Avoid repetitive searches. If a known item's outline is absent or its page is unknown, do not guess successive page ranges; use a narrower exact-item semantic query or the documented known-item sidecar locator.
4. **Compare models carefully:** For empirical comparisons, note the outcome variable, sign (+/-), unit, sample, geography, and time horizon.
5. **Verify only what needs it:**
   - For conceptual answers, adequate displayed passages are sufficient; check quotations verbatim and retain theorem hypotheses.
   - Read targeted PDF pages for empirical numbers, tables, or missing context; use the documented known-item fallback when needed.
   - Run the final claim audit for the high-risk claims defined above or an explicit audit request. Stop when the question is answered or two follow-up searches yield no new evidence; the audit budget below also limits verification retries.
6. **Answer at the requested scale:**
   - For “a few” motivations or examples, aim for three or four distinct points, not a citation inventory.
   - Fetch metadata only for sources you actually cite and reuse verified metadata already returned. Follow `citation-integrity` footnotes.
   - Review headings and connective sentences for overstatement, missing conditions, and unsupported deductions. Distinguish source statements from your own synthesis. Never attribute your own inferences to a paper.
   - Without exhaustive coverage, limit superlatives to the comparable estimates retrieved.

A collection scopes the retrieval corpus, not study geography. For difficult comparisons, graph expansion, filters, or exact counts, load [search and retrieval](references/search-retrieval.md).

### Final evidence audit (ordinary RAG only)

- **Submit:** Send one batch of 1–8 atomic claims to `zotero_audit_claims`, with 1–4 evidence references each. Select only the material high-risk claims or those explicitly requested for audit; the eight-claim cap is not a target.
  - Atomic means one attributed result, estimand, null result, or comparison. Do not bundle program dates, sample size, effect magnitude, subgroup results, spillovers, and null outcomes into one claim.
  - Use exact parent item keys and truthful `semantic`, `pdf_page`, or `mineru_sidecar` routes. Never submit paths, arbitrary source text, or caller-supplied reranker scores.
  - For semantic evidence, reuse the exact successful search query unchanged. For every route, copy an exact contiguous substring from the returned evidence. Do not delete parentheticals or interleaved layout text, repair OCR, join fragments, normalize thresholds, or silently dehyphenate words. Final prose may paraphrase after the evidence passes.
  - Preserve inequalities and dose thresholds literally: `over 5` is not `at least 5`. Keep bibliographic years and incidental dates out of the audited claim unless they are material and occur in its accepted evidence quote.
  - Preserve returned `chunk_id`, `content_hash`, and `index_generation` when available; never invent them from passage numbers or omit them on a repair rerun.
  - Use `risk_tags=["comparison"]` only for cross-item comparisons and submit validated evidence from at least two distinct item keys. Use `risk_tags=["within_item_comparison"]` for a comparison contained within one item. The tags are mutually exclusive.
- **Deterministic check:** The audit rehydrates evidence, requires fresh raw `Rerank > 0` plus quote containment, verifies that numeric values and units occur inside accepted direct-evidence quotes, and checks comparison coverage. Use `escalation="none"` initially; use `escalation="bounded"` only for a specific unresolved evidence gap.
- **Interpretation:** `supported` means the submitted evidence passed the deterministic evidence contract. It does not adjudicate claim wording, entailment, causal language, or omitted qualifications. Perform that final prose review in the main session under `citation-integrity`. `unsupported` reflects a deterministic contradiction such as a number/unit mismatch; `insufficient` means the evidence contract was not established.
- **Retrieval failure:** Interpret the exact failure code; never blanket-label audit failures as deployment drift.
  - `QUOTE_NOT_FOUND` does not prove that the source lacks the claim. First compare the submitted quote with the raw returned evidence for reconstructed text, omitted parentheticals/layout labels, OCR repairs, or changed line-ending hyphens. Use one shorter exact substring or one targeted source read within the repair budget.
  - `NUMBER_MISMATCH` and `UNIT_MISMATCH` require correction or omission; do not override them from memory. Check ranges, signs, inequality, units, and whether every reported number occurs inside the accepted direct-evidence quote.
  - If the tool schema exposes legacy `check_mode`, returns `CHECKER_UNAVAILABLE`/`CHECKER_SKIPPED`, or a retained positive-Rerank record reports conflicting score/quote diagnostics, stop. Load [service operations](references/service-ops.md), verify/restart the deployed service, and do not spend the audit rerun on a stale deployment.
  - Evidence previews must center the accepted quote. If a retained evidence preview omits it, treat that as a service/response-contract failure and use one targeted read instead of inferring source-level contradiction.
  - Do not polish queries repeatedly to raise scores; rechecks are not independent corroboration.
- **Request-wide budget:** After the initial batch, allow at most one repair pass, with no more than three exact-item follow-up retrieval/read operations in total and at most one audit rerun.
  - Never broaden to titles, DOIs, collections, neighbors, related papers, or full-paper reads. Stop and qualify or omit unresolved claims.
  - For an explicit audit exceeding eight claims, agree on scope before starting rather than silently truncating coverage.

### Exact-source identity gate

When the user supplies a title, author/title/year, DOI, citation key, item key, or “this paper,” resolve identity before substantive retrieval.

1. Call `zotero_resolve_exact_source` with the original wording and explicit metadata. Do not shorten or repair the target with `related_matches`.
2. `exact`: bind all substantive retrieval and evidence to the returned `item_key`. If semantic search is needed, pass `filters={"item_keys": ["<KEY>"]}`; an empty result requires direct reading, not dropping the filter.
3. `ambiguous`: stop and disclose the conflict or ask for clarification. Do not choose by semantic relevance.
4. `absent`: stop the named-source task and report absence. Related matches are metadata-only suggestions, never substitutes; do not launch substantive retrieval for them unless the user starts that separate task.
5. If the resolver is unavailable, use the narrowest exact metadata or citation-key lookup. A uniquely verified record may bind identity; simplified or related results remain discovery only.

Do not infer source absence from failed semantic retrieval. Detailed identity and collection-scope edge cases are in [search and retrieval](references/search-retrieval.md).

### Do Not Do These by Default

- Do not preflight `zotero_get_semantic_index_status`; use it only after a readiness or index error.
- Do not enumerate a collection merely to feel exhaustive. Inventory only when completeness is requested or bounded discovery leaves a concrete recall problem — for an explicit `zotero-extract` request or "all/every/complete/audit" collection request, hand off to the zotero-extract skill.
- Do not call graph tools unless the question concerns relationships or deliberately expands identified seeds.
- Do not read outlines, full text, or every candidate “just in case.” Read a whole paper only to evaluate its whole argument or meet an explicit full-reading request, not merely because the user says “literature review.”
- If MCP output is oversized, narrow the request or use a known-item fallback; never shell-parse the gateway's temporary result file.
- Use sidecar extraction only for a known item when page extraction fails, a table is malformed, or a precise window is substantially cheaper. Load [deep-dive reading](references/deep-dive-reading.md).

## Metadata, Filters, and Failure

- Native Zotero `itemType` is canonical; `source_group` is a query-time alias. Use only canonical `review:*` and `type:*` tags.
- Semantic filter fields combine with `AND`. Never silently drop a supplied collection, item, type, group, or tag filter.
- For targeted embedding maintenance, use `zotero_update_semantic_index(item_keys=[...])` or `zotero-mcp-server update-db --fulltext --no-batch --item-key KEY`. Exact-key refreshes preserve every requested live parent key, bypass DOI/title deduplication, refresh existing chunks, and leave watermark/deletion reconciliation untouched. Ordinary full-library indexing retains global DOI/title deduplication; never substitute a DOI/title duplicate for a requested key.
- Missing `Rerank`: do not cite semantic results; repair the service or use verified direct evidence.
- Reranker unavailable: ask Samuel to run `serve-reranker`; never use unranked substitutes.
- Embedder unavailable: ask Samuel to run `serve-embedder`.
- Metadata, filter, Desktop, or SQLite failure: report it and retry without weakening scope or filters. Load [service operations](references/service-ops.md) for diagnosis.

## Progressive Disclosure and Specialized Operations

- If a collection key is unknown or scope semantics matter, load [collections](references/collections.md).
- If the task uses filters, bibliography search, external nodes, citation counts, graph scopes, difficult comparisons, or exact-source edge cases, load [search and retrieval](references/search-retrieval.md).
- If page retrieval fails, a displayed passage lacks necessary context, tables are malformed, or a whole argument needs evaluation, load [deep-dive reading](references/deep-dive-reading.md).
- If ingesting, exporting, annotating, tagging, or changing metadata, load [library operations](references/library-ops.md).
- If creating sidecars or maintaining embeddings, BM25, references, or citation graphs, load [index maintenance](references/index-maintenance.md).
