---
name: zotero
description: Manage Samuel's local Zotero library through MCP and CLI tools, including metadata, local full-text RAG, bibliography search, internal and expanded citation graphs, audits, and exports. Use when querying or organizing Zotero literature, extracting source evidence, tracing citations, handling external-reference metadata, or maintaining Zotero indexes.
---

# Zotero Library Management

## Operating boundary (CRITICAL)

- Zotero MCP tools use the literal `zotero_zotero_*` prefix; the collections resource is `zotero_read_zotero_collections`.
- An `external_reference` is a graph identity not resolved to a Zotero item. It is metadata-only, but is not proof that no equivalent preprint or published version exists in the library. Check library metadata before saying it is absent; never merge versions silently. Two kinds exist: `ext:doi:*` (DOI-backed, confident) and `ext:meta:*` (heuristic, derived from surname+year+title of a DOI-less bibliography entry, confidence ≤ 0.72) — treat `ext:meta:*` labels as approximate and verify via `zotero_zotero_search_references`.
- Reference metadata and graph edges are not evidence of a paper's findings. Never infer absent-source results. Full-text acquisition is separate, explicitly authorized, and never bulk-triggered by citations.
- For every Zotero-grounded content, reference-occurrence, or graph claim, load and follow `~/.agents/skills/citation-integrity/SKILL.md`.

## Files, attachments, and safety

- Never delete from `~/Zotero/storage/`, call `zotero_zotero_attach_file`, or upload PDF bytes to Zotero cloud.
- For an authorized PDF already in Dropbox, prefer a linked attachment: create metadata with `zotero_zotero_add_item(..., attach_mode="none")`, then run `~/.local/bin/zotero-link <item_key> <absolute_pdf_path>`. Keep the original.
- Do not download, create, parse, or embed an item merely because it appears in a bibliography. `zotero_zotero_delete_item` requires explicit authorization and moves the item to Trash.

## Services

- Embeddings require `127.0.0.1:8082`; ask Samuel to run `serve-embedder` if unavailable. Never auto-start it.
- Reranking requires `127.0.0.1:8083/v1/rerank`; the MCP does not auto-start it. Ask Samuel to run `serve-reranker`, then retry. It is fail-closed: never substitute Hugging Face, an in-process model, or unranked results.
- Zotero Desktop is required for writes, CSL exports, and live full-text retrieval. Graph/reference rebuilds read Zotero SQLite immutably and require Desktop fully closed and WAL-checkpointed; load [service operations](references/service-ops.md) before recovery or maintenance.
- Never run a host-wide `pkill llama-server`. Zotero work stays in the main session, never a subagent.

## Workflows

### 1. Metadata and library operations

- Existing records: `zotero_zotero_search_items`, `zotero_zotero_advanced_search`, citekey, tag, and collection tools.
- Add or ingest only when explicitly requested. Prefer DOI metadata; use `zotero-auto-ingest` only for an explicitly supplied local PDF.
- For edits, annotations, exports, and lifecycle operations, load [library operations](references/library-ops.md).

### 2. Search, references, and graphs

- Substantive findings, mechanisms, estimates, equations, and robustness passages from locally indexed items → `zotero_zotero_semantic_search`. Use its `collection` argument for project scope when appropriate.
- Literal bibliography occurrence, DOI/title lookup, citing-item context, or external-node resolution → `zotero_zotero_search_references`.
- Citation-count questions (“how many times is X cited”, “most-cited work in / external to a collection”): count raw bibliography occurrences with `zotero_zotero_search_references`, deduping citing items per identity. `zotero_zotero_get_collection_hubs` can *surface* the leading anchors quickly (it now includes external works via `ext:meta:*` nodes), but its counts are graph-edge based, not raw-occurrence based: unresolved leftovers drop out, and `ext:meta` counts are approximate (typo variants can split one work). Treat hubs counts as directional; quote `search_references` counts for anything precise.
- Closed internal structure → graph scope `collection` or `library`; include external and out-of-collection citation targets only with `collection-expanded` or `library-expanded`.
- External workflow: reference search → inspect `resolution` → pass a returned `ext:*` key to expanded lineage for known incoming local citers. An external node has no outgoing references unless a local full-text version is separately identified.
- For the complete routing tree, scope semantics, unresolved entries, topic-first discovery, and fan-out limits, load [search and retrieval](references/search-retrieval.md).

### 3. Sidecars and indexes

- `zotero-sidecar.sh create|enrich|embed|reembed` is only for PDFs already represented by Zotero library items, never `external_reference` nodes.
- Graph, content-BM25, or reference-index recovery requires [index maintenance](references/index-maintenance.md).

### 4. Evidence checks

- Discard any semantic hit marked `REF` or containing a bibliography-only passage; route it to reference search instead.
- A semantic claim requires the displayed raw `Rerank` score plus a matching passage. If the score is absent, report an instrumentation failure and do not invent one.
- Verify empirical numbers against the retrieved passage or direct PDF/full text under the citation-integrity contract. “No evidence found” is a complete answer.
