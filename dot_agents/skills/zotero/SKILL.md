---
name: zotero
description: Manages Samuel's local Zotero library through MCP, including collection-scoped RAG, source verification, metadata, references, citation graphs, exports, ingestion, and maintenance. Use when querying, reading, citing, organizing, tagging, exporting, ingesting, or maintaining Zotero literature.
---

# Zotero

## Non-Negotiable Rules

- Keep Zotero work in the main session; never delegate it to subagents.
- For claims about source content, load and follow `~/.agents/skills/citation-integrity/SKILL.md`.
- Ordinary literature questions are MCP-first. Use tools with the literal `zotero_zotero_*` prefix; do not parse MCP transport/spill files with shell commands.
- Never upload PDF bytes to Zotero Cloud, call `zotero_zotero_attach_file`, or use `add_item` with a file. For explicitly requested ingestion, follow [library operations](references/library-ops.md) and attach local PDFs with `zotero-link`.
- Never download, ingest, parse, or embed a cited work merely because it appears in a bibliography. Never delete an item without explicit confirmation.
- Never run a host-wide `pkill llama-server`.

## Default Literature-RAG Fast Path

For ordinary findings, mechanisms, estimates, equations, and “which paper?” questions, follow this sequence and stop when the answer is supported:

1. **Search once:** Call `zotero_zotero_semantic_search` with a task-oriented query, `limit=5–8`, and `collection=<KEY>` when scoped. `Detroit-Paper` is `TRGBCDX5`; other known keys are in [collections](references/collections.md).
2. **Gate passages:** Keep positive-`Rerank`, non-`REF` results whose displayed passages actually support the requested claim. Never substitute `Relevance` for `Rerank`.
3. **Refine at most once:** Use one materially different targeted query only if the first call does not expose the needed estimate or comparison. Do not issue near-duplicate searches.
4. **Compare correctly:** For comparative or superlative questions, record outcome, sign, unit, treatment dose, geography, horizon, and specification for the leading candidates. Rank only comparable estimates. Otherwise identify the “largest reported estimate” and state the incompatibility.
5. **Verify narrowly:** Verify the exact number/context for the likely winner and, only if needed, one close comparator. Use `zotero_zotero_read_pdf_pages`; call `zotero_zotero_get_pdf_outline` only when the relevant page is unknown. Use `zotero_zotero_get_item_fulltext` only when bounded retrieval cannot recover the context or the user asks to read the paper.
6. **Fetch final metadata once:** Call `zotero_zotero_get_item_metadata` only for sources actually cited. Record native `itemType` and any canonical `review:*` / `type:*` tags; derive `source_group` from semantic output or the locked mapping.
7. **Answer with evidence tokens:** Use the exact token format required by `citation-integrity`, including item key, retrieval route, source classification, and canonical tags when present.

A collection scope defines the retrieval corpus, not study geography. A paper about Chicago or Saginaw can be a valid result from `Detroit-Paper` unless the user also requests Detroit-only studies.

### Minimal Example

```python
zotero_zotero_semantic_search(
    query="largest reported effect of demolitions on crime",
    limit=8,
    collection="TRGBCDX5",
)
```

Shortlist from that response, verify only the likely winner's exact page/table, then fetch metadata only for sources cited in the answer.

### Do Not Do These by Default

- Do not preflight `get_search_database_status`; use it only after a readiness/index error.
- Do not enumerate `get_collection_items` unless the user requests an inventory/completeness audit or semantic retrieval clearly fails.
- Do not call graph tools unless the question concerns citations/relationships or deliberately expands identified seeds.
- Do not read outlines, full text, or every candidate “just in case.”
- If MCP output is oversized, narrow the query or lower `limit`; never shell-parse the gateway's temporary result file.
- Sidecar `grep`/`sed` is a known-item fallback only for malformed tables, unavailable page extraction, or large technical works; see [deep-dive reading](references/deep-dive-reading.md).

## Tool Router

| Need | First tool |
|---|---|
| Findings, estimates, mechanisms, equations | `zotero_zotero_semantic_search` |
| Exact page/table verification | `zotero_zotero_read_pdf_pages` |
| Known author/title/citekey | `zotero_zotero_search_items` / `zotero_zotero_search_by_citation_key` |
| Metadata, item type, review/subtype tags | `zotero_zotero_get_item_metadata` / `zotero_zotero_search_by_tag` |
| Exact bibliography occurrence, DOI, “who cites X?” | `zotero_zotero_search_references` |
| Citation neighbors or shared references | `zotero_zotero_get_paper_lineage` / `zotero_zotero_find_connected_papers` |
| Top-cited ranking in a scope | `zotero_zotero_get_collection_hubs` |
| Collection inventory | `zotero_zotero_get_collection_items` |
| Exports, writes, ingestion, annotations | [library operations](references/library-ops.md) |

Reference search proves a bibliography occurrence, not a finding. Graph tools prove returned graph structure, not source content. Use explicit graph scopes and follow [search and retrieval](references/search-retrieval.md) for external references, exact citation counts, filters, and graph semantics.

## Metadata and Filters

- Native Zotero `itemType` is canonical; `source_group` is a query-time alias, not a stored tag.
- Canonical tags are `review:unreviewed`, `review:skimmed`, `review:checked`, `type:textbook`, and `type:lecture-notes`. Do not invent subject, credibility, role, or publication-status tags.
- Semantic filters accept `item_type(s)`, `source_group(s)`, `tag(s)` / `required_tags`, and `exclude_tags`; supplied fields combine with `AND`. Never silently drop a filter.
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
