---
name: zotero
description: Manages Samuel's local Zotero library through MCP, including collection-scoped RAG, source verification, metadata, references, citation graphs, exports, ingestion, and maintenance. Use when Samuel names Zotero, his Zotero library, a collection, stored item, passage RAG, or citation graph, or asks to "find this paper", "who cites X", "how many times is X cited", "add this PDF to my library", or "export my bibliography".
---

# Zotero

## Non-Negotiable Rules

- Keep Zotero work in the main session; never delegate it to subagents. Carve-out: mechanical extraction workers under the zotero-extract skill may delegate, subject to the session's configured subagent concurrency — identity, verification, adjudication, and synthesis stay in the main session.
- For claims about source content, load and follow `~/.agents/skills/citation-integrity/SKILL.md`.
- Ordinary literature questions are MCP-first. Pi exposes tools with one literal `zotero_*` prefix; never parse MCP transport or spill files with shell commands.
- Do not call `advisor` for ordinary Zotero RAG. This skill and `citation-integrity` govern retrieval.
- Never upload PDF bytes to Zotero Cloud, call `zotero_attach_file`, or use `zotero_add_item` with a file. For explicitly requested ingestion, load [library operations](references/library-ops.md) and attach local PDFs with `zotero-link`.
- Never download, ingest, parse, or embed a cited work merely because it appears in a bibliography. Never delete an item without explicit confirmation.
- Never run a host-wide `pkill llama-server`.

## Request-Routing Playbook

```text
REQUEST
├─ Library mutation? ───────────────→ MUTATION: load library-ops; confirm destructive actions
├─ Bibliography occurrence/count? ─→ REFERENCE: search_bibliography_entries
├─ Named source or item? ──────────→ IDENTITY: resolve_exact_source
│                                    ├─ exact → bind item_key, then CONTENT and/or VERIFY
│                                    ├─ ambiguous → clarify; do not choose semantically
│                                    └─ absent → stop; never substitute a related work
├─ Substantive topic/question? ────→ CONTENT: scoped semantic_search → positive Rerank evidence
├─ Exact number/table/page? ───────→ VERIFY: read_pdf_pages; outline only if page unknown;
│                                             known-item sidecar only if page extraction fails
├─ Citation relationships? ────────→ GRAPH: neighbors / coupling / inbound ranking
└─ Metadata/inventory? ────────────→ METADATA: metadata lookup / collection items
```

Common chains: named-paper finding = IDENTITY → CONTENT → VERIFY; named number = IDENTITY → VERIFY; comparison = CONTENT → VERIFY winner/challenger; exact citation count = REFERENCE; topic-expanded graph = CONTENT seeds → GRAPH → CONTENT/VERIFY.

REFERENCE proves literal bibliography occurrences and exact counts. IDENTITY proves source identity and scope. GRAPH proves returned structure; METADATA proves descriptive facts. None proves substantive findings. Follow only answer-changing evidence gaps.

## Adaptive Literature-RAG Fast Path

For findings, mechanisms, estimates, equations, and topical “which paper?” questions, use this bounded loop. A named source must pass the identity gate first.

1. **Start scoped:** Call `zotero_semantic_search` with a task-oriented query, normally `limit=5–8`, and `collection=<KEY>` when scoped. Known keys are in [collections](references/collections.md).
2. **Gate passages:** Keep positive-`Rerank`, non-`REF` passages that concern the claim. Never substitute `Relevance` for `Rerank`.
3. **Follow the evidence gap:** Before a follow-up, identify what could materially change the current answer and use the cheapest reliable retrieval that resolves it. Avoid near-duplicate searches and irrelevant context.
4. **Compare correctly:** For plausible leaders, establish the outcome, sign, unit, treatment dose, geography, horizon, and specification. Rank comparable estimates; otherwise qualify the comparison dimension.
5. **Verify and stop:** Directly verify the winning claim and any plausible challenger needed to justify it. Stop when the claim is supported, material ambiguity is resolved or disclosed, and another call is unlikely to change the answer. Two uninformative follow-ups strongly favor stopping.
6. **Answer with evidence:** Fetch metadata only for sources actually cited. Answer directly using verified evidence; distinguish source statements from analytical synthesis or recommendations, and never attribute your inference to a source. Offer interpretation only when the request calls for it. Apply the exact evidence-token contract from `citation-integrity`.

A collection scopes the retrieval corpus, not study geography. For difficult comparisons, graph expansion, filters, or exact counts, load [search and retrieval](references/search-retrieval.md).

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
- Do not enumerate a collection merely to feel exhaustive. Inventory only when completeness is requested or bounded discovery leaves a concrete recall problem — for "all/every/complete/audit" collection requests, route to the zotero-extract skill.
- Do not call graph tools unless the question concerns relationships or deliberately expands identified seeds.
- Do not read outlines, full text, or every candidate “just in case.”
- If MCP output is oversized, narrow the request or use a known-item fallback; never shell-parse the gateway's temporary result file.
- Use sidecar extraction only for a known item when page extraction fails, a table is malformed, or a precise window is substantially cheaper. Load [deep-dive reading](references/deep-dive-reading.md).

## Metadata, Filters, and Failure

- Native Zotero `itemType` is canonical; `source_group` is a query-time alias. Use only canonical `review:*` and `type:*` tags.
- Semantic filter fields combine with `AND`. Never silently drop a supplied collection, item, type, group, or tag filter.
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
