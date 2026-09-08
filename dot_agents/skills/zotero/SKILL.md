---
name: zotero
description: Manages Samuel's local Zotero library through MCP, including identity resolution, collection-scoped RAG, source verification, metadata, references, citation graphs, exports, ingestion, maintenance, and handoff to zotero-extract for explicit exhaustive extraction. Use when Samuel names Zotero, his Zotero library, a collection, stored item, passage RAG, citation graph, or explicitly asks for Zotero RAG, library management, or zotero-extract.
---

# Zotero

## Non-Negotiable Rules

- If Samuel asks for `zotero-extract` or asks for an exhaustive/complete collection review, route to the `zotero-extract` skill. Do not answer it with ordinary search or reduce the scope.
- Keep ordinary Zotero work in the main session; never delegate it to subagents. (The only exception is collection extraction workers under `zotero-extract`). Identity resolution, verification, and synthesis always stay in the main session.
- For claims about paper content or numbers, load and follow `~/.agents/skills/citation-integrity/SKILL.md`.
- For ordinary search answers with exact numbers, direct quotes, causal claims, comparisons, or superlatives, run `zotero_audit_claims` after reading the pages and before writing your final answer. (This tool is not used inside `zotero-extract`).
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
- Named paper findings: IDENTITY → CONTENT → VERIFY
- Named number: IDENTITY → VERIFY
- Comparison between papers: CONTENT → VERIFY winner and challenger
- Exact citation count: REFERENCE
- Citation graph expansion: CONTENT seeds → GRAPH → CONTENT/VERIFY
For high-risk claims in ordinary searches, finish the chain with `zotero_audit_claims` before writing the answer.

Remember what each tool proves: REFERENCE proves bibliography appearances; IDENTITY proves item identity; GRAPH proves network structure; METADATA proves descriptive facts. None of these prove a paper's empirical findings.

## Adaptive Literature Search

For findings, mechanisms, estimates, equations, and "which paper?" questions, use this loop. If a paper is named, resolve its identity first.

1. **Start with a focused search:** Call `zotero_semantic_search` with a clear query, `limit=5–8`, and `collection=<KEY>` when searching a specific collection. Known keys are in [collections](references/collections.md).
2. **Filter passages by score:** Keep passages with `Rerank > 0`. Never treat passages marked `REF` as findings. Never substitute `Relevance` for `Rerank`.
3. **Follow evidence gaps:** Before searching again, ask what missing information would actually change your answer. Avoid repetitive searches.
4. **Compare models carefully:** For comparisons, note the outcome variable, sign (+/-), unit, sample, geography, and time horizon.
5. **Verify, audit, and stop:** Directly verify winning claims and numbers using `zotero_read_pdf_pages`. For high-risk claims, run `zotero_audit_claims` before writing the answer. Stop when the question is answered, or when two follow-up searches yield no new evidence.
6. **Answer with evidence:** Fetch metadata only for papers you actually cite. Answer directly using verified evidence and `citation-integrity` footnotes. Distinguish source statements from your own synthesis. Never attribute your own inferences to a paper.

A collection scopes the retrieval corpus, not study geography. For difficult comparisons, graph expansion, filters, or exact counts, load [search and retrieval](references/search-retrieval.md).

### Final claim audit (ordinary RAG only)

- Send 1–8 atomic claims and 1–4 evidence references each to `zotero_audit_claims`; use exact parent item keys and truthful semantic, PDF-page, or known-item sidecar routes. Never submit paths, arbitrary source text, or caller-supplied reranker scores.
- The audit rehydrates semantic evidence and requires fresh raw `Rerank > 0`; exact numbers normally need direct PDF-page evidence. A sidecar is a visibly weaker fallback only after a failed or unreadable page route, and its provenance must remain sidecar provenance.
- Comparison claims require separately validated evidence for both sides. In `rules_only` mode semantic support remains `insufficient`; checker failure also fails closed. The audit result maps claim IDs to evidence locators but never replaces `citation-integrity` footnotes.
- `escalation="bounded"` is capped at three unresolved claims and stays on each explicit item key: one hybrid retrieval, one targeted sidecar search, and one narrow page/section read. Never broaden to titles, DOIs, collections, neighbors, related papers, or full-paper reads.
- If the running service does not expose `zotero_audit_claims` because it is still pinned to an older tested tag, do not emulate the audit or broaden retrieval; report the unavailable capability and preserve the existing fail-closed evidence rules.

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
- Do not read outlines, full text, or every candidate “just in case.”
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
- If page retrieval fails, tables are malformed, or comprehensive reading is requested, load [deep-dive reading](references/deep-dive-reading.md).
- If ingesting, exporting, annotating, tagging, or changing metadata, load [library operations](references/library-ops.md).
- If creating sidecars or maintaining embeddings, BM25, references, or citation graphs, load [index maintenance](references/index-maintenance.md).
