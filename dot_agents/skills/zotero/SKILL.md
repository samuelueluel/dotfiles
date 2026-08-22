---
name: zotero
description: Manage Samuel's local Zotero library via the zotero MCP server and CLI tools — search literature with hybrid RAG (BM25 + vector + reranker), explore citation graphs, ingest PDFs with imported copies, audit metadata, parse PDFs via MinerU/VLM sidecars, and export manuscript bibliographies. Use when querying Zotero literature, finding papers, extracting empirical findings or figures, ingesting or linking PDFs, auditing metadata, citing in manuscripts, or managing the semantic search index.
---

# Zotero Library Management

## Quick start

- **Citation & Synthesis Contract:** When synthesizing retrieved literature, reporting empirical estimates, or describing citation graphs, you MUST read and adhere to `~/.agents/skills/citation-integrity/SKILL.md`.
- **Storage & Ingestion (CRITICAL — never delete Zotero-directory copies):** Zotero 9, data dir `~/Zotero`. **Never upload PDF bytes to Zotero cloud** or call `zotero_zotero_attach_file`. **Never delete anything from `~/Zotero/storage/`.**
  - **Samuel's setup: PDFs dragged into the GUI are COPIED into `~/Zotero/storage/` (imported copies). Originals stay in Dropbox/Downloads. He expects TWO copies on disk: the original + the Zotero-directory copy. NEVER remove the Zotero copy to "dedupe" against Dropbox — that is data loss from his perspective.**
  - **New-PDF ingestion:** the recommended path is **GUI drag-drop** (Zotero auto-copies into `~/Zotero/storage/`, sets imported_file). If you create items programmatically and the PDF already has a copy in `~/Zotero/storage/` or is meant to, do NOT leave it as a linked-only pointer.
  - CLI tools (`zotero-auto-ingest`, `zotero-link`) create **linked_file pointers (zero-byte, path only)** — those are acceptable ONLY for PDFs that must stay put (e.g. system docs like Stata manuals, or project files you don't want duplicated). For ordinary papers, prefer GUI drag-drop / imported copies; if you create a linked attachment programmatically, tell Samuel it's a linked pointer and needs a drag-drop (or scripted import) to get its storage copy.
  - **Known limitation:** the local Zotero API is read-only (POST/DELETE → "Endpoint does not support method"). Programmatic writes go through the web API as **metadata only** (PDF bytes never leave the machine — file sync is off, no WebDAV). This is the "web nonsense" Samuel has accepted. It means a scripted local import (copy into `~/Zotero/storage/`) is the only fully-automated way to restore storage copies, and it must be done with Zotero closed + backup first.
  - Ingest new PDFs via `zotero-auto-ingest <pdf_path> [--collection <KEY>]` (auto-extracts DOI/Crossref/OpenAlex and creates zero-byte linked attachment; fallback: `zotero_zotero_add_item(source=<DOI/ISBN>, attach_mode="none")` + `zotero-link`). **After CLI ingestion, check whether the PDF also needs a copy in `~/Zotero/storage/` (drag-drop or scripted import) and arrange it — never delete a storage copy.**
- **MCP Calls:** Server `zotero` on `http://127.0.0.1:13308/mcp`. Use direct server-scoped calls (`mcp({server:"zotero", tool, args})`). All tools are named `zotero_zotero_*`.
- **Subagent Policy:** Zotero work is main-session only. Never delegate Zotero tasks to subagents (subagents lack MCP access).
- **Service Preconditions:**
  - *Embedder (:8082):* Required for indexing and search. Ask Samuel to run `serve-embedder`; never auto-start.
  - *Reranker (:8083):* Enhances search ranking. Auto-start via `serve-reranker` if down.
  - *Desktop (:23119):* Required for metadata writes and enrichment. If closed, use read-only SQLite: `sqlite3 "file:$HOME/Zotero/zotero.sqlite?immutable=1"`.
  - *Engine Safety:* Never run host-wide `pkill llama-server` (terminates all containerized engines).

## Workflows

### 1. Ingesting & Managing Paper Metadata
1. **Automated Ingestion (Fast Path):** `zotero-auto-ingest <path_to_pdf> [--collection <KEY>]` (extracts DOI/arXiv/ISBN $\to$ Crossref/OpenAlex $\to$ creates item $\to$ Better BibTeX citekey $\to$ links local PDF).
2. **Manual Ingestion (Fallback):** `zotero_zotero_add_item(source=<DOI/ISBN>, attach_mode="none")` then `~/.local/bin/zotero-link <new_key> <path_to_pdf>`.
3. **Audit & Corrections:** Run `zotero-auto-ingest --enrich-existing [--collection <KEY>]` to backfill missing DOIs. For field edits and lifecycle transitions, see [references/library-ops.md](references/library-ops.md).

### 2. Sidecar Creation & Indexing Pipeline (New PDFs)
```bash
# 3-Stage Ingestion Pipeline (New PDFs)
zotero-sidecar.sh create  <COLLECTION_KEY | KEY...>   # Stage 1: MinerU parse -> Markdown sidecar (GPU)
zotero-sidecar.sh enrich  <COLLECTION_KEY | KEY...>   # Stage 2: Inject [Figure Schema] blocks (needs :8084)
zotero-sidecar.sh embed   <COLLECTION_KEY...>         # Stage 3: Chunk + embed + index into ChromaDB & BM25

# Maintenance / Re-indexing (Modified Sidecars or Chunker Updates)
zotero-sidecar.sh reembed <COLLECTION_KEY...>         # Purges old chunks in ChromaDB first, then re-indexes
```
*Note:* For large batch `create` jobs, run under `zotero-sidecar-watch.sh` for GTT memory protection (see [references/index-maintenance.md](references/index-maintenance.md)). **Always use the `zotero-sidecar.sh` wrapper (it detaches `create`) — never run `zotero-sidecar-create.py` in a foreground/supervised shell; if that shell dies or times out the whole parse batch is reaped silently.** A transient `sqlite3.DatabaseError: database disk image is malformed` mid-batch is the immutable-read race with Zotero writes, not corruption — just re-run (idempotent). See [references/index-maintenance.md](references/index-maintenance.md) §1.

### 3. Search & Retrieval (RAG & Citation Graph)
- **Synthesis Contract:** Before presenting empirical claims, point estimates, or literature structures, you MUST read and follow `~/.agents/skills/citation-integrity/SKILL.md` (brace citations `{Author (Year), passage N/M, Rerank <score>}`, verbatim number verification, confidence gating on `Rerank > 0`, and structural graph citations).
- **Concept / Topic Search:** `zotero_zotero_semantic_search(query, collection=<KEY | NAME>)` (hybrid BM25 + dense vector + cross-encoder reranker; live SQLite collection resolution).
- **Citation Graph Discovery:** `zotero_zotero_get_collection_hubs` (foundational literature), `zotero_zotero_get_paper_lineage` (ancestor & descendant trees), `zotero_zotero_find_connected_papers` (co-citation similarity).
- **Deep-Dive Verification:** Check extracted numbers/formulas against the MinerU sidecar (`~/.config/zotero-mcp/mineru-sidecars/<key>.md`) or `get_item_fulltext` per `citation-integrity` discipline.

## Reference Guides

- **Search & Retrieval (RAG):** Query formulation, econometric concept translation, and two-stage synthesis $\to$ [references/search-retrieval.md](references/search-retrieval.md).
- **Deep-Dive Reading & Sidecar Extraction:** Surgical grep extraction for coefficients, SEs, and tables without desktop $\to$ [references/deep-dive-reading.md](references/deep-dive-reading.md).
- **Library Operations & Citing:** CSL bibliographies, BibTeX exports, BBT citekeys, batch tagging, and item lifecycles $\to$ [references/library-ops.md](references/library-ops.md).
- **Service Operations & SQLite Fallback:** Service error map, embedder probe, and desktop-closed SQLite queries $\to$ [references/service-ops.md](references/service-ops.md).
- **Index Maintenance & Watchdogs:** Batch recovery, GTT watchdogs, pause/resume, sparse index rebuild, and store repairs $\to$ [references/index-maintenance.md](references/index-maintenance.md).
- **Collection Scopes:** Fast lookup table for project collection keys $\to$ [references/collections.md](references/collections.md).
