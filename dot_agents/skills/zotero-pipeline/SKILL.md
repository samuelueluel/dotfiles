---
name: zotero-pipeline
description: Operates Zotero OCR, MinerU sidecars, figure enrichment, embeddings, derived indexes, and retrieval-service diagnostics. Use when Samuel requests Zotero parsing, OCR, indexing, re-embedding, pipeline maintenance or recovery, or when a diagnosed Zotero infrastructure failure needs investigation.
---

# Zotero OCR and Embedding Pipeline

## Request-Routing Playbook

```text
REQUEST
├─ Parse PDFs or create sidecars? ─────────────→ PARSE: preflight → detached create
├─ Enrich figures? ───────────────────────────→ ENRICH: authorized VLM run → stop VLM
├─ Embed new/changed source text? ─────────────→ INDEX: exact-item update or scoped embed
├─ Rebuild bibliography or citation graph? ────→ DERIVED INDEX: Desktop/WAL check → dedicated rebuild
├─ Inspect a service/index failure? ───────────→ DIAGNOSE: scoped status/probe → report cause
├─ Pause jobs or recover corrupted indexes? ──→ RECOVER: inspect plan → explicit approval → reviewed helper
└─ Read an existing source or answer research? → RESEARCH: load zotero-research
```

## Safety Boundaries

- Diagnose before changing state. A failed research query is not authorization to rebuild, reinstall, or start services.
- Before stopping index processes, deleting chunks, archiving an index, or permitting a mass rebuild, inspect exact targets and obtain Samuel's explicit approval.
- Use reviewed helpers under `scripts/` for preflight, process pausing, item-chunk deletion, sparse rebuild, and Chroma recovery. Never substitute raw destructive shell commands.
- Never run a host-wide `pkill llama-server`; isolate any authorized operation to the intended service or container.
- Ask Samuel to run `serve-embedder` or `serve-reranker` if unavailable. Never auto-start them or substitute unranked semantic results.
- Never upload PDFs to Zotero Cloud or create library items from files through upload tools. Ingestion and local linking belong to [library management](../zotero-library/SKILL.md).
- Never download, parse, or embed a paper merely because it appears in a bibliography. External reference nodes contain metadata, not processable library sources.
- Never parse MCP gateway temporary output or internal files through shell tools. Use official tools and documented pipeline storage paths.
- Do not enable or disable MCP servers. Do not install native host packages or run `chezmoi apply` from an agent session.

## 1. Scope and Preconditions

Identify the exact parent item keys, collection scope, stage, and intended change.
Inspect current state rather than relying on historical item counts, release tags, process IDs, or notes.
Use [collection keys](../zotero-library/references/collections.md) when a known project scope is needed.

Separate three kinds of work:
- Metadata-only change: no re-embedding.
- Changed source text, parsing, or chunking: refresh affected items.
- Corruption or interrupted indexing: diagnose the affected index before choosing recovery.

Close Zotero Desktop fully and allow WAL checkpointing before graph/reference rebuilds or relying on SQLite-backed changes after writes/sync.
Never treat an immutable SQLite read as current while WAL is active.
Report metadata/filter failures and retry without weakening requested scope.

## 2. OCR and Sidecar Creation

Load [index and parser operations](references/index-maintenance.md) for commands and preflight details.

1. Resolve the intended library source and attachment; do not parse a bibliography entry as though it were a local item.
2. Use the production capability-aware MinerU runner through `zotero-sidecar.sh`, not a copied command from another environment.
3. After changes to the parser environment, config, or package pin, run `scripts/mineru-preflight.py` through the documented Python environment.
4. Run one representative item before a large batch. Check that its log reports completion and its sidecar is non-empty.
5. Run `create` detached so termination of the calling shell does not leave a partial parse. Use the documented memory watchdog for large batches.

Native-text parsing and scanned-document OCR are distinct routes; text mode does not by itself imply missing formula recognition.
Inspect equations, tables, and failure logs when they are the reason for processing.
Do not report a batch complete while jobs are still running or any requested items remain unresolved.
For anomalous GPU failures, use the documented single-item CPU fallback rather than broad parser reconfiguration.

## 3. Figure Enrichment

Enrichment is optional and separate from core text retrieval.
Use `serve-vlm` only for an authorized enrichment run, then stop the VLM immediately after the run to release memory.
Inspect the requested mode before running: adding schemas, forcing replacement, captions-only extraction, and relocation have different effects.
Inspect the resulting schemas/captions, then refresh the affected source text in the index.
Do not re-enrich the collection merely because one figure query was unhelpful.

## 4. Embeddings and Derived Indexes

For exact-item refreshes, use `zotero_update_semantic_index(item_keys=[...])` or:

```text
zotero-mcp-server update-db --fulltext --no-batch --item-key KEY [--item-key OTHERKEY]
```

The exact-key route preserves every requested live parent key, bypasses global DOI/title deduplication, refreshes existing chunks, and leaves global deletion reconciliation and the sync watermark untouched.
Never substitute a DOI/title duplicate for a requested key or broaden a targeted refresh into a library rebuild.

Use collection `embed` only for a genuinely collection-scoped processing request.
A `reembed` operation deletes existing chunks first; it requires the deletion approval above.
Metadata, tag, native type, and collection changes alone do not justify re-embedding.

Use dedicated graph/reference rebuild tools for their derived indexes, not the sidecar parser.
Graph/reference rebuilds require the Desktop/WAL precondition and do not require Chroma re-embedding.
Completed embedding runs normally synchronize sparse BM25; rebuild it manually only for a diagnosed interruption or drift.

Verify the requested items' chunk counts and source metadata, then perform a bounded exact-item retrieval when semantic verification is needed.
A positive relevance score is not proof of faithful OCR or correct source interpretation.

## 5. Diagnosis and Recovery

For errors, load [service operations](references/service-ops.md); for index mutation/recovery, load [index maintenance](references/index-maintenance.md).
Use `zotero_get_semantic_index_status` after a readiness/index error or an explicit status request, not before every research query.
Inspect tool schemas when arguments or capabilities are uncertain.

Distinguish the failing layer: source file, parser, index, embedding endpoint, reranker, Zotero metadata access, or response formatting.
A relevance miss does not establish corruption. Do not rebuild indexes to repair a clipped preview.
Missing `Rerank` means semantic output is discovery-only; source verification can still use direct reading through the research skill.

For a wedged service or container, inspect its state and the intended recovery before an authorized restart.
If repair requires package reinstallation or deployment, obtain authorization and follow the current fork pin rather than an assumed upstream version.
No research request implicitly authorizes deployment changes.

For interrupted jobs or corrupted Chroma, run the reviewed helper's dry-run mode first.
Show exact targets and consequences; proceed with confirmation flags only after Samuel approves them.
The recovery helper archives damaged Chroma and stops if rebuilding fails. Preserve the archive until recovery is verified.
Use exact-key deletion confirmation for individual interrupted items.

## 6. Report Outcomes

Report what changed, what verification succeeded, and what remains unresolved.
Separate source parsing success from index success and successful retrieval.
Do not claim the pipeline is repaired solely because a process started or a command returned.
Ordinary source reading and interpretation belong to [Zotero research](../zotero-research/SKILL.md); library metadata changes belong to [library management](../zotero-library/SKILL.md).

## Reference Routing

- For parser compatibility, detached batch commands, memory protection, exact-key refresh, sparse indexing, or corruption recovery, load [index maintenance](references/index-maintenance.md).
- For endpoint errors, offline SQLite diagnostics, service probes, and deployment failures, load [service operations](references/service-ops.md).
