---
name: zotero
description: Manage Samuel's local Zotero library through MCP and CLI tools, including metadata, local full-text RAG, bibliography search, internal and expanded citation graphs, audits, and exports. Use when querying or organizing Zotero literature, extracting source evidence, tracing citations, handling external-reference metadata, or maintaining Zotero indexes.
---

# Zotero Library Management

## Operating Boundaries & Safety

- **Tool Names:** MCP tools use the literal prefix `zotero_zotero_*`; the collections resource is `zotero_read_zotero_collections`.
- **Evidence Contracts:** For all literature claims, reference occurrences, or graph assertions, follow `~/.agents/skills/citation-integrity/SKILL.md`. Reference metadata and graph edges do not prove source findings.
- **Zero Cloud PDFs:** Never delete from `~/Zotero/storage/`, call `zotero_zotero_attach_file`, or upload PDF bytes to Zotero Cloud. Attach local PDFs via `zotero_zotero_add_item(attach_mode="none")` followed by `~/.local/bin/zotero-link <key> <pdf_path>`, preserving Dropbox originals.
- **Acquisition Gating:** Do not download, create, parse, or embed items merely because they appear in bibliographies. `zotero_zotero_delete_item` requires explicit user confirmation (moves item to Trash).
- **External References:** Graph nodes prefixed with `ext:*` are unmapped to library items (`ext:doi:*` are DOI-backed; `ext:meta:*` are heuristic from DOI-less entries, confidence ≤ 0.72). Treat `ext:meta:*` as approximate and verify via `zotero_zotero_search_references`. Check library metadata before declaring a work absent; never merge versions silently.
- **Subagent Policy:** Zotero operations remain interactive in the main session (no subagents). Never run a host-wide `pkill llama-server`.

## Required Services

- **Embedder (`127.0.0.1:8082`):** Ask Samuel to run `serve-embedder`; never auto-start.
- **Reranker (`127.0.0.1:8083`):** Fail-closed. Ask Samuel to run `serve-reranker`, then retry. Never substitute unranked results or remote models.
- **Zotero Desktop (`127.0.0.1:23119`):** Required for metadata writes, CSL exports, and live full-text retrieval.
- **Offline / Troubleshooting:** When services fail, wedged APIs occur, or Desktop is closed for SQLite reads, load [service operations](references/service-ops.md).

## Workflows & Reference Routing

### 1. Search & Evidence Retrieval
- **Findings, Mechanisms, Estimates, Equations:** Run `zotero_zotero_semantic_search` (use `collection=<KEY>` to scope). Verify raw `Rerank` score; ignore chunks marked `REF`.
- **Exact DOIs, Raw References, "Who Cites X?":** Run `zotero_zotero_search_references`.
- **Citation Totals:** Count distinct citing items via `zotero_zotero_search_references`. `zotero_zotero_get_collection_hubs` provides directional most-cited rankings based on graph edges, but does not provide exact raw citation totals.
- **Graph Traversal:** Run `zotero_zotero_get_paper_lineage`, `find_connected_papers`, or `get_collection_hubs` with explicit scopes (`collection`, `library`, `collection-expanded`, `library-expanded`).
- For routing logic, scope semantics, and unresolved citations, load [search and retrieval](references/search-retrieval.md).

### 2. Collection Scopes & Keys
- For known collection keys (`Detroit-Paper`, `Methods`, `Theory`, etc.) and dynamic collection discovery, load [collections](references/collections.md).

### 3. Targeted Reading & Sidecar Extraction
- To extract estimates, standard errors, table notes, or specific proofs via `grep`/`sed` without loading full papers into context, load [deep-dive reading](references/deep-dive-reading.md).

### 4. Library Operations, Ingestion & Metadata
- For CLI ingestion (`zotero-auto-ingest`), CSL manuscript exports (`zotero_zotero_export_bibliography`), bulk edits (`zotero_zotero_batch_update`), and lecture note schemas, load [library operations](references/library-ops.md).

### 5. Sidecars & Index Maintenance
- For the 3-stage pipeline (`zotero-sidecar.sh create|enrich|embed|reembed`), BM25 convergence, and ChromaDB recovery, load [index maintenance](references/index-maintenance.md).
