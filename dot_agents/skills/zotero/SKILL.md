---
name: zotero
description: Manages Samuel's local Zotero library through MCP, including collection-scoped RAG, source verification, metadata, references, citation graphs, exports, ingestion, and maintenance. Use when querying, reading, citing, organizing, tagging, exporting, ingesting, or maintaining Zotero literature.
---

# Zotero

## Non-Negotiable Rules

- Keep Zotero work in the main session; never delegate it to subagents.
- For claims about source content, load and follow `~/.agents/skills/citation-integrity/SKILL.md`.
- Ordinary literature questions are MCP-first. Pi exposes this server's tools with one literal `zotero_*` namespace prefix; do not parse MCP transport/spill files with shell commands.
- Do not call `advisor` for ordinary Zotero RAG. This skill and `citation-integrity` govern retrieval; generic review must not expand a bounded evidence search into an exhaustive audit.
- Never upload PDF bytes to Zotero Cloud, call `zotero_attach_file`, or use `zotero_add_item` with a file. For explicitly requested ingestion, follow [library operations](references/library-ops.md) and attach local PDFs with `zotero-link`.
- Never download, ingest, parse, or embed a cited work merely because it appears in a bibliography. Never delete an item without explicit confirmation.
- Never run a host-wide `pkill llama-server`.

## Request-Routing Playbook

Before the first Zotero call, interpret the request as one or more ordered routes. Routes may be chained; this is an internal attention aid, not a user-visible plan, fixed classifier, or call quota.

```text
REQUEST
├─ Library mutation? ───────────────→ MUTATION: load library-ops; confirm destructive actions
├─ Bibliography occurrence/count? ─→ REFERENCE: search_bibliography_entries (raw entries/counts)
├─ Named source or item? ──────────→ IDENTITY: resolve_exact_source
│                                    ├─ exact → bind item_key, then CONTENT and/or VERIFY
│                                    ├─ ambiguous → clarify; do not choose semantically
│                                    └─ absent → stop named-source task; never substitute related work
├─ Substantive topic/question? ────→ CONTENT: scoped semantic_search → positive Rerank evidence
├─ Exact number/table/page? ───────→ VERIFY: read_pdf_pages; outline only if page unknown;
│                                             known-item sidecar only if page extraction fails
├─ Citation relationships? ────────→ GRAPH: citation neighbors / bibliographic coupling / inbound-citation ranking
└─ Metadata/inventory? ────────────→ METADATA: item metadata / metadata search / collection items

Common chains:
  named-paper finding      = IDENTITY → CONTENT → VERIFY
  named table/coefficient  = IDENTITY → VERIFY
  comparison/superlative  = CONTENT → COMPARE → VERIFY winner/challenger
  exact citing items/count = REFERENCE
  graph neighbors of item  = IDENTITY → GRAPH
  topic-expanded graph     = CONTENT seeds → GRAPH → CONTENT/VERIFY for findings
```

Precedence and boundaries: REFERENCE handles literal bibliography occurrences and exact citation counts even when the cited work is not a local item. IDENTITY precedes source-specific content, metadata, or graph-neighbor claims. GRAPH provides structural traversal and approximate edge rankings; metadata establishes identity/description. Neither supports substantive findings. After each retrieval, follow only an answer-changing evidence gap; verify and stop under the rules below.

## Adaptive Literature-RAG Fast Path

For findings, mechanisms, estimates, equations, and topical “which paper?” questions, use a bounded agentic loop rather than either one-shot retrieval or an exhaustive audit. If the user names a source, the exact-source identity gate below takes precedence over semantic discovery.

1. **Start scoped:** Call `zotero_semantic_search` with a task-oriented query, normally `limit=5–8`, and `collection=<KEY>` when scoped. `Detroit-Paper` is `TRGBCDX5`; other known keys are in [collections](references/collections.md).
2. **Gate passages:** Keep positive-`Rerank`, non-`REF` results whose displayed passages concern the requested claim. Never substitute `Relevance` for `Rerank`.
3. **Identify the evidence gap:** Before every follow-up, determine internally: the current answer, the unresolved issue that could materially change it, and the cheapest reliable retrieval that resolves that issue. Do not use a fixed ledger; track whatever facts the task requires.
4. **Follow up adaptively:** A materially different semantic query, an orthogonal lexical/metadata recall check, a page read, an outline, or targeted sidecar extraction is appropriate when tied to that gap. Do not issue near-duplicate searches or gather context that cannot change the answer.
5. **Compare correctly:** For comparative or superlative questions, establish the relevant outcome, sign, unit, treatment dose, geography, horizon, and specification for plausible leaders. Rank comparable estimates; otherwise name the dimension on which one estimate is largest and state the incompatibility.
6. **Verify and stop:** Directly verify the winning claim and any plausible challenger needed to justify it. Stop when the answer is stable: the requested claim is supported, material ambiguities are resolved or disclosed, and another retrieval is unlikely to change the answer. Two uninformative follow-ups are a strong signal to stop, not a quota to fill.
7. **Fetch final metadata once:** Call `zotero_get_item_metadata` only for sources actually cited. Record native `itemType` and canonical `review:*` / `type:*` tags; derive `source_group` from semantic output or the locked mapping.
8. **Answer with evidence tokens:** Use the exact token format required by `citation-integrity`: item key, evidence location (page, passage/`Rerank`, or line range), source classification, and canonical tags when present. Do not print retrieval-route labels such as `zotero_read_pdf_pages` or `zotero_semantic_search` inside `{...}`; the correct route must still be used internally.

A collection scope defines the retrieval corpus, not study geography. A paper about Chicago or Saginaw can be valid in `Detroit-Paper` unless the user also requests Detroit-only studies. Full workflow and stopping rules are in [search and retrieval](references/search-retrieval.md).

### Exact-source identity gate

When the user identifies a source by title, author/title/year, DOI, citation key, item key, or “this paper,” resolve identity before substantive retrieval. This gate is for named sources, not topical discovery.

1. Call `zotero_resolve_exact_source` with the original wording and explicit metadata. Do not shorten or “repair” the target using `related_matches`.
2. `exact`: bind every substantive claim and final evidence token to the returned `item_key`. Prefer a direct-source route; if semantic search is needed to locate a passage, pass `filters={"item_keys": ["<KEY>"]}` so both dense and sparse retrieval are restricted to that paper. An empty result means no passage from the verified item matched the query — fall back to direct reading; never drop the filter to keep neighbors.
3. `ambiguous`: stop and disclose the conflict or ask for clarification. When an identifier conflicts, state explicitly that no in-scope item carries the requested identifier. Do not use semantic relevance to choose.
4. `absent`: stop the named-source task and report absence. Related matches are metadata-only suggestions, never substitutes. If a collection was supplied, use each match's `in_requested_scope` and `scope_basis` fields; an empty `collections` display field is not evidence of non-membership. Do not run semantic/full-text/graph retrieval or re-resolve a related title unless the user explicitly starts that separate task.
5. If the resolver is unavailable, use the narrowest exact metadata/citation-key lookup. A uniquely verified exact record may bind identity; simplified or related fallback results remain discovery only.

Do not infer absence from a failed semantic query. Full routing and fallback details are in [search and retrieval](references/search-retrieval.md).

### Minimal Examples

For a named source, resolve identity before substantive retrieval:

```python
zotero_resolve_exact_source(
    source="Find the paper titled 'Example title' and summarize its result.",
    title="Example title",
    collection_key="TRGBCDX5",
)
```

For topical discovery, do not invoke the identity gate:

```python
zotero_semantic_search(
    query="largest reported effect of demolitions on crime",
    limit=8,
    collection="TRGBCDX5",
)
```

Form a provisional answer, run only follow-ups tied to a material uncertainty, verify the winner and any plausible challenger needed for the claim, then fetch metadata only for cited sources.

### Do Not Do These by Default

- Do not preflight `zotero_get_semantic_index_status`; use it only after a readiness/index error.
- Do not enumerate `zotero_list_collection_items` merely to feel exhaustive. Use a cheap orthogonal recall check for a collection-wide superlative; inventory only when completeness is itself requested or targeted retrieval demonstrably leaves the candidate set unresolved.
- Do not call graph tools unless the question concerns citations/relationships or deliberately expands identified seeds.
- Do not read outlines, full text, or every candidate “just in case.” Each expansion must address a material evidence gap.
- If MCP output is oversized, narrow the request or use the known-item fallback; never shell-parse the gateway's temporary result file.
- Sidecar `grep`/`sed` is valid for malformed tables, unavailable page extraction, or precise windows in large known works; see [deep-dive reading](references/deep-dive-reading.md).

## Tool Router

| Need | First tool |
|---|---|
| Findings, estimates, mechanisms, equations | `zotero_semantic_search` |
| Exact page/table verification | `zotero_read_pdf_pages` |
| Specific paper/item identity | `zotero_resolve_exact_source` |
| Author/title discovery or metadata after identity | `zotero_search_items` / `zotero_find_item_by_citation_key` |
| Metadata, item type, review/subtype tags | `zotero_get_item_metadata` / `zotero_search_items_by_tag` |
| Exact bibliography occurrence, DOI, “who cites X?” | `zotero_search_bibliography_entries` |
| Citation neighbors or shared references | `zotero_get_citation_neighbors` / `zotero_find_bibliographically_coupled_papers` |
| Top-cited ranking in a scope | `zotero_rank_works_by_inbound_citations` |
| Collection inventory | `zotero_list_collection_items` |
| Exports, writes, ingestion, annotations | [library operations](references/library-ops.md) |

Reference search proves a bibliography occurrence, not a finding. Graph tools prove returned graph structure, not source content. Use explicit graph scopes and follow [search and retrieval](references/search-retrieval.md) for external references, exact citation counts, filters, and graph semantics.

## Metadata and Filters

- Native Zotero `itemType` is canonical; `source_group` is a query-time alias, not a stored tag.
- Canonical tags are `review:unreviewed`, `review:skimmed`, `review:checked`, `type:textbook`, and `type:lecture-notes`. Do not invent subject, credibility, role, or publication-status tags.
- Semantic filters accept `item_type(s)`, `item_key(s)`, `source_group(s)`, `tag(s)` / `required_tags`, and `exclude_tags`; supplied fields combine with `AND`. Never silently drop a filter.
- Metadata labels describe sources and never replace passage/page evidence or `Rerank` gating.

## Fail Closed

- Missing `Rerank`: do not cite semantic results; repair/restart or use verified direct-source evidence.
- Reranker unavailable: ask Samuel to run `serve-reranker`; never use unranked substitutes.
- Embedder unavailable: ask Samuel to run `serve-embedder`.
- Metadata/filter/Desktop/SQLite failures: report the failure and retry without weakening scope or filters.
- For actual service errors, offline SQLite rules, and WAL handling, load [service operations](references/service-ops.md).

## Specialized Operations

Load detailed references only when the task requires them:

- If a collection key is unknown or scope semantics matter, load [collections](references/collections.md).
- If the task uses filters, bibliography search, external nodes, citation counts, or graph scopes, load [search and retrieval](references/search-retrieval.md).
- If page retrieval fails, tables are malformed, or comprehensive reading is requested, load [deep-dive reading](references/deep-dive-reading.md).
- If ingesting, exporting, annotating, tagging, or changing metadata, load [library operations](references/library-ops.md).
- If creating sidecars or maintaining embeddings, BM25, references, or citation graphs, load [index maintenance](references/index-maintenance.md).
